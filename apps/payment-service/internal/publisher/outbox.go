package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/bytz/payment-service/internal/observability"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const serviceSource = "payment-service"

var tracer = otel.Tracer("payment-service-outbox")

// Envelope mirrors the canonical NATS event shape consumed by other services.
// CorrelationID is the trace_id of the publish span — empty if no valid span.
type Envelope struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Source        string          `json:"source"`
	Timestamp     string          `json:"timestamp"`
	CorrelationID string          `json:"correlationId,omitempty"`
	Data          json.RawMessage `json:"data"`
}

// OutboxPublisher polls outbox_events and forwards them to NATS JetStream.
type OutboxPublisher struct {
	pool    *pgxpool.Pool
	natsURL string
	nc      *nats.Conn
	js      jetstream.JetStream
	stop    chan struct{}
}

func New(pool *pgxpool.Pool, natsURL string) *OutboxPublisher {
	return &OutboxPublisher{pool: pool, natsURL: natsURL, stop: make(chan struct{})}
}

func (p *OutboxPublisher) Start(ctx context.Context) error {
	nc, err := nats.Connect(p.natsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
	)
	if err != nil {
		return fmt.Errorf("connect nats: %w", err)
	}
	p.nc = nc

	js, err := jetstream.New(nc)
	if err != nil {
		return fmt.Errorf("init jetstream: %w", err)
	}
	p.js = js

	go p.loop(ctx)
	slog.Info("payment outbox publisher started")
	return nil
}

func (p *OutboxPublisher) loop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.stop:
			return
		case <-ticker.C:
			if n, err := p.pollAndPublish(ctx); err != nil {
				slog.Warn("outbox poll error", "error", err)
			} else if n > 0 {
				slog.Info("outbox published events", "count", n)
			}
		}
	}
}

func (p *OutboxPublisher) pollAndPublish(ctx context.Context) (int, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, event_type, payload, created_at, retry_count, trace_context
		FROM outbox_events
		WHERE published = false AND retry_count < 3
		ORDER BY created_at ASC
		LIMIT 100
	`)
	if err != nil {
		return 0, fmt.Errorf("query outbox: %w", err)
	}
	defer rows.Close()

	type row struct {
		id           string
		eventType    string
		payload      []byte
		createdAt    time.Time
		retryCount   int
		traceContext []byte
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.eventType, &r.payload, &r.createdAt, &r.retryCount, &r.traceContext); err != nil {
			return 0, fmt.Errorf("scan outbox row: %w", err)
		}
		batch = append(batch, r)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	published := 0
	for _, r := range batch {
		publishCtx := ctx
		if len(r.traceContext) > 0 {
			var carrier map[string]string
			if err := json.Unmarshal(r.traceContext, &carrier); err != nil {
				slog.Warn("restore trace context failed", "id", r.id, "error", err)
			} else {
				publishCtx = observability.RestoreTraceContext(ctx, carrier)
			}
		}

		pubErr := p.publishWithTrace(publishCtx, r.id, r.eventType, r.payload, r.createdAt)
		if pubErr != nil {
			retry := r.retryCount + 1
			p.markRetry(ctx, r.id, retry, pubErr.Error())
			if retry >= 3 {
				p.moveToDLQ(ctx, r.id, r.eventType, r.payload, r.traceContext, pubErr.Error(), retry)
			}
			continue
		}

		if _, err := p.pool.Exec(ctx,
			`UPDATE outbox_events SET published = true, published_at = NOW() WHERE id = $1`, r.id); err != nil {
			slog.Warn("mark outbox published failed", "id", r.id, "error", err)
			continue
		}
		published++
	}
	return published, nil
}

// publishWithTrace wraps JetStream publish in a PRODUCER span, builds the
// envelope (stamping correlationId = trace_id), and injects W3C trace context
// into the message headers for downstream consumers.
func (p *OutboxPublisher) publishWithTrace(ctx context.Context, id, eventType string, payload []byte, createdAt time.Time) error {
	ctx, span := tracer.Start(ctx, fmt.Sprintf("nats.publish %s", eventType),
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(
			attribute.String("messaging.system", "nats"),
			attribute.String("messaging.destination.name", eventType),
			attribute.String("messaging.message.id", id),
			attribute.String("messaging.operation", "publish"),
		),
	)
	defer span.End()

	envelope := Envelope{
		ID:        id,
		Type:      eventType,
		Source:    serviceSource,
		Timestamp: createdAt.UTC().Format(time.RFC3339Nano),
		Data:      payload,
	}
	if sc := span.SpanContext(); sc.IsValid() {
		envelope.CorrelationID = sc.TraceID().String()
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("marshal envelope: %w", err)
	}

	msg := &nats.Msg{
		Subject: eventType,
		Data:    body,
		Header:  nats.Header{},
	}
	observability.InjectNATSHeaders(ctx, msg.Header)

	if _, err := p.js.PublishMsg(ctx, msg, jetstream.WithMsgID(id)); err != nil {
		span.SetStatus(codes.Error, err.Error())
		return err
	}
	return nil
}

func (p *OutboxPublisher) markRetry(ctx context.Context, id string, retry int, errMsg string) {
	_, err := p.pool.Exec(ctx,
		`UPDATE outbox_events SET retry_count = $1, error_message = $2 WHERE id = $3`,
		retry, errMsg, id)
	if err != nil {
		slog.Warn("mark outbox retry failed", "id", id, "error", err)
	}
}

func (p *OutboxPublisher) moveToDLQ(ctx context.Context, originalID, eventType string, payload, traceContext []byte, errMsg string, retry int) {
	dlqID := uuid.Must(uuid.NewV7()).String()
	var traceArg any
	if len(traceContext) > 0 {
		traceArg = traceContext
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO dead_letter_events
			(id, original_event_id, event_type, payload, trace_context, consumer_service, error_message, retry_count, reprocessed, created_at)
		VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, false, NOW())
	`, dlqID, originalID, eventType, payload, traceArg, "payment-service-outbox", errMsg, retry)
	if err != nil {
		slog.Warn("DLQ insert failed", "id", originalID, "error", err)
	}
}

func (p *OutboxPublisher) Stop() {
	close(p.stop)
	if p.nc != nil {
		p.nc.Close()
	}
}

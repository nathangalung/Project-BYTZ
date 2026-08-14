package publisher

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/bytz/payment-service/internal/observability"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

// The pool and JetStream surface the publisher actually uses, narrowed to what
// it calls so the claim and publish paths are reachable from a test without a
// database or a NATS server. *pgxpool.Pool and jetstream.JetStream satisfy
// them.
type pgPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

type msgPublisher interface {
	PublishMsg(ctx context.Context, m *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error)
}

// OutboxPublisher polls outbox_events and forwards them to NATS JetStream.
type OutboxPublisher struct {
	pool    pgPool
	natsURL string
	nc      *nats.Conn
	js      msgPublisher
	stop    chan struct{}
	// Closed by loop on the way out, so Stop can wait for an in-flight publish
	// instead of cutting the connection out from under it.
	done chan struct{}
}

func New(pool *pgxpool.Pool, natsURL string) *OutboxPublisher {
	return &OutboxPublisher{
		pool:    pool,
		natsURL: natsURL,
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
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
	defer close(p.done)
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

const (
	pendingOutboxEventsSQL = `
		SELECT id, event_type, payload, created_at, retry_count, trace_context
		FROM outbox_events
		WHERE published = false AND retry_count < 3
		ORDER BY created_at ASC
		LIMIT 100
	`
	// Two replicas polling the same table would otherwise both take the same
	// rows: wasted work while JetStream's msgID dedup window covers it, double
	// delivery for anything retried outside it. SKIP LOCKED makes the claims
	// disjoint, and claiming one row at a time keeps the lock held across a
	// single publish rather than a whole batch of them.
	claimOutboxEventSQL = `
		SELECT retry_count
		FROM outbox_events
		WHERE id = $1 AND published = false
		FOR UPDATE SKIP LOCKED
	`
)

type outboxRow struct {
	id           string
	eventType    string
	payload      []byte
	createdAt    time.Time
	retryCount   int
	traceContext []byte
}

func (p *OutboxPublisher) pollAndPublish(ctx context.Context) (int, error) {
	batch, err := p.pendingEvents(ctx)
	if err != nil {
		return 0, err
	}

	published := 0
	for _, r := range batch {
		sent, err := p.claimAndPublish(ctx, r)
		if err != nil {
			slog.Warn("outbox claim failed", "id", r.id, "error", err)
			continue
		}
		if sent {
			published++
		}
	}
	return published, nil
}

// pendingEvents reads candidates without locking. The claim below decides who
// actually owns each row, so a stale candidate another replica has taken costs
// one skipped SELECT.
func (p *OutboxPublisher) pendingEvents(ctx context.Context) ([]outboxRow, error) {
	rows, err := p.pool.Query(ctx, pendingOutboxEventsSQL)
	if err != nil {
		return nil, fmt.Errorf("query outbox: %w", err)
	}
	defer rows.Close()

	var batch []outboxRow
	for rows.Next() {
		var r outboxRow
		if err := rows.Scan(&r.id, &r.eventType, &r.payload, &r.createdAt, &r.retryCount, &r.traceContext); err != nil {
			return nil, fmt.Errorf("scan outbox row: %w", err)
		}
		batch = append(batch, r)
	}
	return batch, rows.Err()
}

// claimAndPublish locks one event, publishes it, and records the outcome in the
// same transaction. Reports whether this poller published it: a row already
// held or already finished elsewhere is skipped, not published twice.
func (p *OutboxPublisher) claimAndPublish(ctx context.Context, r outboxRow) (bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin claim: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var retryCount int
	err = tx.QueryRow(ctx, claimOutboxEventSQL, r.id).Scan(&retryCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim outbox event: %w", err)
	}
	if retryCount >= 3 {
		return false, nil
	}

	publishCtx := ctx
	if len(r.traceContext) > 0 {
		var carrier map[string]string
		if err := json.Unmarshal(r.traceContext, &carrier); err != nil {
			slog.Warn("restore trace context failed", "id", r.id, "error", err)
		} else {
			publishCtx = observability.RestoreTraceContext(ctx, carrier)
		}
	}

	if pubErr := p.publishWithTrace(publishCtx, r.id, r.eventType, r.payload, r.createdAt); pubErr != nil {
		// The retry count and DLQ copy commit with the claim. Rolling back here
		// would leave the row at its old count, so it would retry forever and
		// never reach the DLQ.
		retry := retryCount + 1
		p.markRetryTx(ctx, tx, r.id, retry, pubErr.Error())
		if retry >= 3 {
			p.moveToDLQTx(ctx, tx, r.id, r.eventType, r.payload, r.traceContext, pubErr.Error(), retry)
		}
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit publish failure: %w", err)
		}
		return false, nil
	}

	// Marked published only after JetStream acknowledged, and under the lock
	// that kept anyone else off this row.
	if _, err := tx.Exec(ctx,
		`UPDATE outbox_events SET published = true, published_at = NOW() WHERE id = $1`, r.id); err != nil {
		return false, fmt.Errorf("mark outbox published: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit publish: %w", err)
	}
	return true, nil
}

// buildEnvelope serializes the canonical event envelope every consumer parses.
// Pure so the cross-service contract is testable without NATS.
func buildEnvelope(id, eventType string, payload []byte, createdAt time.Time, correlationID string) ([]byte, error) {
	return json.Marshal(Envelope{
		ID:            id,
		Type:          eventType,
		Source:        serviceSource,
		Timestamp:     createdAt.UTC().Format(time.RFC3339Nano),
		CorrelationID: correlationID,
		Data:          payload,
	})
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

	correlationID := ""
	if sc := span.SpanContext(); sc.IsValid() {
		correlationID = sc.TraceID().String()
	}
	body, err := buildEnvelope(id, eventType, payload, createdAt, correlationID)
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

func (p *OutboxPublisher) markRetryTx(ctx context.Context, tx pgx.Tx, id string, retry int, errMsg string) {
	_, err := tx.Exec(ctx,
		`UPDATE outbox_events SET retry_count = $1, error_message = $2 WHERE id = $3`,
		retry, errMsg, id)
	if err != nil {
		slog.Warn("mark outbox retry failed", "id", id, "error", err)
	}
}

func (p *OutboxPublisher) moveToDLQTx(ctx context.Context, tx pgx.Tx, originalID, eventType string, payload, traceContext []byte, errMsg string, retry int) {
	dlqID := uuid.Must(uuid.NewV7()).String()
	var traceArg any
	if len(traceContext) > 0 {
		traceArg = traceContext
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO dead_letter_events
			(id, original_event_id, event_type, payload, trace_context, consumer_service, error_message, retry_count, reprocessed, created_at)
		VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, false, NOW())
	`, dlqID, originalID, eventType, payload, traceArg, "payment-service-outbox", errMsg, retry)
	if err != nil {
		slog.Warn("DLQ insert failed", "id", originalID, "error", err)
	}
}

// Stop waits for the current batch before letting the connection go.
//
// It used to close the stop channel and the connection back to back, without
// waiting for the loop at all, and main closes the database pool one line
// later. A SIGTERM landing inside PublishMsg then had two ways to hurt: the
// message could reach the server while the ack was cut, rolling back the claim
// so the event republished on the next boot - past the two-minute dedupe
// window, so a talent got a second "payment released" email for one payout -
// or the commit landed and a retry_count was burned on a shutdown rather than
// a fault, three of which dead-letter the event and it is never delivered at
// all.
//
// Drain rather than Close so buffered publishes flush. project-service's
// outbox worker already had this shape.
// How long Stop waits for the loop before draining regardless. A variable so
// the give-up path is reachable in a test without a ten second wait.
var stopDrainTimeout = 10 * time.Second

func (p *OutboxPublisher) Stop() {
	close(p.stop)

	select {
	case <-p.done:
	case <-time.After(stopDrainTimeout):
		slog.Warn("outbox publisher did not stop in time; draining anyway")
	}

	if p.nc != nil {
		if err := p.nc.Drain(); err != nil {
			slog.Warn("outbox drain failed, closing", "error", err)
			p.nc.Close()
		}
	}
}

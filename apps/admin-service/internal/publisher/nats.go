package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/bytz/admin-service/internal/observability"
)

const serviceSource = "admin-service-reprocess"

var tracer = otel.Tracer("admin-service-publisher")

// Envelope mirrors the shared NATS event shape.
type Envelope struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Source        string          `json:"source"`
	Timestamp     string          `json:"timestamp"`
	CorrelationID string          `json:"correlationId,omitempty"`
	Data          json.RawMessage `json:"data"`
}

// Publisher re-publishes DLQ payloads back to JetStream.
type Publisher interface {
	Republish(ctx context.Context, originalEventID, eventType string, payload, traceContext []byte) error
	Close()
}

// NATSPublisher is a JetStream-backed Publisher.
type NATSPublisher struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// Connect opens a NATS connection and JetStream context.
func Connect(natsURL string) (*NATSPublisher, error) {
	nc, err := nats.Connect(natsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("connect nats: %w", err)
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("init jetstream: %w", err)
	}
	return &NATSPublisher{nc: nc, js: js}, nil
}

// Republish reconstructs the original envelope and publishes to JetStream.
// The envelope keeps the original event ID so consumer-side idempotency
// stays meaningful. A fresh msgID bypasses JetStream's dedup window so
// reprocessing is not silently swallowed when it lands within 2 minutes
// of the prior failed publish.
func (p *NATSPublisher) Republish(ctx context.Context, originalEventID, eventType string, payload, traceContext []byte) error {
	if len(traceContext) > 0 {
		var carrier map[string]string
		if err := json.Unmarshal(traceContext, &carrier); err == nil {
			ctx = observability.RestoreTraceContext(ctx, carrier)
		}
	}

	ctx, span := tracer.Start(ctx, fmt.Sprintf("nats.publish %s", eventType),
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(
			attribute.String("messaging.system", "nats"),
			attribute.String("messaging.destination.name", eventType),
			attribute.String("messaging.message.id", originalEventID),
			attribute.String("messaging.operation", "publish"),
			attribute.Bool("admin.dlq.reprocess", true),
		),
	)
	defer span.End()

	envelope := Envelope{
		ID:        originalEventID,
		Type:      eventType,
		Source:    serviceSource,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
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

	publishMsgID := uuid.Must(uuid.NewV7()).String()
	if _, err := p.js.PublishMsg(ctx, msg, jetstream.WithMsgID(publishMsgID)); err != nil {
		span.SetStatus(codes.Error, err.Error())
		return err
	}
	return nil
}

// Close drains and closes the underlying NATS connection.
func (p *NATSPublisher) Close() {
	if p.nc == nil {
		return
	}
	if err := p.nc.Drain(); err != nil {
		slog.Warn("nats drain failed", "error", err)
	}
}

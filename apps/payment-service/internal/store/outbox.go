package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/bytz/payment-service/internal/observability"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// OutboxEvent represents a row in outbox_events.
type OutboxEvent struct {
	AggregateType string
	AggregateID   string
	EventType     string
	Payload       map[string]any
}

// Insert outbox event with captured trace context.
func InsertOutboxEventTx(ctx context.Context, tx pgx.Tx, e OutboxEvent) error {
	id := uuid.Must(uuid.NewV7()).String()
	payloadJSON, err := json.Marshal(e.Payload)
	if err != nil {
		return fmt.Errorf("marshal outbox payload: %w", err)
	}

	var traceJSON []byte
	if tc := observability.CaptureTraceContext(ctx); tc != nil {
		traceJSON, err = json.Marshal(tc)
		if err != nil {
			return fmt.Errorf("marshal trace context: %w", err)
		}
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, trace_context, published, retry_count, created_at)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, false, 0, NOW())
	`, id, e.AggregateType, e.AggregateID, e.EventType, payloadJSON, traceJSON)
	if err != nil {
		return fmt.Errorf("insert outbox event: %w", err)
	}
	return nil
}

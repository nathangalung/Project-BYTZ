package store

import (
	"context"
	"encoding/json"
	"fmt"

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

// InsertOutboxEventTx inserts an outbox event within an existing transaction.
// The outbox-publisher polls this table and emits to NATS JetStream.
func InsertOutboxEventTx(ctx context.Context, tx pgx.Tx, e OutboxEvent) error {
	id := uuid.Must(uuid.NewV7()).String()
	payloadJSON, err := json.Marshal(e.Payload)
	if err != nil {
		return fmt.Errorf("marshal outbox payload: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, published, retry_count, created_at)
		VALUES ($1, $2, $3, $4, $5::jsonb, false, 0, NOW())
	`, id, e.AggregateType, e.AggregateID, e.EventType, payloadJSON)
	if err != nil {
		return fmt.Errorf("insert outbox event: %w", err)
	}
	return nil
}

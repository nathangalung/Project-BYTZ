package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type DeadLetterInput struct {
	OriginalEventID string
	EventType       string
	Payload         []byte
	ConsumerService string
	ErrorMessage    string
	RetryCount      int
}

// Parks an event JetStream is about to drop.
func (s *Store) RecordDeadLetter(ctx context.Context, in DeadLetterInput) error {
	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate uuid: %w", err)
	}

	_, err = s.pool.Exec(ctx,
		`INSERT INTO dead_letter_events
		   (id, original_event_id, event_type, payload, consumer_service, error_message, retry_count)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id.String(), in.OriginalEventID, in.EventType, in.Payload,
		in.ConsumerService, in.ErrorMessage, in.RetryCount,
	)
	if err != nil {
		return fmt.Errorf("insert dead letter: %w", err)
	}
	return nil
}

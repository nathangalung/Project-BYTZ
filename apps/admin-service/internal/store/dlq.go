package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DLQEvent struct {
	ID              string          `json:"id"`
	OriginalEventID string          `json:"originalEventId"`
	EventType       string          `json:"eventType"`
	Payload         json.RawMessage `json:"payload"`
	TraceContext    json.RawMessage `json:"traceContext,omitempty"`
	ConsumerService string          `json:"consumerService"`
	ErrorMessage    string          `json:"errorMessage"`
	RetryCount      int             `json:"retryCount"`
	Reprocessed     bool            `json:"reprocessed"`
	ReprocessedAt   *time.Time      `json:"reprocessedAt"`
	CreatedAt       time.Time       `json:"createdAt"`
}

type DLQListResult struct {
	Items []DLQEvent `json:"items"`
	Total int64      `json:"total"`
}

type DLQFilters struct {
	EventType       string
	ConsumerService string
	Reprocessed     *bool
	Page            int
	PageSize        int
}

type DLQStore struct {
	pool *pgxpool.Pool
}

func NewDLQStore(pool *pgxpool.Pool) *DLQStore {
	return &DLQStore{pool: pool}
}

// GetDLQList returns paginated DLQ events with optional filters.
func (s *DLQStore) GetDLQList(ctx context.Context, f DLQFilters) (*DLQListResult, error) {
	offset := (f.Page - 1) * f.PageSize

	baseWhere := `WHERE 1=1`
	args := []any{}
	argIdx := 1

	if f.EventType != "" {
		baseWhere += fmt.Sprintf(` AND event_type = $%d`, argIdx)
		args = append(args, f.EventType)
		argIdx++
	}
	if f.ConsumerService != "" {
		baseWhere += fmt.Sprintf(` AND consumer_service = $%d`, argIdx)
		args = append(args, f.ConsumerService)
		argIdx++
	}
	if f.Reprocessed != nil {
		baseWhere += fmt.Sprintf(` AND reprocessed = $%d`, argIdx)
		args = append(args, *f.Reprocessed)
		argIdx++
	}

	countQuery := `SELECT COUNT(*) FROM dead_letter_events ` + baseWhere
	var total int64
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count dlq events: %w", err)
	}

	itemsQuery := fmt.Sprintf(
		`SELECT id, original_event_id, event_type, payload, trace_context,
		        consumer_service, error_message, retry_count, reprocessed,
		        reprocessed_at, created_at
		 FROM dead_letter_events %s
		 ORDER BY created_at DESC
		 LIMIT $%d OFFSET $%d`,
		baseWhere, argIdx, argIdx+1)
	args = append(args, f.PageSize, offset)

	rows, err := s.pool.Query(ctx, itemsQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("list dlq events: %w", err)
	}
	defer rows.Close()

	var items []DLQEvent
	for rows.Next() {
		var e DLQEvent
		if err := rows.Scan(&e.ID, &e.OriginalEventID, &e.EventType, &e.Payload,
			&e.TraceContext, &e.ConsumerService, &e.ErrorMessage, &e.RetryCount,
			&e.Reprocessed, &e.ReprocessedAt, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan dlq event: %w", err)
		}
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []DLQEvent{}
	}

	return &DLQListResult{Items: items, Total: total}, nil
}

// GetDLQByID returns a single DLQ event, or nil if not found.
func (s *DLQStore) GetDLQByID(ctx context.Context, id string) (*DLQEvent, error) {
	var e DLQEvent
	err := s.pool.QueryRow(ctx,
		`SELECT id, original_event_id, event_type, payload, trace_context,
		        consumer_service, error_message, retry_count, reprocessed,
		        reprocessed_at, created_at
		 FROM dead_letter_events
		 WHERE id = $1`, id).
		Scan(&e.ID, &e.OriginalEventID, &e.EventType, &e.Payload,
			&e.TraceContext, &e.ConsumerService, &e.ErrorMessage, &e.RetryCount,
			&e.Reprocessed, &e.ReprocessedAt, &e.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get dlq event: %w", err)
	}
	return &e, nil
}

// MarkReprocessed flags a DLQ event as reprocessed. Returns the updated row,
// or nil if the event does not exist.
func (s *DLQStore) MarkReprocessed(ctx context.Context, id string) (*DLQEvent, error) {
	now := time.Now().UTC()
	var e DLQEvent
	err := s.pool.QueryRow(ctx,
		`UPDATE dead_letter_events
		 SET reprocessed = true, reprocessed_at = $1
		 WHERE id = $2
		 RETURNING id, original_event_id, event_type, payload, trace_context,
		           consumer_service, error_message, retry_count, reprocessed,
		           reprocessed_at, created_at`,
		now, id).
		Scan(&e.ID, &e.OriginalEventID, &e.EventType, &e.Payload,
			&e.TraceContext, &e.ConsumerService, &e.ErrorMessage, &e.RetryCount,
			&e.Reprocessed, &e.ReprocessedAt, &e.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("mark dlq reprocessed: %w", err)
	}
	return &e, nil
}

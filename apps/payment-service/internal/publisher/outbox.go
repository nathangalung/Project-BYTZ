package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const serviceSource = "payment-service"

// Envelope mirrors the canonical NATS event shape consumed by other services.
type Envelope struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Source    string          `json:"source"`
	Timestamp string          `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
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
		SELECT id, event_type, payload, created_at, retry_count
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
		id         string
		eventType  string
		payload    []byte
		createdAt  time.Time
		retryCount int
	}
	var batch []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.eventType, &r.payload, &r.createdAt, &r.retryCount); err != nil {
			return 0, fmt.Errorf("scan outbox row: %w", err)
		}
		batch = append(batch, r)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	published := 0
	for _, r := range batch {
		envelope := Envelope{
			ID:        r.id,
			Type:      r.eventType,
			Source:    serviceSource,
			Timestamp: r.createdAt.UTC().Format(time.RFC3339Nano),
			Data:      r.payload,
		}
		body, err := json.Marshal(envelope)
		if err != nil {
			p.markRetry(ctx, r.id, r.retryCount+1, err.Error())
			continue
		}

		_, err = p.js.Publish(ctx, r.eventType, body, jetstream.WithMsgID(r.id))
		if err != nil {
			retry := r.retryCount + 1
			p.markRetry(ctx, r.id, retry, err.Error())
			if retry >= 3 {
				p.moveToDLQ(ctx, r.id, r.eventType, r.payload, err.Error(), retry)
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

func (p *OutboxPublisher) markRetry(ctx context.Context, id string, retry int, errMsg string) {
	_, err := p.pool.Exec(ctx,
		`UPDATE outbox_events SET retry_count = $1, error_message = $2 WHERE id = $3`,
		retry, errMsg, id)
	if err != nil {
		slog.Warn("mark outbox retry failed", "id", id, "error", err)
	}
}

func (p *OutboxPublisher) moveToDLQ(ctx context.Context, originalID, eventType string, payload []byte, errMsg string, retry int) {
	dlqID := uuid.Must(uuid.NewV7()).String()
	_, err := p.pool.Exec(ctx, `
		INSERT INTO dead_letter_events
			(id, original_event_id, event_type, payload, consumer_service, error_message, retry_count, reprocessed, created_at)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, false, NOW())
	`, dlqID, originalID, eventType, payload, "payment-service-outbox", errMsg, retry)
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

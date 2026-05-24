// Package idempotency provides consumer-side event dedup so JetStream
// redeliveries (or accidental replays from DLQ) don't double-process.
package idempotency

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Idempotency tracks which event IDs have already been processed.
type Idempotency interface {
	// Seen reports whether the event was previously processed.
	Seen(ctx context.Context, eventID string) (bool, error)
	// MarkSeen records that the event has been processed.
	MarkSeen(ctx context.Context, eventID string) error
}

// RedisStore uses Redis string keys with TTL. Recommended TTL: 7 days
// (per CLAUDE.md spec) to outlive JetStream's redelivery window.
type RedisStore struct {
	client *redis.Client
	prefix string
	ttl    time.Duration
}

func NewRedisStore(client *redis.Client, prefix string, ttl time.Duration) *RedisStore {
	if prefix == "" {
		prefix = "notif:idem:"
	}
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	return &RedisStore{client: client, prefix: prefix, ttl: ttl}
}

func (r *RedisStore) key(id string) string {
	return r.prefix + id
}

func (r *RedisStore) Seen(ctx context.Context, eventID string) (bool, error) {
	if eventID == "" {
		return false, errors.New("idempotency: empty event id")
	}
	n, err := r.client.Exists(ctx, r.key(eventID)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r *RedisStore) MarkSeen(ctx context.Context, eventID string) error {
	if eventID == "" {
		return errors.New("idempotency: empty event id")
	}
	return r.client.Set(ctx, r.key(eventID), "1", r.ttl).Err()
}

// NoOp disables idempotency entirely. Used when Redis is unreachable so
// the consumer remains functional (JetStream MaxDeliver still bounds
// duplicate risk). Every call treats the event as unseen.
type NoOp struct{}

func (NoOp) Seen(context.Context, string) (bool, error) { return false, nil }
func (NoOp) MarkSeen(context.Context, string) error     { return nil }

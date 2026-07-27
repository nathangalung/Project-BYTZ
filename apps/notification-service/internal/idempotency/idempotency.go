// Package idempotency provides consumer-side event dedup so JetStream
// redeliveries (or accidental replays from DLQ) don't double-process.
package idempotency

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Idempotency decides which delivery of an event gets to process it.
//
// This was Seen + MarkSeen, an EXISTS followed by a SET that the consumer ran
// after the handler returned. That left the whole handler unprotected, and the
// handlers are not fast: team formation delivers an in-app message and an email
// per talent, so an eight-talent team runs about two minutes against a 30s
// AckWait. JetStream redelivered while the first run was still going, the
// second run saw nothing recorded, and the team got the same offer email two or
// three times. notifications has no unique constraint to catch it either.
//
// Claim is the same decision made atomically and made first.
type Idempotency interface {
	// Claim reports whether this caller may process the event. Exactly one
	// concurrent caller gets true; the rest get false and should skip.
	Claim(ctx context.Context, eventID string) (bool, error)
	// Release drops a claim so a failed delivery can be retried. Callers that
	// succeed keep the claim, which is what makes the next delivery a no-op.
	Release(ctx context.Context, eventID string) error
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

// Claim is SET NX EX: the write and the test are one round trip, so two
// concurrent deliveries cannot both win.
func (r *RedisStore) Claim(ctx context.Context, eventID string) (bool, error) {
	if eventID == "" {
		return false, errors.New("idempotency: empty event id")
	}
	return r.client.SetNX(ctx, r.key(eventID), "1", r.ttl).Result()
}

func (r *RedisStore) Release(ctx context.Context, eventID string) error {
	if eventID == "" {
		return errors.New("idempotency: empty event id")
	}
	return r.client.Del(ctx, r.key(eventID)).Err()
}

// NoOp disables idempotency entirely. Used when Redis is unreachable so
// the consumer remains functional (JetStream MaxDeliver still bounds
// duplicate risk). Every call is granted the claim.
type NoOp struct{}

func (NoOp) Claim(context.Context, string) (bool, error) { return true, nil }
func (NoOp) Release(context.Context, string) error       { return nil }

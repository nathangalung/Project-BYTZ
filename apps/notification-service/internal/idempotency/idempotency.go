// Package idempotency provides consumer-side event dedup so JetStream
// redeliveries (or accidental replays from DLQ) don't double-process.
package idempotency

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Status is what a delivery learns when it asks to process an event.
type Status int

const (
	// StatusInFlight: another delivery holds an unexpired lease and has not
	// finished. Acking here is what lost the notification when that other run
	// died, so a delivery that sees this asks for the message back instead.
	// It is the zero value on purpose: an unknown answer must never be read as
	// "already delivered".
	StatusInFlight Status = iota
	// StatusClaimed: this delivery owns the event and must process it.
	StatusClaimed
	// StatusDone: an earlier delivery processed the event through to its ack.
	// This one is a genuine duplicate and is dropped.
	StatusDone
)

// ErrLeaseLost reports that a lease being refreshed is no longer held, which
// means another delivery may already have taken the event over.
var ErrLeaseLost = errors.New("idempotency: lease expired or was released")

// LeaseTTL is how long an unrefreshed claim survives.
//
// It has to be shorter than the consumer's AckWait. A process that dies mid
// handler stops refreshing, and both deadlines are anchored to that last
// refresh: the lease must be gone by the time JetStream redelivers, or the
// redelivery reads a claim nobody is working on as a duplicate and acks the
// notification away. The claim used to live for seven days, so one crash
// poisoned the event for a week.
const LeaseTTL = 20 * time.Second

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
// Claim is the same decision made atomically and made first. It hands out a
// short lease rather than a permanent record: the permanent record is written
// by Complete, once the work is provably finished.
type Idempotency interface {
	// Claim reports whether this caller may process the event. Exactly one
	// concurrent caller gets StatusClaimed; the rest learn whether the event is
	// finished (StatusDone) or still being worked on (StatusInFlight).
	Claim(ctx context.Context, eventID string) (Status, error)
	// Refresh pushes the lease of a claim this caller still holds forward. It
	// is what tells the rest of the fleet the holder is alive.
	Refresh(ctx context.Context, eventID string) error
	// Complete records the event as processed for good. Called only after the
	// work succeeded and the message was acked, so a crash before that point
	// leaves the lease to expire and the event to be redelivered.
	Complete(ctx context.Context, eventID string) error
	// Release drops a claim so a failed delivery can be retried immediately
	// rather than waiting out the lease.
	Release(ctx context.Context, eventID string) error
}

// Key values. The lease and the finished record share one key so Claim learns
// which it found in a single read.
const (
	leaseValue = "in-flight"
	doneValue  = "done"
)

// RedisStore uses Redis string keys with TTL. ttl is how long a *completed*
// event stays recorded: 7 days (per CLAUDE.md spec) to outlive JetStream's
// redelivery window. An unfinished claim only ever holds LeaseTTL.
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
// concurrent deliveries cannot both win. A caller that loses reads the value
// back to learn whether it lost to a finished run or to a live one.
func (r *RedisStore) Claim(ctx context.Context, eventID string) (Status, error) {
	if eventID == "" {
		return StatusInFlight, errors.New("idempotency: empty event id")
	}
	key := r.key(eventID)

	acquired, err := r.client.SetNX(ctx, key, leaseValue, LeaseTTL).Result()
	if err != nil {
		return StatusInFlight, err
	}
	if acquired {
		return StatusClaimed, nil
	}

	value, err := r.client.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		// The lease expired between the two round trips, so the holder is gone
		// and the event is free. Taking it here is what turns a dead claim back
		// into a delivery instead of a phantom duplicate.
		acquired, err := r.client.SetNX(ctx, key, leaseValue, LeaseTTL).Result()
		if err != nil {
			return StatusInFlight, err
		}
		if acquired {
			return StatusClaimed, nil
		}
		return StatusInFlight, nil
	}
	if err != nil {
		return StatusInFlight, err
	}
	if value == doneValue {
		return StatusDone, nil
	}
	return StatusInFlight, nil
}

// Refresh extends an existing lease. EXPIRE rather than SET, so a lease that
// has already lapsed is reported instead of being resurrected under whoever
// took the event over.
func (r *RedisStore) Refresh(ctx context.Context, eventID string) error {
	if eventID == "" {
		return errors.New("idempotency: empty event id")
	}
	extended, err := r.client.Expire(ctx, r.key(eventID), LeaseTTL).Result()
	if err != nil {
		return err
	}
	if !extended {
		return ErrLeaseLost
	}
	return nil
}

// Complete replaces the lease with the finished record and its long TTL.
func (r *RedisStore) Complete(ctx context.Context, eventID string) error {
	if eventID == "" {
		return errors.New("idempotency: empty event id")
	}
	return r.client.Set(ctx, r.key(eventID), doneValue, r.ttl).Err()
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

func (NoOp) Claim(context.Context, string) (Status, error) { return StatusClaimed, nil }
func (NoOp) Refresh(context.Context, string) error         { return nil }
func (NoOp) Complete(context.Context, string) error        { return nil }
func (NoOp) Release(context.Context, string) error         { return nil }

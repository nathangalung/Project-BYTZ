package store

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// SQLSTATEs Postgres raises when it refuses to order two transactions rather
// than because anything is wrong with either of them.
//
// 40001 is what SERIALIZABLE raises when the serializable snapshot isolation
// check cannot find a serial order for a set of transactions that really did
// overlap; 40P01 is the deadlock detector picking a victim. Both are documented
// by Postgres as retryable: the losing transaction rolled back completely, so
// replaying it from the top is safe and usually succeeds.
const (
	serializationFailureCode = "40001"
	deadlockDetectedCode     = "40P01"
)

// How many times a serializable money transaction is replayed before the
// conflict is reported to the caller.
//
// Bounded rather than open-ended: a retry loop that never gives up turns a
// genuinely contended row into a request that hangs for its whole deadline.
// Four retries clears the contention these paths actually see - two deliveries
// of one webhook, or an owner release racing the hourly auto-release sweep -
// and a fifth conflict means something is wrong that waiting will not fix.
const maxSerializableAttempts = 5

// Backoff between attempts. Small because the conflicting transaction has
// already committed by the time 40001 surfaces, so the next attempt only has to
// miss the next one; jittered so two deliveries that collided once do not
// collide again in lockstep.
const (
	serializableBackoffBase = 5 * time.Millisecond
	serializableBackoffMax  = 80 * time.Millisecond
)

// SerializableLabels name the two framing errors of a serializable transaction.
//
// They exist so each money path keeps the exact error wording its own callers
// and tests already match on, rather than every path suddenly reporting one
// generic message from in here.
type SerializableLabels struct {
	Begin  string
	Commit string
}

// IsSerializationConflict reports whether err is Postgres refusing to order two
// overlapping transactions, which is a retryable outcome rather than a failure.
//
// Keyed on SQLSTATE, not on the message text, which is localised and has
// changed between major versions.
func IsSerializationConflict(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == serializationFailureCode || pgErr.Code == deadlockDetectedCode
}

/*
RunSerializable runs body inside a SERIALIZABLE transaction, replaying the whole
body when Postgres answers with a serialization conflict.

The retry is the point. ReleaseEscrow and ProcessRefund already opened
SERIALIZABLE transactions, so two concurrent draws on one escrow pool correctly
produced SQLSTATE 40001 for the loser and the balance held - but that 40001 came
straight back to the caller as an error. The transaction row for that attempt
was created on the pool before the money transaction opened, so it stayed
committed and pending under an idempotency key that was now spent: the retry
that key exists to allow returned the pending row as a settlement, and the
milestone was never paid at all. A legitimate concurrent release has to succeed,
not surface a database implementation detail to project-service.

body receives the attempt number, zero-based. A path that is only safe to replay
after re-reading state it read outside the transaction uses it to re-check on
every attempt after the first; see ReleaseEscrow.

Each attempt gets its own transaction, and an attempt that returns any other
error - an insufficient balance, an unbalanced ledger set - is final and is
returned as it is.
*/
func RunSerializable[T any](
	ctx context.Context,
	pool PoolIface,
	labels SerializableLabels,
	body func(tx pgx.Tx, attempt int) (T, error),
) (T, error) {
	var zero T

	for attempt := 0; ; attempt++ {
		tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
		if err != nil {
			return zero, fmt.Errorf("%s: %w", labels.Begin, err)
		}

		out, err := runSerializableAttempt(ctx, tx, attempt, labels, body)
		if err == nil {
			return out, nil
		}
		if !IsSerializationConflict(err) || attempt+1 >= maxSerializableAttempts {
			return zero, err
		}
		if waitErr := waitBeforeRetry(ctx, attempt); waitErr != nil {
			return zero, waitErr
		}
	}
}

// runSerializableAttempt is one attempt, in its own function so the rollback can
// be deferred: deferring inside the retry loop would stack every attempt's
// rollback until RunSerializable returned, with each one running against a
// transaction that had already been closed several attempts ago.
//
// Rollback after a successful commit is a no-op that reports ErrTxClosed, which
// is why its error is discarded here exactly as it is at every other call site.
func runSerializableAttempt[T any](
	ctx context.Context,
	tx pgx.Tx,
	attempt int,
	labels SerializableLabels,
	body func(tx pgx.Tx, attempt int) (T, error),
) (T, error) {
	var zero T
	defer tx.Rollback(ctx) //nolint:errcheck

	out, err := body(tx, attempt)
	if err != nil {
		return zero, err
	}

	// Commit is a second place 40001 appears: the serializable check is
	// deferred to commit time whenever the conflict could not be detected
	// earlier, so a body that ran cleanly can still be refused here.
	if err := tx.Commit(ctx); err != nil {
		if IsSerializationConflict(err) {
			return zero, err
		}
		return zero, fmt.Errorf("%s: %w", labels.Commit, err)
	}
	return out, nil
}

// waitBeforeRetry sleeps for a jittered, capped exponential backoff, or returns
// the context's error if the caller gave up while it waited.
func waitBeforeRetry(ctx context.Context, attempt int) error {
	backoff := serializableBackoffBase << attempt
	if backoff > serializableBackoffMax {
		backoff = serializableBackoffMax
	}
	// Full jitter: the whole window is the random range, so two transactions
	// that collided pick different retry moments instead of the same one.
	wait := time.Duration(rand.Int64N(int64(backoff)) + 1)

	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

package store

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func pgErr(code string) error {
	return &pgconn.PgError{Severity: "ERROR", Code: code, Message: "conflict"}
}

func TestIsSerializationConflict(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"serialization failure", pgErr("40001"), true},
		{"deadlock detected", pgErr("40P01"), true},
		{"wrapped serialization failure", fmt.Errorf("create ledger entries: %w", pgErr("40001")), true},
		{"unique violation is not retryable", pgErr("23505"), false},
		{"foreign key violation is not retryable", pgErr("23503"), false},
		{"a plain error is not retryable", errors.New("serialization failure"), false},
		{"nil", nil, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsSerializationConflict(tt.err); got != tt.want {
				t.Errorf("IsSerializationConflict(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// retryPool counts the transactions RunSerializable opens and hands each attempt
// a transaction whose commit outcome the test decides.
type retryPool struct {
	begins   int
	commits  int
	rollacks int
	beginErr error
	// commitErrs is consumed one per attempt; a short slice commits cleanly
	// from then on.
	commitErrs []error
}

func (p *retryPool) pool() *MockPool {
	return &MockPool{
		BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) {
			if p.beginErr != nil {
				return nil, p.beginErr
			}
			attempt := p.begins
			p.begins++
			return &MockTx{
				CommitFn: func(context.Context) error {
					p.commits++
					if attempt < len(p.commitErrs) {
						return p.commitErrs[attempt]
					}
					return nil
				},
				RollbackFn: func(context.Context) error { p.rollacks++; return nil },
			}, nil
		},
	}
}

/*
The defect this helper exists for: ReleaseEscrow and ProcessRefund already ran
at SERIALIZABLE, so two concurrent draws on one escrow pool correctly produced
40001 for the loser and the balance held - but nothing retried it. The loser's
transaction row was already committed as pending under an idempotency key that
was now spent, so the retry that key exists to allow returned that pending row
as a settlement and the milestone was never paid.

A legitimate concurrent money movement has to end in a commit, not in a database
implementation detail reaching project-service as an error.
*/
func TestRunSerializable_RetriesOnlyConflicts(t *testing.T) {
	tests := []struct {
		name string
		// bodyErrs is consumed one per attempt.
		bodyErrs   []error
		commitErrs []error
		beginErr   error
		wantBegins int
		wantOut    int
		wantErr    string
	}{
		{
			name:       "a clean body commits on the first attempt",
			wantBegins: 1,
			wantOut:    1,
		},
		{
			name:       "a conflict in the body is replayed until it succeeds",
			bodyErrs:   []error{pgErr("40001"), pgErr("40001")},
			wantBegins: 3,
			wantOut:    3,
		},
		{
			// Serializable snapshot isolation defers part of its check to
			// commit time, so a body that ran cleanly can still be refused.
			name:       "a conflict at commit is replayed too",
			commitErrs: []error{pgErr("40001")},
			wantBegins: 2,
			wantOut:    2,
		},
		{
			name:       "a deadlock is replayed",
			bodyErrs:   []error{pgErr("40P01")},
			wantBegins: 2,
			wantOut:    2,
		},
		{
			// An insufficient balance is the answer, not a collision. Replaying
			// it would only ask the same question four more times.
			name:       "an application error is final",
			bodyErrs:   []error{errors.New("insufficient escrow balance")},
			wantBegins: 1,
			wantErr:    "insufficient escrow balance",
		},
		{
			name:       "a unique violation is final",
			bodyErrs:   []error{pgErr("23505")},
			wantBegins: 1,
			wantErr:    "ERROR: conflict (SQLSTATE 23505)",
		},
		{
			// Bounded: a row that is genuinely contended must fail rather than
			// hold the request open for its whole deadline.
			name: "unrelenting contention gives up after the attempt budget",
			bodyErrs: []error{
				pgErr("40001"), pgErr("40001"), pgErr("40001"), pgErr("40001"), pgErr("40001"),
			},
			wantBegins: maxSerializableAttempts,
			wantErr:    "ERROR: conflict (SQLSTATE 40001)",
		},
		{
			name:       "a transaction that cannot be opened is labelled",
			beginErr:   errors.New("pool exhausted"),
			wantBegins: 0,
			wantErr:    "begin release tx: pool exhausted",
		},
		{
			name:       "a commit failure that is not a conflict is labelled",
			commitErrs: []error{errors.New("connection reset")},
			wantBegins: 1,
			wantErr:    "commit release tx: connection reset",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &retryPool{beginErr: tt.beginErr, commitErrs: tt.commitErrs}

			got, err := RunSerializable(context.Background(), p.pool(),
				SerializableLabels{Begin: "begin release tx", Commit: "commit release tx"},
				func(_ pgx.Tx, attempt int) (int, error) {
					if attempt < len(tt.bodyErrs) {
						return 0, tt.bodyErrs[attempt]
					}
					return attempt + 1, nil
				})

			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if got != tt.wantOut {
					t.Errorf("result = %d, want %d (the attempt that committed)", got, tt.wantOut)
				}
			} else if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}

			if p.begins != tt.wantBegins {
				t.Errorf("opened %d transactions, want %d", p.begins, tt.wantBegins)
			}
			// Every attempt that was opened has to be closed, or a refused
			// release leaks its connection back into the pool still in a
			// transaction.
			if p.rollacks != p.begins {
				t.Errorf("rolled back %d of %d transactions", p.rollacks, p.begins)
			}
		})
	}
}

// The isolation level is the other half of the guarantee: the retry is only
// correct because the transaction it replays was refused rather than allowed
// through on a stale read.
func TestRunSerializable_AlwaysAsksForSerializable(t *testing.T) {
	var seen []pgx.TxIsoLevel
	pool := &MockPool{
		BeginTxFn: func(_ context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
			seen = append(seen, opts.IsoLevel)
			return &MockTx{}, nil
		},
	}

	attempts := 0
	if _, err := RunSerializable(context.Background(), pool, SerializableLabels{},
		func(_ pgx.Tx, _ int) (struct{}, error) {
			attempts++
			if attempts < 3 {
				return struct{}{}, pgErr("40001")
			}
			return struct{}{}, nil
		}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(seen) != 3 {
		t.Fatalf("opened %d transactions, want 3", len(seen))
	}
	for i, iso := range seen {
		if iso != pgx.Serializable {
			t.Errorf("attempt %d ran at %q, want serializable", i, iso)
		}
	}
}

// A caller that gave up must not be kept waiting through the backoff.
func TestRunSerializable_StopsWhenTheCallerGivesUp(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pool := &MockPool{
		BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) { return &MockTx{}, nil },
	}

	_, err := RunSerializable(ctx, pool, SerializableLabels{},
		func(_ pgx.Tx, _ int) (struct{}, error) {
			cancel()
			return struct{}{}, pgErr("40001")
		})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}

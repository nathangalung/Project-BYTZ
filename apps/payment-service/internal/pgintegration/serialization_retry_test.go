package pgintegration

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kerjacus/payment-service/internal/service"
	"github.com/kerjacus/payment-service/internal/store"
	"github.com/kerjacus/payment-service/internal/testsupport"
)

/*
conflictingLedgerStore is a real LedgerStore with one thing added: on its first
posting it commits a competing write to the escrow account from a second
connection, so the posting that follows is guaranteed to be refused with
SQLSTATE 40001.

The competing write has to land after the money transaction has taken its
snapshot and before it writes, which is exactly where CreateLedgerEntriesTx sits
- the callers read the escrow balance first and post afterwards. Racing two
goroutines instead would reproduce the conflict only sometimes, and a money test
that sometimes exercises the bug is not a test.

It touches updated_at rather than balance so the books are still exact
afterwards: the conflict is injected, the money is not.
*/
type conflictingLedgerStore struct {
	*store.LedgerStore

	pool      *pgxpool.Pool
	accountID string
	conflicts int
}

func (s *conflictingLedgerStore) CreateLedgerEntriesTx(ctx context.Context, tx pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
	if s.conflicts == 0 {
		s.conflicts++
		if _, err := s.pool.Exec(ctx,
			`UPDATE accounts SET updated_at = now() WHERE id = $1`, s.accountID); err != nil {
			return nil, err
		}
	}
	return s.LedgerStore.CreateLedgerEntriesTx(ctx, tx, entries)
}

/*
TestSerializationConflictIsRetriedNotReturned is the money path the previous
integration tests stopped one step short of.

TestConcurrentEscrowDrawsNeverOverdraw proves the balance holds: the serializable
transaction ProcessRefund opens makes Postgres refuse the second of two
overlapping draws with 40001, and escrow never goes negative. What it does not
say is what the refused caller was told. ProcessRefund had no retry, so that
40001 came back to the owner as a failed refund - while the transaction row it
had already committed on the pool stayed behind as a pending row under an
idempotency key that was now spent. The owner's retry reused the key, found that
pending row, and every later attempt short-circuited on it. The money never went
back and nothing in the system was still trying.

So the assertion is the one that was missing: a refund that loses the
serialization race must end up committed, exactly once, with the ledger it wrote
balancing. Not refused.
*/
func TestSerializationConflictIsRetriedNotReturned(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	f := testsupport.NewFixture(t, pool)

	const deposit = 4_000_000

	escrowID := f.SeedAccount(t, store.OwnerEscrow, f.ProjectID, store.AcctLiability, deposit)
	depositTxn := f.SeedTransaction(t, store.TxTypeEscrowIn, deposit)

	ledger := &conflictingLedgerStore{
		LedgerStore: store.NewLedgerStore(pool),
		pool:        pool,
		accountID:   escrowID,
	}
	svc := service.NewPaymentService(store.NewTransactionStore(pool), ledger, "", "")

	refund, err := svc.ProcessRefund(ctx, service.ProcessRefundInput{
		OriginalTransactionID: depositTxn,
		Amount:                deposit,
		Reason:                "serialization retry integration test",
		OwnerID:               f.UserID,
		PerformedBy:           f.UserID,
		IdempotencyKey:        f.ID("idem"),
	})
	if err != nil {
		t.Fatalf("a refund that lost the serialization race was reported as a failure: %v", err)
	}

	if ledger.conflicts != 1 {
		t.Fatalf("the test injected %d conflicts, want exactly 1; the retry was never exercised", ledger.conflicts)
	}
	if refund.Status != store.TxStatusCompleted {
		t.Errorf("refund status = %q, want %q", refund.Status, store.TxStatusCompleted)
	}

	// Exactly one set of legs. The refused attempt rolled back, so replaying it
	// must leave one posting behind, not two.
	entries, err := ledger.GetEntriesByTransaction(ctx, refund.ID)
	if err != nil {
		t.Fatalf("read refund entries: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("refund posted %d ledger entries, want 2; a retried attempt double-booked", len(entries))
	}
	var debits, credits int64
	for _, e := range entries {
		if e.EntryType == store.EntryDebit {
			debits += e.Amount
		} else {
			credits += e.Amount
		}
	}
	if debits != credits || debits != deposit {
		t.Errorf("refund ledger = debit %d / credit %d, want %d on both sides", debits, credits, deposit)
	}

	// The money itself: escrow gave up the deposit once, and the owner got it
	// back once.
	if got := f.Balance(t, escrowID); got != 0 {
		t.Errorf("escrow balance = %d, want 0 after the deposit was refunded in full", got)
	}

	ownerID := f.UserID
	ownerAccount, err := store.NewLedgerStore(pool).FindAccountByOwner(ctx, store.OwnerOwner, &ownerID)
	if err != nil {
		t.Fatalf("find owner account: %v", err)
	}
	if ownerAccount == nil {
		t.Fatal("the refund created no owner account to pay back into")
	}
	if ownerAccount.Balance != deposit {
		t.Errorf("owner balance = %d, want the refunded %d", ownerAccount.Balance, deposit)
	}

	// The original deposit is closed out, so a second refund cannot draw on it.
	var originalStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM transactions WHERE id = $1`, depositTxn).Scan(&originalStatus); err != nil {
		t.Fatalf("read original status: %v", err)
	}
	if originalStatus != store.TxStatusRefunded {
		t.Errorf("original deposit status = %q, want %q", originalStatus, store.TxStatusRefunded)
	}
}

/*
TestSerializationRetryStopsAtTheAttemptBudget is the other half: the retry is
bounded, so a row that is genuinely contended fails rather than holding the
request open until its deadline.

Every attempt hits a freshly committed competing write, so all five are refused
and the caller is told so - with the ledger still untouched, which is the part
that matters. A retry loop that gave up halfway through a posting would be worse
than no retry at all.
*/
func TestSerializationRetryStopsAtTheAttemptBudget(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	f := testsupport.NewFixture(t, pool)

	const deposit = 2_000_000

	escrowID := f.SeedAccount(t, store.OwnerEscrow, f.ProjectID, store.AcctLiability, deposit)
	depositTxn := f.SeedTransaction(t, store.TxTypeEscrowIn, deposit)

	ledger := &alwaysConflictingLedgerStore{
		LedgerStore: store.NewLedgerStore(pool),
		pool:        pool,
		accountID:   escrowID,
	}
	svc := service.NewPaymentService(store.NewTransactionStore(pool), ledger, "", "")

	_, err := svc.ProcessRefund(ctx, service.ProcessRefundInput{
		OriginalTransactionID: depositTxn,
		Amount:                deposit,
		Reason:                "unrelenting contention",
		OwnerID:               f.UserID,
		PerformedBy:           f.UserID,
		IdempotencyKey:        f.ID("idem"),
	})
	if err == nil {
		t.Fatal("a refund refused on every attempt reported success")
	}
	if !isSerializationFailure(err) {
		t.Fatalf("error = %v, want SQLSTATE %s", err, serializationFailure)
	}
	if ledger.conflicts < 2 {
		t.Errorf("injected %d conflicts; the refund was not retried at all", ledger.conflicts)
	}

	if got := f.Balance(t, escrowID); got != deposit {
		t.Errorf("escrow balance = %d, want the untouched %d", got, deposit)
	}
}

// alwaysConflictingLedgerStore refuses every attempt, not just the first.
type alwaysConflictingLedgerStore struct {
	*store.LedgerStore

	pool      *pgxpool.Pool
	accountID string
	conflicts int
}

func (s *alwaysConflictingLedgerStore) CreateLedgerEntriesTx(ctx context.Context, tx pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
	s.conflicts++
	if _, err := s.pool.Exec(ctx,
		`UPDATE accounts SET updated_at = now() WHERE id = $1`, s.accountID); err != nil {
		return nil, err
	}
	return s.LedgerStore.CreateLedgerEntriesTx(ctx, tx, entries)
}

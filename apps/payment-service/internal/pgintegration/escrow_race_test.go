package pgintegration

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kerjacus/payment-service/internal/store"
	"github.com/kerjacus/payment-service/internal/testsupport"
)

// serializationFailure is SQLSTATE 40001. Postgres raises it when a
// serializable transaction cannot be ordered against one that already
// committed.
const serializationFailure = "40001"

// TestConcurrentEscrowDrawsNeverOverdraw is the test the mock suite cannot be.
//
// ReleaseEscrow and ProcessRefund both read the escrow account through
// LedgerStore.FindAccountByOwnerTx, which takes no lock, compare the balance
// they read against the amount they are about to move, and then post the
// entries. Two deliveries that read before either writes therefore both see
// enough money. Whether that overdraws the account is decided entirely by the
// isolation level of the surrounding transaction - and a mock pool accepts
// pgx.TxOptions{IsoLevel: pgx.Serializable} and pgx.TxOptions{} identically,
// so internal/store's mock tests assert only that the option was passed, never
// that it did anything.
//
// The two cases are the point. The read-committed case is the positive
// control: it drives the same code down to a negative balance, which proves
// the interleaving below really is the dangerous one and that a green
// serializable result is not just two transactions that failed to overlap. The
// serializable case is the production path, and it holds: one side gets 40001
// and the account never goes below zero.
//
// No goroutines. The second transaction's UPDATE blocks on the first
// transaction's row lock until it commits, so racing them in parallel and
// waiting on the loser would hang rather than interleave. Staging the reads
// first and then the writes reproduces exactly the interleaving a race
// produces, deterministically, with no barrier that can deadlock CI.
func TestConcurrentEscrowDrawsNeverOverdraw(t *testing.T) {
	pool := testsupport.Pool(t)

	const held = 1_000_000 // what escrow holds
	const draw = 1_000_000 // what each of the two releases wants

	tests := []struct {
		name string
		iso  pgx.TxIsoLevel
		// wantSecondSerializationFailure: the second transaction must be
		// refused rather than allowed to spend money that is not there.
		wantSecondSerializationFailure bool
		wantFinalBalance               int64
	}{
		{
			// Positive control. Not a path production takes; it exists to show
			// this test can see the bug it claims to guard against.
			name:             "read committed lets both stale checks through",
			iso:              pgx.ReadCommitted,
			wantFinalBalance: held - 2*draw, // -1_000_000: money paid out twice
		},
		{
			// What ReleaseEscrow and ProcessRefund actually ask for.
			name:                           "serializable refuses the second draw",
			iso:                            pgx.Serializable,
			wantSecondSerializationFailure: true,
			wantFinalBalance:               held - draw,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := testsupport.Ctx(t)
			f := testsupport.NewFixture(t, pool)
			ledger := store.NewLedgerStore(pool)

			escrowID := f.SeedAccount(t, store.OwnerEscrow, f.ProjectID, store.AcctLiability, held)
			// Two milestones of the same project, released at the same moment
			// to two different talents out of one project-level escrow pool.
			talentA := f.SeedAccount(t, store.OwnerTalent, f.ID("talent-a"), store.AcctAsset, 0)
			talentB := f.SeedAccount(t, store.OwnerTalent, f.ID("talent-b"), store.AcctAsset, 0)
			txnA := f.SeedTransaction(t, "escrow_release", draw)
			txnB := f.SeedTransaction(t, "escrow_release", draw)

			dbA, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: tt.iso})
			if err != nil {
				t.Fatalf("begin A: %v", err)
			}
			defer dbA.Rollback(ctx) //nolint:errcheck
			dbB, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: tt.iso})
			if err != nil {
				t.Fatalf("begin B: %v", err)
			}
			defer dbB.Rollback(ctx) //nolint:errcheck

			// Phase one: both read before either writes. This is the
			// production read, unlocked, and it is the whole hazard.
			ownerID := f.ProjectID
			seenA, err := ledger.FindAccountByOwnerTx(ctx, dbA, store.OwnerEscrow, &ownerID)
			if err != nil {
				t.Fatalf("A reads escrow: %v", err)
			}
			seenB, err := ledger.FindAccountByOwnerTx(ctx, dbB, store.OwnerEscrow, &ownerID)
			if err != nil {
				t.Fatalf("B reads escrow: %v", err)
			}
			if seenA.Balance != held || seenB.Balance != held {
				t.Fatalf("both sides must read the full balance to stage the race, got A=%d B=%d",
					seenA.Balance, seenB.Balance)
			}
			// The guard both service paths apply. Both pass, which is the bug
			// in one line.
			if seenA.Balance < draw || seenB.Balance < draw {
				t.Fatalf("the sufficiency check was expected to pass on both sides, got A=%d B=%d",
					seenA.Balance, seenB.Balance)
			}

			// Phase two: A posts and commits.
			if _, err := ledger.CreateLedgerEntriesTx(ctx, dbA, releaseEntries(txnA, talentA, escrowID, draw)); err != nil {
				t.Fatalf("A posts entries: %v", err)
			}
			if err := dbA.Commit(ctx); err != nil {
				t.Fatalf("A commits: %v", err)
			}

			// B now posts against a balance that no longer exists.
			_, errB := ledger.CreateLedgerEntriesTx(ctx, dbB, releaseEntries(txnB, talentB, escrowID, draw))
			if errB == nil {
				errB = dbB.Commit(ctx)
			}

			if tt.wantSecondSerializationFailure {
				if !isSerializationFailure(errB) {
					t.Fatalf("second draw was expected to fail with SQLSTATE %s, got %v",
						serializationFailure, errB)
				}
			} else if errB != nil {
				t.Fatalf("second draw was expected to succeed under %s, got %v", tt.iso, errB)
			}

			// held-2*draw is negative and held-draw is not, so this one
			// comparison says both things: the control overdrew, and the
			// production path did not.
			if got := f.Balance(t, escrowID); got != tt.wantFinalBalance {
				t.Fatalf("escrow balance = %d, want %d", got, tt.wantFinalBalance)
			}
		})
	}
}

// TestRefundedMoneyIsNotAlsoReleased races a refund against a release on one
// escrow pool, which is the shape that pays the same rupiah to the owner and
// the talent.
//
// ProcessRefund draws through drawFromEscrow over the accounts
// FindEscrowAccountsForProjectTx returned, and ReleaseEscrow draws through
// FindAccountByOwnerTx; neither locks, and both compare against what they read.
// Under the serializable transactions both paths open, the loser must be
// refused. The escrow pool holds one milestone's worth, so exactly one of the
// two may take it.
func TestRefundedMoneyIsNotAlsoReleased(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	f := testsupport.NewFixture(t, pool)
	ledger := store.NewLedgerStore(pool)

	const held = 2_500_000

	escrowID := f.SeedAccount(t, store.OwnerEscrow, f.ProjectID, store.AcctLiability, held)
	talentID := f.SeedAccount(t, store.OwnerTalent, f.ID("talent"), store.AcctAsset, 0)
	ownerAcctID := f.SeedAccount(t, store.OwnerOwner, f.ID("owner"), store.AcctAsset, 0)
	releaseTxn := f.SeedTransaction(t, "escrow_release", held)
	refundTxn := f.SeedTransaction(t, "refund", held)

	release, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin release: %v", err)
	}
	defer release.Rollback(ctx) //nolint:errcheck
	refund, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin refund: %v", err)
	}
	defer refund.Rollback(ctx) //nolint:errcheck

	// Both read the pool first: the release through its own lookup, the refund
	// through the project-wide one it uses.
	ownerID := f.ProjectID
	seenByRelease, err := ledger.FindAccountByOwnerTx(ctx, release, store.OwnerEscrow, &ownerID)
	if err != nil {
		t.Fatalf("release reads escrow: %v", err)
	}
	poolsSeenByRefund, err := ledger.FindEscrowAccountsForProjectTx(ctx, refund, f.ProjectID)
	if err != nil {
		t.Fatalf("refund reads escrow: %v", err)
	}
	if seenByRelease.Balance != held {
		t.Fatalf("release read balance %d, want %d", seenByRelease.Balance, held)
	}
	if len(poolsSeenByRefund) != 1 || poolsSeenByRefund[0].Balance != held {
		t.Fatalf("refund read %d pools, want one holding %d", len(poolsSeenByRefund), held)
	}

	// The refund settles first: the owner's money goes back.
	refundEntries := []store.LedgerEntryInput{
		{TransactionID: refundTxn, AccountID: ownerAcctID, EntryType: store.EntryDebit, Amount: held},
		{TransactionID: refundTxn, AccountID: escrowID, EntryType: store.EntryCredit, Amount: held},
	}
	if _, err := ledger.CreateLedgerEntriesTx(ctx, refund, refundEntries); err != nil {
		t.Fatalf("refund posts entries: %v", err)
	}
	if err := refund.Commit(ctx); err != nil {
		t.Fatalf("refund commits: %v", err)
	}

	// The release now tries to pay the talent out of money already returned.
	_, releaseErr := ledger.CreateLedgerEntriesTx(ctx, release, releaseEntries(releaseTxn, talentID, escrowID, held))
	if releaseErr == nil {
		releaseErr = release.Commit(ctx)
	}
	if !isSerializationFailure(releaseErr) {
		t.Fatalf("the release of refunded money was expected to fail with SQLSTATE %s, got %v",
			serializationFailure, releaseErr)
	}

	if got := f.Balance(t, escrowID); got != 0 {
		t.Fatalf("escrow balance = %d, want 0 after exactly one of refund and release settled", got)
	}
	if got := f.Balance(t, talentID); got != 0 {
		t.Fatalf("talent was paid %d out of refunded escrow, want 0", got)
	}
	if got := f.Balance(t, ownerAcctID); got != held {
		t.Fatalf("owner was refunded %d, want %d", got, held)
	}
}

// releaseEntries is the double-entry pair ReleaseEscrow posts, with the
// platform fee left out: the fee splits the talent leg and changes nothing
// about the escrow leg, which is the one under contention here.
func releaseEntries(transactionID, talentAccountID, escrowAccountID string, amount int64) []store.LedgerEntryInput {
	return []store.LedgerEntryInput{
		{TransactionID: transactionID, AccountID: talentAccountID, EntryType: store.EntryDebit, Amount: amount},
		{TransactionID: transactionID, AccountID: escrowAccountID, EntryType: store.EntryCredit, Amount: amount},
	}
}

// isSerializationFailure keys on SQLSTATE rather than on the message text,
// which is localised and has changed between major versions.
func isSerializationFailure(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == serializationFailure
}

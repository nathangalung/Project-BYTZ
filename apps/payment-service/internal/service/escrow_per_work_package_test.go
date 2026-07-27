package service

import (
	"context"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
)

/*
Escrow used to be one pool per project, so a release only had to fit inside the
project's total. Two talents on one project shared it: approving talent A's
milestones drew down the money quoted to talent B, and B's release then failed
with PAYMENT_ESCROW_INSUFFICIENT_FUNDS on work B had already delivered under an
executed contract.

Escrow is now keyed by work package. A can only overdraw their own pool.
*/

// escrowBook is a tiny in-memory ledger: accounts by owner and by id, with the
// balance arithmetic CreateLedgerEntriesTx does in Postgres.
type escrowBook struct {
	byOwner map[string]*store.Account
	byID    map[string]*store.Account
	lookups []string
}

func newEscrowBook(balances map[string]int64) *escrowBook {
	book := &escrowBook{
		byOwner: map[string]*store.Account{},
		byID:    map[string]*store.Account{},
	}
	for ownerID, balance := range balances {
		account := &store.Account{ID: "acct-" + ownerID, OwnerID: &ownerID, Balance: balance}
		book.byOwner[ownerID] = account
		book.byID[account.ID] = account
	}
	return book
}

func (b *escrowBook) ledgerStore() *store.MockLedgerStore {
	return &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return &store.MockTx{}, nil
				},
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, ownerID *string) (*store.Account, error) {
			b.lookups = append(b.lookups, *ownerID)
			return b.byOwner[*ownerID], nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			key := in.OwnerType
			if in.OwnerID != nil {
				key += ":" + *in.OwnerID
			}
			if account, ok := b.byOwner[key]; ok {
				return account, nil
			}
			account := &store.Account{ID: "acct-" + key, OwnerID: in.OwnerID}
			b.byOwner[key] = account
			b.byID[account.ID] = account
			return account, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			for _, e := range entries {
				account := b.byID[e.AccountID]
				if account == nil {
					continue
				}
				if e.EntryType == store.EntryDebit {
					account.Balance += e.Amount
				} else {
					account.Balance -= e.Amount
				}
			}
			return nil, nil
		},
	}
}

/*
The team project both helpers below describe: two 5 juta work packages, so a 10
juta project. That brackets to 71.5% for the talent, which is the rate every
package is allocated at and therefore the rate each milestone settles at.
*/
const (
	teamPackageAmount int64 = 5_000_000
	teamPackagePayout int64 = 3_575_000
	teamProjectPrice  int64 = 10_000_000
	teamProjectPayout int64 = 7_150_000
)

// teamMilestoneFee is the platform's slice of a milestone at that rate, derived
// independently of the service. Integer division is enough because every amount
// released below divides exactly at 71.5%; the rounding itself is pinned
// against the TypeScript in internal/pricing.
func teamMilestoneFee(amount int64) int64 {
	return amount - amount*teamPackagePayout/teamPackageAmount
}

// milestoneToPackage wires the milestone -> work package mapping the service
// resolves the escrow pool from.
func teamProjectTxnStore(milestoneToPackage map[string]string) *store.MockTransactionStore {
	now := time.Now().UTC()
	return &store.MockTransactionStore{
		GetMilestoneWorkPackageIDFn: func(_ context.Context, milestoneID, _ string) (*string, error) {
			wp, ok := milestoneToPackage[milestoneID]
			if !ok {
				return nil, nil
			}
			return &wp, nil
		},
		// A milestone on a package settles at its package's ratio; one without
		// falls back to the project's. Both are 71.5% here, which is the point:
		// splitting a project into packages must not change what it pays.
		GetMilestonePricingFn: func(_ context.Context, milestoneID, _ string) (*store.MilestonePricing, error) {
			pricing := &store.MilestonePricing{
				ProjectPrice:  ptr(teamProjectPrice),
				ProjectPayout: ptr(teamProjectPayout),
			}
			if _, ok := milestoneToPackage[milestoneID]; ok {
				pricing.PackageAmount = ptr(teamPackageAmount)
				pricing.PackagePayout = ptr(teamPackagePayout)
			}
			return pricing, nil
		},
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{
					ID: "txn-" + in.IdempotencyKey, ProjectID: in.ProjectID,
					WorkPackageID: in.WorkPackageID, Amount: in.Amount,
					Status: store.TxStatusPending, Type: in.Type, CreatedAt: now, UpdatedAt: now,
				},
				IsNew: true,
			}, nil
		},
		UpdateStatusTxFn: func(_ context.Context, _ pgx.Tx, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
}

func ptr[T any](v T) *T { return &v }

func releaseFor(milestoneID, talentID string, amount int64) ReleaseEscrowInput {
	return ReleaseEscrowInput{
		MilestoneID:    milestoneID,
		ProjectID:      "proj-team",
		TalentID:       talentID,
		Amount:         amount,
		FeeAmount:      teamMilestoneFee(amount),
		PerformedBy:    "owner-1",
		IdempotencyKey: "release:" + milestoneID,
	}
}

func TestReleaseEscrow_OneTalentCannotDrainAnother(t *testing.T) {
	book := newEscrowBook(map[string]int64{"wp-a": 5_000_000, "wp-b": 5_000_000})
	svc := NewPaymentService(
		teamProjectTxnStore(map[string]string{"ms-a1": "wp-a", "ms-a2": "wp-a", "ms-b1": "wp-b"}),
		book.ledgerStore(), "", "",
	)

	if _, err := svc.ReleaseEscrow(t.Context(), releaseFor("ms-a1", "talent-a", 3_000_000)); err != nil {
		t.Fatalf("first release for talent A: %v", err)
	}

	// Talent A's second milestone is worth more than their pool still holds.
	// The project as a whole has 7,000,000 left, which is what the shared pool
	// used to pay this out of - out of talent B's money.
	_, err := svc.ReleaseEscrow(t.Context(), releaseFor("ms-a2", "talent-a", 3_000_000))
	appErr, ok := err.(*AppError)
	if !ok || appErr.Code != "PAYMENT_ESCROW_INSUFFICIENT_FUNDS" {
		t.Fatalf("second release for talent A: err = %v, want PAYMENT_ESCROW_INSUFFICIENT_FUNDS", err)
	}

	if _, err := svc.ReleaseEscrow(t.Context(), releaseFor("ms-b1", "talent-b", 5_000_000)); err != nil {
		t.Fatalf("talent B was starved by talent A's approvals: %v", err)
	}

	if got := book.byOwner["wp-a"].Balance; got != 2_000_000 {
		t.Errorf("work package A balance = %d, want 2,000,000", got)
	}
	if got := book.byOwner["wp-b"].Balance; got != 0 {
		t.Errorf("work package B balance = %d, want 0", got)
	}
}

func TestReleaseEscrow_ResolvesThePoolFromTheMilestone(t *testing.T) {
	tests := []struct {
		name        string
		milestone   string
		packages    map[string]string
		wantLookup  string
		wantPackage bool
	}{
		{"milestone on a work package", "ms-a1", map[string]string{"ms-a1": "wp-a"}, "wp-a", true},
		{"milestone without one", "ms-solo", map[string]string{}, "proj-team", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			book := newEscrowBook(map[string]int64{tt.wantLookup: 5_000_000})
			var recorded *string
			txnStore := teamProjectTxnStore(tt.packages)
			create := txnStore.CreateFn
			txnStore.CreateFn = func(ctx context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
				recorded = in.WorkPackageID
				return create(ctx, in)
			}

			svc := NewPaymentService(txnStore, book.ledgerStore(), "", "")
			if _, err := svc.ReleaseEscrow(t.Context(), releaseFor(tt.milestone, "talent-a", 1_000_000)); err != nil {
				t.Fatalf("release: %v", err)
			}

			if len(book.lookups) != 1 || book.lookups[0] != tt.wantLookup {
				t.Errorf("escrow lookups = %v, want [%s]", book.lookups, tt.wantLookup)
			}
			// The release transaction records the pool it drew from, which is
			// what lets a later refund target the same one.
			if tt.wantPackage != (recorded != nil) {
				t.Errorf("transaction workPackageId = %v, want set = %v", recorded, tt.wantPackage)
			}
		})
	}
}

func TestProcessRefund_DrawsAcrossWorkPackagePools(t *testing.T) {
	tests := []struct {
		name     string
		accounts []store.Account
		amount   int64
		want     []escrowDraw
		wantErr  bool
	}{
		{
			"fullest pool first",
			[]store.Account{{ID: "esc-a", Balance: 6_000_000}, {ID: "esc-b", Balance: 4_000_000}},
			8_000_000,
			[]escrowDraw{{"esc-a", 6_000_000}, {"esc-b", 2_000_000}},
			false,
		},
		{
			"stops once covered",
			[]store.Account{{ID: "esc-a", Balance: 6_000_000}, {ID: "esc-b", Balance: 4_000_000}},
			5_000_000,
			[]escrowDraw{{"esc-a", 5_000_000}},
			false,
		},
		{
			"refuses to overdraw the project",
			[]store.Account{{ID: "esc-a", Balance: 1_000_000}},
			5_000_000,
			nil,
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			draws, err := drawFromEscrow(tt.accounts, tt.amount)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected an insufficient funds error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(draws) != len(tt.want) {
				t.Fatalf("draws = %v, want %v", draws, tt.want)
			}
			for i, d := range draws {
				if d != tt.want[i] {
					t.Errorf("draw %d = %v, want %v", i, d, tt.want[i])
				}
			}
		})
	}
}

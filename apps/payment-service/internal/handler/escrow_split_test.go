package handler

import (
	"context"
	"testing"

	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
)

// A settled deposit is one payment for the whole project, but the escrow it
// funds is held per work package so one talent's approvals cannot draw down
// another's money. The split is by package amount, never even: a Rp 40 juta
// backend package and a Rp 10 juta design package do not each get half.

func TestAllocateEscrowShares(t *testing.T) {
	tests := []struct {
		name     string
		deposit  int64
		packages []store.WorkPackage
		want     []int64
	}{
		{
			"by package amount",
			10_000_000,
			[]store.WorkPackage{{ID: "wp-1", Amount: 8_000_000}, {ID: "wp-2", Amount: 2_000_000}},
			[]int64{8_000_000, 2_000_000},
		},
		{
			// Same convention as the package payout split in pricing.ts.
			"rounding remainder lands on the largest package",
			1000,
			[]store.WorkPackage{{ID: "wp-1", Amount: 1}, {ID: "wp-2", Amount: 2}},
			[]int64{333, 667},
		},
		{
			"a package priced at zero draws nothing",
			900,
			[]store.WorkPackage{{ID: "wp-1", Amount: 0}, {ID: "wp-2", Amount: 3}},
			[]int64{0, 900},
		},
		{"no packages", 900, nil, nil},
		{"no priced packages", 900, []store.WorkPackage{{ID: "wp-1", Amount: 0}}, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := allocateEscrowShares(tt.deposit, tt.packages)
			if len(got) != len(tt.want) {
				t.Fatalf("shares = %v, want %v", got, tt.want)
			}
			var total int64
			for i, share := range got {
				if share != tt.want[i] {
					t.Errorf("share %d = %d, want %d", i, share, tt.want[i])
				}
				total += share
			}
			// Every rupiah of the deposit has to land somewhere or the ledger
			// entries will not balance against the owner credit.
			if got != nil && total != tt.deposit {
				t.Errorf("shares total %d, want the full deposit %d", total, tt.deposit)
			}
		})
	}
}

func TestFundEscrowLedgerTx_FundsOnePoolPerWorkPackage(t *testing.T) {
	packages := []store.WorkPackage{{ID: "wp-1", Amount: 6_000_000}, {ID: "wp-2", Amount: 4_000_000}}
	txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000}

	var opened []string
	var entries []store.LedgerEntryInput
	ledgerStore := &store.MockLedgerStore{
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			owner := in.OwnerType
			if in.OwnerID != nil {
				owner = in.OwnerType + ":" + *in.OwnerID
			}
			opened = append(opened, owner)
			return &store.Account{ID: "acct-" + owner}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, in []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			entries = append(entries, in...)
			return nil, nil
		},
	}
	txnStore := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
		GetWorkPackageAmountsFn: func(_ context.Context, _ string) ([]store.WorkPackage, error) {
			return packages, nil
		},
	}

	h := NewWebhookHandler(txnStore, ledgerStore, "key", "", "secret")
	if err := h.fundEscrowLedgerTx(t.Context(), &store.MockTx{}, txn); err != nil {
		t.Fatalf("fund escrow: %v", err)
	}

	wantAccounts := []string{"owner:owner-1", "escrow:wp-1", "escrow:wp-2"}
	if len(opened) != len(wantAccounts) {
		t.Fatalf("accounts opened = %v, want %v", opened, wantAccounts)
	}
	for i, want := range wantAccounts {
		if opened[i] != want {
			t.Errorf("account %d = %s, want %s", i, opened[i], want)
		}
	}

	var debits, credits int64
	perAccount := map[string]int64{}
	for _, e := range entries {
		if e.EntryType == store.EntryDebit {
			debits += e.Amount
		} else {
			credits += e.Amount
		}
		perAccount[e.AccountID] += e.Amount
	}
	if debits != credits || debits != txn.Amount {
		t.Errorf("debits = %d, credits = %d, want both %d", debits, credits, txn.Amount)
	}
	if got := perAccount["acct-escrow:wp-1"]; got != 6_000_000 {
		t.Errorf("wp-1 escrow funded %d, want 6,000,000", got)
	}
	if got := perAccount["acct-escrow:wp-2"]; got != 4_000_000 {
		t.Errorf("wp-2 escrow funded %d, want 4,000,000", got)
	}
}

// Nothing to split against, so the money stays reachable in one project pool.
func TestFundEscrowLedgerTx_ProjectPoolWithoutWorkPackages(t *testing.T) {
	var opened []string
	ledgerStore := &store.MockLedgerStore{
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			owner := in.OwnerType
			if in.OwnerID != nil {
				owner = in.OwnerType + ":" + *in.OwnerID
			}
			opened = append(opened, owner)
			return &store.Account{ID: "acct-" + owner}, nil
		},
	}
	txnStore := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
	}

	h := NewWebhookHandler(txnStore, ledgerStore, "key", "", "secret")
	txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000}
	if err := h.fundEscrowLedgerTx(t.Context(), &store.MockTx{}, txn); err != nil {
		t.Fatalf("fund escrow: %v", err)
	}

	if len(opened) != 2 || opened[1] != "escrow:proj-1" {
		t.Errorf("accounts opened = %v, want the project escrow pool", opened)
	}
}

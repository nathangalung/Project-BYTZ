package handler

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/kerjacus/payment-service/internal/store"
)

// A settled brd, prd or revision payment wrote no ledger entry at all. The
// settlement flipped the transaction to completed, project-service unlocked the
// document, and the append-only record every balance is derived from stayed
// silent about money the platform had taken. The admin finance summary had to
// count that revenue straight off the transactions table as a result, which is
// a second source of truth for the same rupiah.

// TestBookDocumentRevenueTx_BalancedLegs pins the directions and the accounts.
// They are the pair packages/db/src/seed.ts books for a document payment, so a
// seeded database and one that settled through this webhook agree.
func TestBookDocumentRevenueTx_BalancedLegs(t *testing.T) {
	const (
		ownerID      = "owner-1"
		ownerAcctID  = "acct-owner"
		platformAcct = "acct-platform"
	)

	tests := []struct {
		name   string
		txType string
		amount int64
	}{
		{"brd payment", store.TxTypeBRDPayment, 250_000},
		{"prd payment", store.TxTypePRDPayment, 500_000},
		{"revision fee", store.TxTypeRevisionFee, 150_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var accountsAsked []store.CreateAccountInput
			var booked []store.LedgerEntryInput

			ledgerStore := &store.MockLedgerStore{
				GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
					accountsAsked = append(accountsAsked, in)
					if in.OwnerType == store.OwnerPlatform {
						return &store.Account{ID: platformAcct, OwnerType: in.OwnerType, AccountType: in.AccountType}, nil
					}
					return &store.Account{ID: ownerAcctID, OwnerType: in.OwnerType, AccountType: in.AccountType}, nil
				},
				CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, in []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
					booked = append(booked, in...)
					return nil, nil
				},
			}
			txnStore := &store.MockTransactionStore{
				GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return ownerID, nil },
			}

			h := NewWebhookHandler(txnStore, ledgerStore, "key", "", "secret")
			txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: tt.amount, Type: tt.txType}
			if err := h.bookDocumentRevenueTx(t.Context(), &store.MockTx{}, txn); err != nil {
				t.Fatalf("book document revenue: %v", err)
			}

			// The platform leg must land on the singleton platform account, the
			// one ReleaseEscrow recognises milestone fees on. Keying it per
			// project scatters platform income across an account per customer.
			var sawPlatform bool
			for _, in := range accountsAsked {
				if in.OwnerType != store.OwnerPlatform {
					continue
				}
				sawPlatform = true
				if in.OwnerID != nil {
					t.Errorf("platform account keyed to %q; it is the NULL owner_id singleton", *in.OwnerID)
				}
				if in.AccountType != store.AcctRevenue {
					t.Errorf("platform account type = %q, want %q", in.AccountType, store.AcctRevenue)
				}
			}
			if !sawPlatform {
				t.Fatal("no platform revenue account was resolved")
			}

			if len(booked) != 2 {
				t.Fatalf("booked %d legs, want 2", len(booked))
			}
			var debits, credits int64
			byAccount := map[string]store.LedgerEntryInput{}
			for _, e := range booked {
				byAccount[e.AccountID] = e
				if e.TransactionID != txn.ID {
					t.Errorf("leg keyed to %s, want the settled payment %s", e.TransactionID, txn.ID)
				}
				if e.EntryType == store.EntryDebit {
					debits += e.Amount
				} else {
					credits += e.Amount
				}
			}
			// Debit the platform: it now holds the money. Credit the owner: it
			// left their account. Same directions the escrow funding uses.
			if got := byAccount[platformAcct]; got.EntryType != store.EntryDebit || got.Amount != tt.amount {
				t.Errorf("platform leg = %s %d, want %s %d", got.EntryType, got.Amount, store.EntryDebit, tt.amount)
			}
			if got := byAccount[ownerAcctID]; got.EntryType != store.EntryCredit || got.Amount != tt.amount {
				t.Errorf("owner leg = %s %d, want %s %d", got.EntryType, got.Amount, store.EntryCredit, tt.amount)
			}
			// CreateLedgerEntriesTx rejects an unbalanced set; asserting it here
			// says the set reaches that writer already balanced.
			if debits != credits {
				t.Errorf("document revenue does not balance: debit=%d, credit=%d", debits, credits)
			}
		})
	}
}

// settlementWebhookStore wires the store a settlement notification walks
// through for a transaction of the given type, currently pending.
func settlementWebhookStore(txType string, amount int64) *store.MockTransactionStore {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		ExecFn: func(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag(""), nil
		},
	}
	return &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: amount,
				Status: store.TxStatusPending, Type: txType,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		LockStatusTxFn: func(_ context.Context, _ pgx.Tx, _ string) (string, error) {
			return store.TxStatusPending, nil
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, status string, _, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
		GetWorkPackageAmountsFn: func(_ context.Context, _ string) ([]store.WorkPackage, error) { return nil, nil },
	}
}

// postSettlement drives one signed Midtrans notification through the handler
// and returns the ledger legs it booked.
func postSettlement(t *testing.T, txType string, amount int64, transactionStatus, fraudStatus string) ([]store.LedgerEntryInput, int) {
	t.Helper()

	const (
		serverKey  = "test-server-key"
		orderID    = "DOC-SETTLE"
		statusCode = "200"
	)
	gross := fmt.Sprint(amount)
	hash := sha512.Sum512([]byte(orderID + statusCode + gross + serverKey))
	sig := hex.EncodeToString(hash[:])

	var booked []store.LedgerEntryInput
	ledgerStore := &store.MockLedgerStore{
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-" + in.OwnerType, OwnerType: in.OwnerType, AccountType: in.AccountType}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, in []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			booked = append(booked, in...)
			return nil, nil
		},
	}

	wh := NewWebhookHandler(settlementWebhookStore(txType, amount), ledgerStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(
		`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"%s","fraud_status":"%s"}`,
		orderID, statusCode, gross, sig, transactionStatus, fraudStatus)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	return booked, resp.StatusCode
}

// Every settled payment type books double entry now, not only escrow deposits.
func TestMidtransWebhook_SettlementBooksLedgerForEveryPaidType(t *testing.T) {
	const amount = 400_000

	tests := []struct {
		name        string
		txType      string
		wantAccount string
	}{
		{"escrow deposit funds the escrow pool", store.TxTypeEscrowIn, "acct-" + store.OwnerEscrow},
		{"brd payment books platform revenue", store.TxTypeBRDPayment, "acct-" + store.OwnerPlatform},
		{"prd payment books platform revenue", store.TxTypePRDPayment, "acct-" + store.OwnerPlatform},
		{"revision fee books platform revenue", store.TxTypeRevisionFee, "acct-" + store.OwnerPlatform},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			booked, status := postSettlement(t, tt.txType, amount, "settlement", "")
			if status != fiber.StatusOK {
				t.Fatalf("status = %d, want %d", status, fiber.StatusOK)
			}
			if len(booked) == 0 {
				t.Fatal("a settled payment booked no ledger entries")
			}

			var debits, credits int64
			var sawAccount bool
			for _, e := range booked {
				if e.AccountID == tt.wantAccount {
					sawAccount = true
				}
				if e.EntryType == store.EntryDebit {
					debits += e.Amount
				} else {
					credits += e.Amount
				}
			}
			if !sawAccount {
				t.Errorf("no leg landed on %s; legs were %+v", tt.wantAccount, booked)
			}
			if debits != credits {
				t.Errorf("settlement does not balance: debit=%d, credit=%d", debits, credits)
			}
			if debits != amount {
				t.Errorf("booked %d, want the settled amount %d", debits, amount)
			}
		})
	}
}

// A card capture Midtrans is still holding for manual review must move no
// money: the charge may yet be cancelled, and escrow funded from it would pay a
// talent out of a deposit that never arrived.
func TestMidtransWebhook_ChallengedCaptureBooksNothing(t *testing.T) {
	tests := []struct {
		name              string
		transactionStatus string
		fraudStatus       string
		wantBooked        bool
	}{
		{"capture held for review", "capture", "challenge", false},
		{"capture with no fraud verdict yet", "capture", "", false},
		{"capture the fraud check denied", "capture", "deny", false},
		{"capture the fraud check accepted", "capture", "accept", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			booked, status := postSettlement(t, store.TxTypeEscrowIn, 10_000_000, tt.transactionStatus, tt.fraudStatus)
			if status != fiber.StatusOK {
				t.Fatalf("status = %d, want %d", status, fiber.StatusOK)
			}
			if got := len(booked) > 0; got != tt.wantBooked {
				t.Errorf("booked ledger entries = %v, want %v (legs: %+v)", got, tt.wantBooked, booked)
			}
		})
	}
}

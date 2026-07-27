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

	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// A refund issued from the Midtrans dashboard flipped the transaction to
// refunded and wrote nothing to the ledger: escrow still showed the deposit,
// the next milestone could pay a talent out of money that had already gone
// back, and ProcessRefund short-circuits on a refunded row so the internal path
// could never correct the books.

func TestReverseEscrowLedgerTx_MirrorsFundingEntries(t *testing.T) {
	funding := []store.LedgerEntry{
		{ID: "le-1", AccountID: "acct-owner", EntryType: store.EntryCredit, Amount: 10_000_000},
		{ID: "le-2", AccountID: "acct-escrow-wp-1", EntryType: store.EntryDebit, Amount: 6_000_000},
		{ID: "le-3", AccountID: "acct-escrow-wp-2", EntryType: store.EntryDebit, Amount: 4_000_000},
	}

	var reversal []store.LedgerEntryInput
	ledgerStore := &store.MockLedgerStore{
		GetEntriesByTransactionFn: func(_ context.Context, _ string) ([]store.LedgerEntry, error) {
			return funding, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, in []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			reversal = append(reversal, in...)
			return nil, nil
		},
	}

	h := NewWebhookHandler(&store.MockTransactionStore{}, ledgerStore, "key", "", "secret")
	txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000, Type: store.TxTypeEscrowIn}
	if err := h.reverseEscrowLedgerTx(t.Context(), &store.MockTx{}, txn); err != nil {
		t.Fatalf("reverse escrow: %v", err)
	}

	if len(reversal) != len(funding) {
		t.Fatalf("reversal entries = %d, want %d", len(reversal), len(funding))
	}
	// Same directions ProcessRefund posts for the same money: debit owner,
	// credit the escrow pools.
	want := map[string]struct {
		entryType string
		amount    int64
	}{
		"acct-owner":       {store.EntryDebit, 10_000_000},
		"acct-escrow-wp-1": {store.EntryCredit, 6_000_000},
		"acct-escrow-wp-2": {store.EntryCredit, 4_000_000},
	}
	var debits, credits int64
	for _, e := range reversal {
		w, ok := want[e.AccountID]
		if !ok {
			t.Errorf("unexpected account %s in the reversal", e.AccountID)
			continue
		}
		if e.EntryType != w.entryType {
			t.Errorf("%s reversed as %s, want %s", e.AccountID, e.EntryType, w.entryType)
		}
		if e.Amount != w.amount {
			t.Errorf("%s reversed %d, want %d", e.AccountID, e.Amount, w.amount)
		}
		if e.TransactionID != txn.ID {
			t.Errorf("entry keyed to %s, want the refunded deposit %s", e.TransactionID, txn.ID)
		}
		if e.EntryType == store.EntryDebit {
			debits += e.Amount
		} else {
			credits += e.Amount
		}
	}
	if debits != credits {
		t.Errorf("reversal does not balance: debit=%d, credit=%d", debits, credits)
	}
}

// A deposit that settled before the ledger funding existed has nothing to give
// back. Refusing would only make the gateway retry that notification forever.
func TestReverseEscrowLedgerTx_NoFundingEntries(t *testing.T) {
	wrote := false
	ledgerStore := &store.MockLedgerStore{
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			wrote = true
			return nil, nil
		},
	}

	h := NewWebhookHandler(&store.MockTransactionStore{}, ledgerStore, "key", "", "secret")
	txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000, Type: store.TxTypeEscrowIn}
	if err := h.reverseEscrowLedgerTx(t.Context(), &store.MockTx{}, txn); err != nil {
		t.Fatalf("reverse escrow: %v", err)
	}
	if wrote {
		t.Error("wrote reversal entries against a deposit that was never funded")
	}
}

// refundWebhookStore wires the store a refund notification walks through, with
// the deposit's current status under lockedStatus. Outbox inserts are the only
// statement this flow runs on the transaction itself, so recording them names
// every event the notification emits.
func refundWebhookStore(lockedStatus string, outboxTypes *[]string) *store.MockTransactionStore {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		ExecFn: func(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "outbox_events") && len(args) > 3 {
				*outboxTypes = append(*outboxTypes, fmt.Sprint(args[3]))
			}
			return pgconn.NewCommandTag(""), nil
		},
	}
	return &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
				Status: lockedStatus, Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		LockStatusTxFn: func(_ context.Context, _ pgx.Tx, _ string) (string, error) { return lockedStatus, nil },
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, status string, _, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
}

// The settled deposit is reversed once, and a redelivery of the same refund
// writes nothing: supersedes treats refunded as terminal, so one deposit is
// never reversed twice.
func TestMidtransWebhook_RefundedEscrowReversesLedger(t *testing.T) {
	const (
		serverKey   = "test-server-key"
		orderID     = "ESC-REFUND"
		statusCode  = "200"
		grossAmount = "10000000"
	)
	hash := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	sig := hex.EncodeToString(hash[:])

	tests := []struct {
		name         string
		status       string
		wantReversal bool
		wantOutbox   []string
	}{
		{"settled deposit is reversed", store.TxStatusCompleted, true, []string{"payment.refunded"}},
		{"redelivery of the same refund writes nothing", store.TxStatusRefunded, false, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var reversed bool
			var outboxTypes []string
			ledgerStore := &store.MockLedgerStore{
				GetEntriesByTransactionFn: func(_ context.Context, _ string) ([]store.LedgerEntry, error) {
					return []store.LedgerEntry{
						{ID: "le-1", AccountID: "acct-owner", EntryType: store.EntryCredit, Amount: 10_000_000},
						{ID: "le-2", AccountID: "acct-escrow", EntryType: store.EntryDebit, Amount: 10_000_000},
					}, nil
				},
				CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
					reversed = true
					return nil, nil
				},
			}

			wh := NewWebhookHandler(refundWebhookStore(tt.status, &outboxTypes), ledgerStore, serverKey, "", "secret")
			app := fiber.New()
			wh.Register(app)

			body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"refund"}`,
				orderID, statusCode, grossAmount, sig)
			req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
			}
			if reversed != tt.wantReversal {
				t.Errorf("ledger reversed = %v, want %v", reversed, tt.wantReversal)
			}
			// project-service learns of a dashboard refund only through this
			// event, and a redelivery must not announce the refund twice.
			if len(outboxTypes) != len(tt.wantOutbox) {
				t.Fatalf("outbox events = %v, want %v", outboxTypes, tt.wantOutbox)
			}
			for i, want := range tt.wantOutbox {
				if outboxTypes[i] != want {
					t.Errorf("outbox event %d = %s, want %s", i, outboxTypes[i], want)
				}
			}
		})
	}
}

// What Midtrans sends in gross_amount for a partial refund cannot be
// established from here, and booking it as a full reversal would give back
// escrow the gateway never returned. Refuse instead of mis-booking.
func TestMidtransWebhook_PartialRefundRefused(t *testing.T) {
	const (
		serverKey   = "test-server-key"
		orderID     = "ESC-PARTIAL"
		statusCode  = "200"
		grossAmount = "10000000"
	)
	hash := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	sig := hex.EncodeToString(hash[:])

	var touched bool
	var outboxTypes []string
	ledgerStore := &store.MockLedgerStore{
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			touched = true
			return nil, nil
		},
	}

	wh := NewWebhookHandler(refundWebhookStore(store.TxStatusCompleted, &outboxTypes), ledgerStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"partial_refund"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotImplemented {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotImplemented)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Error == nil || result.Error.Code != "PAYMENT_PARTIAL_REFUND_UNSUPPORTED" {
		t.Errorf("expected PAYMENT_PARTIAL_REFUND_UNSUPPORTED, got %+v", result.Error)
	}
	if touched {
		t.Error("a partial refund wrote ledger entries")
	}
	if len(outboxTypes) != 0 {
		t.Errorf("a partial refund emitted %v", outboxTypes)
	}
}

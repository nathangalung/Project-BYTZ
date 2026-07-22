package service

import (
	"context"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Refund needs the balance guards release already has.
//
// ReleaseEscrow refuses a missing escrow account and refuses to pay out more
// than the account holds. ProcessRefund did neither: it wrapped the ledger
// write in `if escrowAccount != nil` and then marked the refund completed and
// published payment.refunded either way. So a refund could drive the escrow
// account negative, paying the same money out twice, or complete with no
// double-entry pair at all.

func refundTxnMock(now time.Time, originalAmount int64) *store.MockTransactionStore {
	return &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, id string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: id, ProjectID: "p-1", Amount: originalAmount,
				Status: store.TxStatusCompleted, Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "refund-1", Status: store.TxStatusPending, CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
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

func refundLedgerMock(escrow *store.Account, entriesWritten *int) *store.MockLedgerStore {
	return &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return &store.MockTx{
						ExecFn: func(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
							return pgconn.CommandTag{}, nil
						},
						QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
							return &store.MockRow{ScanFn: func(dest ...any) error {
								if p, ok := dest[0].(*int64); ok {
									*p = 0
								}
								return nil
							}}
						},
					}, nil
				},
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return escrow, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, e []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			*entriesWritten += len(e)
			return []store.LedgerEntry{}, nil
		},
	}
}

func refundInput(amount int64) ProcessRefundInput {
	return ProcessRefundInput{
		OriginalTransactionID: "orig-1",
		Amount:                amount,
		OwnerID:               "owner-1",
		Reason:                "test",
		IdempotencyKey:        "k-refund-1",
	}
}

// The double-payout: escrow already released, refund still succeeds.
func TestProcessRefund_RefusesToOverdrawEscrow(t *testing.T) {
	entries := 0
	svc := NewPaymentService(
		refundTxnMock(time.Now(), 10_000_000),
		refundLedgerMock(&store.Account{ID: "esc", Balance: 0}, &entries),
		"", "",
	)

	_, err := svc.ProcessRefund(t.Context(), refundInput(10_000_000))
	if err == nil {
		t.Fatal("refund drove the escrow account to -10,000,000")
	}
	if entries != 0 {
		t.Errorf("wrote %d ledger entries on a rejected refund", entries)
	}
}

func TestProcessRefund_AllowsARefundTheEscrowCovers(t *testing.T) {
	entries := 0
	svc := NewPaymentService(
		refundTxnMock(time.Now(), 10_000_000),
		refundLedgerMock(&store.Account{ID: "esc", Balance: 10_000_000}, &entries),
		"", "",
	)

	if _, err := svc.ProcessRefund(t.Context(), refundInput(10_000_000)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entries != 2 {
		t.Errorf("wrote %d ledger entries, want a debit and a credit", entries)
	}
}

// BRD and PRD purchases never create an escrow account.
func TestProcessRefund_RefusesWhenNoEscrowAccountExists(t *testing.T) {
	entries := 0
	svc := NewPaymentService(
		refundTxnMock(time.Now(), 5_000_000),
		refundLedgerMock(nil, &entries),
		"", "",
	)

	_, err := svc.ProcessRefund(t.Context(), refundInput(5_000_000))
	if err == nil {
		t.Fatal("marked a refund completed with no ledger entries behind it")
	}
	if entries != 0 {
		t.Errorf("wrote %d ledger entries with no escrow account", entries)
	}
}

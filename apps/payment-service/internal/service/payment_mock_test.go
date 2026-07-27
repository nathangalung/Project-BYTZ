package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
)

/*
A release re-derives its fee from the stored project split, so every release
test has to stand up pricing or it is refused before reaching the ledger.

The fixture is a 1 juta project at the entry bracket: 81.5% to the talent, which
is the payout ProjectTalentPayout brackets 1 juta to. A 50,000 milestone off it
settles 40,750 to the talent and 9,250 to the platform.
*/
const (
	fixtureProjectPrice  int64 = 1_000_000
	fixtureProjectPayout int64 = 815_000
	fixtureReleaseAmount int64 = 50_000
	fixtureReleaseFee    int64 = 9_250
)

func projectPricingFn(finalPrice, talentPayout int64) func(context.Context, string, string) (*store.MilestonePricing, error) {
	return func(_ context.Context, _, _ string) (*store.MilestonePricing, error) {
		return &store.MilestonePricing{ProjectPrice: &finalPrice, ProjectPayout: &talentPayout}, nil
	}
}

// --- CreateEscrow with mocks ---

func TestProcessRefund_NotFound(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-1", Amount: 1000, Reason: "test", OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "NOT_FOUND" {
		t.Errorf("code = %q, want NOT_FOUND", appErr.Code)
	}
}

func TestProcessRefund_AlreadyRefunded(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: store.TxStatusRefunded, Amount: 1000, CreatedAt: now, UpdatedAt: now}, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-1", Amount: 1000, Reason: "test", OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "PAYMENT_ALREADY_PROCESSED" {
		t.Errorf("code = %q, want PAYMENT_ALREADY_PROCESSED", appErr.Code)
	}
}

func TestProcessRefund_AmountExceedsOriginal(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "completed", Amount: 1000, CreatedAt: now, UpdatedAt: now}, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-1", Amount: 2000, Reason: "test", OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "VALIDATION_ERROR" {
		t.Errorf("code = %q, want VALIDATION_ERROR", appErr.Code)
	}
}

func TestProcessRefund_FindByIDError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-1", Amount: 1000, Reason: "test", OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- VerifyProjectOwner with mocks ---

func TestVerifyProjectOwner_Success(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) {
			return "owner-1", nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	err := svc.VerifyProjectOwner(t.Context(), "proj-1", "owner-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestVerifyProjectOwner_NotFound(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) {
			return "", nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	err := svc.VerifyProjectOwner(t.Context(), "proj-1", "owner-1")
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "NOT_FOUND" {
		t.Errorf("code = %q, want NOT_FOUND", appErr.Code)
	}
}

func TestVerifyProjectOwner_Forbidden(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) {
			return "other-owner", nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	err := svc.VerifyProjectOwner(t.Context(), "proj-1", "owner-1")
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "FORBIDDEN" {
		t.Errorf("code = %q, want FORBIDDEN", appErr.Code)
	}
}

func TestVerifyProjectOwner_StoreError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) {
			return "", fmt.Errorf("db error")
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	err := svc.VerifyProjectOwner(t.Context(), "proj-1", "owner-1")
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- GetProjectTransactions with mocks ---

func TestGetProjectTransactions_Success(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByProjectIDFn: func(_ context.Context, _ string) ([]store.Transaction, error) {
			return []store.Transaction{{ID: "t-1"}}, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	txns, err := svc.GetProjectTransactions(t.Context(), "proj-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(txns) != 1 {
		t.Errorf("len = %d, want 1", len(txns))
	}
}

// --- GetTransactionByID with mocks ---

func TestGetTransactionByID_Success(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "t-1", CreatedAt: now, UpdatedAt: now}, nil
		},
		GetEventsByTransactionFn: func(_ context.Context, _ string) ([]store.TransactionEvent, error) {
			return []store.TransactionEvent{}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		GetEntriesByTransactionFn: func(_ context.Context, _ string) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	detail, err := svc.GetTransactionByID(t.Context(), "t-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if detail.ID != "t-1" {
		t.Errorf("ID = %q, want t-1", detail.ID)
	}
}

func TestGetTransactionByID_NotFound(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.GetTransactionByID(t.Context(), "t-1")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestGetTransactionByID_EventsError(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "t-1", CreatedAt: now, UpdatedAt: now}, nil
		},
		GetEventsByTransactionFn: func(_ context.Context, _ string) ([]store.TransactionEvent, error) {
			return nil, fmt.Errorf("err")
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.GetTransactionByID(t.Context(), "t-1")
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- CreateSnapToken with mock HTTP server ---

func TestCreateSnapToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"token":"snap-abc","redirect_url":"https://example.com"}`))
	}))
	defer server.Close()

	svc := NewPaymentService(snapTestStore(), &store.MockLedgerStore{}, "test-key", server.URL)
	result, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", CheckoutType: "brd", ItemName: "BRD", CustomerName: "User", CustomerEmail: "u@e.com",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Token != "snap-abc" {
		t.Errorf("token = %q, want snap-abc", result.Token)
	}
	if result.RedirectURL != "https://example.com" {
		t.Errorf("redirectURL = %q, want https://example.com", result.RedirectURL)
	}
}

func TestCreateSnapToken_GatewayError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	svc := NewPaymentService(snapTestStore(), &store.MockLedgerStore{}, "test-key", server.URL)
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", CheckoutType: "brd", CustomerEmail: "u@e.com",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "EXTERNAL_SERVICE_ERROR" {
		t.Errorf("code = %q, want EXTERNAL_SERVICE_ERROR", appErr.Code)
	}
}

func TestCreateSnapToken_EmptyToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"token":"","redirect_url":""}`))
	}))
	defer server.Close()

	svc := NewPaymentService(snapTestStore(), &store.MockLedgerStore{}, "test-key", server.URL)
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", CheckoutType: "brd", CustomerEmail: "u@e.com",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "EXTERNAL_SERVICE_ERROR" {
		t.Errorf("code = %q, want EXTERNAL_SERVICE_ERROR", appErr.Code)
	}
}

func TestCreateSnapToken_InvalidResponseJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`not json`))
	}))
	defer server.Close()

	svc := NewPaymentService(snapTestStore(), &store.MockLedgerStore{}, "test-key", server.URL)
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", CheckoutType: "brd", CustomerEmail: "u@e.com",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- ReleaseEscrow full success and error paths ---

func TestReleaseEscrow_Success(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		CommitFn: func(_ context.Context) error { return nil },
	}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-rel", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "talent-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	result, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Status != "completed" {
		t.Errorf("status = %q, want completed", result.Status)
	}
}

func TestReleaseEscrow_Idempotent(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now},
				IsNew:       false,
			}, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	result, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ID != "txn-1" {
		t.Errorf("ID = %q, want txn-1", result.ID)
	}
}

func TestReleaseEscrow_CreateError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_BeginTxError(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return nil, fmt.Errorf("pool error")
				},
			}
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_EscrowAccountNotFound(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return nil, nil // not found
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "PAYMENT_ESCROW_INSUFFICIENT_FUNDS" {
		t.Errorf("code = %q, want PAYMENT_ESCROW_INSUFFICIENT_FUNDS", appErr.Code)
	}
}

func TestReleaseEscrow_InsufficientBalance(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 1000}, nil // insufficient
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "PAYMENT_ESCROW_INSUFFICIENT_FUNDS" {
		t.Errorf("code = %q, want PAYMENT_ESCROW_INSUFFICIENT_FUNDS", appErr.Code)
	}
}

func TestReleaseEscrow_FindAccountError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_GetTalentAccountError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return nil, fmt.Errorf("talent account error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_LedgerEntriesError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "talent-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return nil, fmt.Errorf("ledger error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_UpdateStatusTxError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusTxFn: func(_ context.Context, _ pgx.Tx, _, _ string) (*store.Transaction, error) {
			return nil, fmt.Errorf("update error")
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "talent-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_CreateEventTxError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusTxFn: func(_ context.Context, _ pgx.Tx, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return nil, fmt.Errorf("event error")
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "talent-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_CommitError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		CommitFn: func(_ context.Context) error { return fmt.Errorf("commit error") },
	}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
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
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "talent-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- ProcessRefund full success and error paths ---

func TestProcessRefund_FullRefundSuccess(t *testing.T) {
	now := time.Now().UTC()
	projectID := "proj-1"
	mockTx := &store.MockTx{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				if p, ok := dest[0].(*int64); ok {
					*p = 0
				}
				if p, ok := dest[1].(*int64); ok {
					*p = 100_000_000
				}
				return nil
			}}
		},
		CommitFn: func(_ context.Context) error { return nil },
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: projectID, Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", Type: in.Type, CreatedAt: now, UpdatedAt: now},
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
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindEscrowAccountsFn: func(_ context.Context, _ string) ([]store.Account, error) {
			return []store.Account{{ID: "esc-acct", Balance: 10000}}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	result, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 10000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Status != "completed" {
		t.Errorf("status = %q, want completed", result.Status)
	}
}

func TestProcessRefund_PartialRefundSuccess(t *testing.T) {
	now := time.Now().UTC()
	projectID := "proj-1"
	mockTx := &store.MockTx{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				if p, ok := dest[0].(*int64); ok {
					*p = 0
				}
				if p, ok := dest[1].(*int64); ok {
					*p = 100_000_000
				}
				return nil
			}}
		},
		CommitFn: func(_ context.Context) error { return nil },
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: projectID, Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", Type: in.Type, CreatedAt: now, UpdatedAt: now},
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
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindEscrowAccountsFn: func(_ context.Context, _ string) ([]store.Account, error) {
			return []store.Account{{ID: "esc-acct", Balance: 10000}}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	result, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 5000, Reason: "partial refund",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-partial",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestProcessRefund_Idempotent(t *testing.T) {
	now := time.Now().UTC()
	mockPool := &store.MockPool{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				if p, ok := dest[0].(*int64); ok {
					*p = 0
				}
				if p, ok := dest[1].(*int64); ok {
					*p = 100_000_000
				}
				return nil
			}}
		},
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: "p-1", Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		PoolFn: func() store.PoolIface { return mockPool },
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", Status: "completed", CreatedAt: now, UpdatedAt: now},
				IsNew:       false,
			}, nil
		},
	}

	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	result, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 10000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-idem",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ID != "txn-refund" {
		t.Errorf("ID = %q, want txn-refund", result.ID)
	}
}

func TestProcessRefund_TotalRefundExceedsOriginal(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				if p, ok := dest[0].(*int64); ok {
					*p = 8000 // already refunded 8000
				}
				return nil
			}}
		},
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: "p-1", Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", Type: in.Type, CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 5000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-exceed",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "PAYMENT_ESCROW_INSUFFICIENT_FUNDS" {
		t.Errorf("code = %q, want PAYMENT_ESCROW_INSUFFICIENT_FUNDS", appErr.Code)
	}
}

func TestProcessRefund_QueryRefundedAmountError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(_ ...any) error {
				return fmt.Errorf("query error")
			}}
		},
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: "p-1", Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", Type: in.Type, CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 5000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-qerr",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

// A refund with no escrow account behind it used to be allowed, and this test
// recorded that as correct: it asserted success while the ledger entries were
// skipped. That is a completed refund for a real amount with no double-entry
// pair, and payment.refunded was published from it. ReleaseEscrow has always
// refused the same state. It refuses now too.
func TestProcessRefund_NoEscrowAccount(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				if p, ok := dest[0].(*int64); ok {
					*p = 0
				}
				if p, ok := dest[1].(*int64); ok {
					*p = 100_000_000
				}
				return nil
			}}
		},
		CommitFn: func(_ context.Context) error { return nil },
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: "p-1", Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return nil, nil // no escrow account
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 10000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-noesc",
	})
	if err == nil {
		t.Fatal("expected a refund with no escrow account to be refused")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "PAYMENT_ESCROW_INSUFFICIENT_FUNDS" {
		t.Errorf("code = %q, want PAYMENT_ESCROW_INSUFFICIENT_FUNDS", appErr.Code)
	}
}

// --- GetTransactionByID ledger entries error ---

func TestGetTransactionByID_LedgerEntriesError(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "t-1", CreatedAt: now, UpdatedAt: now}, nil
		},
		GetEventsByTransactionFn: func(_ context.Context, _ string) ([]store.TransactionEvent, error) {
			return []store.TransactionEvent{}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		GetEntriesByTransactionFn: func(_ context.Context, _ string) ([]store.LedgerEntry, error) {
			return nil, fmt.Errorf("ledger error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.GetTransactionByID(t.Context(), "t-1")
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- CreateEscrow additional error paths ---

func TestReleaseEscrow_FeeSplitLedger(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	txnMock := &store.MockTransactionStore{
		// A 50 juta project: the last bracket before the top, 51.5% to the
		// talent. A 50,000 milestone off it splits 25,750 / 24,250.
		GetMilestonePricingFn: projectPricingFn(50_000_000, 25_750_000),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-rel", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
	var captured []store.LedgerEntryInput
	var accountTypes []string
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			accountTypes = append(accountTypes, in.OwnerType)
			return &store.Account{ID: "acct-" + in.OwnerType}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			captured = entries
			return []store.LedgerEntry{}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: 50000, FeeAmount: 24250, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(captured) != 3 {
		t.Fatalf("entries = %d, want 3 (talent, escrow, platform)", len(captured))
	}
	byAccount := map[string]store.LedgerEntryInput{}
	var debit, credit int64
	for _, e := range captured {
		byAccount[e.AccountID] = e
		if e.EntryType == store.EntryDebit {
			debit += e.Amount
		} else {
			credit += e.Amount
		}
	}
	if debit != credit {
		t.Errorf("unbalanced entries: debit=%d credit=%d", debit, credit)
	}
	if e := byAccount["acct-talent"]; e.EntryType != store.EntryDebit || e.Amount != 25750 {
		t.Errorf("talent leg = %+v, want debit 25750", e)
	}
	if e := byAccount["esc-acct"]; e.EntryType != store.EntryCredit || e.Amount != 50000 {
		t.Errorf("escrow leg = %+v, want credit 50000", e)
	}
	if e := byAccount["acct-platform"]; e.EntryType != store.EntryDebit || e.Amount != 24250 {
		t.Errorf("platform leg = %+v, want debit 24250", e)
	}
	wantTypes := map[string]bool{store.OwnerTalent: false, store.OwnerPlatform: false}
	for _, ot := range accountTypes {
		wantTypes[ot] = true
	}
	if !wantTypes[store.OwnerPlatform] {
		t.Error("platform revenue account was never resolved")
	}
}

func TestReleaseEscrow_ZeroFeeKeepsTwoLegs(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		// Below the fee's resolution: one rupiah rounds entirely to the talent
		// at 81.5%, so the platform earns nothing and there is no third leg.
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-rel", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
	var captured []store.LedgerEntryInput
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 100000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-" + in.OwnerType}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			captured = entries
			return []store.LedgerEntry{}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	if _, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: 1, FeeAmount: 0, PerformedBy: "o-1", IdempotencyKey: "k-1",
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(captured) != 2 {
		t.Fatalf("entries = %d, want 2 when no fee is charged", len(captured))
	}
}

/*
The fee is re-derived from the stored project split, so anything other than the
figure the milestone brackets to is refused - not just the implausible ones a
range check used to catch.

The one-rupiah case is the point. A range check passes it, and so did the old
service; project-service returning a fee of zero on anomalous pricing was the
same shape of mistake, releasing the whole milestone to the talent.
*/
func TestReleaseEscrow_FeeValidation(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")

	for _, tt := range []struct {
		name string
		fee  int64
	}{
		{"negative fee", -1},
		{"no fee at all", 0},
		{"one rupiah under the bracket", fixtureReleaseFee - 1},
		{"one rupiah over the bracket", fixtureReleaseFee + 1},
		{"fee equal to amount", fixtureReleaseAmount},
		{"fee above amount", fixtureReleaseAmount + 10_000},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
				MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
				Amount: fixtureReleaseAmount, FeeAmount: tt.fee, PerformedBy: "o-1", IdempotencyKey: "k-1",
			})
			appErr, ok := err.(*AppError)
			if !ok || appErr.Code != "VALIDATION_ERROR" {
				t.Fatalf("err = %v, want VALIDATION_ERROR", err)
			}
		})
	}
}

// Pricing that belongs to no bracket is refused outright. Nothing re-checks
// these columns after the PRD is priced, so a payout from the wrong bracket
// would otherwise settle every milestone on the project at the wrong rate.
func TestReleaseEscrow_RejectsOffBracketProjectPayout(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		// 1 juta brackets to 815,000, not to the 900,000 stored here.
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, 900_000),
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")

	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: 5_000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	appErr, ok := err.(*AppError)
	if !ok || appErr.Code != "VALIDATION_ERROR" {
		t.Fatalf("err = %v, want VALIDATION_ERROR", err)
	}
}

// A milestone with no pricing behind it cannot be settled. project-service
// falls back to a fee of zero here; accepting that would hand the talent the
// whole milestone and the platform nothing.
func TestReleaseEscrow_RejectsMilestoneWithoutPricing(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: func(_ context.Context, _, _ string) (*store.MilestonePricing, error) {
			return nil, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")

	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: 0, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	appErr, ok := err.(*AppError)
	if !ok || appErr.Code != "VALIDATION_ERROR" {
		t.Fatalf("err = %v, want VALIDATION_ERROR", err)
	}
}

// A project's escrow is spread over one account per work package, so the
// balance a refund sizes against is their sum.
func TestGetEscrowBalance(t *testing.T) {
	tests := []struct {
		name     string
		accounts []store.Account
		want     int64
	}{
		{
			"sums every work package pool",
			[]store.Account{{ID: "esc-wp1", Balance: 4000000}, {ID: "esc-wp2", Balance: 2000000}},
			6000000,
		},
		{"single project level pool", []store.Account{{ID: "esc", Balance: 6000000}}, 6000000},
		{"unfunded project returns zero", nil, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ledgerMock := &store.MockLedgerStore{
				FindEscrowAccountsFn: func(_ context.Context, projectID string) ([]store.Account, error) {
					if projectID != "p-1" {
						t.Errorf("looked up %s, want p-1", projectID)
					}
					return tt.accounts, nil
				},
			}
			svc := NewPaymentService(&store.MockTransactionStore{}, ledgerMock, "", "")
			got, err := svc.GetEscrowBalance(t.Context(), "p-1")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("balance = %d, want %d", got, tt.want)
			}
		})
	}
}

// A release whose ledger tx failed leaves a committed pending row under the
// idempotency key. Returning that row as success on retry told the caller the
// talent had been paid when no ledger entry existed, and since project-service
// defers to the 14-day auto-release which reuses the same key, the money was
// never paid and no retry remained anywhere in the system.
func TestReleaseEscrow_PendingRowIsResumedNotReportedPaid(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       false,
			}, nil
		},
	}
	txnMock.LockStatusTxFn = func(_ context.Context, _ pgx.Tx, _ string) (string, error) {
		return "pending", nil
	}
	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	// No escrow account, so the resumed attempt must surface a real failure
	// rather than reporting the stale pending row as a completed payment.
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return nil, nil
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected the resumed release to report failure, got nil")
	}
}

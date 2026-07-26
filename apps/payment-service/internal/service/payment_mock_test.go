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

// --- CreateEscrow with mocks ---

func TestCreateEscrow_Success(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		CommitFn: func(_ context.Context) error { return nil },
	}
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-1"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	result, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
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

func TestCreateEscrow_Idempotent(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now},
				IsNew:       false,
			}, nil
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	result, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ID != "txn-1" {
		t.Errorf("ID = %q, want txn-1", result.ID)
	}
}

func TestCreateEscrow_CreateError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestCreateEscrow_LedgerError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return nil, fmt.Errorf("ledger error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

// --- ProcessRefund with mocks ---

// ProcessRefund_Success requires a real DB pool for Pool().QueryRow.
// We test all the validation and error paths that don't need it.

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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
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
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_BeginTxError(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_EscrowAccountNotFound(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_GetTalentAccountError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_LedgerEntriesError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_UpdateStatusTxError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_CreateEventTxError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
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
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 10000}, nil
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
		FindAccountByOwnerTxFn: func(_ context.Context, _ pgx.Tx, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 10000}, nil
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

func TestCreateEscrow_GetEscrowAccountError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	callCount := 0
	ledgerMock := &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			callCount++
			if callCount == 1 {
				return &store.Account{ID: "owner-acct"}, nil
			}
			return nil, fmt.Errorf("escrow account error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestCreateEscrow_LedgerEntriesError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
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
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-1"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return nil, fmt.Errorf("ledger error")
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestCreateEscrow_UpdateStatusError(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{}
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
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
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-1"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}
	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
		ProjectID: "p-1", Amount: 10000, OwnerID: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestReleaseEscrow_FeeSplitLedger(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	txnMock := &store.MockTransactionStore{
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(captured) != 2 {
		t.Fatalf("entries = %d, want 2 when no fee is charged", len(captured))
	}
}

func TestReleaseEscrow_FeeValidation(t *testing.T) {
	svc := &PaymentService{}
	for _, tt := range []struct {
		name string
		fee  int64
	}{
		{"negative fee", -1},
		{"fee equal to amount", 50000},
		{"fee above amount", 60000},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
				MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
				Amount: 50000, FeeAmount: tt.fee, PerformedBy: "o-1", IdempotencyKey: "k-1",
			})
			appErr, ok := err.(*AppError)
			if !ok || appErr.Code != "VALIDATION_ERROR" {
				t.Fatalf("err = %v, want VALIDATION_ERROR", err)
			}
		})
	}
}

func TestGetEscrowBalance(t *testing.T) {
	tests := []struct {
		name    string
		account *store.Account
		want    int64
	}{
		{"existing account returns its balance", &store.Account{ID: "esc", Balance: 6000000}, 6000000},
		{"missing account returns zero", nil, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ledgerMock := &store.MockLedgerStore{
				FindAccountByOwnerFn: func(_ context.Context, ownerType string, ownerID *string) (*store.Account, error) {
					if ownerType != store.OwnerEscrow || ownerID == nil || *ownerID != "p-1" {
						t.Errorf("looked up %s/%v, want escrow/p-1", ownerType, ownerID)
					}
					return tt.account, nil
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
		Amount: 50000, PerformedBy: "o-1", IdempotencyKey: "k-1",
	})
	if err == nil {
		t.Fatal("expected the resumed release to report failure, got nil")
	}
}

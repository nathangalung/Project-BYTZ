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
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusFn: func(_ context.Context, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventFn: func(_ context.Context, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-1"}, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
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
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
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

	svc := NewPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}, "test-key", server.URL)
	result, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", Amount: 10000, ItemName: "BRD", CustomerName: "User", CustomerEmail: "u@e.com",
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

	svc := NewPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}, "test-key", server.URL)
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", Amount: 10000, CustomerEmail: "u@e.com",
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

	svc := NewPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}, "test-key", server.URL)
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", Amount: 10000, CustomerEmail: "u@e.com",
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

	svc := NewPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}, "test-key", server.URL)
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: "ORD-1", Amount: 10000, CustomerEmail: "u@e.com",
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
			return &store.Transaction{ID: "txn-orig", ProjectID: projectID, Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		PoolFn: func() store.PoolIface { return mockPool },
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", Type: in.Type, CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusFn: func(_ context.Context, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventFn: func(_ context.Context, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		FindAccountByOwnerFn: func(_ context.Context, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 10000}, nil
		},
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
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
			return &store.Transaction{ID: "txn-orig", ProjectID: projectID, Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		PoolFn: func() store.PoolIface { return mockPool },
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", Type: in.Type, CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusFn: func(_ context.Context, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventFn: func(_ context.Context, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		FindAccountByOwnerFn: func(_ context.Context, _ string, _ *string) (*store.Account, error) {
			return &store.Account{ID: "esc-acct", Balance: 10000}, nil
		},
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
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
	mockPool := &store.MockPool{
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
		PoolFn: func() store.PoolIface { return mockPool },
	}

	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
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
	mockPool := &store.MockPool{
		QueryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				return fmt.Errorf("query error")
			}}
		},
	}
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-orig", ProjectID: "p-1", Amount: 10000, Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		PoolFn: func() store.PoolIface { return mockPool },
	}

	svc := NewPaymentService(txnMock, &store.MockLedgerStore{}, "", "")
	_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 5000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-qerr",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestProcessRefund_NoEscrowAccount(t *testing.T) {
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
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusFn: func(_ context.Context, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventFn: func(_ context.Context, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		FindAccountByOwnerFn: func(_ context.Context, _ string, _ *string) (*store.Account, error) {
			return nil, nil // no escrow account
		},
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
	}

	svc := NewPaymentService(txnMock, ledgerMock, "", "")
	result, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
		OriginalTransactionID: "txn-orig", Amount: 10000, Reason: "test",
		OwnerID: "o-1", PerformedBy: "a-1", IdempotencyKey: "k-noesc",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should succeed even without escrow account (skips ledger entries)
	if result == nil {
		t.Fatal("expected non-nil result")
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
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	callCount := 0
	ledgerMock := &store.MockLedgerStore{
		GetOrCreateAccountFn: func(_ context.Context, in store.CreateAccountInput) (*store.Account, error) {
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
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
	}
	ledgerMock := &store.MockLedgerStore{
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-1"}, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
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
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusFn: func(_ context.Context, _, _ string) (*store.Transaction, error) {
			return nil, fmt.Errorf("update error")
		},
	}
	ledgerMock := &store.MockLedgerStore{
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-1"}, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
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


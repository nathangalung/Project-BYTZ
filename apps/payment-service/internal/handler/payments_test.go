package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/service"
	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// helper to build a PaymentService with mocks
func newMockPaymentService(txn *store.MockTransactionStore, ledger *store.MockLedgerStore) *service.PaymentService {
	return service.NewPaymentService(txn, ledger, "test-server-key", "http://localhost:9999/snap")
}

func newTestPaymentApp(svc *service.PaymentService) *fiber.App {
	app := fiber.New()
	h := NewPaymentHandler(svc)

	// Mock auth middleware that trusts X-User-ID
	authMW := func(c *fiber.Ctx) error {
		if uid := c.Get("X-User-ID"); uid != "" {
			c.Locals("userID", uid)
		}
		return c.Next()
	}
	h.RegisterWithAuth(app, authMW)
	return app
}

type testResp struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func parseTestResp(t *testing.T, body io.ReadCloser) testResp {
	t.Helper()
	b, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var r testResp
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, string(b))
	}
	return r
}

func TestCreateEscrow_Success(t *testing.T) {
	now := time.Now().UTC()
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-1", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
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

	svc := newMockPaymentService(txnMock, ledgerMock)
	app := newTestPaymentApp(svc)

	body := `{"projectId":"proj-1","amount":50000,"ownerId":"owner-1","idempotencyKey":"key-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "owner-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusCreated)
	}
	r := parseTestResp(t, resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

func TestCreateEscrow_InvalidBody(t *testing.T) {
	svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestCreateEscrow_MissingFields(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"empty projectId", `{"projectId":"","amount":1000,"idempotencyKey":"k"}`},
		{"zero amount", `{"projectId":"p","amount":0,"idempotencyKey":"k"}`},
		{"negative amount", `{"projectId":"p","amount":-1,"idempotencyKey":"k"}`},
		{"empty idempotencyKey", `{"projectId":"p","amount":1000,"idempotencyKey":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
			app := newTestPaymentApp(svc)

			req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", "user-1")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestCreateEscrow_NoAuthMock(t *testing.T) {
	svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"projectId":"p","amount":1000,"idempotencyKey":"k"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// No X-User-ID

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestReleaseEscrow_MissingFields(t *testing.T) {
	svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"milestoneId":"","projectId":"p","talentId":"t","amount":0,"performedBy":"","idempotencyKey":"k"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestReleaseEscrow_InvalidBody(t *testing.T) {
	svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestProcessRefund_ValidationMock(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"invalid json", "{bad"},
		{"missing fields", `{"originalTransactionId":"","amount":0,"reason":"","ownerId":"","performedBy":"","idempotencyKey":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
			app := newTestPaymentApp(svc)

			req := httptest.NewRequest("POST", "/api/v1/payments/refund", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestProcessRefund_ServiceError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"originalTransactionId":"t-1","amount":1000,"reason":"test","ownerId":"o-1","performedBy":"a-1","idempotencyKey":"k-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/refund", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetProjectTransactions_Success(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByProjectIDFn: func(_ context.Context, _ string) ([]store.Transaction, error) {
			return []store.Transaction{{ID: "t-1"}}, nil
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("GET", "/api/v1/payments/project/proj-1", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	r := parseTestResp(t, resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

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
	svc := newMockPaymentService(txnMock, ledgerMock)
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("GET", "/api/v1/payments/txn-123", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestGetTransactionByID_NotFound(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, nil
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("GET", "/api/v1/payments/nonexistent", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestCreateSnapToken_ValidationMock(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"invalid json", "not json"},
		{"missing fields", `{"projectId":"","orderId":"","amount":0,"customerEmail":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
			app := newTestPaymentApp(svc)

			req := httptest.NewRequest("POST", "/api/v1/payments/create-snap-token", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", "user-1")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestJsonError(t *testing.T) {
	app := fiber.New()
	app.Get("/err", func(c *fiber.Ctx) error {
		return jsonError(c, 418, "TEST", "teapot")
	})

	req := httptest.NewRequest("GET", "/err", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != 418 {
		t.Errorf("status = %d, want 418", resp.StatusCode)
	}
	r := parseTestResp(t, resp.Body)
	if r.Success {
		t.Error("expected success=false")
	}
	if r.Error.Code != "TEST" {
		t.Errorf("code = %q, want TEST", r.Error.Code)
	}
}

func TestHandleServiceError_AppErrorMock(t *testing.T) {
	app := fiber.New()
	app.Get("/err", func(c *fiber.Ctx) error {
		return handleServiceError(c, &service.AppError{Code: "FORBIDDEN", Message: "no", StatusCode: 403})
	})

	req := httptest.NewRequest("GET", "/err", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
}

func TestHandleServiceError_GenericErrorMock(t *testing.T) {
	app := fiber.New()
	app.Get("/err", func(c *fiber.Ctx) error {
		return handleServiceError(c, fmt.Errorf("something"))
	})

	req := httptest.NewRequest("GET", "/err", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want 500", resp.StatusCode)
	}
}

// --- ReleaseEscrow success and error paths ---

func TestReleaseEscrow_Success(t *testing.T) {
	now := time.Now().UTC()
	mockTx := &store.MockTx{
		CommitFn: func(_ context.Context) error { return nil },
	}

	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-rel-1", ProjectID: in.ProjectID, Amount: in.Amount, Status: "pending", CreatedAt: now, UpdatedAt: now},
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
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return mockTx, nil
				},
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

	svc := newMockPaymentService(txnMock, ledgerMock)
	app := newTestPaymentApp(svc)

	body := `{"milestoneId":"ms-1","projectId":"proj-1","talentId":"talent-1","amount":50000,"performedBy":"owner-1","idempotencyKey":"rel-k-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "owner-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		r := parseTestResp(t, resp.Body)
		t.Fatalf("status = %d, want %d, error: %+v", resp.StatusCode, fiber.StatusOK, r.Error)
	}
	r := parseTestResp(t, resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

func TestReleaseEscrow_VerifyOwnerFails(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) {
			return "other-owner", nil
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"milestoneId":"ms-1","projectId":"proj-1","talentId":"talent-1","amount":50000,"performedBy":"owner-1","idempotencyKey":"rel-k-2"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "owner-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusForbidden {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusForbidden)
	}
}

func TestReleaseEscrow_ServiceError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"milestoneId":"ms-1","projectId":"proj-1","talentId":"talent-1","amount":50000,"performedBy":"owner-1","idempotencyKey":"rel-k-3"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "owner-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestReleaseEscrow_FallbackToHeaderUserID(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return "owner-1", nil },
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, fmt.Errorf("db err")
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := fiber.New()
	h := NewPaymentHandler(svc)
	authMW := func(c *fiber.Ctx) error {
		return c.Next()
	}
	h.RegisterWithAuth(app, authMW)

	body := `{"milestoneId":"ms-1","projectId":"proj-1","talentId":"talent-1","amount":50000,"performedBy":"owner-1","idempotencyKey":"rel-k-4"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "owner-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- ProcessRefund success path ---

func TestProcessRefund_SuccessHandler(t *testing.T) {
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
			return &store.Account{ID: "esc-acct", Balance: 10000}, nil
		},
		GetOrCreateAccountFn: func(_ context.Context, _ store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "owner-acct"}, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{}, nil
		},
	}

	svc := newMockPaymentService(txnMock, ledgerMock)
	app := newTestPaymentApp(svc)

	body := `{"originalTransactionId":"txn-orig","amount":10000,"reason":"client requested","ownerId":"o-1","performedBy":"admin-1","idempotencyKey":"ref-k-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/refund", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		r := parseTestResp(t, resp.Body)
		t.Fatalf("status = %d, want %d, error: %+v", resp.StatusCode, fiber.StatusOK, r.Error)
	}
	r := parseTestResp(t, resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

// --- CreateSnapToken success and error handler paths ---

func TestCreateSnapToken_SuccessHandler(t *testing.T) {
	snapServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"token":"snap-token-123","redirect_url":"https://pay.example.com"}`))
	}))
	defer snapServer.Close()

	svc := service.NewPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}, "test-key", snapServer.URL)
	app := newTestPaymentApp(svc)

	body := `{"projectId":"p-1","orderId":"ORD-1","amount":10000,"itemName":"BRD","customerName":"User","customerEmail":"u@e.com"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/create-snap-token", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		r := parseTestResp(t, resp.Body)
		t.Fatalf("status = %d, want %d, error: %+v", resp.StatusCode, fiber.StatusCreated, r.Error)
	}
	r := parseTestResp(t, resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

func TestCreateSnapToken_ServiceError(t *testing.T) {
	svc := newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"projectId":"p-1","orderId":"ORD-1","amount":10000,"itemName":"BRD","customerName":"User","customerEmail":"u@e.com"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/create-snap-token", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	// snap URL is unreachable, should return 502 external service error
	if resp.StatusCode != fiber.StatusBadGateway {
		// Also acceptable: internal server error
		if resp.StatusCode != fiber.StatusInternalServerError {
			t.Errorf("status = %d, want 502 or 500", resp.StatusCode)
		}
	}
}

// --- CreateEscrow service error path ---

func TestCreateEscrow_ServiceError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	body := `{"projectId":"proj-1","amount":50000,"ownerId":"owner-1","idempotencyKey":"key-err"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "owner-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- GetProjectTransactions service error path ---

func TestGetProjectTransactions_ServiceError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByProjectIDFn: func(_ context.Context, _ string) ([]store.Transaction, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("GET", "/api/v1/payments/project/proj-1", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- GetTransactionByID service error path ---

func TestGetTransactionByID_ServiceError(t *testing.T) {
	txnMock := &store.MockTransactionStore{
		FindByIDFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	svc := newMockPaymentService(txnMock, &store.MockLedgerStore{})
	app := newTestPaymentApp(svc)

	req := httptest.NewRequest("GET", "/api/v1/payments/txn-err", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

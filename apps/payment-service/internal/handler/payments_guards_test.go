package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

// paramlessApp mounts the handlers on routes that carry no path parameter, so
// the guards that refuse an empty id are reachable. They are unreachable
// through the real routing table, and that is the point: they are what keeps
// the handler safe if the table is ever reshaped.
func paramlessApp(h *PaymentHandler) *fiber.App {
	app := fiber.New()
	app.Get("/escrow-balance", h.GetEscrowBalance)
	app.Get("/project", h.GetProjectTransactions)
	app.Get("/transaction", h.GetTransactionByID)
	return app
}

func jsonBody(s string) io.Reader { return strings.NewReader(s) }

func doGet(t *testing.T, app *fiber.App, path, userID string) (*http.Response, paymentTestResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if userID != "" {
		req.Header.Set("X-User-ID", userID)
	}
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("request %s: %v", path, err)
	}
	return resp, parsePaymentResponse(t, &resp.Body)
}

func TestHandlers_RefuseAnEmptyPathParameter(t *testing.T) {
	app := paramlessApp(NewPaymentHandler(newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{})))

	for _, path := range []string{"/escrow-balance", "/project", "/transaction"} {
		t.Run(path, func(t *testing.T) {
			resp, body := doGet(t, app, path, "")
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Fatalf("status = %d, want 400", resp.StatusCode)
			}
			if body.Error == nil || body.Error.Code != "VALIDATION_ERROR" {
				t.Errorf("error = %+v, want VALIDATION_ERROR", body.Error)
			}
		})
	}
}

// Every route that returns amounts, talent ids or ledger lines must refuse an
// unauthenticated caller before it reaches the store.
func TestPaymentRoutes_RefuseCallersWithoutAUserID(t *testing.T) {
	reached := false
	txnStore := &store.MockTransactionStore{
		ListByUserFn: func(context.Context, string, string, int, int) ([]store.Transaction, int, error) {
			reached = true
			return nil, 0, nil
		},
		GetSummaryByUserFn: func(context.Context, string) (int64, int64, int64, int64, error) {
			reached = true
			return 0, 0, 0, 0, nil
		},
		UserMayViewProjectTransactionsFn: func(context.Context, string, string) (bool, error) {
			reached = true
			return true, nil
		},
		UserMayViewTransactionFn: func(context.Context, string, string) (bool, error) {
			reached = true
			return true, nil
		},
	}
	app := newTestPaymentApp(newMockPaymentService(txnStore, &store.MockLedgerStore{}))

	tests := []struct {
		path     string
		wantCode string
	}{
		{path: "/api/v1/payments/list", wantCode: "AUTH_REQUIRED"},
		{path: "/api/v1/payments/summary", wantCode: "AUTH_REQUIRED"},
		{path: "/api/v1/payments/project/proj-1", wantCode: "AUTH_UNAUTHORIZED"},
		{path: "/api/v1/payments/txn-1", wantCode: "AUTH_UNAUTHORIZED"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			reached = false
			resp, body := doGet(t, app, tt.path, "")
			if resp.StatusCode != fiber.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", resp.StatusCode)
			}
			if body.Error == nil || body.Error.Code != tt.wantCode {
				t.Errorf("error = %+v, want %s", body.Error, tt.wantCode)
			}
			if reached {
				t.Error("an unauthenticated request reached the store")
			}
		})
	}
}

// POST /create-snap-token opens a checkout, so an anonymous caller must be
// refused before the ownership check runs.
func TestCreateSnapToken_RefusesCallersWithoutAUserID(t *testing.T) {
	app := newTestPaymentApp(newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/create-snap-token",
		jsonBody(`{"projectId":"p-1","orderId":"BRD-1","checkoutType":"brd","customerEmail":"a@b.co"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	body := parsePaymentResponse(t, &resp.Body)

	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
	if body.Error == nil || body.Error.Code != "AUTH_UNAUTHORIZED" {
		t.Errorf("error = %+v, want AUTH_UNAUTHORIZED", body.Error)
	}
}

// A failure in the authorization lookup must not be read as permission.
func TestPaymentRoutes_AuthorizationLookupFailureDeniesAccess(t *testing.T) {
	boom := errors.New("connection reset")
	served := false
	txnStore := &store.MockTransactionStore{
		UserMayViewProjectTransactionsFn: func(context.Context, string, string) (bool, error) { return false, boom },
		UserMayViewTransactionFn:         func(context.Context, string, string) (bool, error) { return false, boom },
		FindByProjectIDFn: func(context.Context, string) ([]store.Transaction, error) {
			served = true
			return nil, nil
		},
		FindByIDFn: func(context.Context, string) (*store.Transaction, error) {
			served = true
			return &store.Transaction{ID: "txn-1"}, nil
		},
	}
	app := newTestPaymentApp(newMockPaymentService(txnStore, &store.MockLedgerStore{}))

	for _, path := range []string{"/api/v1/payments/project/proj-1", "/api/v1/payments/txn-1"} {
		t.Run(path, func(t *testing.T) {
			served = false
			resp, _ := doGet(t, app, path, "user-1")
			if resp.StatusCode == fiber.StatusOK {
				t.Fatalf("status = 200; a failed authorization check let the request through")
			}
			if served {
				t.Error("transactions were returned despite the authorization check failing")
			}
		})
	}
}

func TestGetEscrowBalance_SumsThePoolsForTheProject(t *testing.T) {
	tests := []struct {
		name        string
		accounts    []store.Account
		findErr     error
		wantStatus  int
		wantBalance int64
	}{
		{
			name: "sums every pool the project holds",
			accounts: []store.Account{
				{ID: "acct-wp-1", Balance: 6_000_000},
				{ID: "acct-wp-2", Balance: 4_000_000},
			},
			wantStatus: fiber.StatusOK, wantBalance: 10_000_000,
		},
		{
			name:       "a fully released project reports zero, not an error",
			accounts:   []store.Account{{ID: "acct-wp-1", Balance: 0}},
			wantStatus: fiber.StatusOK, wantBalance: 0,
		},
		{
			name:       "a project with no escrow at all reports zero",
			accounts:   nil,
			wantStatus: fiber.StatusOK, wantBalance: 0,
		},
		{
			name:       "a lookup failure is not reported as an empty escrow",
			findErr:    errors.New("connection reset"),
			wantStatus: fiber.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ledger := &store.MockLedgerStore{
				FindEscrowAccountsFn: func(context.Context, string) ([]store.Account, error) {
					return tt.accounts, tt.findErr
				},
			}
			app := newTestPaymentApp(newMockPaymentService(&store.MockTransactionStore{}, ledger))

			resp, body := doGet(t, app, "/api/v1/payments/escrow-balance/proj-1", "user-1")
			if resp.StatusCode != tt.wantStatus {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
			if tt.wantStatus != fiber.StatusOK {
				if body.Error == nil || body.Error.Code != "INTERNAL_ERROR" {
					t.Errorf("error = %+v, want INTERNAL_ERROR", body.Error)
				}
				return
			}
			var data struct {
				ProjectID string `json:"projectId"`
				Balance   int64  `json:"balance"`
			}
			if err := json.Unmarshal(body.Data, &data); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if data.Balance != tt.wantBalance {
				t.Errorf("balance = %d, want %d", data.Balance, tt.wantBalance)
			}
			if data.ProjectID != "proj-1" {
				t.Errorf("projectId = %q, want proj-1", data.ProjectID)
			}
		})
	}
}

// Pagination bounds are what stop a caller pulling the whole table in one
// request, so the values the store actually receives are the assertion.
func TestListPayments_BoundsThePageItRequests(t *testing.T) {
	tests := []struct {
		name         string
		query        string
		wantPage     int
		wantPageSize int
		wantType     string
	}{
		{name: "defaults", query: "", wantPage: 1, wantPageSize: 50},
		{name: "explicit page and size", query: "?page=3&pageSize=25", wantPage: 3, wantPageSize: 25},
		{name: "page below one is clamped up", query: "?page=0", wantPage: 1, wantPageSize: 50},
		{name: "negative page is clamped up", query: "?page=-7", wantPage: 1, wantPageSize: 50},
		{name: "page size above the cap is clamped down", query: "?pageSize=5000", wantPage: 1, wantPageSize: 100},
		{name: "page size exactly at the cap is kept", query: "?pageSize=100", wantPage: 1, wantPageSize: 100},
		{name: "type filter is passed through", query: "?type=escrow_in", wantPage: 1, wantPageSize: 50, wantType: "escrow_in"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotUser, gotType string
			var gotPage, gotPageSize int
			txnStore := &store.MockTransactionStore{
				ListByUserFn: func(_ context.Context, userID, txType string, page, pageSize int) ([]store.Transaction, int, error) {
					gotUser, gotType, gotPage, gotPageSize = userID, txType, page, pageSize
					return []store.Transaction{{ID: "txn-1", Amount: 10_000_000}}, 1, nil
				},
			}
			app := newTestPaymentApp(newMockPaymentService(txnStore, &store.MockLedgerStore{}))

			resp, body := doGet(t, app, "/api/v1/payments/list"+tt.query, "user-1")
			if resp.StatusCode != fiber.StatusOK {
				t.Fatalf("status = %d, want 200", resp.StatusCode)
			}
			if gotUser != "user-1" {
				t.Errorf("listed for %q, want user-1", gotUser)
			}
			if gotPage != tt.wantPage || gotPageSize != tt.wantPageSize {
				t.Errorf("store got page=%d pageSize=%d, want page=%d pageSize=%d",
					gotPage, gotPageSize, tt.wantPage, tt.wantPageSize)
			}
			if gotType != tt.wantType {
				t.Errorf("type filter = %q, want %q", gotType, tt.wantType)
			}

			var data struct {
				Items    []store.Transaction `json:"items"`
				Total    int                 `json:"total"`
				Page     int                 `json:"page"`
				PageSize int                 `json:"pageSize"`
			}
			if err := json.Unmarshal(body.Data, &data); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			// The response echoes the bounds actually applied, not the ones
			// asked for, so a caller can tell it was clamped.
			if data.Page != tt.wantPage || data.PageSize != tt.wantPageSize {
				t.Errorf("response page=%d pageSize=%d, want %d and %d",
					data.Page, data.PageSize, tt.wantPage, tt.wantPageSize)
			}
			if data.Total != 1 || len(data.Items) != 1 {
				t.Errorf("items=%d total=%d, want 1 and 1", len(data.Items), data.Total)
			}
		})
	}
}

func TestListPayments_StoreFailureIsNotAnEmptyList(t *testing.T) {
	txnStore := &store.MockTransactionStore{
		ListByUserFn: func(context.Context, string, string, int, int) ([]store.Transaction, int, error) {
			return nil, 0, errors.New("statement timeout")
		},
	}
	app := newTestPaymentApp(newMockPaymentService(txnStore, &store.MockLedgerStore{}))

	resp, body := doGet(t, app, "/api/v1/payments/list", "user-1")
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	if body.Error == nil || body.Error.Code != "INTERNAL_ERROR" {
		t.Errorf("error = %+v, want INTERNAL_ERROR", body.Error)
	}
	if body.Success {
		t.Error("a failed listing reported success")
	}
}

func TestGetPaymentSummary_ReportsEachTotalSeparately(t *testing.T) {
	txnStore := &store.MockTransactionStore{
		GetSummaryByUserFn: func(_ context.Context, userID string) (int64, int64, int64, int64, error) {
			if userID != "user-1" {
				t.Errorf("summary requested for %q, want user-1", userID)
			}
			return 25_000_000, 7_150_000, 3_000_000, 10_000_000, nil
		},
	}
	app := newTestPaymentApp(newMockPaymentService(txnStore, &store.MockLedgerStore{}))

	resp, body := doGet(t, app, "/api/v1/payments/summary", "user-1")
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var data struct {
		TotalSpent  int64 `json:"totalSpent"`
		TotalEarned int64 `json:"totalEarned"`
		Pending     int64 `json:"pending"`
		ThisMonth   int64 `json:"thisMonth"`
	}
	if err := json.Unmarshal(body.Data, &data); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// Spent and earned come from different sources and must not be transposed:
	// an owner's outgoings shown as earnings is a nonsense dashboard.
	want := map[string]int64{
		"totalSpent": 25_000_000, "totalEarned": 7_150_000,
		"pending": 3_000_000, "thisMonth": 10_000_000,
	}
	got := map[string]int64{
		"totalSpent": data.TotalSpent, "totalEarned": data.TotalEarned,
		"pending": data.Pending, "thisMonth": data.ThisMonth,
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %d, want %d", k, got[k], v)
		}
	}
}

func TestGetPaymentSummary_StoreFailureIsNotZeroTotals(t *testing.T) {
	txnStore := &store.MockTransactionStore{
		GetSummaryByUserFn: func(context.Context, string) (int64, int64, int64, int64, error) {
			return 0, 0, 0, 0, errors.New("statement timeout")
		},
	}
	app := newTestPaymentApp(newMockPaymentService(txnStore, &store.MockLedgerStore{}))

	resp, body := doGet(t, app, "/api/v1/payments/summary", "user-1")
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	if body.Success {
		t.Error("a failed summary reported success; the dashboard would show zero balances")
	}
}

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

func newFinanceTestApp(h *FinanceHandler) *fiber.App {
	app := fiber.New()
	g := app.Group("/api/v1/admin/finance")
	g.Get("/summary", h.GetSummary)
	g.Get("/escrow", h.GetEscrow)
	g.Get("/transactions", h.ListTransactions)
	g.Get("/reconciliation", h.GetLedgerReconciliation)
	return app
}

func TestGetSummary_Success(t *testing.T) {
	mock := &store.MockFinanceStore{
		GetSummaryFn: func(_ context.Context) (*store.FinanceSummary, error) {
			return &store.FinanceSummary{
				TotalRevenue:     850_000_000,
				ThisMonthRevenue: 125_000_000,
				LastMonthRevenue: 98_000_000,
				BrdRevenue:       45_000_000,
				PrdRevenue:       78_000_000,
				MarginRevenue:    680_000_000,
				RevisionFee:      3_600_000,
				PlacementFee:     24_000_000,
				EscrowHeld:       75_000_000,
			}, nil
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/summary", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var body struct {
		Success bool                 `json:"success"`
		Data    store.FinanceSummary `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Data.TotalRevenue != 850_000_000 || body.Data.EscrowHeld != 75_000_000 {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestGetSummary_StoreError(t *testing.T) {
	mock := &store.MockFinanceStore{
		GetSummaryFn: func(_ context.Context) (*store.FinanceSummary, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/summary", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetEscrow_Success(t *testing.T) {
	var capturedLimit int
	mock := &store.MockFinanceStore{
		GetEscrowByProjectFn: func(_ context.Context, limit int) ([]store.EscrowProjectRow, error) {
			capturedLimit = limit
			return []store.EscrowProjectRow{
				{
					ProjectID: "p-1", ProjectTitle: "Demo", Status: "in_progress",
					TotalEscrow: 50_000_000, Released: 20_000_000, Remaining: 30_000_000,
				},
			}, nil
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/escrow?limit=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	if capturedLimit != 10 {
		t.Errorf("limit = %d, want 10", capturedLimit)
	}

	var body struct {
		Success bool                     `json:"success"`
		Data    []store.EscrowProjectRow `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || len(body.Data) != 1 || body.Data[0].Remaining != 30_000_000 {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestListTransactions_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockFinanceStore{
		GetTransactionsListFn: func(_ context.Context, _ store.TransactionFilters) (*store.TransactionListResult, error) {
			return &store.TransactionListResult{
				Items: []store.TransactionRow{
					{
						ID: "tx-1", ProjectID: "p-1", ProjectTitle: "Demo",
						Type: "escrow_in", Amount: 10_000_000, Status: "completed",
						CreatedAt: now,
					},
				},
				Total: 1,
			}, nil
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/transactions?page=1&pageSize=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Items []store.TransactionRow `json:"items"`
			Total int64                  `json:"total"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || len(body.Data.Items) != 1 || body.Data.Items[0].ID != "tx-1" {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestListTransactions_WithFilters(t *testing.T) {
	mock := &store.MockFinanceStore{
		GetTransactionsListFn: func(_ context.Context, f store.TransactionFilters) (*store.TransactionListResult, error) {
			if f.Type != "refund" {
				t.Errorf("type = %q, want refund", f.Type)
			}
			if f.Search != "demo" {
				t.Errorf("search = %q, want demo", f.Search)
			}
			return &store.TransactionListResult{Items: []store.TransactionRow{}, Total: 0}, nil
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/transactions?type=refund&search=demo", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListTransactions_PaginationClamping(t *testing.T) {
	var capturedPage, capturedPageSize int
	mock := &store.MockFinanceStore{
		GetTransactionsListFn: func(_ context.Context, f store.TransactionFilters) (*store.TransactionListResult, error) {
			capturedPage = f.Page
			capturedPageSize = f.PageSize
			return &store.TransactionListResult{Items: []store.TransactionRow{}, Total: 0}, nil
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	tests := []struct {
		name         string
		query        string
		wantPage     int
		wantPageSize int
	}{
		{"negative page", "?page=-1", 1, 20},
		{"zero pageSize", "?pageSize=0", 1, 20},
		{"over 100 pageSize", "?pageSize=200", 1, 20},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			capturedPage, capturedPageSize = 0, 0
			req := httptest.NewRequest("GET", "/api/v1/admin/finance/transactions"+tt.query, nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
			}
			if capturedPage != tt.wantPage {
				t.Errorf("page = %d, want %d", capturedPage, tt.wantPage)
			}
			if capturedPageSize != tt.wantPageSize {
				t.Errorf("pageSize = %d, want %d", capturedPageSize, tt.wantPageSize)
			}
		})
	}
}

func TestListTransactions_StoreError(t *testing.T) {
	mock := &store.MockFinanceStore{
		GetTransactionsListFn: func(_ context.Context, _ store.TransactionFilters) (*store.TransactionListResult, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewFinanceHandler(mock)
	app := newFinanceTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/transactions", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// A clean ledger must report zero drift and an empty row list, so the admin
// screen can treat any row at all as an alert.
func TestGetLedgerReconciliation_Clean(t *testing.T) {
	mock := &store.MockFinanceStore{
		ReconcileLedgerFn: func(_ context.Context) (*store.LedgerReconciliation, error) {
			return &store.LedgerReconciliation{
				AccountsChecked: 12,
				DriftedAccounts: 0,
				TotalDrift:      0,
				Rows:            []store.LedgerDriftRow{},
			}, nil
		},
	}
	app := newFinanceTestApp(NewFinanceHandler(mock))

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/reconciliation", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Success bool                       `json:"success"`
		Data    store.LedgerReconciliation `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success {
		t.Fatal("expected success")
	}
	if body.Data.DriftedAccounts != 0 || body.Data.TotalDrift != 0 {
		t.Fatalf("expected no drift, got %d accounts / %d total",
			body.Data.DriftedAccounts, body.Data.TotalDrift)
	}
	if len(body.Data.Rows) != 0 {
		t.Fatalf("expected no rows, got %d", len(body.Data.Rows))
	}
}

/*
Drift is the whole point of the endpoint: accounts.balance gates every release
and refund, so a balance the ledger does not support must surface with the
account identified and the signed difference intact.
*/
func TestGetLedgerReconciliation_ReportsDrift(t *testing.T) {
	ownerID := "11111111-1111-7111-8111-111111111111"
	mock := &store.MockFinanceStore{
		ReconcileLedgerFn: func(_ context.Context) (*store.LedgerReconciliation, error) {
			return &store.LedgerReconciliation{
				AccountsChecked: 12,
				DriftedAccounts: 1,
				TotalDrift:      -250_000,
				Rows: []store.LedgerDriftRow{{
					AccountID:     "22222222-2222-7222-8222-222222222222",
					OwnerType:     "escrow",
					OwnerID:       &ownerID,
					Name:          "Owner Escrow - Project X",
					StoredBalance: 750_000,
					LedgerBalance: 1_000_000,
					Drift:         -250_000,
				}},
			}, nil
		},
	}
	app := newFinanceTestApp(NewFinanceHandler(mock))

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/reconciliation", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body struct {
		Data store.LedgerReconciliation `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if body.Data.DriftedAccounts != 1 {
		t.Fatalf("expected 1 drifted account, got %d", body.Data.DriftedAccounts)
	}
	if len(body.Data.Rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(body.Data.Rows))
	}
	row := body.Data.Rows[0]
	// Sign matters: negative means the stored balance is short of the ledger,
	// which is the direction that silently blocks payouts.
	if row.Drift != -250_000 {
		t.Fatalf("expected drift -250000, got %d", row.Drift)
	}
	if row.StoredBalance-row.LedgerBalance != row.Drift {
		t.Fatalf("drift must equal stored minus ledger, got %d vs %d",
			row.Drift, row.StoredBalance-row.LedgerBalance)
	}
}

func TestGetLedgerReconciliation_StoreError(t *testing.T) {
	mock := &store.MockFinanceStore{
		ReconcileLedgerFn: func(_ context.Context) (*store.LedgerReconciliation, error) {
			return nil, errors.New("db down")
		},
	}
	app := newFinanceTestApp(NewFinanceHandler(mock))

	req := httptest.NewRequest("GET", "/api/v1/admin/finance/reconciliation", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != 500 {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

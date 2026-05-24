package handler

import (
	"context"
	"encoding/json"
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

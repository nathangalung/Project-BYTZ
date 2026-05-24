package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/bytz/admin-service/internal/store"
)

func newDisputesTestApp(h *DisputesHandler) *fiber.App {
	app := fiber.New()
	g := app.Group("/api/v1/admin/disputes")
	g.Get("/", h.ListDisputes)
	g.Get("/status-counts", h.GetStatusCounts)
	g.Get("/:id", h.GetDispute)
	return app
}

func TestListDisputes_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockDisputeStore{
		GetDisputesListFn: func(_ context.Context, _ store.DisputeFilters) (*store.DisputeListResult, error) {
			return &store.DisputeListResult{
				Items: []store.DisputeRow{
					{
						ID: "d-1", ProjectID: "p-1", ProjectTitle: "Demo",
						InitiatedBy: "u-1", InitiatedByName: "Alice", InitiatedByRole: "owner",
						AgainstUserID: "u-2", AgainstUserName: "Bob", AgainstUserRole: "talent",
						Reason: "missed milestone", Status: "open", Amount: 5_000_000,
						CreatedAt: now, UpdatedAt: now,
					},
				},
				Total: 1,
			}, nil
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/?page=1&pageSize=10", nil)
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
			Items []store.DisputeRow `json:"items"`
			Total int64              `json:"total"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || len(body.Data.Items) != 1 || body.Data.Items[0].ID != "d-1" {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestListDisputes_StatusFilter(t *testing.T) {
	mock := &store.MockDisputeStore{
		GetDisputesListFn: func(_ context.Context, f store.DisputeFilters) (*store.DisputeListResult, error) {
			if f.Status != "open" {
				t.Errorf("status = %q, want open", f.Status)
			}
			return &store.DisputeListResult{Items: []store.DisputeRow{}, Total: 0}, nil
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/?status=open", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListDisputes_PaginationClamping(t *testing.T) {
	var capturedPage, capturedPageSize int
	mock := &store.MockDisputeStore{
		GetDisputesListFn: func(_ context.Context, f store.DisputeFilters) (*store.DisputeListResult, error) {
			capturedPage = f.Page
			capturedPageSize = f.PageSize
			return &store.DisputeListResult{Items: []store.DisputeRow{}, Total: 0}, nil
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

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
			req := httptest.NewRequest("GET", "/api/v1/admin/disputes/"+tt.query, nil)
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

func TestListDisputes_StoreError(t *testing.T) {
	mock := &store.MockDisputeStore{
		GetDisputesListFn: func(_ context.Context, _ store.DisputeFilters) (*store.DisputeListResult, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetStatusCounts_Success(t *testing.T) {
	mock := &store.MockDisputeStore{
		GetStatusCountsFn: func(_ context.Context) (map[string]int64, error) {
			return map[string]int64{
				"open":         3,
				"under_review": 1,
				"mediation":    0,
				"resolved":     12,
				"escalated":    0,
			}, nil
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/status-counts", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var body struct {
		Success bool             `json:"success"`
		Data    map[string]int64 `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Data["open"] != 3 || body.Data["resolved"] != 12 {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestGetStatusCounts_StoreError(t *testing.T) {
	mock := &store.MockDisputeStore{
		GetStatusCountsFn: func(_ context.Context) (map[string]int64, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/status-counts", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetDispute_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockDisputeStore{
		GetDisputeByIDFn: func(_ context.Context, id string) (*store.DisputeDetail, error) {
			if id != "d-1" {
				t.Errorf("id = %q, want d-1", id)
			}
			return &store.DisputeDetail{
				DisputeRow: store.DisputeRow{
					ID: "d-1", ProjectID: "p-1", ProjectTitle: "Demo",
					InitiatedBy: "u-1", InitiatedByName: "Alice", InitiatedByRole: "owner",
					AgainstUserID: "u-2", AgainstUserName: "Bob", AgainstUserRole: "talent",
					Reason: "missed milestone", Status: "open", Amount: 5_000_000,
					CreatedAt: now, UpdatedAt: now,
				},
				EvidenceURLs: []string{"https://example.com/proof.pdf"},
				StatusHistory: []store.DisputeStatusEvent{
					{FromStatus: "open", ToStatus: "under_review", CreatedAt: now},
				},
			}, nil
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/d-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var body struct {
		Success bool                `json:"success"`
		Data    store.DisputeDetail `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Data.ID != "d-1" || len(body.Data.EvidenceURLs) != 1 {
		t.Errorf("unexpected body: %+v", body)
	}
	if len(body.Data.StatusHistory) != 1 || body.Data.StatusHistory[0].ToStatus != "under_review" {
		t.Errorf("unexpected history: %+v", body.Data.StatusHistory)
	}
}

func TestGetDispute_NotFound(t *testing.T) {
	mock := &store.MockDisputeStore{
		GetDisputeByIDFn: func(_ context.Context, _ string) (*store.DisputeDetail, error) {
			return nil, nil
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/missing", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestGetDispute_StoreError(t *testing.T) {
	mock := &store.MockDisputeStore{
		GetDisputeByIDFn: func(_ context.Context, _ string) (*store.DisputeDetail, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDisputesHandler(mock)
	app := newDisputesTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/disputes/d-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

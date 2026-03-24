package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

type testResponseBody struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func parseTestResponse(t *testing.T, resp *io.ReadCloser) testResponseBody {
	t.Helper()
	body, err := io.ReadAll(*resp)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var result testResponseBody
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, string(body))
	}
	return result
}

func newDashboardTestApp(dh *DashboardHandler) *fiber.App {
	app := fiber.New()
	g := app.Group("/api/v1/admin")
	g.Get("/dashboard", dh.GetDashboard)
	g.Get("/audit-logs", dh.GetAuditLogs)
	g.Get("/settings", dh.GetSettings)
	g.Patch("/settings/:key", dh.UpdateSetting)
	return app
}

func TestGetDashboard_Success(t *testing.T) {
	dMock := &store.MockDashboardStore{
		GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) {
			return map[string]int64{"draft": 5, "in_progress": 3}, nil
		},
		GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) {
			return &store.RevenueStats{TotalRevenue: 1000000, Breakdown: map[string]store.RevenueBreakdownEntry{}}, nil
		},
		GetTalentStatsFn: func(_ context.Context) (*store.TalentStats, error) {
			return &store.TalentStats{TotalTalents: 10, ActiveTalents: 3}, nil
		},
	}
	uMock := &store.MockUserStore{}
	h := NewDashboardHandler(dMock, uMock)
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dashboard", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	r := parseTestResponse(t, &resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

func TestGetDashboard_WithDateRange(t *testing.T) {
	dMock := &store.MockDashboardStore{
		GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) {
			return map[string]int64{}, nil
		},
		GetRevenueStatsFn: func(_ context.Context, dr *store.DateRange) (*store.RevenueStats, error) {
			if dr == nil {
				t.Error("expected non-nil date range")
			}
			return &store.RevenueStats{}, nil
		},
		GetTalentStatsFn: func(_ context.Context) (*store.TalentStats, error) {
			return &store.TalentStats{}, nil
		},
	}
	h := NewDashboardHandler(dMock, &store.MockUserStore{})
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dashboard?from=2024-01-01&to=2024-12-31", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestGetDashboard_InvalidDateFormat(t *testing.T) {
	tests := []struct {
		name  string
		query string
	}{
		{"invalid from", "?from=bad-date&to=2024-12-31"},
		{"invalid to", "?from=2024-01-01&to=bad-date"},
		{"only from", "?from=2024-01-01"},
		{"only to", "?to=2024-12-31"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewDashboardHandler(&store.MockDashboardStore{
				GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) { return map[string]int64{}, nil },
				GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) { return &store.RevenueStats{}, nil },
				GetTalentStatsFn:  func(_ context.Context) (*store.TalentStats, error) { return &store.TalentStats{}, nil },
			}, &store.MockUserStore{})
			app := newDashboardTestApp(h)

			req := httptest.NewRequest("GET", "/api/v1/admin/dashboard"+tt.query, nil)
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

func TestGetDashboard_StoreErrors(t *testing.T) {
	tests := []struct {
		name string
		dMock *store.MockDashboardStore
	}{
		{
			"project stats error",
			&store.MockDashboardStore{
				GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) { return nil, fmt.Errorf("err") },
			},
		},
		{
			"revenue stats error",
			&store.MockDashboardStore{
				GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) { return map[string]int64{}, nil },
				GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) { return nil, fmt.Errorf("err") },
			},
		},
		{
			"talent stats error",
			&store.MockDashboardStore{
				GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) { return map[string]int64{}, nil },
				GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) { return &store.RevenueStats{}, nil },
				GetTalentStatsFn:  func(_ context.Context) (*store.TalentStats, error) { return nil, fmt.Errorf("err") },
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewDashboardHandler(tt.dMock, &store.MockUserStore{})
			app := newDashboardTestApp(h)

			req := httptest.NewRequest("GET", "/api/v1/admin/dashboard", nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusInternalServerError {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
			}
		})
	}
}

func TestGetAuditLogs_Success(t *testing.T) {
	uMock := &store.MockUserStore{
		GetAuditLogsFn: func(_ context.Context, page, pageSize int) (*store.AuditLogResult, error) {
			return &store.AuditLogResult{Items: []store.AuditLog{}, Total: 0}, nil
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/audit-logs?page=1&pageSize=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestGetAuditLogs_StoreError(t *testing.T) {
	uMock := &store.MockUserStore{
		GetAuditLogsFn: func(_ context.Context, _, _ int) (*store.AuditLogResult, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/audit-logs", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetAuditLogs_PaginationClamping(t *testing.T) {
	uMock := &store.MockUserStore{
		GetAuditLogsFn: func(_ context.Context, _, _ int) (*store.AuditLogResult, error) {
			return &store.AuditLogResult{Items: []store.AuditLog{}, Total: 0}, nil
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	tests := []struct {
		name  string
		query string
	}{
		{"negative page", "?page=-1"},
		{"zero pageSize", "?pageSize=0"},
		{"over 100 pageSize", "?pageSize=200"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/v1/admin/audit-logs"+tt.query, nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
			}
		})
	}
}

func TestGetSettings_Success(t *testing.T) {
	uMock := &store.MockUserStore{
		GetPlatformSettingsFn: func(_ context.Context) ([]store.PlatformSetting, error) {
			return []store.PlatformSetting{{ID: "s-1", Key: "margin_rate"}}, nil
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/settings", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestGetSettings_StoreError(t *testing.T) {
	uMock := &store.MockUserStore{
		GetPlatformSettingsFn: func(_ context.Context) ([]store.PlatformSetting, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/settings", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestUpdateSetting_Success(t *testing.T) {
	uMock := &store.MockUserStore{
		UpsertPlatformSettingFn: func(_ context.Context, _, key string, value json.RawMessage, _ *string, _ string) (*store.PlatformSetting, error) {
			return &store.PlatformSetting{ID: "s-1", Key: key, Value: value}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return &store.AuditLog{}, nil
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	body := `{"value":{"rate":0.25},"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/settings/margin_rate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestUpdateSetting_Validation(t *testing.T) {
	tests := []struct {
		name string
		key  string
		body string
	}{
		{"invalid json", "k", "not json"},
		{"missing adminId", "k", `{"value":{"x":1},"adminId":""}`},
		{"empty value", "k", `{"adminId":"a-1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewDashboardHandler(&store.MockDashboardStore{}, &store.MockUserStore{})
			app := newDashboardTestApp(h)

			req := httptest.NewRequest("PATCH", "/api/v1/admin/settings/"+tt.key, strings.NewReader(tt.body))
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

func TestUpdateSetting_StoreError(t *testing.T) {
	uMock := &store.MockUserStore{
		UpsertPlatformSettingFn: func(_ context.Context, _, _ string, _ json.RawMessage, _ *string, _ string) (*store.PlatformSetting, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, uMock)
	app := newDashboardTestApp(h)

	body := `{"value":{"x":1},"adminId":"a-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/settings/key", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestInternalError(t *testing.T) {
	app := fiber.New()
	app.Get("/err", func(c *fiber.Ctx) error { return internalError(c) })

	req := httptest.NewRequest("GET", "/err", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want 500", resp.StatusCode)
	}
}

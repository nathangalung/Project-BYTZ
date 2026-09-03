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
	// Stands in for AdminAuth, which sets this from the session.
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("adminUserID", "admin-1")
		return c.Next()
	})
	g := app.Group("/api/v1/admin")
	g.Get("/dashboard", dh.GetDashboard)
	g.Get("/audit-logs", dh.GetAuditLogs)
	g.Get("/settings", dh.GetSettings)
	g.Patch("/settings/:key", dh.UpdateSetting)
	return app
}

// Keeps the three required stats out of the way of the case under test.
func newDashboardStatsMock() *store.MockDashboardStore {
	return &store.MockDashboardStore{
		GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) {
			return map[string]int64{}, nil
		},
		GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) {
			return &store.RevenueStats{Breakdown: map[string]store.RevenueBreakdownEntry{}}, nil
		},
		GetTalentStatsFn: func(_ context.Context) (*store.TalentStats, error) {
			return &store.TalentStats{}, nil
		},
	}
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

	// Exactly maxDashboardRangeDays inclusive.
	req := httptest.NewRequest("GET", "/api/v1/admin/dashboard?from=2024-01-01&to=2024-03-30", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

// A caller-supplied span costs three correlated scans per day, so a year-wide
// range is an availability problem, not a slow query.
func TestGetDashboard_RangeTooWide(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		wantCode string
	}{
		{"one year", "?from=2024-01-01&to=2024-12-31", "VALIDATION_RANGE_TOO_WIDE"},
		{"one day over the cap", "?from=2024-01-01&to=2024-03-31", "VALIDATION_RANGE_TOO_WIDE"},
		{"reversed range", "?from=2024-03-31&to=2024-01-01", "VALIDATION_ERROR"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dMock := newDashboardStatsMock()
			dMock.GetDailyRevenueFn = func(_ context.Context, _ *store.DateRange) ([]store.DailyRevenuePoint, error) {
				t.Error("store must not be queried for a rejected range")
				return nil, nil
			}
			h := NewDashboardHandler(dMock, &store.MockUserStore{})
			app := newDashboardTestApp(h)

			req := httptest.NewRequest("GET", "/api/v1/admin/dashboard"+tt.query, nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
			r := parseTestResponse(t, &resp.Body)
			if r.Error == nil || r.Error.Code != tt.wantCode {
				t.Errorf("error = %+v, want code %s", r.Error, tt.wantCode)
			}
		})
	}
}

func TestGetDashboard_CachesSuccessfulAssembly(t *testing.T) {
	var calls int
	dMock := newDashboardStatsMock()
	dMock.GetDailyRevenueFn = func(_ context.Context, _ *store.DateRange) ([]store.DailyRevenuePoint, error) {
		calls++
		return []store.DailyRevenuePoint{}, nil
	}
	h := NewDashboardHandler(dMock, &store.MockUserStore{})
	app := newDashboardTestApp(h)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "/api/v1/admin/dashboard?from=2024-01-01&to=2024-01-31", nil)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("test failed: %v", err)
		}
		if resp.StatusCode != fiber.StatusOK {
			t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
		}
	}
	if calls != 1 {
		t.Errorf("store called %d times, want 1 (second request must hit the cache)", calls)
	}

	// A different range is a different key.
	req := httptest.NewRequest("GET", "/api/v1/admin/dashboard?from=2024-02-01&to=2024-02-28", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if calls != 2 {
		t.Errorf("store called %d times, want 2 for a distinct range", calls)
	}
}

// A degraded assembly must not be pinned for the whole TTL.
func TestGetDashboard_DoesNotCacheDegradedResponse(t *testing.T) {
	var calls int
	dMock := newDashboardStatsMock()
	dMock.GetDailyRevenueFn = func(_ context.Context, _ *store.DateRange) ([]store.DailyRevenuePoint, error) {
		calls++
		return nil, fmt.Errorf("transactions unavailable")
	}
	h := NewDashboardHandler(dMock, &store.MockUserStore{})
	app := newDashboardTestApp(h)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "/api/v1/admin/dashboard", nil)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("test failed: %v", err)
		}
		if resp.StatusCode != fiber.StatusOK {
			t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
		}
	}
	if calls != 2 {
		t.Errorf("store called %d times, want 2 (a degraded response must not be cached)", calls)
	}
}

func TestGetDashboard_AiUsage(t *testing.T) {
	dMock := newDashboardStatsMock()
	dMock.GetAiUsageFn = func(_ context.Context, _ *store.DateRange) (*store.AiUsageStats, error) {
		return &store.AiUsageStats{
			TotalCostUsd:        0.0421,
			TotalRequests:       15,
			AvgTokensPerSuccess: 4650.71,
			DailyCost: []store.DailyAiCostPoint{
				{Date: "2026-07-24", CostUsd: 0.0421, Requests: 15, Tokens: 65100},
			},
			ByModel: []store.AiModelUsage{
				{Model: "glm-5.3", Requests: 15, PromptTokens: 21050, CompletionTokens: 44050, CostUsd: 0.0421},
			},
		}, nil
	}
	h := NewDashboardHandler(dMock, &store.MockUserStore{})
	app := newDashboardTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dashboard", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var data struct {
		AiUsage *store.AiUsageStats `json:"aiUsage"`
	}
	r := parseTestResponse(t, &resp.Body)
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if data.AiUsage == nil {
		t.Fatal("expected aiUsage in payload")
	}
	if data.AiUsage.TotalCostUsd != 0.0421 {
		t.Errorf("totalCostUsd = %v, want 0.0421", data.AiUsage.TotalCostUsd)
	}
	if data.AiUsage.TotalRequests != 15 {
		t.Errorf("totalRequests = %d, want 15", data.AiUsage.TotalRequests)
	}
	if data.AiUsage.AvgTokensPerSuccess != 4650.71 {
		t.Errorf("avgTokensPerSuccess = %v, want 4650.71", data.AiUsage.AvgTokensPerSuccess)
	}
	if len(data.AiUsage.DailyCost) != 1 || data.AiUsage.DailyCost[0].Tokens != 65100 {
		t.Errorf("dailyCost = %+v, want one point with 65100 tokens", data.AiUsage.DailyCost)
	}
	if len(data.AiUsage.ByModel) != 1 || data.AiUsage.ByModel[0].Model != "glm-5.3" {
		t.Errorf("byModel = %+v, want one glm-5.3 row", data.AiUsage.ByModel)
	}
}

// AI usage is supplementary, so a failure must not take the dashboard down.
func TestGetDashboard_AiUsageNonFatal(t *testing.T) {
	tests := []struct {
		name string
		fn   func(context.Context, *store.DateRange) (*store.AiUsageStats, error)
	}{
		{"store error", func(_ context.Context, _ *store.DateRange) (*store.AiUsageStats, error) {
			return nil, fmt.Errorf("ai_interactions unavailable")
		}},
		{"nil without error", func(_ context.Context, _ *store.DateRange) (*store.AiUsageStats, error) {
			return nil, nil
		}},
		{"unset", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dMock := newDashboardStatsMock()
			dMock.GetAiUsageFn = tt.fn
			h := NewDashboardHandler(dMock, &store.MockUserStore{})
			app := newDashboardTestApp(h)

			req := httptest.NewRequest("GET", "/api/v1/admin/dashboard", nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
			}

			// The frontend reads arrays directly, so null is not acceptable.
			var data struct {
				AiUsage *store.AiUsageStats `json:"aiUsage"`
			}
			r := parseTestResponse(t, &resp.Body)
			if err := json.Unmarshal(r.Data, &data); err != nil {
				t.Fatalf("unmarshal data: %v", err)
			}
			if data.AiUsage == nil {
				t.Fatal("aiUsage must not be null")
			}
			if data.AiUsage.DailyCost == nil || data.AiUsage.ByModel == nil {
				t.Errorf("expected empty slices, got %+v", data.AiUsage)
			}
			if len(data.AiUsage.DailyCost) != 0 || len(data.AiUsage.ByModel) != 0 {
				t.Errorf("expected empty slices, got %+v", data.AiUsage)
			}
		})
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
				GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) {
					return &store.RevenueStats{}, nil
				},
				GetTalentStatsFn: func(_ context.Context) (*store.TalentStats, error) { return &store.TalentStats{}, nil },
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
		name  string
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
				GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) {
					return nil, fmt.Errorf("err")
				},
			},
		},
		{
			"talent stats error",
			&store.MockDashboardStore{
				GetProjectStatsFn: func(_ context.Context) (map[string]int64, error) { return map[string]int64{}, nil },
				GetRevenueStatsFn: func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) {
					return &store.RevenueStats{}, nil
				},
				GetTalentStatsFn: func(_ context.Context) (*store.TalentStats, error) { return nil, fmt.Errorf("err") },
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
	var auditCalled bool
	var capturedAction, capturedTargetType, capturedTargetID string
	uMock := &store.MockUserStore{
		UpsertPlatformSettingFn: func(_ context.Context, _, key string, value json.RawMessage, _ *string, _ string) (*store.PlatformSetting, error) {
			return &store.PlatformSetting{ID: "s-1", Key: key, Value: value}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, action, targetType, targetID string, _ json.RawMessage) (*store.AuditLog, error) {
			auditCalled = true
			capturedAction = action
			capturedTargetType = targetType
			capturedTargetID = targetID
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
	if !auditCalled {
		t.Error("CreateAuditLog was not called for UpdateSetting")
	}
	if capturedAction != "config.update" {
		t.Errorf("audit action = %q, want config.update", capturedAction)
	}
	if capturedTargetType != "platform_setting" {
		t.Errorf("audit targetType = %q, want platform_setting", capturedTargetType)
	}
	if capturedTargetID != "margin_rate" {
		t.Errorf("audit targetID = %q, want margin_rate", capturedTargetID)
	}
}

// TestUpdateSetting_AuditLogFailureIsNotFatal verifies the setting still updates
// even if the audit log write fails.
func TestUpdateSetting_AuditLogFailureIsNotFatal(t *testing.T) {
	uMock := &store.MockUserStore{
		UpsertPlatformSettingFn: func(_ context.Context, _, key string, value json.RawMessage, _ *string, _ string) (*store.PlatformSetting, error) {
			return &store.PlatformSetting{ID: "s-1", Key: key, Value: value}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return nil, fmt.Errorf("audit db down")
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
		t.Errorf("audit log failure must not fail request: status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestUpdateSetting_Validation(t *testing.T) {
	tests := []struct {
		name string
		key  string
		body string
	}{
		{"invalid json", "k", "not json"},
		{"empty value", "k", `{}`},
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

package features

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/admin-service/internal/handler"
	"github.com/bytz/admin-service/internal/store"
	"github.com/cucumber/godog"
	"github.com/gofiber/fiber/v2"
)

// testContext holds per-scenario state.
type testContext struct {
	app              *fiber.App
	dashboardStore   *store.MockDashboardStore
	userStore        *store.MockUserStore
	lastResp         *apiResp
	lastStatusCode   int
	adminID          string
	suspendedUserID  string
	suspendedUser    *store.User
}

type apiResp struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func newTestContext() *testContext {
	tc := &testContext{
		dashboardStore: &store.MockDashboardStore{},
		userStore:      &store.MockUserStore{},
		adminID:        "admin-1",
	}
	return tc
}

func (tc *testContext) buildApp() {
	app := fiber.New()

	dashHandler := handler.NewDashboardHandler(tc.dashboardStore, tc.userStore)
	usersHandler := handler.NewUsersHandler(tc.userStore)

	// Skip real admin auth middleware; use a pass-through for testing
	admin := app.Group("/api/v1/admin")

	admin.Get("/dashboard", dashHandler.GetDashboard)
	admin.Get("/audit-logs", dashHandler.GetAuditLogs)
	admin.Get("/settings", dashHandler.GetSettings)
	admin.Patch("/settings/:key", dashHandler.UpdateSetting)

	admin.Get("/users", usersHandler.ListUsers)
	admin.Get("/users/:id", usersHandler.GetUser)
	admin.Patch("/users/:id/suspend", usersHandler.SuspendUser)
	admin.Patch("/users/:id/unsuspend", usersHandler.UnsuspendUser)

	tc.app = app
}

func (tc *testContext) doRequest(method, url, body string, headers map[string]string) error {
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := tc.app.Test(req, -1)
	if err != nil {
		return fmt.Errorf("app.Test: %w", err)
	}
	tc.lastStatusCode = resp.StatusCode

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	var r apiResp
	if err := json.Unmarshal(b, &r); err != nil {
		return fmt.Errorf("unmarshal response: %w (body: %s)", err, string(b))
	}
	tc.lastResp = &r
	return nil
}

// --- Step Definitions ---

func (tc *testContext) anAdminUser() error {
	now := time.Now().UTC()

	tc.userStore.GetUserByIDFn = func(_ context.Context, id string) (*store.User, error) {
		return &store.User{
			ID:         id,
			Email:      "user@example.com",
			Name:       "Test User",
			Role:       "talent",
			IsVerified: true,
			Locale:     "id",
			CreatedAt:  now,
			UpdatedAt:  now,
		}, nil
	}
	tc.userStore.SuspendUserFn = func(_ context.Context, id string) (*store.User, error) {
		tc.suspendedUser = &store.User{
			ID:         id,
			Email:      "user@example.com",
			Name:       "Test User",
			Role:       "talent",
			IsVerified: false,
			Locale:     "id",
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		return tc.suspendedUser, nil
	}
	tc.userStore.CreateAuditLogFn = func(_ context.Context, id, adminID, action, targetType, targetID string, details json.RawMessage) (*store.AuditLog, error) {
		return &store.AuditLog{
			ID:         id,
			AdminID:    adminID,
			Action:     action,
			TargetType: targetType,
			TargetID:   targetID,
			Details:    details,
			CreatedAt:  now,
		}, nil
	}

	tc.buildApp()
	return nil
}

func (tc *testContext) theySuspendUserWithReason(userID, reason string) error {
	tc.suspendedUserID = userID
	body := fmt.Sprintf(`{"adminId":"%s","reason":"%s"}`, tc.adminID, reason)
	return tc.doRequest("PATCH", fmt.Sprintf("/api/v1/admin/users/%s/suspend", userID), body, nil)
}

func (tc *testContext) theUserShouldBeSuspended() error {
	if tc.lastStatusCode != fiber.StatusOK {
		return fmt.Errorf("expected status 200, got %d", tc.lastStatusCode)
	}
	if !tc.lastResp.Success {
		return fmt.Errorf("expected success=true, got false (error: %+v)", tc.lastResp.Error)
	}
	if tc.suspendedUser == nil {
		return fmt.Errorf("user was not suspended")
	}
	if tc.suspendedUser.IsVerified {
		return fmt.Errorf("expected user to be unverified (suspended), but IsVerified=true")
	}
	return nil
}

func (tc *testContext) anAuthenticatedAdmin() error {
	tc.dashboardStore.GetProjectStatsFn = func(_ context.Context) (map[string]int64, error) {
		return map[string]int64{
			"draft":       5,
			"in_progress": 3,
			"completed":   10,
			"cancelled":   2,
		}, nil
	}
	tc.dashboardStore.GetRevenueStatsFn = func(_ context.Context, _ *store.DateRange) (*store.RevenueStats, error) {
		return &store.RevenueStats{
			TotalRevenue: 150000000,
			Breakdown: map[string]store.RevenueBreakdownEntry{
				"brd_payment":     {Amount: 30000000, Count: 6},
				"prd_payment":     {Amount: 20000000, Count: 4},
				"escrow_release":  {Amount: 100000000, Count: 10},
			},
		}, nil
	}
	tc.dashboardStore.GetTalentStatsFn = func(_ context.Context) (*store.TalentStats, error) {
		return &store.TalentStats{
			TotalTalents:     25,
			TierDistribution: map[string]int64{"junior": 10, "mid": 10, "senior": 5},
			ActiveTalents:    15,
			UtilizationRate:  0.6,
			AverageRating:    4.2,
		}, nil
	}

	tc.buildApp()
	return nil
}

func (tc *testContext) theyRequestDashboardData() error {
	return tc.doRequest("GET", "/api/v1/admin/dashboard", "", nil)
}

func (tc *testContext) projectStatsShouldBeReturned() error {
	if tc.lastStatusCode != fiber.StatusOK {
		return fmt.Errorf("expected status 200, got %d", tc.lastStatusCode)
	}
	if !tc.lastResp.Success {
		return fmt.Errorf("expected success=true, got false (error: %+v)", tc.lastResp.Error)
	}

	var data struct {
		Projects map[string]int64 `json:"projects"`
	}
	if err := json.Unmarshal(tc.lastResp.Data, &data); err != nil {
		return fmt.Errorf("unmarshal data: %w", err)
	}
	if data.Projects == nil || len(data.Projects) == 0 {
		return fmt.Errorf("expected project stats to be non-empty")
	}
	if data.Projects["completed"] != 10 {
		return fmt.Errorf("expected 10 completed projects, got %d", data.Projects["completed"])
	}
	return nil
}

func (tc *testContext) revenueStatsShouldBeReturned() error {
	var data struct {
		Revenue *store.RevenueStats `json:"revenue"`
	}
	if err := json.Unmarshal(tc.lastResp.Data, &data); err != nil {
		return fmt.Errorf("unmarshal data: %w", err)
	}
	if data.Revenue == nil {
		return fmt.Errorf("expected revenue stats to be present")
	}
	if data.Revenue.TotalRevenue != 150000000 {
		return fmt.Errorf("expected total revenue 150000000, got %d", data.Revenue.TotalRevenue)
	}
	return nil
}

// --- Test Runner ---

func TestFeatures(t *testing.T) {
	suite := godog.TestSuite{
		ScenarioInitializer: InitializeScenario,
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			TestingT: t,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("non-zero status returned, failed to run feature tests")
	}
}

func InitializeScenario(sc *godog.ScenarioContext) {
	tc := newTestContext()

	sc.Step(`^an admin user$`, tc.anAdminUser)
	sc.Step(`^they suspend user "([^"]*)" with reason "([^"]*)"$`, tc.theySuspendUserWithReason)
	sc.Step(`^the user should be suspended$`, tc.theUserShouldBeSuspended)

	sc.Step(`^an authenticated admin$`, tc.anAuthenticatedAdmin)
	sc.Step(`^they request dashboard data$`, tc.theyRequestDashboardData)
	sc.Step(`^project stats should be returned$`, tc.projectStatsShouldBeReturned)
	sc.Step(`^revenue stats should be returned$`, tc.revenueStatsShouldBeReturned)
}

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

	"github.com/bytz/notification-service/internal/handler"
	"github.com/bytz/notification-service/internal/store"
	"github.com/cucumber/godog"
	"github.com/gofiber/fiber/v2"
)

// testContext holds per-scenario state.
type testContext struct {
	app            *fiber.App
	mockStore      *store.MockStore
	lastResp       *apiResp
	lastStatusCode int
	userID         string
	createdNotif   *store.Notification
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
		mockStore: &store.MockStore{},
	}
	return tc
}

func (tc *testContext) buildApp() {
	app := fiber.New()
	h := handler.New(tc.mockStore)
	h.Register(app)

	// Auth middleware that trusts X-User-ID header
	authMW := func(c *fiber.Ctx) error {
		if uid := c.Get("X-User-ID"); uid != "" {
			c.Locals("userID", uid)
		}
		return c.Next()
	}
	h.RegisterWithAuth(app, authMW)
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

func (tc *testContext) aUserWithID(userID string) error {
	tc.userID = userID
	now := time.Now().UTC()

	tc.mockStore.CreateFn = func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
		notif := &store.Notification{
			ID:        "notif-1",
			UserID:    in.UserID,
			Type:      in.Type,
			Title:     in.Title,
			Message:   in.Message,
			Link:      in.Link,
			IsRead:    false,
			CreatedAt: now,
		}
		tc.createdNotif = notif
		return notif, nil
	}

	tc.buildApp()
	return nil
}

func (tc *testContext) aProjectMatchNotificationIsCreated() error {
	body := fmt.Sprintf(`{"userId":"%s","type":"project_match","title":"New match","message":"A project matches your skills"}`, tc.userID)
	return tc.doRequest("POST", "/api/v1/notifications/", body, nil)
}

func (tc *testContext) theNotificationShouldBeStored() error {
	if tc.lastStatusCode != fiber.StatusCreated {
		return fmt.Errorf("expected status 201, got %d", tc.lastStatusCode)
	}
	if !tc.lastResp.Success {
		return fmt.Errorf("expected success=true, got false (error: %+v)", tc.lastResp.Error)
	}
	if tc.createdNotif == nil {
		return fmt.Errorf("notification was not created")
	}
	return nil
}

func (tc *testContext) itShouldBeMarkedAsUnread() error {
	if tc.createdNotif == nil {
		return fmt.Errorf("no notification created")
	}
	if tc.createdNotif.IsRead {
		return fmt.Errorf("expected notification to be unread, but it is read")
	}
	return nil
}

func (tc *testContext) anUnreadNotificationForUser(userID string) error {
	tc.userID = userID
	now := time.Now().UTC()

	tc.mockStore.FindByIDFn = func(_ context.Context, id string, uid string) (*store.Notification, error) {
		return &store.Notification{
			ID:        id,
			UserID:    uid,
			Type:      store.TypeProjectMatch,
			Title:     "Test",
			Message:   "Test message",
			IsRead:    false,
			CreatedAt: now,
		}, nil
	}
	tc.mockStore.MarkAsReadFn = func(_ context.Context, id string) (*store.Notification, error) {
		tc.createdNotif = &store.Notification{
			ID:        id,
			UserID:    userID,
			Type:      store.TypeProjectMatch,
			Title:     "Test",
			Message:   "Test message",
			IsRead:    true,
			CreatedAt: now,
		}
		return tc.createdNotif, nil
	}

	tc.buildApp()
	return nil
}

func (tc *testContext) theUserMarksItAsRead() error {
	return tc.doRequest("PATCH", "/api/v1/notifications/notif-1/read", "", map[string]string{"X-User-ID": tc.userID})
}

func (tc *testContext) itShouldBeMarkedAsRead() error {
	if tc.lastStatusCode != fiber.StatusOK {
		return fmt.Errorf("expected status 200, got %d", tc.lastStatusCode)
	}
	if tc.createdNotif == nil {
		return fmt.Errorf("no notification found")
	}
	if !tc.createdNotif.IsRead {
		return fmt.Errorf("expected notification to be read, but it is unread")
	}
	return nil
}

func (tc *testContext) notificationsForUser(count int, userID string) error {
	tc.userID = userID

	tc.mockStore.FindByUserIDFn = func(_ context.Context, uid string, page, pageSize int) (*store.PaginatedResult, error) {
		// Generate items for the requested page
		items := make([]store.Notification, 0, pageSize)
		now := time.Now().UTC()
		start := (page - 1) * pageSize
		end := start + pageSize
		if end > count {
			end = count
		}
		for i := start; i < end; i++ {
			items = append(items, store.Notification{
				ID:        fmt.Sprintf("notif-%d", i+1),
				UserID:    uid,
				Type:      store.TypeSystem,
				Title:     fmt.Sprintf("Notification %d", i+1),
				Message:   fmt.Sprintf("Message %d", i+1),
				IsRead:    false,
				CreatedAt: now,
			})
		}
		return &store.PaginatedResult{
			Items:    items,
			Total:    count,
			Page:     page,
			PageSize: pageSize,
		}, nil
	}

	tc.buildApp()
	return nil
}

func (tc *testContext) requestingPageWithPageSize(page, pageSize int) error {
	url := fmt.Sprintf("/api/v1/notifications/?page=%d&pageSize=%d", page, pageSize)
	return tc.doRequest("GET", url, "", map[string]string{"X-User-ID": tc.userID})
}

func (tc *testContext) notificationsShouldBeReturned(expected int) error {
	if tc.lastStatusCode != fiber.StatusOK {
		return fmt.Errorf("expected status 200, got %d", tc.lastStatusCode)
	}
	if !tc.lastResp.Success {
		return fmt.Errorf("expected success=true, got false")
	}

	var result store.PaginatedResult
	if err := json.Unmarshal(tc.lastResp.Data, &result); err != nil {
		return fmt.Errorf("unmarshal data: %w", err)
	}
	if len(result.Items) != expected {
		return fmt.Errorf("expected %d notifications, got %d", expected, len(result.Items))
	}
	return nil
}

func (tc *testContext) totalShouldBe(expected int) error {
	var result store.PaginatedResult
	if err := json.Unmarshal(tc.lastResp.Data, &result); err != nil {
		return fmt.Errorf("unmarshal data: %w", err)
	}
	if result.Total != expected {
		return fmt.Errorf("expected total %d, got %d", expected, result.Total)
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

	sc.Step(`^a user with ID "([^"]*)"$`, tc.aUserWithID)
	sc.Step(`^a project_match notification is created$`, tc.aProjectMatchNotificationIsCreated)
	sc.Step(`^the notification should be stored$`, tc.theNotificationShouldBeStored)
	sc.Step(`^it should be marked as unread$`, tc.itShouldBeMarkedAsUnread)

	sc.Step(`^an unread notification for user "([^"]*)"$`, tc.anUnreadNotificationForUser)
	sc.Step(`^the user marks it as read$`, tc.theUserMarksItAsRead)
	sc.Step(`^it should be marked as read$`, tc.itShouldBeMarkedAsRead)

	sc.Step(`^(\d+) notifications for user "([^"]*)"$`, tc.notificationsForUser)
	sc.Step(`^requesting page (\d+) with pageSize (\d+)$`, tc.requestingPageWithPageSize)
	sc.Step(`^(\d+) notifications should be returned$`, tc.notificationsShouldBeReturned)
	sc.Step(`^total should be (\d+)$`, tc.totalShouldBe)
}

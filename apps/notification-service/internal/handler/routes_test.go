package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/notification-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

type apiResponseBody struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func parseResponse(t *testing.T, resp *io.ReadCloser) apiResponseBody {
	t.Helper()
	body, err := io.ReadAll(*resp)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	var result apiResponseBody
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("unmarshal response: %v (body: %s)", err, string(body))
	}
	return result
}

func newTestApp(h *Handler) *fiber.App {
	app := fiber.New()
	h.Register(app)

	authMiddleware := func(c *fiber.Ctx) error {
		userID := c.Get("X-User-ID")
		if userID != "" {
			c.Locals("userID", userID)
		}
		return c.Next()
	}
	h.RegisterWithAuth(app, authMiddleware)
	return app
}

// --- Health endpoints ---

func TestHealth(t *testing.T) {
	h := New(&store.MockStore{})
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	body, _ := io.ReadAll(resp.Body)
	var result map[string]any
	json.Unmarshal(body, &result)
	if result["status"] != "ok" {
		t.Errorf("status = %v, want ok", result["status"])
	}
	if result["service"] != "notification-service" {
		t.Errorf("service = %v, want notification-service", result["service"])
	}
}

func TestHealthReady(t *testing.T) {
	h := New(&store.MockStore{})
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/health/ready", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

// --- Auth required tests ---

func TestListNotifications_RequiresAuth(t *testing.T) {
	h := New(&store.MockStore{})
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/notifications/", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestMarkRead_RequiresAuth(t *testing.T) {
	h := New(&store.MockStore{})
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/some-id/read", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestMarkAllRead_RequiresAuth(t *testing.T) {
	h := New(&store.MockStore{})
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/read-all", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestUnreadCount_RequiresAuth(t *testing.T) {
	h := New(&store.MockStore{})
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/notifications/unread-count", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

// --- Create notification validation ---

func TestCreateNotification_Validation(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{"invalid JSON", "not json", fiber.StatusBadRequest},
		{"empty userId", `{"userId":"","type":"system","title":"Test","message":"hello"}`, fiber.StatusBadRequest},
		{"empty title", `{"userId":"user-1","type":"system","title":"","message":"hello"}`, fiber.StatusBadRequest},
		{"title too long", `{"userId":"user-1","type":"system","title":"` + strings.Repeat("a", 256) + `","message":"hello"}`, fiber.StatusBadRequest},
		{"empty message", `{"userId":"user-1","type":"system","title":"Test","message":""}`, fiber.StatusBadRequest},
		{"invalid type", `{"userId":"user-1","type":"invalid","title":"Test","message":"hello"}`, fiber.StatusBadRequest},
		{"missing type", `{"userId":"user-1","title":"Test","message":"hello"}`, fiber.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := New(&store.MockStore{})
			app := newTestApp(h)

			req := httptest.NewRequest("POST", "/api/v1/notifications/", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
		})
	}
}

// --- Create notification success ---

func TestCreateNotification_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			return &store.Notification{
				ID:        "notif-1",
				UserID:    in.UserID,
				Type:      in.Type,
				Title:     in.Title,
				Message:   in.Message,
				Link:      in.Link,
				IsRead:    false,
				CreatedAt: now,
			}, nil
		},
	}
	h := New(mock)
	app := newTestApp(h)

	body := `{"userId":"user-1","type":"system","title":"Test","message":"hello","link":"/projects/1"}`
	req := httptest.NewRequest("POST", "/api/v1/notifications/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusCreated)
	}
	r := parseResponse(t, &resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

func TestCreateNotification_StoreError(t *testing.T) {
	mock := &store.MockStore{
		CreateFn: func(_ context.Context, _ store.CreateInput) (*store.Notification, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	h := New(mock)
	app := newTestApp(h)

	body := `{"userId":"user-1","type":"system","title":"Test","message":"hello"}`
	req := httptest.NewRequest("POST", "/api/v1/notifications/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- List notifications ---

func TestListNotifications_Success(t *testing.T) {
	mock := &store.MockStore{
		FindByUserIDFn: func(_ context.Context, _ string, page, pageSize int) (*store.PaginatedResult, error) {
			return &store.PaginatedResult{Items: []store.Notification{}, Total: 0, Page: page, PageSize: pageSize}, nil
		},
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/notifications/?page=1&pageSize=10", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	r := parseResponse(t, &resp.Body)
	if !r.Success {
		t.Error("expected success=true")
	}
}

func TestListNotifications_StoreError(t *testing.T) {
	mock := &store.MockStore{
		FindByUserIDFn: func(_ context.Context, _ string, _, _ int) (*store.PaginatedResult, error) {
			return nil, fmt.Errorf("db error")
		},
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/notifications/", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestListNotifications_PaginationClamping(t *testing.T) {
	tests := []struct {
		name  string
		query string
	}{
		{"pageSize over 100", "?page=1&pageSize=200"},
		{"pageSize zero", "?page=1&pageSize=0"},
		{"negative page", "?page=-1&pageSize=10"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &store.MockStore{
				FindByUserIDFn: func(_ context.Context, _ string, _, _ int) (*store.PaginatedResult, error) {
					return &store.PaginatedResult{Items: []store.Notification{}, Total: 0, Page: 1, PageSize: 20}, nil
				},
			}
			h := New(mock)
			app := newTestApp(h)

			req := httptest.NewRequest("GET", "/api/v1/notifications/"+tt.query, nil)
			req.Header.Set("X-User-ID", "user-1")

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

// --- Mark read ---

func TestMarkRead_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockStore{
		FindByIDFn: func(_ context.Context, _ string, _ string) (*store.Notification, error) {
			return &store.Notification{ID: "n-1", UserID: "user-1", IsRead: false, CreatedAt: now}, nil
		},
		MarkAsReadFn: func(_ context.Context, _ string) (*store.Notification, error) {
			return &store.Notification{ID: "n-1", UserID: "user-1", IsRead: true, CreatedAt: now}, nil
		},
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/n-1/read", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestMarkRead_NotFound(t *testing.T) {
	mock := &store.MockStore{
		FindByIDFn: func(_ context.Context, _ string, _ string) (*store.Notification, error) {
			return nil, nil
		},
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/nonexistent/read", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestMarkRead_FindError(t *testing.T) {
	mock := &store.MockStore{
		FindByIDFn: func(_ context.Context, _ string, _ string) (*store.Notification, error) {
			return nil, fmt.Errorf("db err")
		},
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/n-1/read", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestMarkRead_UpdateError(t *testing.T) {
	mock := &store.MockStore{
		FindByIDFn: func(_ context.Context, _ string, _ string) (*store.Notification, error) {
			return &store.Notification{ID: "n-1"}, nil
		},
		MarkAsReadFn: func(_ context.Context, _ string) (*store.Notification, error) {
			return nil, fmt.Errorf("update error")
		},
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/n-1/read", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- Mark all read ---

func TestMarkAllRead_Success(t *testing.T) {
	mock := &store.MockStore{
		MarkAllAsReadFn: func(_ context.Context, _ string) (int, error) { return 5, nil },
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/read-all", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestMarkAllRead_StoreError(t *testing.T) {
	mock := &store.MockStore{
		MarkAllAsReadFn: func(_ context.Context, _ string) (int, error) { return 0, fmt.Errorf("err") },
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("PATCH", "/api/v1/notifications/read-all", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- Unread count ---

func TestUnreadCount_Success(t *testing.T) {
	mock := &store.MockStore{
		CountUnreadFn: func(_ context.Context, _ string) (int, error) { return 3, nil },
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/notifications/unread-count", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestUnreadCount_StoreError(t *testing.T) {
	mock := &store.MockStore{
		CountUnreadFn: func(_ context.Context, _ string) (int, error) { return 0, fmt.Errorf("err") },
	}
	h := New(mock)
	app := newTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/notifications/unread-count", nil)
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

// --- Response helpers ---

func TestResponseHelpers(t *testing.T) {
	t.Run("errorResponse", func(t *testing.T) {
		app := fiber.New()
		app.Get("/err", func(c *fiber.Ctx) error {
			return errorResponse(c, 400, "TEST", "msg")
		})
		req := httptest.NewRequest("GET", "/err", nil)
		resp, _ := app.Test(req)
		if resp.StatusCode != 400 {
			t.Errorf("status = %d, want 400", resp.StatusCode)
		}
	})

	t.Run("successResponse", func(t *testing.T) {
		app := fiber.New()
		app.Get("/ok", func(c *fiber.Ctx) error {
			return successResponse(c, fiber.Map{"k": "v"})
		})
		req := httptest.NewRequest("GET", "/ok", nil)
		resp, _ := app.Test(req)
		if resp.StatusCode != 200 {
			t.Errorf("status = %d, want 200", resp.StatusCode)
		}
	})

	t.Run("successResponseCreated", func(t *testing.T) {
		app := fiber.New()
		app.Post("/ok", func(c *fiber.Ctx) error {
			return successResponseCreated(c, fiber.Map{"id": "1"})
		})
		req := httptest.NewRequest("POST", "/ok", nil)
		resp, _ := app.Test(req)
		if resp.StatusCode != 201 {
			t.Errorf("status = %d, want 201", resp.StatusCode)
		}
	})
}

func TestNew_Handler(t *testing.T) {
	h := New(&store.MockStore{})
	if h == nil {
		t.Fatal("expected non-nil handler")
	}
}

// --- All valid notification types ---

func TestCreateNotification_AllValidTypes(t *testing.T) {
	types := []string{
		"project_match", "application_update", "milestone_update",
		"payment", "dispute", "team_formation", "assignment_offer", "system",
	}

	for _, typ := range types {
		t.Run(typ, func(t *testing.T) {
			mock := &store.MockStore{
				CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
					return &store.Notification{ID: "n-1", UserID: in.UserID, Type: in.Type, Title: in.Title, Message: in.Message}, nil
				},
			}
			h := New(mock)
			app := newTestApp(h)

			body := fmt.Sprintf(`{"userId":"u-1","type":"%s","title":"T","message":"M"}`, typ)
			req := httptest.NewRequest("POST", "/api/v1/notifications/", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusCreated {
				t.Errorf("status = %d, want %d for type %s", resp.StatusCode, fiber.StatusCreated, typ)
			}
		})
	}
}

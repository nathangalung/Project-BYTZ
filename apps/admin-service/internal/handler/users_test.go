package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

func newUsersTestApp(uh *UsersHandler) *fiber.App {
	app := fiber.New()
	g := app.Group("/api/v1/admin")
	g.Get("/users", uh.ListUsers)
	g.Get("/users/:id", uh.GetUser)
	g.Patch("/users/:id/suspend", uh.SuspendUser)
	g.Patch("/users/:id/unsuspend", uh.UnsuspendUser)
	return app
}

func TestListUsers_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUsersListFn: func(_ context.Context, f store.UserFilters) (*store.UserListResult, error) {
			return &store.UserListResult{
				Items: []store.User{{ID: "u-1", Email: "a@b.com", Name: "Test", Role: "owner", CreatedAt: now, UpdatedAt: now}},
				Total: 1,
			}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users?page=1&pageSize=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListUsers_WithFilters(t *testing.T) {
	mock := &store.MockUserStore{
		GetUsersListFn: func(_ context.Context, f store.UserFilters) (*store.UserListResult, error) {
			if f.Role != "talent" {
				t.Errorf("role = %q, want talent", f.Role)
			}
			if f.Search != "john" {
				t.Errorf("search = %q, want john", f.Search)
			}
			return &store.UserListResult{Items: []store.User{}, Total: 0}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users?role=talent&search=john&page=1&pageSize=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListUsers_PaginationClamping(t *testing.T) {
	mock := &store.MockUserStore{
		GetUsersListFn: func(_ context.Context, _ store.UserFilters) (*store.UserListResult, error) {
			return &store.UserListResult{Items: []store.User{}, Total: 0}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

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
			req := httptest.NewRequest("GET", "/api/v1/admin/users"+tt.query, nil)
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

func TestListUsers_StoreError(t *testing.T) {
	mock := &store.MockUserStore{
		GetUsersListFn: func(_ context.Context, _ store.UserFilters) (*store.UserListResult, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetUser_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", Name: "Test", Role: "owner", CreatedAt: now, UpdatedAt: now}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/user-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestGetUser_NotFound(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return nil, nil },
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/nonexistent", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestGetUser_StoreError(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return nil, fmt.Errorf("err") },
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/user-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestSuspendUser_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", Name: "Test", IsVerified: true, CreatedAt: now, UpdatedAt: now}, nil
		},
		SuspendUserFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, IsVerified: false, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return &store.AuditLog{}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1","reason":"violation"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/suspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestSuspendUser_Validation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"invalid json", "not json"},
		{"missing adminId and reason", `{"adminId":"","reason":""}`},
		{"reason too long", `{"adminId":"a","reason":"` + strings.Repeat("x", 1001) + `"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewUsersHandler(&store.MockUserStore{})
			app := newUsersTestApp(h)

			req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/suspend", strings.NewReader(tt.body))
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

func TestSuspendUser_NotFound(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return nil, nil },
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1","reason":"test"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/nonexistent/suspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestSuspendUser_SuspendError(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, CreatedAt: now, UpdatedAt: now}, nil
		},
		SuspendUserFn: func(_ context.Context, _ string) (*store.User, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1","reason":"test"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/suspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestUnsuspendUser_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", IsVerified: false, CreatedAt: now, UpdatedAt: now}, nil
		},
		UnsuspendUserFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, IsVerified: true, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return &store.AuditLog{}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/unsuspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestUnsuspendUser_Validation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"invalid json", "not json"},
		{"missing adminId", `{"adminId":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewUsersHandler(&store.MockUserStore{})
			app := newUsersTestApp(h)

			req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/unsuspend", strings.NewReader(tt.body))
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

func TestUnsuspendUser_NotFound(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return nil, nil },
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/nonexistent/unsuspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestUnsuspendUser_StoreError(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, CreatedAt: now, UpdatedAt: now}, nil
		},
		UnsuspendUserFn: func(_ context.Context, _ string) (*store.User, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/unsuspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestSuspendUser_GetUserError(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return nil, fmt.Errorf("err") },
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1","reason":"test"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/suspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestUnsuspendUser_GetUserError(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return nil, fmt.Errorf("err") },
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/user-1/unsuspend", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

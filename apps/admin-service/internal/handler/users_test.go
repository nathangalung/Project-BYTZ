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
	g.Get("/users/:id/talent-detail", uh.GetTalentDetail)
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
	var auditCalled bool
	var capturedAction, capturedTargetType, capturedAdminID string
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", Name: "Test", Role: "talent", IsVerified: true, CreatedAt: now, UpdatedAt: now}, nil
		},
		SuspendUserFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, IsVerified: false, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, adminID, action, targetType, _ string, details json.RawMessage) (*store.AuditLog, error) {
			auditCalled = true
			capturedAction = action
			capturedTargetType = targetType
			capturedAdminID = adminID
			if !strings.Contains(string(details), "violation") {
				t.Errorf("audit details missing reason: %s", string(details))
			}
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
	if !auditCalled {
		t.Error("CreateAuditLog was not called for suspend")
	}
	if capturedAction != "user.suspend" {
		t.Errorf("audit action = %q, want user.suspend", capturedAction)
	}
	if capturedTargetType != "user" {
		t.Errorf("audit targetType = %q, want user", capturedTargetType)
	}
	if capturedAdminID != "admin-1" {
		t.Errorf("audit adminID = %q, want admin-1", capturedAdminID)
	}
}

// TestSuspendUser_AuditLogFailureIsNotFatal verifies that if the audit log
// write fails, the suspend operation still returns success.
func TestSuspendUser_AuditLogFailureIsNotFatal(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", IsVerified: true, CreatedAt: now, UpdatedAt: now}, nil
		},
		SuspendUserFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, IsVerified: false, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return nil, fmt.Errorf("audit db down")
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
		t.Errorf("audit log failure must not fail request: status = %d, want %d", resp.StatusCode, fiber.StatusOK)
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
	var auditCalled bool
	var capturedAction string
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", Role: "owner", IsVerified: false, CreatedAt: now, UpdatedAt: now}, nil
		},
		UnsuspendUserFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, IsVerified: true, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, action, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			auditCalled = true
			capturedAction = action
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
	if !auditCalled {
		t.Error("CreateAuditLog was not called for unsuspend")
	}
	if capturedAction != "user.unsuspend" {
		t.Errorf("audit action = %q, want user.unsuspend", capturedAction)
	}
}

// TestUnsuspendUser_AuditLogFailureIsNotFatal verifies best-effort audit log.
func TestUnsuspendUser_AuditLogFailureIsNotFatal(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "a@b.com", IsVerified: false, CreatedAt: now, UpdatedAt: now}, nil
		},
		UnsuspendUserFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, IsVerified: true, CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return nil, fmt.Errorf("audit db down")
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
		t.Errorf("audit log failure must not fail request: status = %d, want %d", resp.StatusCode, fiber.StatusOK)
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

func TestGetTalentDetail_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "t@b.com", Name: "Talent", Role: "talent", CreatedAt: now, UpdatedAt: now}, nil
		},
		GetTalentDetailFn: func(_ context.Context, _ string) (*store.TalentDetail, error) {
			return &store.TalentDetail{
				Profile: &store.TalentProfile{
					ID: "tp-1", UserID: "u-1", Tier: "mid",
					YearsOfExperience: 4, AvailabilityStatus: "available",
					VerificationStatus: "verified", CreatedAt: now, UpdatedAt: now,
				},
				Skills: []store.TalentSkillEntry{
					{SkillID: "s-1", SkillName: "Go", Category: "backend", ProficiencyLevel: "advanced", IsPrimary: true},
				},
				Penalties:      []store.TalentPenaltyEntry{},
				ProjectHistory: []store.TalentProjectHistoryEntry{},
			}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/u-1/talent-detail", nil)
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
			Profile *struct {
				Tier string `json:"tier"`
			} `json:"profile"`
			Skills []struct {
				SkillName string `json:"skillName"`
			} `json:"skills"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Data.Profile == nil || body.Data.Profile.Tier != "mid" {
		t.Errorf("unexpected body: %+v", body)
	}
	if len(body.Data.Skills) != 1 || body.Data.Skills[0].SkillName != "Go" {
		t.Errorf("skills = %+v, want one Go skill", body.Data.Skills)
	}
}

func TestGetTalentDetail_NotTalent(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "o@b.com", Name: "Owner", Role: "owner", CreatedAt: now, UpdatedAt: now}, nil
		},
		GetTalentDetailFn: func(_ context.Context, _ string) (*store.TalentDetail, error) {
			return &store.TalentDetail{
				Profile:        nil,
				Skills:         []store.TalentSkillEntry{},
				Penalties:      []store.TalentPenaltyEntry{},
				ProjectHistory: []store.TalentProjectHistoryEntry{},
			}, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/u-2/talent-detail", nil)
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
			Profile any `json:"profile"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Data.Profile != nil {
		t.Errorf("expected null profile, got %+v", body)
	}
}

func TestGetTalentDetail_UserNotFound(t *testing.T) {
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) {
			return nil, nil
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/missing/talent-detail", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestGetTalentDetail_StoreError(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, id string) (*store.User, error) {
			return &store.User{ID: id, Email: "t@b.com", Name: "T", Role: "talent", CreatedAt: now, UpdatedAt: now}, nil
		},
		GetTalentDetailFn: func(_ context.Context, _ string) (*store.TalentDetail, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewUsersHandler(mock)
	app := newUsersTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/users/u-3/talent-detail", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

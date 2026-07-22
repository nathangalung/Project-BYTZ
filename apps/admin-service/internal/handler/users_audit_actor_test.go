package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

// The actor in an audit log has to come from the session.
//
// UpdateSetting and ReprocessDLQEvent read c.Locals("adminUserID"), which
// AdminAuth sets from a verified session. Suspend and unsuspend took it from
// the request body instead, so one admin could record another as having done
// it. The audit write is deliberately best-effort, and admin_audit_logs.admin_id
// has a foreign key to user, so a body naming a non-existent admin produced a
// 200 with no audit row at all.

func newUsersAuditApp(h *UsersHandler, sessionAdmin string) *fiber.App {
	app := fiber.New()
	// Stands in for AdminAuth, which sets this from the session.
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("adminUserID", sessionAdmin)
		return c.Next()
	})
	g := app.Group("/api/v1/admin")
	g.Patch("/users/:id/suspend", h.SuspendUser)
	g.Patch("/users/:id/unsuspend", h.UnsuspendUser)
	return app
}

func auditCapturingUserStore(seen *string) *store.MockUserStore {
	now := time.Now().UTC()
	user := &store.User{ID: "victim", Email: "v@example.com", Role: "talent", CreatedAt: now, UpdatedAt: now}
	return &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) { return user, nil },
		SuspendUserFn: func(_ context.Context, _ string) (*store.User, error) { return user, nil },
		UnsuspendUserFn: func(_ context.Context, _ string) (*store.User, error) {
			return user, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, adminID, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			*seen = adminID
			return &store.AuditLog{ID: "audit-1"}, nil
		},
	}
}

func TestSuspendUser_RecordsTheSessionAdminNotTheBody(t *testing.T) {
	var seen string
	app := newUsersAuditApp(NewUsersHandler(auditCapturingUserStore(&seen)), "admin-A")

	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/victim/suspend",
		strings.NewReader(`{"adminId":"admin-B","reason":"spam"}`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if seen != "admin-A" {
		t.Errorf("audit actor = %q, want admin-A (the session), not the body", seen)
	}
}

func TestUnsuspendUser_RecordsTheSessionAdminNotTheBody(t *testing.T) {
	var seen string
	app := newUsersAuditApp(NewUsersHandler(auditCapturingUserStore(&seen)), "admin-A")

	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/victim/unsuspend",
		strings.NewReader(`{"adminId":"admin-B"}`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if seen != "admin-A" {
		t.Errorf("audit actor = %q, want admin-A", seen)
	}
}

// A service-auth caller has its locals pinned to "service" so it cannot name
// an actor. Reading the body defeated that pin.
func TestSuspendUser_RefusesWithoutASessionAdmin(t *testing.T) {
	var seen string
	app := newUsersAuditApp(NewUsersHandler(auditCapturingUserStore(&seen)), "")

	req := httptest.NewRequest("PATCH", "/api/v1/admin/users/victim/suspend",
		strings.NewReader(`{"adminId":"admin-B","reason":"spam"}`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
	if seen != "" {
		t.Errorf("wrote an audit log naming %q with no session", seen)
	}
}

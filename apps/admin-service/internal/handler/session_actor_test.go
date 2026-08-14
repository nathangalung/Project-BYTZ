package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/admin-service/internal/publisher"
	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

/*
Every mutating admin endpoint reads its actor from c.Locals("adminUserID"),
which AdminAuth sets from a verified session. If that local is absent the
handler must refuse, not fall through with an empty actor.

The status code is the smaller half of the property. The half that matters is
that the mutation does not happen: admin_audit_logs.admin_id is a foreign key
to user, so an empty actor produces a state change with no audit row behind it -
a suspension, a settings change, or a republished event that nobody performed.

These tests mount the handler with no auth middleware at all, which is the
shape of the bug: a route registered outside the admin group, or a middleware
that returns c.Next() on a path it failed to check.
*/

func mountBare(register func(*fiber.App)) *fiber.App {
	app := fiber.New()
	register(app)
	return app
}

func assertUnauthorized(t *testing.T, app *fiber.App, method, path, body string) {
	t.Helper()

	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}

	var decoded struct {
		Success bool `json:"success"`
		Error   struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if decoded.Success {
		t.Error("success = true on an unauthenticated mutation")
	}
	if decoded.Error.Code != "AUTH_UNAUTHORIZED" {
		t.Errorf("error code = %q, want %q", decoded.Error.Code, "AUTH_UNAUTHORIZED")
	}
}

func TestUpdateSetting_RefusesWithoutASessionAdmin(t *testing.T) {
	var upserted, audited int
	users := &store.MockUserStore{
		UpsertPlatformSettingFn: func(_ context.Context, _, _ string, _ json.RawMessage, _ *string, _ string) (*store.PlatformSetting, error) {
			upserted++
			return &store.PlatformSetting{Key: "k"}, nil
		},
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			audited++
			return &store.AuditLog{ID: "a-1"}, nil
		},
	}
	h := NewDashboardHandler(&store.MockDashboardStore{}, users)

	app := mountBare(func(a *fiber.App) { a.Patch("/settings/:key", h.UpdateSetting) })
	assertUnauthorized(t, app, "PATCH", "/settings/matching_weights", `{"value":{"skill":1}}`)

	if upserted != 0 {
		t.Errorf("settings written = %d, want 0; an unattributable config change was applied", upserted)
	}
	if audited != 0 {
		t.Errorf("audit rows = %d, want 0", audited)
	}
}

func TestUnsuspendUser_RefusesWithoutASessionAdmin(t *testing.T) {
	now := time.Now().UTC()
	var unsuspended int
	users := &store.MockUserStore{
		GetUserByIDFn: func(_ context.Context, _ string) (*store.User, error) {
			return &store.User{ID: "victim", Email: "v@example.com", Role: "talent", CreatedAt: now, UpdatedAt: now}, nil
		},
		UnsuspendUserFn: func(_ context.Context, _ string) (*store.User, error) {
			unsuspended++
			return &store.User{ID: "victim"}, nil
		},
	}
	h := NewUsersHandler(users)

	app := mountBare(func(a *fiber.App) { a.Patch("/users/:id/unsuspend", h.UnsuspendUser) })
	assertUnauthorized(t, app, "PATCH", "/users/victim/unsuspend", `{"reason":"appeal accepted"}`)

	if unsuspended != 0 {
		t.Errorf("unsuspends = %d, want 0; a suspension was lifted by nobody", unsuspended)
	}
}

func TestReprocessDLQEvent_RefusesWithoutASessionAdmin(t *testing.T) {
	pub := &publisher.MockPublisher{}
	var marked int
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			return &store.DLQEvent{ID: "d-1", EventType: "payment.released"}, nil
		},
		MarkReprocessedFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			marked++
			return &store.DLQEvent{ID: "d-1"}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, pub)

	app := mountBare(func(a *fiber.App) { a.Patch("/dlq/:id/reprocess", h.ReprocessDLQEvent) })
	assertUnauthorized(t, app, "PATCH", "/dlq/d-1/reprocess", `{}`)

	if len(pub.Calls) != 0 {
		t.Errorf("republishes = %d, want 0; an event was replayed onto NATS by nobody", len(pub.Calls))
	}
	if marked != 0 {
		t.Errorf("reprocessed marks = %d, want 0", marked)
	}
}

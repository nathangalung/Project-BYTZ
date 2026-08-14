package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

// withAdmin mounts a route with a session already established, since every
// mutating handler reads the actor from locals rather than the body.
func withAdmin(app *fiber.App, adminID string) {
	app.Use(func(c *fiber.Ctx) error {
		if adminID != "" {
			c.Locals("adminUserID", adminID)
			c.Locals("adminUserName", "Admin")
		}
		return c.Next()
	})
}

func TestGetEscrow_StoreFailureIs500(t *testing.T) {
	h := NewFinanceHandler(&store.MockFinanceStore{
		GetEscrowByProjectFn: func(context.Context, int) ([]store.EscrowProjectRow, error) {
			return nil, errors.New("db down")
		},
	})

	app := fiber.New()
	app.Get("/escrow", h.GetEscrow)

	resp, err := app.Test(httptest.NewRequest("GET", "/escrow", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want 500", resp.StatusCode)
	}
}

// The limit query parameter must reach the store, or the page size control
// on the escrow view does nothing.
func TestGetEscrow_PassesTheLimitThrough(t *testing.T) {
	tests := []struct {
		query string
		want  int
	}{
		{"", 20},
		{"?limit=5", 5},
		{"?limit=100", 100},
		{"?limit=notanumber", 20},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			var got int
			h := NewFinanceHandler(&store.MockFinanceStore{
				GetEscrowByProjectFn: func(_ context.Context, limit int) ([]store.EscrowProjectRow, error) {
					got = limit
					return []store.EscrowProjectRow{}, nil
				},
			})

			app := fiber.New()
			app.Get("/escrow", h.GetEscrow)

			resp, err := app.Test(httptest.NewRequest("GET", "/escrow"+tt.query, nil))
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Fatalf("status = %d, want 200", resp.StatusCode)
			}
			if got != tt.want {
				t.Errorf("limit = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestGetTalentDetail_StoreFailures(t *testing.T) {
	tests := []struct {
		name       string
		users      *store.MockUserStore
		wantStatus int
	}{
		{
			name: "user lookup fails",
			users: &store.MockUserStore{
				GetUserByIDFn: func(context.Context, string) (*store.User, error) {
					return nil, errors.New("db down")
				},
			},
			wantStatus: fiber.StatusInternalServerError,
		},
		{
			name: "unknown user",
			users: &store.MockUserStore{
				GetUserByIDFn: func(context.Context, string) (*store.User, error) { return nil, nil },
			},
			wantStatus: fiber.StatusNotFound,
		},
		{
			name: "talent detail fails",
			users: &store.MockUserStore{
				GetUserByIDFn: func(context.Context, string) (*store.User, error) {
					return &store.User{ID: "u-1"}, nil
				},
				GetTalentDetailFn: func(context.Context, string) (*store.TalentDetail, error) {
					return nil, errors.New("db down")
				},
			},
			wantStatus: fiber.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewUsersHandler(tt.users)

			app := fiber.New()
			app.Get("/users/:id/talent-detail", h.GetTalentDetail)

			resp, err := app.Test(httptest.NewRequest("GET", "/users/u-1/talent-detail", nil))
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
		})
	}
}

// A key is required, or the handler would upsert an unnamed setting.
func TestUpdateSetting_MissingKeyIs400(t *testing.T) {
	h := NewDashboardHandler(&store.MockDashboardStore{}, &store.MockUserStore{})

	app := fiber.New()
	withAdmin(app, "admin-1")
	// A route whose key parameter is optional lets the empty case be reached.
	app.Patch("/settings/:key?", h.UpdateSetting)

	req := httptest.NewRequest("PATCH", "/settings/", strings.NewReader(`{"value":1}`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}

	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "VALIDATION_ERROR" {
		t.Errorf("code = %v, want VALIDATION_ERROR", errObj["code"])
	}
}

func TestUpdateSetting_MalformedBodyIs400(t *testing.T) {
	h := NewDashboardHandler(&store.MockDashboardStore{}, &store.MockUserStore{})

	app := fiber.New()
	withAdmin(app, "admin-1")
	app.Patch("/settings/:key", h.UpdateSetting)

	req := httptest.NewRequest("PATCH", "/settings/auto_release_days", strings.NewReader(`{not json`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUnsuspendUser_MalformedBodyIs400(t *testing.T) {
	h := NewUsersHandler(&store.MockUserStore{})

	app := fiber.New()
	withAdmin(app, "admin-1")
	app.Post("/users/:id/unsuspend", h.UnsuspendUser)

	req := httptest.NewRequest("POST", "/users/u-1/unsuspend", strings.NewReader(`{not json`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestReprocessDLQEvent_MalformedBodyIs400(t *testing.T) {
	h := NewDLQHandler(&store.MockDLQStore{}, &store.MockUserStore{}, nil)

	app := fiber.New()
	withAdmin(app, "admin-1")
	app.Post("/dlq/:id/reprocess", h.ReprocessDLQEvent)

	req := httptest.NewRequest("POST", "/dlq/dl-1/reprocess", strings.NewReader(`{not json`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// Reproduces main.go's registration order.
//
// Every other webhook test builds a bare `fiber.New()` and calls only
// wh.Register(app), so none of them sees the auth middleware that production
// mounts on the same prefix. Fiber's Group(prefix, mw) is prefix-scoped Use:
// it applies to every request matching the prefix, not only to routes declared
// on the returned router. RegisterWithAuth mounts session auth on
// /api/v1/payments, and the webhook lives under /api/v1/payments/webhook, so
// the webhook inherits it.
//
// Consequence if this regresses: Midtrans callbacks arrive without a session
// cookie, get 401, and no payment is ever confirmed.
// Calls the same RegisterAll that main.go does, so the order under test cannot
// drift away from the order that ships.
func registerLikeProduction(app *fiber.App) {
	rejectAll := func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusUnauthorized).
			JSON(fiber.Map{"success": false, "error": fiber.Map{"code": "AUTH_UNAUTHORIZED"}})
	}

	RegisterAll(
		app,
		&PaymentHandler{},
		NewWebhookHandler(nil, "server-key", "", "auth-secret"),
		rejectAll,
		rejectAll,
	)
}

func TestMidtransWebhook_ReachableWithoutSession(t *testing.T) {
	app := fiber.New()
	registerLikeProduction(app)

	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}

	// 400 means the handler ran and rejected the body. 401 means auth
	// middleware swallowed the callback before the handler was reached.
	if resp.StatusCode == fiber.StatusUnauthorized {
		t.Fatalf("webhook is behind auth: got 401, so Midtrans callbacks never reach the handler")
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

// The user-facing routes must stay protected; the fix must not open them up.
func TestPaymentRoutes_StillRequireAuth(t *testing.T) {
	app := fiber.New()
	registerLikeProduction(app)

	for _, path := range []string{"/api/v1/payments/summary", "/api/v1/payments/list"} {
		resp, err := app.Test(httptest.NewRequest("GET", path, nil))
		if err != nil {
			t.Fatalf("test request failed: %v", err)
		}
		if resp.StatusCode != fiber.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", path, resp.StatusCode)
		}
	}
}

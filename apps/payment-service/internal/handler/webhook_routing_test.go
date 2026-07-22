package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// Shares RegisterAll with main, prevents drift.
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

	// 400 handler ran, 401 auth blocked
	if resp.StatusCode == fiber.StatusUnauthorized {
		t.Fatalf("webhook is behind auth: got 401, so Midtrans callbacks never reach the handler")
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

// Fix must not open user routes.
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

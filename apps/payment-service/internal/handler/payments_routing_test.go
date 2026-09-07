package handler

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// Both gates short-circuit with their own name, so a response says which
// middleware chain a path actually went through. Asserting on the gate rather
// than on the handler keeps this about routing and needs no service wiring.
func gate(name string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusTeapot).JSON(fiber.Map{"gate": name})
	}
}

func registerWithGates(app *fiber.App) {
	RegisterAll(
		app,
		&PaymentHandler{},
		NewWebhookHandler(nil, nil, "server-key", "", "auth-secret"),
		gate("session"),
		gate("service"),
	)
}

func gateReached(t *testing.T, method, path string) string {
	t.Helper()
	app := fiber.New()
	registerWithGates(app)

	req := httptest.NewRequest(method, path, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusTeapot {
		return "" // no gate ran, the handler was reached directly
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var parsed struct {
		Gate string `json:"gate"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("decode body %q: %v", body, err)
	}
	return parsed.Gate
}

// The bug this pins: fiber mounts Group middleware on the PREFIX, so two groups
// sharing /api/v1/payments stacked session auth onto the service-to-service
// routes. Session auth ran first and demanded a cookie no background job
// carries, so every milestone release, 14 day auto-release and refund answered
// 401 and no talent could be paid.
func TestServiceRoutes_PassServiceAuthOnly(t *testing.T) {
	cases := []struct{ name, method, path string }{
		{"release", "POST", "/api/v1/payments/internal/release"},
		{"refund", "POST", "/api/v1/payments/internal/refund"},
		{"escrow balance", "GET", "/api/v1/payments/internal/escrow-balance/proj-1"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := gateReached(t, tc.method, tc.path); got != "service" {
				t.Fatalf("gate = %q on %s %s, want \"service\"", got, tc.method, tc.path)
			}
		})
	}
}

// User routes keep their session gate and must not be reachable with the
// service secret instead.
func TestUserRoutes_PassSessionAuthOnly(t *testing.T) {
	cases := []struct{ name, method, path string }{
		{"summary", "GET", "/api/v1/payments/summary"},
		{"list", "GET", "/api/v1/payments/list"},
		{"project transactions", "GET", "/api/v1/payments/project/proj-1"},
		{"transaction by id", "GET", "/api/v1/payments/txn-1"},
		{"snap token", "POST", "/api/v1/payments/create-snap-token"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := gateReached(t, tc.method, tc.path); got != "session" {
				t.Fatalf("gate = %q on %s %s, want \"session\"", got, tc.method, tc.path)
			}
		})
	}
}

// Registration order must not decide whether the webhook is reachable. It used
// to: the webhook survived only because it registered before the group that
// mounted session auth on the shared prefix. Midtrans carries neither a session
// nor the service secret, so any gate at all locks settlement out.
func TestWebhook_PassesNoGate(t *testing.T) {
	if got := gateReached(t, "POST", "/api/v1/payments/webhook/midtrans"); got != "" {
		t.Fatalf("gate = %q on the midtrans webhook, want none", got)
	}
}

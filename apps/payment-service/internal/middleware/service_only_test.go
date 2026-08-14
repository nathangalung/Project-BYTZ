package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

/*
ServiceOnly guards the routes that move money: /release and /refund are called
by project-service and must never accept a user session, because a browser
session reaching them would let an owner release escrow to whoever they named.

The comparison is constant time and the secret is never empty-matched, so an
unset secret refuses everything rather than accepting everything.
*/
func TestServiceOnly(t *testing.T) {
	tests := []struct {
		name        string
		secret      string
		header      string
		wantAllowed bool
	}{
		{name: "the configured secret", secret: "shared-secret", header: "shared-secret", wantAllowed: true},
		{name: "a wrong secret", secret: "shared-secret", header: "guess"},
		{name: "no header at all", secret: "shared-secret"},
		{name: "a prefix of the secret", secret: "shared-secret", header: "shared"},
		{name: "the secret with an extra character", secret: "shared-secret", header: "shared-secretx"},
		// An unconfigured service must fail closed. Comparing "" to "" would
		// otherwise open the money routes to anyone sending an empty header.
		{name: "no secret configured, empty header", secret: "", header: ""},
		{name: "no secret configured, any header", secret: "", header: "anything"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			orig := serviceAuthSecret
			serviceAuthSecret = tt.secret
			defer func() { serviceAuthSecret = orig }()

			app := fiber.New()
			app.Use(ServiceOnly())
			app.Get("/release", func(c *fiber.Ctx) error {
				// A shared secret must not let the caller pick a user; the
				// middleware deliberately sets no userID.
				if c.Locals("userID") != nil {
					t.Error("ServiceOnly populated userID from the request")
				}
				return c.SendString("released")
			})

			req := httptest.NewRequest(http.MethodGet, "/release", nil)
			if tt.header != "" {
				req.Header.Set("X-Service-Auth", tt.header)
			}
			// A caller-supplied user id must be ignored whatever else happens.
			req.Header.Set("X-User-ID", "attacker")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}

			if tt.wantAllowed {
				if resp.StatusCode != fiber.StatusOK {
					t.Fatalf("status = %d, want 200", resp.StatusCode)
				}
				return
			}
			if resp.StatusCode != fiber.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", resp.StatusCode)
			}

			body, _ := io.ReadAll(resp.Body)
			var out struct {
				Success bool `json:"success"`
				Error   struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(body, &out); err != nil {
				t.Fatalf("unmarshal %s: %v", body, err)
			}
			if out.Success || out.Error.Code != "AUTH_SERVICE_REQUIRED" {
				t.Errorf("body = %s, want AUTH_SERVICE_REQUIRED", body)
			}
		})
	}
}

// A misconfigured auth service URL must degrade to 503 rather than letting the
// request through unauthenticated. The request cannot even be built, so this is
// the earliest point the middleware can fail, and it has to fail closed.
func TestSessionAuth_UnbuildableAuthRequestFailsClosed(t *testing.T) {
	app := fiber.New()
	app.Use(SessionAuth("http://bad\nhost"))
	reached := false
	app.Get("/summary", func(c *fiber.Ctx) error {
		reached = true
		return c.SendString("ok")
	})

	req := httptest.NewRequest(http.MethodGet, "/summary", nil)
	req.Header.Set("Cookie", "session=abc")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}
	if reached {
		t.Error("the handler ran without an authenticated session")
	}

	body, _ := io.ReadAll(resp.Body)
	var out struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	if out.Error.Code != "SERVICE_UNAVAILABLE" {
		t.Errorf("error code = %q, want SERVICE_UNAVAILABLE", out.Error.Code)
	}
}

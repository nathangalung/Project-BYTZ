package middleware

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// ServiceOnly guards the internal create endpoint. Anything that is not the
// exact shared secret has to be rejected, including a valid user session:
// letting a session through would let any logged-in user write a notification
// addressed to anybody.
func TestServiceOnly(t *testing.T) {
	tests := []struct {
		name       string
		secret     string
		header     string
		cookie     string
		wantStatus int
	}{
		{"correct secret passes", "shared-secret", "shared-secret", "", fiber.StatusOK},
		{"wrong secret rejected", "shared-secret", "not-it", "", fiber.StatusUnauthorized},
		{"missing header rejected", "shared-secret", "", "", fiber.StatusUnauthorized},
		{"unconfigured secret rejects everything", "", "anything", "", fiber.StatusUnauthorized},
		{"unconfigured secret rejects empty too", "", "", "", fiber.StatusUnauthorized},
		{"a user session is not service auth", "shared-secret", "", "session=abc", fiber.StatusUnauthorized},
		{"prefix of the secret rejected", "shared-secret", "shared", "", fiber.StatusUnauthorized},
		// Same length, one byte different: this is what a constant-time compare
		// has to get right and a length check alone would not.
		{"near miss rejected", "shared-secret", "shared-secreT", "", fiber.StatusUnauthorized},
		{"longer than the secret rejected", "shared-secret", "shared-secretX", "", fiber.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			orig := serviceAuthSecret
			serviceAuthSecret = tt.secret
			t.Cleanup(func() { serviceAuthSecret = orig })

			app := fiber.New()
			app.Post("/internal", ServiceOnly(), func(c *fiber.Ctx) error {
				return c.SendString("ok")
			})

			req := httptest.NewRequest("POST", "/internal", nil)
			if tt.header != "" {
				req.Header.Set("X-Service-Auth", tt.header)
			}
			if tt.cookie != "" {
				req.Header.Set("Cookie", tt.cookie)
			}

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
		})
	}
}

func TestServiceOnly_RejectionCarriesTheErrorCode(t *testing.T) {
	orig := serviceAuthSecret
	serviceAuthSecret = "shared-secret"
	t.Cleanup(func() { serviceAuthSecret = orig })

	app := fiber.New()
	app.Post("/internal", ServiceOnly(), func(c *fiber.Ctx) error { return c.SendString("ok") })

	resp, err := app.Test(httptest.NewRequest("POST", "/internal", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}

	var body struct {
		Success bool `json:"success"`
		Error   struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Success {
		t.Error("success = true on a rejection")
	}
	if body.Error.Code != "AUTH_SERVICE_REQUIRED" {
		t.Errorf("code = %q, want AUTH_SERVICE_REQUIRED", body.Error.Code)
	}
}

// The shared secret must not double as a user identity. Nothing may read
// X-User-ID, or any service holding the secret could act as any user.
func TestServiceOnly_DoesNotAdoptCallerSuppliedUserID(t *testing.T) {
	orig := serviceAuthSecret
	serviceAuthSecret = "shared-secret"
	t.Cleanup(func() { serviceAuthSecret = orig })

	app := fiber.New()
	app.Post("/internal", ServiceOnly(), func(c *fiber.Ctx) error {
		if v := c.Locals("userID"); v != nil {
			return c.SendString("adopted:" + v.(string))
		}
		return c.SendString("none")
	})

	req := httptest.NewRequest("POST", "/internal", nil)
	req.Header.Set("X-Service-Auth", "shared-secret")
	req.Header.Set("X-User-ID", "victim-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	buf := make([]byte, 64)
	n, _ := resp.Body.Read(buf)
	if got := string(buf[:n]); got != "none" {
		t.Errorf("body = %q, want none (a caller-supplied user id must not be trusted)", got)
	}
}

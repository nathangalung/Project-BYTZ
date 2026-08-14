package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestSessionAuth_NoCookie(t *testing.T) {
	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_InvalidServiceAuth(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "wrong")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

// A valid service secret must not let the caller assert an identity - that let
// anyone holding the shared secret read or act on any user's notifications.
func TestSessionAuth_ServiceAuthDoesNotTrustUserIDHeader(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		uid, _ := c.Locals("userID").(string)
		return c.SendString(uid)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "correct")
	req.Header.Set("X-User-ID", "user-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	// Falls through to session validation, which has no cookie.
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d (X-User-ID must not be trusted)", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_EmptySecret(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = ""
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "any")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_CookieAuthDown(t *testing.T) {
	app := fiber.New()
	app.Use(SessionAuth("http://localhost:1"))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusServiceUnavailable)
	}
}

func TestSessionAuth_CookieAuthRejects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(SessionAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_CookieInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not json"))
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(SessionAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_CookieNullUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"user": nil})
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(SessionAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_CookieValidSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"user": map[string]string{"id": "u-1", "name": "Test", "role": "owner"},
		})
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(SessionAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString(c.Locals("userID").(string))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

// A malformed AUTH_SERVICE_URL must degrade to 503, not 401. The distinction is
// operational: 401 tells the caller its session is bad and sends the user to
// log in again, when in fact the deployment is misconfigured and no session
// would ever work.
func TestSessionAuth_UnbuildableAuthURLIsUnavailableNotUnauthorized(t *testing.T) {
	app := fiber.New()
	// A control character survives string concatenation and fails url.Parse.
	app.Use(SessionAuth("http://auth\x7f.invalid"))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusServiceUnavailable)
	}

	var body struct {
		Success bool `json:"success"`
		Error   struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Success {
		t.Error("success = true on a failed auth lookup")
	}
	if body.Error.Code != "SERVICE_UNAVAILABLE" {
		t.Errorf("error code = %q, want %q", body.Error.Code, "SERVICE_UNAVAILABLE")
	}
}

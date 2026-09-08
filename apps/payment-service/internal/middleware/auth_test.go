package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestSessionAuth_NoCookie(t *testing.T) {
	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
	body, _ := io.ReadAll(resp.Body)
	var r map[string]any
	json.Unmarshal(body, &r)
	if r["success"] != false {
		t.Error("expected success=false")
	}
}

func TestSessionAuth_InvalidServiceAuth(t *testing.T) {
	// Ensure serviceAuthSecret is set
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct-secret"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "wrong-secret")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

// A valid service secret must not let the caller choose which user it is acting
// as. This previously returned 200 with userID = "user-123", which meant anyone
// holding the shared secret could release escrow as any project owner.
func TestSessionAuth_ServiceAuthDoesNotTrustUserIDHeader(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct-secret"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		uid, _ := c.Locals("userID").(string)
		return c.SendString(uid)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "correct-secret")
	req.Header.Set("X-User-ID", "user-123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	// Falls through to session validation, which has no cookie.
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d (X-User-ID must not be trusted)", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_ValidServiceAuth_NoUserID(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct-secret"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("should not reach")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "correct-secret")
	// No X-User-ID, should fall through to cookie check

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	// No cookie either, so should be 401
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_EmptyServiceSecret(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = ""
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(SessionAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "any-value")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	// Empty secret means service auth always fails
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_WithCookie_AuthServiceDown(t *testing.T) {
	app := fiber.New()
	// Point to unreachable auth service
	app.Use(SessionAuth("http://localhost:1"))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusServiceUnavailable)
	}
}

func TestSessionAuth_WithCookie_AuthServiceRejects(t *testing.T) {
	// Create a mock auth service that returns 401
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_WithCookie_AuthServiceReturnsInvalidJSON(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not json"))
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_WithCookie_AuthServiceReturnsNullUser(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"user": nil})
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestSessionAuth_WithCookie_ValidSession(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"user": map[string]string{
				"id":   "user-999",
				"name": "Test User",
				"role": "owner",
			},
		})
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		uid, _ := c.Locals("userID").(string)
		name, _ := c.Locals("userName").(string)
		return c.JSON(fiber.Map{"uid": uid, "name": name})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

// A throttled auth service means the session could not be checked, not that it
// was refused. Answering 401 here signed owners out mid-generation: every
// service-to-service check shared one rate-limit bucket, so a busy minute
// looked exactly like an expired cookie.
func TestSessionAuth_ThrottledAuthServiceIsUnavailableNotUnauthorized(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d (a throttled check must not end the session)", resp.StatusCode, fiber.StatusServiceUnavailable)
	}
}

// 403 is a refusal like 401, and must still end the session.
func TestSessionAuth_ForbiddenStillRefusesTheSession(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
}

// The caller's address has to reach the auth service, or every check this
// service makes is counted as one client.
func TestSessionAuth_ForwardsTheCallerAddress(t *testing.T) {
	seen := make(chan string, 1)
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Header.Get("CF-Connecting-IP")
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(SessionAuth(authServer.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=abc123")
	req.Header.Set("CF-Connecting-IP", "203.0.113.7")

	if _, err := app.Test(req); err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if got := <-seen; got != "203.0.113.7" {
		t.Errorf("CF-Connecting-IP = %q, want %q", got, "203.0.113.7")
	}
}

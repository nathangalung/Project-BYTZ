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

func TestSessionAuth_ValidServiceAuth(t *testing.T) {
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
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "user-123" {
		t.Errorf("body = %q, want user-123", string(body))
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

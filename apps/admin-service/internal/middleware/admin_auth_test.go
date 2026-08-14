package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestAdminAuth_NoCookie(t *testing.T) {
	app := fiber.New()
	app.Use(AdminAuth("http://localhost:9999"))
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

func TestAdminAuth_InvalidServiceAuth(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(AdminAuth("http://localhost:9999"))
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

func TestAdminAuth_ValidServiceAuth(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = "correct"
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(AdminAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.SendString(c.Locals("adminUserID").(string))
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "correct")
	req.Header.Set("X-User-ID", "admin-1")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	body, _ := io.ReadAll(resp.Body)
	// Machine callers get a fixed identity. This previously echoed "admin-1"
	// from the request header, so the shared secret both impersonated a user
	// and skipped the admin role check.
	if string(body) != "service" {
		t.Errorf("body = %q, want service (X-User-ID must not be trusted)", string(body))
	}
}

func TestAdminAuth_EmptySecret(t *testing.T) {
	origSecret := serviceAuthSecret
	serviceAuthSecret = ""
	defer func() { serviceAuthSecret = origSecret }()

	app := fiber.New()
	app.Use(AdminAuth("http://localhost:9999"))
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

func TestAdminAuth_CookieAuthDown(t *testing.T) {
	app := fiber.New()
	app.Use(AdminAuth("http://localhost:1"))
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

func TestAdminAuth_CookieAuthRejects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(AdminAuth(server.URL))
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

func TestAdminAuth_CookieInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not json"))
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(AdminAuth(server.URL))
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

func TestAdminAuth_CookieNonAdminRole(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"user": map[string]string{"id": "u-1", "name": "User", "role": "owner"},
		})
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(AdminAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusForbidden {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusForbidden)
	}
}

func TestAdminAuth_CookieNullUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"user": nil})
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(AdminAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Cookie", "session=x")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusForbidden {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusForbidden)
	}
}

func TestAdminAuth_CookieValidAdmin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"user": map[string]string{"id": "admin-1", "name": "Admin", "role": "admin"},
		})
	}))
	defer server.Close()

	app := fiber.New()
	app.Use(AdminAuth(server.URL))
	app.Get("/test", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"uid":  c.Locals("adminUserID"),
			"name": c.Locals("adminUserName"),
		})
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

// A malformed AUTH_SERVICE_URL must degrade to 503, not 401/403. The
// distinction is operational: an auth-shaped rejection sends the admin off to
// log in again, when in fact the deployment is misconfigured and no session
// would ever be accepted.
//
// Note the body still carries code AUTH_UNAUTHORIZED on this path while the
// status is 503; notification-service returns SERVICE_UNAVAILABLE for the same
// condition. Asserted as-is rather than as the preferred value, so this test
// does not quietly become the specification for the inconsistency.
func TestAdminAuth_UnbuildableAuthURLIsUnavailableNotUnauthorized(t *testing.T) {
	app := fiber.New()
	// A control character survives string concatenation and fails url.Parse.
	app.Use(AdminAuth("http://auth\x7f.invalid"))
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
}

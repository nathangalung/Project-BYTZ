package middleware

import (
	"encoding/json"
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

// X-Service-Auth confers nothing on admin-service. It used to short-circuit
// before the role check, so the shared service secret alone granted full admin.
// No service calls admin-service; the console reaches it with a session cookie.
func TestAdminAuth_ServiceAuthHeaderGrantsNothing(t *testing.T) {
	app := fiber.New()
	app.Use(AdminAuth("http://localhost:9999"))
	app.Get("/test", func(c *fiber.Ctx) error { return c.SendString("ok") })

	// A service-auth header with no session cookie must be refused, not admitted.
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Service-Auth", "any-value")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d (service auth must not grant admin access)", resp.StatusCode, fiber.StatusUnauthorized)
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

// A throttled auth service means the session could not be checked, not that it
// was refused. Answering 401 here signed owners out mid-generation: every
// service-to-service check shared one rate-limit bucket, so a busy minute
// looked exactly like an expired cookie.
func TestAdminAuth_ThrottledAuthServiceIsUnavailableNotUnauthorized(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(AdminAuth(authServer.URL))
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
func TestAdminAuth_ForbiddenStillRefusesTheSession(t *testing.T) {
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(AdminAuth(authServer.URL))
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
func TestAdminAuth_ForwardsTheCallerAddress(t *testing.T) {
	seen := make(chan string, 1)
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Header.Get("CF-Connecting-IP")
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer authServer.Close()

	app := fiber.New()
	app.Use(AdminAuth(authServer.URL))
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

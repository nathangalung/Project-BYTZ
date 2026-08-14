package handler

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bytz/notification-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "centrifugo-hmac-secret"

// newWSApp mounts wsToken behind a middleware that fakes the session.
func newWSApp(secret, userID string) *fiber.App {
	h := New(&store.MockStore{})
	h.SetCentrifugoTokenSecret(secret)

	app := fiber.New()
	app.Get("/ws-token", func(c *fiber.Ctx) error {
		if userID != "" {
			c.Locals("userID", userID)
		}
		return h.wsToken(c)
	})
	return app
}

func decodeToken(t *testing.T, body io.Reader) string {
	t.Helper()
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.Success {
		t.Fatal("response reported failure")
	}
	return resp.Data.Token
}

// The token's sub must be the authenticated user. Centrifugo limits the
// notifications#<id> channel by that claim, so a wrong sub would let one user
// subscribe to another's notifications.
func TestWSToken_SubjectIsTheAuthenticatedUser(t *testing.T) {
	app := newWSApp(testSecret, "user-42")

	resp, err := app.Test(httptest.NewRequest("GET", "/ws-token", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	raw := decodeToken(t, resp.Body)
	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (interface{}, error) {
		return []byte(testSecret), nil
	})
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("token is not valid")
	}
	if claims["sub"] != "user-42" {
		t.Errorf("sub = %v, want user-42", claims["sub"])
	}
	if parsed.Method.Alg() != jwt.SigningMethodHS256.Alg() {
		t.Errorf("alg = %s, want HS256 (centrifugo's token_hmac_secret_key)", parsed.Method.Alg())
	}
}

// A token signed with the wrong secret must not verify, which is what proves
// the handler signs with the configured one.
func TestWSToken_RejectsAnotherSecret(t *testing.T) {
	app := newWSApp(testSecret, "user-42")

	resp, _ := app.Test(httptest.NewRequest("GET", "/ws-token", nil))
	raw := decodeToken(t, resp.Body)

	_, err := jwt.Parse(raw, func(*jwt.Token) (interface{}, error) {
		return []byte("a-different-secret"), nil
	})
	if err == nil {
		t.Error("the token verified under a different secret")
	}
}

// The token must expire, or a leaked one grants a permanent subscription.
func TestWSToken_IsShortLived(t *testing.T) {
	app := newWSApp(testSecret, "user-42")

	resp, _ := app.Test(httptest.NewRequest("GET", "/ws-token", nil))
	raw := decodeToken(t, resp.Body)

	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (interface{}, error) {
		return []byte(testSecret), nil
	}); err != nil {
		t.Fatalf("parse token: %v", err)
	}

	expRaw, ok := claims["exp"].(float64)
	if !ok {
		t.Fatal("no exp claim; the token would never expire")
	}
	iatRaw, ok := claims["iat"].(float64)
	if !ok {
		t.Fatal("no iat claim")
	}

	lifetime := time.Unix(int64(expRaw), 0).Sub(time.Unix(int64(iatRaw), 0))
	if lifetime != time.Hour {
		t.Errorf("lifetime = %v, want 1h", lifetime)
	}
	if time.Until(time.Unix(int64(expRaw), 0)) <= 0 {
		t.Error("the token is already expired")
	}
}

func TestWSToken_RequiresAuthentication(t *testing.T) {
	app := newWSApp(testSecret, "")

	resp, err := app.Test(httptest.NewRequest("GET", "/ws-token", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (an anonymous caller must not get a channel token)", resp.StatusCode)
	}
}

// With no secret configured the endpoint must say so rather than mint a token
// signed with the empty string, which anyone could forge.
func TestWSToken_UnconfiguredSecretIsUnavailable(t *testing.T) {
	app := newWSApp("", "user-42")

	resp, err := app.Test(httptest.NewRequest("GET", "/ws-token", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}

	var body apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error == nil || body.Error.Code != "WS_UNAVAILABLE" {
		t.Errorf("error = %+v, want code WS_UNAVAILABLE", body.Error)
	}
}

func TestSetCentrifugoTokenSecret(t *testing.T) {
	h := New(&store.MockStore{})
	if h.centrifugoTokenSecret != "" {
		t.Error("a new handler already has a secret")
	}
	h.SetCentrifugoTokenSecret("s3cret")
	if h.centrifugoTokenSecret != "s3cret" {
		t.Errorf("secret = %q, want s3cret", h.centrifugoTokenSecret)
	}
}

package middleware

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
)

var serviceAuthSecret = os.Getenv("SERVICE_AUTH_SECRET")

type sessionResponse struct {
	User *sessionUser `json:"user"`
}

type sessionUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

var authClient = &http.Client{Timeout: 5 * time.Second}

// SessionAuth validates the session cookie against the auth service.
// It stores the authenticated user ID in c.Locals("userID").
func SessionAuth(authURL string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Allow internal service-to-service calls via X-Service-Auth header
		if serviceAuth := c.Get("X-Service-Auth"); serviceAuth != "" {
			if serviceAuthSecret == "" || subtle.ConstantTimeCompare([]byte(serviceAuth), []byte(serviceAuthSecret)) != 1 {
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
					"success": false,
					"error": fiber.Map{
						"code":    "AUTH_UNAUTHORIZED",
						"message": "Invalid service auth",
					},
				})
			}
			// Trust X-User-ID only if service auth is valid
			userID := c.Get("X-User-ID")
			if userID != "" {
				c.Locals("userID", userID)
				return c.Next()
			}
		}

		cookie := c.Get("Cookie")
		if cookie == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
					"message": "Session required",
				},
			})
		}

		req, err := http.NewRequestWithContext(c.UserContext(), http.MethodGet, authURL+"/api/v1/auth/get-session", nil)
		if err != nil {
			slog.Error("failed to build auth request", "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "SERVICE_UNAVAILABLE",
					"message": "Auth service unavailable",
				},
			})
		}
		req.Header.Set("Cookie", cookie)

		resp, err := authClient.Do(req)
		if err != nil {
			slog.Error("auth service request failed", "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "SERVICE_UNAVAILABLE",
					"message": "Auth service unavailable",
				},
			})
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
					"message": "Invalid session",
				},
			})
		}

		var session sessionResponse
		if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
			slog.Error("failed to decode session", "error", err)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
					"message": "Invalid session response",
				},
			})
		}

		if session.User == nil || session.User.ID == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
					"message": "No user in session",
				},
			})
		}

		c.Locals("userID", session.User.ID)
		c.Locals("userName", session.User.Name)

		return c.Next()
	}
}

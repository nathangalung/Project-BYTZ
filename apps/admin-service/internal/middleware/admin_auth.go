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

// AdminAuth validates the session cookie against the auth service
// and ensures the user has the admin role.
func AdminAuth(authURL string) fiber.Handler {
	client := &http.Client{Timeout: 5 * time.Second}

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
			// Trust X-User-ID for internal calls
			userID := c.Get("X-User-ID")
			if userID != "" {
				c.Locals("adminUserID", userID)
				c.Locals("adminUserName", "service")
				return c.Next()
			}
		}

		cookie := c.Get("Cookie")
		if cookie == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
					"message": "Admin session required",
				},
			})
		}

		req, err := http.NewRequestWithContext(c.UserContext(), http.MethodGet, authURL+"/api/v1/auth/get-session", nil)
		if err != nil {
			slog.Error("failed to build auth request", "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
					"message": "Auth service unavailable",
				},
			})
		}
		req.Header.Set("Cookie", cookie)

		resp, err := client.Do(req)
		if err != nil {
			slog.Error("auth service request failed", "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_UNAUTHORIZED",
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

		if session.User == nil || session.User.Role != "admin" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "AUTH_FORBIDDEN",
					"message": "Admin access required",
				},
			})
		}

		// Store admin user in locals for downstream handlers
		c.Locals("adminUserID", session.User.ID)
		c.Locals("adminUserName", session.User.Name)

		slog.Debug("admin authenticated", "adminId", session.User.ID)

		return c.Next()
	}
}

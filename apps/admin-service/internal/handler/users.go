package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/bytz/admin-service/internal/store"
)

type UsersHandler struct {
	users store.UserStoreInterface
}

func NewUsersHandler(u store.UserStoreInterface) *UsersHandler {
	return &UsersHandler{users: u}
}

// ListUsers returns paginated users with optional filters.
// GET /api/v1/admin/users?role=talent&search=john&page=1&pageSize=20
func (h *UsersHandler) ListUsers(c *fiber.Ctx) error {
	role := c.Query("role")
	search := c.Query("search")
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("pageSize", 20)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	result, err := h.users.GetUsersList(c.UserContext(), store.UserFilters{
		Role:     role,
		Search:   search,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		slog.Error("failed to list users", "error", err)
		return internalError(c)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"items":    result.Items,
			"total":    result.Total,
			"page":     page,
			"pageSize": pageSize,
		},
	})
}

// GetUser returns a single user by ID.
// GET /api/v1/admin/users/:id
func (h *UsersHandler) GetUser(c *fiber.Ctx) error {
	id := c.Params("id")

	user, err := h.users.GetUserByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get user", "id", id, "error", err)
		return internalError(c)
	}
	if user == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "User not found",
			},
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    user,
	})
}

type suspendBody struct {
	AdminID string `json:"adminId"`
	Reason  string `json:"reason"`
}

// SuspendUser sets a user as unverified (suspended).
// PATCH /api/v1/admin/users/:id/suspend
func (h *UsersHandler) SuspendUser(c *fiber.Ctx) error {
	id := c.Params("id")

	var body suspendBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Invalid request body",
			},
		})
	}

	if body.AdminID == "" || body.Reason == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "adminId and reason are required",
			},
		})
	}

	if len(body.Reason) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "reason must be at most 1000 characters",
			},
		})
	}

	// Verify user exists
	existing, err := h.users.GetUserByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get user for suspend", "id", id, "error", err)
		return internalError(c)
	}
	if existing == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "User not found",
			},
		})
	}

	updated, err := h.users.SuspendUser(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to suspend user", "id", id, "error", err)
		return internalError(c)
	}

	// Audit log
	auditID := uuid.Must(uuid.NewV7()).String()
	details, _ := json.Marshal(map[string]string{"reason": body.Reason, "userEmail": existing.Email})
	_, auditErr := h.users.CreateAuditLog(c.UserContext(), auditID, body.AdminID, "user.suspend", "user", id, details)
	if auditErr != nil {
		slog.Error("failed to create audit log for suspend", "userId", id, "error", auditErr)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    updated,
	})
}

type unsuspendBody struct {
	AdminID string `json:"adminId"`
}

// UnsuspendUser restores a user's verified status.
// PATCH /api/v1/admin/users/:id/unsuspend
func (h *UsersHandler) UnsuspendUser(c *fiber.Ctx) error {
	id := c.Params("id")

	var body unsuspendBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Invalid request body",
			},
		})
	}

	if body.AdminID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "adminId is required",
			},
		})
	}

	// Verify user exists
	existing, err := h.users.GetUserByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get user for unsuspend", "id", id, "error", err)
		return internalError(c)
	}
	if existing == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "User not found",
			},
		})
	}

	updated, err := h.users.UnsuspendUser(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to unsuspend user", "id", id, "error", err)
		return internalError(c)
	}

	// Audit log
	auditID := uuid.Must(uuid.NewV7()).String()
	details, _ := json.Marshal(map[string]string{"userEmail": existing.Email})
	_, auditErr := h.users.CreateAuditLog(c.UserContext(), auditID, body.AdminID, "user.unsuspend", "user", id, details)
	if auditErr != nil {
		slog.Error("failed to create audit log for unsuspend", "userId", id, "error", auditErr)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    updated,
	})
}

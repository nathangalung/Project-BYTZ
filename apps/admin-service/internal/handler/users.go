package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/bytz/admin-service/internal/store"
)

// Cross-service audit log gaps (admin-service does not own these endpoints):
//
// TODO(cross-service): User role change (PATCH /users/:id/role) — does not exist
// in admin-service. If added later, emit "user.role_change" audit log with
// before/after role in details. For now, role changes happen via direct DB
// migration or auth-service; both should emit their own audit trail.
//
// TODO(cross-service): Project reassignment lives in project-service
// (PATCH /api/v1/projects/:id/reassign). project-service must publish
// admin.action.performed NATS event with action="project.reassign", and
// admin-service should subscribe and persist to admin_audit_logs. Tracked
// separately in Wave 3.x event consumer work.
//
// TODO(cross-service): Dispute resolution lives in project-service
// (PATCH /api/v1/disputes/:id/resolve). Same NATS-based pattern as above:
// project-service publishes admin.action.performed with action="dispute.resolve"
// and resolution_type in details; admin-service consumer writes audit log.
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

// GetTalentDetail returns talent-specific profile data, skills, penalties, and project history.
// Returns 200 with null profile and empty slices when user is not a talent.
// GET /api/v1/admin/users/:id/talent-detail
func (h *UsersHandler) GetTalentDetail(c *fiber.Ctx) error {
	id := c.Params("id")

	existing, err := h.users.GetUserByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get user for talent detail", "id", id, "error", err)
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

	detail, err := h.users.GetTalentDetail(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get talent detail", "id", id, "error", err)
		return internalError(c)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    detail,
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

	// Audit log (best-effort: do NOT fail the request if write fails)
	auditID := uuid.Must(uuid.NewV7()).String()
	details, _ := json.Marshal(map[string]string{
		"reason":     body.Reason,
		"userEmail":  existing.Email,
		"userRole":   existing.Role,
		"prevStatus": "verified",
	})
	if _, auditErr := h.users.CreateAuditLog(c.UserContext(), auditID, body.AdminID, "user.suspend", "user", id, details); auditErr != nil {
		slog.Warn("failed to write audit log", "action", "user.suspend", "userId", id, "error", auditErr)
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

	// Audit log (best-effort: do NOT fail the request if write fails)
	auditID := uuid.Must(uuid.NewV7()).String()
	details, _ := json.Marshal(map[string]string{
		"userEmail": existing.Email,
		"userRole":  existing.Role,
	})
	if _, auditErr := h.users.CreateAuditLog(c.UserContext(), auditID, body.AdminID, "user.unsuspend", "user", id, details); auditErr != nil {
		slog.Warn("failed to write audit log", "action", "user.unsuspend", "userId", id, "error", auditErr)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    updated,
	})
}

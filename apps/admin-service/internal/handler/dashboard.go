package handler

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/bytz/admin-service/internal/store"
)

type DashboardHandler struct {
	dashboard store.DashboardStoreInterface
	users     store.UserStoreInterface
}

func NewDashboardHandler(d store.DashboardStoreInterface, u store.UserStoreInterface) *DashboardHandler {
	return &DashboardHandler{dashboard: d, users: u}
}

// GetDashboard returns aggregated project, revenue, and talent stats.
// GET /api/v1/admin/dashboard?from=2024-01-01&to=2024-12-31
func (h *DashboardHandler) GetDashboard(c *fiber.Ctx) error {
	ctx := c.UserContext()

	var dr *store.DateRange
	if fromStr := c.Query("from"); fromStr != "" {
		t, err := time.Parse("2006-01-02", fromStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "VALIDATION_ERROR",
					"message": "Invalid 'from' date format, expected YYYY-MM-DD",
				},
			})
		}
		if dr == nil {
			dr = &store.DateRange{}
		}
		dr.From = t
	}
	if toStr := c.Query("to"); toStr != "" {
		t, err := time.Parse("2006-01-02", toStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "VALIDATION_ERROR",
					"message": "Invalid 'to' date format, expected YYYY-MM-DD",
				},
			})
		}
		if dr == nil {
			dr = &store.DateRange{}
		}
		dr.To = t
	}

	// Require both from and to if either is provided
	if dr != nil && (dr.From.IsZero() || dr.To.IsZero()) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Both 'from' and 'to' are required for date range filter",
			},
		})
	}

	projectStats, err := h.dashboard.GetProjectStats(ctx)
	if err != nil {
		slog.Error("failed to get project stats", "error", err)
		return internalError(c)
	}

	revenueStats, err := h.dashboard.GetRevenueStats(ctx, dr)
	if err != nil {
		slog.Error("failed to get revenue stats", "error", err)
		return internalError(c)
	}

	talentStats, err := h.dashboard.GetTalentStats(ctx)
	if err != nil {
		slog.Error("failed to get talent stats", "error", err)
		return internalError(c)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"projects": projectStats,
			"revenue":  revenueStats,
			"talents":  talentStats,
		},
	})
}

// GetAuditLogs returns paginated audit logs.
// GET /api/v1/admin/audit-logs?page=1&pageSize=20
func (h *DashboardHandler) GetAuditLogs(c *fiber.Ctx) error {
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("pageSize", 20)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	result, err := h.users.GetAuditLogs(c.UserContext(), page, pageSize)
	if err != nil {
		slog.Error("failed to get audit logs", "error", err)
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

// GetSettings returns all platform settings.
// GET /api/v1/admin/settings
func (h *DashboardHandler) GetSettings(c *fiber.Ctx) error {
	settings, err := h.users.GetPlatformSettings(c.UserContext())
	if err != nil {
		slog.Error("failed to get settings", "error", err)
		return internalError(c)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    settings,
	})
}

type updateSettingBody struct {
	Value       json.RawMessage `json:"value"`
	Description *string         `json:"description"`
	AdminID     string          `json:"adminId"`
}

// UpdateSetting creates or updates a platform setting by key.
// PATCH /api/v1/admin/settings/:key
func (h *DashboardHandler) UpdateSetting(c *fiber.Ctx) error {
	key := c.Params("key")
	if key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "Setting key is required",
			},
		})
	}

	var body updateSettingBody
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

	if len(body.Value) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "VALIDATION_ERROR",
				"message": "value is required",
			},
		})
	}

	id := uuid.Must(uuid.NewV7()).String()
	setting, err := h.users.UpsertPlatformSetting(c.UserContext(), id, key, body.Value, body.Description, body.AdminID)
	if err != nil {
		slog.Error("failed to update setting", "key", key, "error", err)
		return internalError(c)
	}

	// Audit log the setting change
	auditID := uuid.Must(uuid.NewV7()).String()
	details, _ := json.Marshal(map[string]any{"key": key, "newValue": body.Value})
	_, err = h.users.CreateAuditLog(c.UserContext(), auditID, body.AdminID, "config.update", "platform_setting", key, details)
	if err != nil {
		slog.Error("failed to create audit log for setting update", "key", key, "error", err)
		// Non-fatal: setting was updated, audit log failure is logged but not returned
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    setting,
	})
}

func internalError(c *fiber.Ctx) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
		"success": false,
		"error": fiber.Map{
			"code":    "INTERNAL_ERROR",
			"message": "An unexpected error occurred",
		},
	})
}

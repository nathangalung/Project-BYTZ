package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/bytz/admin-service/internal/publisher"
	"github.com/bytz/admin-service/internal/store"
)

// DLQHandler serves dead-letter event triage endpoints for admins.
type DLQHandler struct {
	dlq   store.DLQStoreInterface
	users store.UserStoreInterface
	pub   publisher.Publisher
}

func NewDLQHandler(d store.DLQStoreInterface, u store.UserStoreInterface, p publisher.Publisher) *DLQHandler {
	return &DLQHandler{dlq: d, users: u, pub: p}
}

// ListDLQ returns paginated dead-letter events with optional filters.
// GET /api/v1/admin/dlq?eventType=...&consumerService=...&reprocessed=true&page=1&pageSize=20
func (h *DLQHandler) ListDLQ(c *fiber.Ctx) error {
	eventType := c.Query("eventType")
	consumerService := c.Query("consumerService")
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("pageSize", 20)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var reprocessed *bool
	if v := c.Query("reprocessed"); v != "" {
		switch v {
		case "true":
			t := true
			reprocessed = &t
		case "false":
			f := false
			reprocessed = &f
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"success": false,
				"error": fiber.Map{
					"code":    "VALIDATION_ERROR",
					"message": "reprocessed must be 'true' or 'false'",
				},
			})
		}
	}

	result, err := h.dlq.GetDLQList(c.UserContext(), store.DLQFilters{
		EventType:       eventType,
		ConsumerService: consumerService,
		Reprocessed:     reprocessed,
		Page:            page,
		PageSize:        pageSize,
	})
	if err != nil {
		slog.Error("failed to list dlq events", "error", err)
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

// GetDLQEvent returns a single DLQ event by ID.
// GET /api/v1/admin/dlq/:id
func (h *DLQHandler) GetDLQEvent(c *fiber.Ctx) error {
	id := c.Params("id")

	event, err := h.dlq.GetDLQByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get dlq event", "id", id, "error", err)
		return internalError(c)
	}
	if event == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "DLQ event not found",
			},
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    event,
	})
}

type reprocessBody struct {
	AdminID string `json:"adminId"`
}

// ReprocessDLQEvent republishes the original event envelope back to JetStream
// and only then marks the DLQ row as reprocessed. If publish fails, the row is
// left untouched so the admin can retry.
// PATCH /api/v1/admin/dlq/:id/reprocess
func (h *DLQHandler) ReprocessDLQEvent(c *fiber.Ctx) error {
	id := c.Params("id")

	var body reprocessBody
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

	existing, err := h.dlq.GetDLQByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get dlq event for reprocess", "id", id, "error", err)
		return internalError(c)
	}
	if existing == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "DLQ event not found",
			},
		})
	}
	if existing.Reprocessed {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "ALREADY_REPROCESSED",
				"message": "DLQ event already marked reprocessed",
			},
		})
	}

	if h.pub == nil {
		slog.Error("dlq reprocess attempted without publisher", "id", id)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "PUBLISHER_UNAVAILABLE",
				"message": "NATS publisher not configured",
			},
		})
	}

	if err := h.pub.Republish(c.UserContext(), existing.OriginalEventID, existing.EventType, existing.Payload, existing.TraceContext); err != nil {
		slog.Error("failed to republish dlq event", "id", id, "eventType", existing.EventType, "error", err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "REPUBLISH_FAILED",
				"message": "Failed to republish event to NATS",
			},
		})
	}

	updated, err := h.dlq.MarkReprocessed(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to mark dlq reprocessed", "id", id, "error", err)
		return internalError(c)
	}

	// Audit log (best-effort: do NOT fail the request if write fails)
	auditID := uuid.Must(uuid.NewV7()).String()
	details, _ := json.Marshal(map[string]any{
		"eventType":       existing.EventType,
		"consumerService": existing.ConsumerService,
		"originalEventId": existing.OriginalEventID,
	})
	if _, auditErr := h.users.CreateAuditLog(c.UserContext(), auditID, body.AdminID, "dlq.reprocess", "dlq_event", id, details); auditErr != nil {
		slog.Warn("failed to write audit log", "action", "dlq.reprocess", "dlqId", id, "error", auditErr)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    updated,
	})
}

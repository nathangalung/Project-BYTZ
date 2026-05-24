package handler

import (
	"log/slog"

	"github.com/gofiber/fiber/v2"

	"github.com/bytz/admin-service/internal/store"
)

// DisputesHandler serves admin disputes endpoints.
type DisputesHandler struct {
	disputes store.DisputeStoreInterface
}

func NewDisputesHandler(d store.DisputeStoreInterface) *DisputesHandler {
	return &DisputesHandler{disputes: d}
}

// ListDisputes returns paginated disputes with optional status filter.
// GET /api/v1/admin/disputes?status=open&page=1&pageSize=20
func (h *DisputesHandler) ListDisputes(c *fiber.Ctx) error {
	statusFilter := c.Query("status")
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("pageSize", 20)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	result, err := h.disputes.GetDisputesList(c.UserContext(), store.DisputeFilters{
		Status:   statusFilter,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		slog.Error("failed to list disputes", "error", err)
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

// GetStatusCounts returns dispute counts by status.
// GET /api/v1/admin/disputes/status-counts
func (h *DisputesHandler) GetStatusCounts(c *fiber.Ctx) error {
	counts, err := h.disputes.GetStatusCounts(c.UserContext())
	if err != nil {
		slog.Error("failed to load dispute status counts", "error", err)
		return internalError(c)
	}
	return c.JSON(fiber.Map{
		"success": true,
		"data":    counts,
	})
}

// GetDispute returns one dispute with evidence and status timeline.
// GET /api/v1/admin/disputes/:id
func (h *DisputesHandler) GetDispute(c *fiber.Ctx) error {
	id := c.Params("id")
	dispute, err := h.disputes.GetDisputeByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to load dispute", "id", id, "error", err)
		return internalError(c)
	}
	if dispute == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "Dispute not found",
			},
		})
	}
	return c.JSON(fiber.Map{
		"success": true,
		"data":    dispute,
	})
}

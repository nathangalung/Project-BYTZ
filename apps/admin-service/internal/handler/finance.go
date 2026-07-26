package handler

import (
	"log/slog"

	"github.com/gofiber/fiber/v2"

	"github.com/bytz/admin-service/internal/store"
)

// FinanceHandler serves admin finance endpoints.
type FinanceHandler struct {
	finance store.FinanceStoreInterface
}

func NewFinanceHandler(f store.FinanceStoreInterface) *FinanceHandler {
	return &FinanceHandler{finance: f}
}

// GetSummary returns aggregated revenue and escrow figures.
// GET /api/v1/admin/finance/summary
func (h *FinanceHandler) GetSummary(c *fiber.Ctx) error {
	summary, err := h.finance.GetSummary(c.UserContext())
	if err != nil {
		slog.Error("failed to load finance summary", "error", err)
		return internalError(c)
	}
	return c.JSON(fiber.Map{
		"success": true,
		"data":    summary,
	})
}

// GetEscrow returns escrow position per active project.
// GET /api/v1/admin/finance/escrow?limit=20
func (h *FinanceHandler) GetEscrow(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 20)
	rows, err := h.finance.GetEscrowByProject(c.UserContext(), limit)
	if err != nil {
		slog.Error("failed to load escrow", "error", err)
		return internalError(c)
	}
	return c.JSON(fiber.Map{
		"success": true,
		"data":    rows,
	})
}

// ListTransactions returns paginated transactions across all projects.
// GET /api/v1/admin/finance/transactions?type=escrow_in&search=foo&page=1&pageSize=20
func (h *FinanceHandler) ListTransactions(c *fiber.Ctx) error {
	txType := c.Query("type")
	search := c.Query("search")
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("pageSize", 20)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	result, err := h.finance.GetTransactionsList(c.UserContext(), store.TransactionFilters{
		Type:     txType,
		Search:   search,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		slog.Error("failed to list transactions", "error", err)
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

/*
GetLedgerReconciliation reports accounts whose stored balance disagrees with
their ledger entries.

GET /api/v1/admin/finance/reconciliation

A non-empty rows array means money has moved without a matching ledger leg, or
a ledger leg was written without updating the balance. Either way the escrow
gate is now operating on a number the audit record does not support, so this
is an alert, not a report to skim.
*/
func (h *FinanceHandler) GetLedgerReconciliation(c *fiber.Ctx) error {
	result, err := h.finance.ReconcileLedger(c.UserContext())
	if err != nil {
		slog.Error("failed to reconcile ledger", "error", err)
		return internalError(c)
	}
	if result.DriftedAccounts > 0 {
		slog.Error("ledger drift detected",
			"driftedAccounts", result.DriftedAccounts,
			"totalDrift", result.TotalDrift)
	}
	return c.JSON(fiber.Map{
		"success": true,
		"data":    result,
	})
}

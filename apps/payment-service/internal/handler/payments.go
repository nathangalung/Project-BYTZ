package handler

import (
	"errors"
	"log/slog"

	"github.com/bytz/payment-service/internal/service"
	"github.com/gofiber/fiber/v2"
)

type createEscrowRequest struct {
	ProjectID      string  `json:"projectId"`
	Amount         int64   `json:"amount"`
	WorkPackageID  *string `json:"workPackageId,omitempty"`
	TalentID       *string `json:"talentId,omitempty"`
	OwnerID        string  `json:"ownerId"`
	IdempotencyKey string  `json:"idempotencyKey"`
}

type releaseEscrowRequest struct {
	MilestoneID    string `json:"milestoneId"`
	ProjectID      string `json:"projectId"`
	TalentID       string `json:"talentId"`
	Amount         int64  `json:"amount"`
	PerformedBy    string `json:"performedBy"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type refundRequest struct {
	OriginalTransactionID string `json:"originalTransactionId"`
	Amount                int64  `json:"amount"`
	Reason                string `json:"reason"`
	OwnerID               string `json:"ownerId"`
	PerformedBy           string `json:"performedBy"`
	IdempotencyKey        string `json:"idempotencyKey"`
}

type createSnapTokenRequest struct {
	ProjectID     string `json:"projectId"`
	OrderID       string `json:"orderId"`
	Amount        int64  `json:"amount"`
	ItemName      string `json:"itemName"`
	CustomerName  string `json:"customerName"`
	CustomerEmail string `json:"customerEmail"`
}

type PaymentHandler struct {
	svc *service.PaymentService
}

func NewPaymentHandler(svc *service.PaymentService) *PaymentHandler {
	return &PaymentHandler{svc: svc}
}

// RegisterWithAuth registers user-facing routes with session auth middleware.
func (h *PaymentHandler) RegisterWithAuth(app fiber.Router, authMiddleware fiber.Handler) {
	g := app.Group("/api/v1/payments", authMiddleware)

	// User-facing endpoints — require valid session
	g.Post("/escrow", h.CreateEscrow)
	g.Post("/release", h.ReleaseEscrow)
	g.Post("/create-snap-token", h.CreateSnapToken)
	g.Get("/project/:projectId", h.GetProjectTransactions)
	g.Get("/:id", h.GetTransactionByID)

	// Internal endpoints — no session required (service-to-service)
	internal := app.Group("/api/v1/payments")
	internal.Post("/refund", h.ProcessRefund)
}

// POST /api/v1/payments/escrow
func (h *PaymentHandler) CreateEscrow(c *fiber.Ctx) error {
	var req createEscrowRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}

	if req.ProjectID == "" || req.IdempotencyKey == "" || req.Amount <= 0 {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "projectId, idempotencyKey are required and amount must be positive")
	}

	// Use authenticated user ID from session middleware if available
	if userID, ok := c.Locals("userID").(string); ok && userID != "" {
		req.OwnerID = userID
	}
	if req.OwnerID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}

	txn, err := h.svc.CreateEscrow(c.UserContext(), service.CreateEscrowInput{
		ProjectID:      req.ProjectID,
		Amount:         req.Amount,
		WorkPackageID:  req.WorkPackageID,
		TalentID:       req.TalentID,
		OwnerID:        req.OwnerID,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": txn})
}

// POST /api/v1/payments/create-snap-token
func (h *PaymentHandler) CreateSnapToken(c *fiber.Ctx) error {
	var req createSnapTokenRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}

	if req.ProjectID == "" || req.OrderID == "" || req.Amount <= 0 || req.CustomerEmail == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "projectId, orderId, customerEmail are required and amount must be positive")
	}

	result, err := h.svc.CreateSnapToken(c.UserContext(), service.CreateSnapTokenInput{
		ProjectID:     req.ProjectID,
		OrderID:       req.OrderID,
		Amount:        req.Amount,
		ItemName:      req.ItemName,
		CustomerName:  req.CustomerName,
		CustomerEmail: req.CustomerEmail,
	})
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": result})
}

// POST /api/v1/payments/release
func (h *PaymentHandler) ReleaseEscrow(c *fiber.Ctx) error {
	var req releaseEscrowRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}

	if req.MilestoneID == "" || req.ProjectID == "" || req.TalentID == "" || req.PerformedBy == "" || req.IdempotencyKey == "" || req.Amount <= 0 {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "milestoneId, projectId, talentId, performedBy, idempotencyKey are required and amount must be positive")
	}

	// Use authenticated user ID from session middleware if available
	userID := ""
	if id, ok := c.Locals("userID").(string); ok && id != "" {
		userID = id
	} else {
		userID = c.Get("X-User-ID", req.PerformedBy)
	}
	if userID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}

	// Verify the requester is the project owner
	if err := h.svc.VerifyProjectOwner(c.UserContext(), req.ProjectID, userID); err != nil {
		return handleServiceError(c, err)
	}

	txn, err := h.svc.ReleaseEscrow(c.UserContext(), service.ReleaseEscrowInput{
		MilestoneID:    req.MilestoneID,
		ProjectID:      req.ProjectID,
		TalentID:       req.TalentID,
		Amount:         req.Amount,
		PerformedBy:    req.PerformedBy,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.JSON(fiber.Map{"success": true, "data": txn})
}

// POST /api/v1/payments/refund
func (h *PaymentHandler) ProcessRefund(c *fiber.Ctx) error {
	var req refundRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}

	if req.OriginalTransactionID == "" || req.Reason == "" || req.OwnerID == "" || req.PerformedBy == "" || req.IdempotencyKey == "" || req.Amount <= 0 {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "originalTransactionId, reason, ownerId, performedBy, idempotencyKey are required and amount must be positive")
	}

	txn, err := h.svc.ProcessRefund(c.UserContext(), service.ProcessRefundInput{
		OriginalTransactionID: req.OriginalTransactionID,
		Amount:                req.Amount,
		Reason:                req.Reason,
		OwnerID:               req.OwnerID,
		PerformedBy:           req.PerformedBy,
		IdempotencyKey:        req.IdempotencyKey,
	})
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.JSON(fiber.Map{"success": true, "data": txn})
}

// GET /api/v1/payments/project/:projectId
func (h *PaymentHandler) GetProjectTransactions(c *fiber.Ctx) error {
	projectID := c.Params("projectId")
	if projectID == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "projectId is required")
	}

	txns, err := h.svc.GetProjectTransactions(c.UserContext(), projectID)
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.JSON(fiber.Map{"success": true, "data": txns})
}

// GET /api/v1/payments/:id
func (h *PaymentHandler) GetTransactionByID(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "id is required")
	}

	detail, err := h.svc.GetTransactionByID(c.UserContext(), id)
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.JSON(fiber.Map{"success": true, "data": detail})
}

// --- helpers ---

func jsonError(c *fiber.Ctx, status int, code, message string) error {
	return c.Status(status).JSON(fiber.Map{
		"success": false,
		"error": fiber.Map{
			"code":    code,
			"message": message,
		},
	})
}

func handleServiceError(c *fiber.Ctx, err error) error {
	var appErr *service.AppError
	if errors.As(err, &appErr) {
		return c.Status(appErr.StatusCode).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    appErr.Code,
				"message": appErr.Message,
			},
		})
	}

	slog.Error("unhandled error", "error", err)
	return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "an unexpected error occurred")
}

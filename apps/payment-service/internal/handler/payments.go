package handler

import (
	"errors"
	"log/slog"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/service"
)

type releaseEscrowRequest struct {
	MilestoneID    string `json:"milestoneId"`
	ProjectID      string `json:"projectId"`
	TalentID       string `json:"talentId"`
	Amount         int64  `json:"amount"`
	FeeAmount      int64  `json:"feeAmount"`
	PerformedBy    string `json:"performedBy"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type refundRequest struct {
	OriginalTransactionID string  `json:"originalTransactionId"`
	Amount                int64   `json:"amount"`
	Reason                string  `json:"reason"`
	OwnerID               string  `json:"ownerId"`
	PerformedBy           string  `json:"performedBy"`
	IdempotencyKey        string  `json:"idempotencyKey"`
	ScopeWorkPackageID    *string `json:"scopeWorkPackageId"`
}

type createSnapTokenRequest struct {
	ProjectID string `json:"projectId"`
	OrderID   string `json:"orderId"`
	// No amount field, server prices the checkout.
	CheckoutType  string `json:"checkoutType"`
	MilestoneID   string `json:"milestoneId"`
	ItemName      string `json:"itemName"`
	CustomerName  string `json:"customerName"`
	CustomerEmail string `json:"customerEmail"`
}

type validateAccountRequest struct {
	// Provider is the Iris bank code (or e-wallet name), Account the number or
	// registered phone. HolderName is what the talent claimed; the destination
	// counts as verified only when Iris returns the same registered name.
	Provider   string `json:"provider"`
	Account    string `json:"account"`
	HolderName string `json:"holderName"`
}

type executeDisbursementRequest struct {
	// The admin who approved the payout, recorded as the actor on the row.
	ApprovedBy string `json:"approvedBy"`
}

type PaymentHandler struct {
	svc  *service.PaymentService
	iris *iris.Client
	disb *service.DisbursementService
}

func NewPaymentHandler(svc *service.PaymentService) *PaymentHandler {
	return &PaymentHandler{svc: svc}
}

// SetIris attaches a Payouts client. Left unset (the default in tests and any
// deployment without IRIS_API_KEY), account validation answers "unverified"
// rather than failing, so a talent's payout_verified_at simply stays null.
func (h *PaymentHandler) SetIris(client *iris.Client) { h.iris = client }

// SetDisbursements attaches the disbursement service. Left unset (disbursement
// off), the execute and list endpoints answer 503 rather than moving money.
func (h *PaymentHandler) SetDisbursements(d *service.DisbursementService) { h.disb = d }

// RegisterWithAuth wires user and service-to-service payment routes.
//
// Middleware is attached PER ROUTE, never to the group. fiber's
// Group(prefix, handlers...) mounts the handlers on the PREFIX, so two groups
// sharing "/api/v1/payments" stack both middlewares onto every path under it.
// That is what made release, refund and escrow-balance answer 401: session auth
// ran first and demanded a cookie no background job carries, so owner milestone
// approval, the Temporal auto-release and the hourly sweep could never pay a
// talent. It also made the webhook's survival depend on registering before this
// function rather than on anything it declares.
//
// Service-to-service paths sit under /internal/, which the API gateway refuses
// to proxy. They move money on the strength of a shared secret alone, so a
// public route was one leaked secret away from being a payout endpoint.
func (h *PaymentHandler) RegisterWithAuth(app fiber.Router, authMiddleware fiber.Handler, serviceMiddleware fiber.Handler) {
	g := app.Group("/api/v1/payments")

	// user-facing routes
	g.Get("/summary", authMiddleware, h.GetPaymentSummary)
	g.Post("/create-snap-token", authMiddleware, h.CreateSnapToken)
	g.Get("/project/:projectId", authMiddleware, h.GetProjectTransactions)
	g.Get("/list", authMiddleware, h.ListPayments)

	// service-to-service: project-service settles milestones and refunds.
	// The talent is anonymous to the owner, so the browser cannot supply the
	// talent id a release needs; project-service resolves it from the milestone.
	g.Post("/internal/release", serviceMiddleware, h.ReleaseEscrow)
	g.Post("/internal/refund", serviceMiddleware, h.ProcessRefund)
	g.Get("/internal/escrow-balance/:projectId", serviceMiddleware, h.GetEscrowBalance)
	g.Post("/internal/validate-account", serviceMiddleware, h.ValidateAccount)
	g.Get("/internal/disbursements", serviceMiddleware, h.ListDisbursements)
	g.Post("/internal/disbursements/:id/execute", serviceMiddleware, h.ExecuteDisbursement)

	// Last: /:id matches one segment and would otherwise shadow later siblings.
	g.Get("/:id", authMiddleware, h.GetTransactionByID)
}

// GET /api/v1/payments/internal/escrow-balance/:projectId (service-to-service)
// Remaining escrow for a project; refund flows size against this, not the
// original deposit, so partially released projects stay refundable.
func (h *PaymentHandler) GetEscrowBalance(c *fiber.Ctx) error {
	projectID := c.Params("projectId")
	if projectID == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "projectId is required")
	}
	balance, err := h.svc.GetEscrowBalance(c.UserContext(), projectID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "escrow lookup failed")
	}
	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"projectId": projectID, "balance": balance}})
}

// POST /api/v1/payments/internal/validate-account (service-to-service)
//
// Confirms a talent payout destination against Iris and reports whether the
// registered holder matches the claimed name. project-service sets
// payout_verified_at only on a match, so a destination whose name does not line
// up stays unpayable rather than sending money to digits nobody checked.
//
// Every non-match is a 200 with verified:false, never an error: "we could not
// confirm this account" and "the request failed" are different answers, and the
// caller must be able to record the first without retrying the second. A
// transport failure against a configured Iris is the one real error (502).
func (h *PaymentHandler) ValidateAccount(c *fiber.Ctx) error {
	var req validateAccountRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}
	if req.Provider == "" || req.Account == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "provider and account are required")
	}

	if !h.iris.Enabled() {
		return c.JSON(fiber.Map{
			"success": true,
			"data":    fiber.Map{"verified": false, "reason": "validation_unavailable"},
		})
	}

	result, err := h.iris.ValidateAccount(c.UserContext(), req.Provider, req.Account)
	if err != nil {
		var invalid *iris.InvalidAccountError
		if errors.As(err, &invalid) {
			return c.JSON(fiber.Map{
				"success": true,
				"data":    fiber.Map{"verified": false, "reason": "account_not_found"},
			})
		}
		slog.Error("iris account validation failed", "error", err)
		return jsonError(c, fiber.StatusBadGateway, "PAYMENT_GATEWAY_ERROR", "could not reach account validation")
	}

	verified := namesMatch(req.HolderName, result.AccountName)
	reason := ""
	if !verified {
		reason = "name_mismatch"
	}
	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"verified":    verified,
			"accountName": result.AccountName,
			"reason":      reason,
		},
	})
}

// namesMatch compares a claimed holder name to the one on the account, ignoring
// case and internal whitespace. Bank records are upper-cased and spaced
// inconsistently, so an exact-string compare would reject legitimate matches;
// an empty claim never matches, since it would verify every account.
func namesMatch(claimed, registered string) bool {
	c := normalizeName(claimed)
	r := normalizeName(registered)
	return c != "" && c == r
}

func normalizeName(s string) string {
	return strings.ToUpper(strings.Join(strings.Fields(s), " "))
}

// GET /api/v1/payments/internal/disbursements?status=pending (service-to-service)
//
// The operator queue: pending payouts awaiting approval, and the other states
// for monitoring. admin-service reads this to drive the approve action.
func (h *PaymentHandler) ListDisbursements(c *fiber.Ctx) error {
	if h.disb == nil {
		return jsonError(c, fiber.StatusServiceUnavailable, "DISBURSEMENT_DISABLED", "disbursement is not enabled")
	}
	status := c.Query("status", "pending")
	items, err := h.disb.List(c.UserContext(), status, c.QueryInt("limit", 50))
	if err != nil {
		return handleServiceError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": items})
}

// POST /api/v1/payments/internal/disbursements/:id/execute (service-to-service)
//
// Sends a recorded payout to the bank via Iris. Called by admin-service after an
// operator approves it; approvedBy is the audit actor. Money moves here, so it
// is deliberately a distinct action from the release that recorded the payout.
func (h *PaymentHandler) ExecuteDisbursement(c *fiber.Ctx) error {
	if h.disb == nil {
		return jsonError(c, fiber.StatusServiceUnavailable, "DISBURSEMENT_DISABLED", "disbursement is not enabled")
	}
	id := c.Params("id")
	if id == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "id is required")
	}
	var req executeDisbursementRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}
	if req.ApprovedBy == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "approvedBy is required")
	}
	d, err := h.disb.Execute(c.UserContext(), id, req.ApprovedBy)
	if err != nil {
		return handleServiceError(c, err)
	}
	return c.JSON(fiber.Map{"success": true, "data": d})
}

// POST /api/v1/payments/create-snap-token
func (h *PaymentHandler) CreateSnapToken(c *fiber.Ctx) error {
	var req createSnapTokenRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}

	if req.ProjectID == "" || req.OrderID == "" || req.CheckoutType == "" || req.CustomerEmail == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "projectId, orderId, checkoutType and customerEmail are required")
	}

	// Only the project owner may open a checkout: a stranger could otherwise
	// fund escrow for a foreign project and drive its state via the callback.
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}
	if err := h.svc.VerifyProjectOwner(c.UserContext(), req.ProjectID, userID); err != nil {
		return handleServiceError(c, err)
	}

	result, err := h.svc.CreateSnapToken(c.UserContext(), service.CreateSnapTokenInput{
		ProjectID:     req.ProjectID,
		OrderID:       req.OrderID,
		CheckoutType:  req.CheckoutType,
		MilestoneID:   req.MilestoneID,
		ItemName:      req.ItemName,
		CustomerName:  req.CustomerName,
		CustomerEmail: req.CustomerEmail,
	})
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"success": true, "data": result})
}

// POST /api/v1/payments/internal/release
func (h *PaymentHandler) ReleaseEscrow(c *fiber.Ctx) error {
	var req releaseEscrowRequest
	if err := c.BodyParser(&req); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid request body")
	}

	if req.MilestoneID == "" || req.ProjectID == "" || req.TalentID == "" || req.PerformedBy == "" || req.IdempotencyKey == "" || req.Amount <= 0 {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "milestoneId, projectId, talentId, performedBy, idempotencyKey are required and amount must be positive")
	}

	// Authorisation lives in project-service, which owns the milestone and
	// checks the project owner (or runs the platform auto-release) before
	// calling this service-only route. performedBy is the audit actor.
	txn, err := h.svc.ReleaseEscrow(c.UserContext(), service.ReleaseEscrowInput{
		MilestoneID:    req.MilestoneID,
		ProjectID:      req.ProjectID,
		TalentID:       req.TalentID,
		Amount:         req.Amount,
		FeeAmount:      req.FeeAmount,
		PerformedBy:    req.PerformedBy,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		return handleServiceError(c, err)
	}

	return c.JSON(fiber.Map{"success": true, "data": txn})
}

// POST /api/v1/payments/internal/refund
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
		ScopeWorkPackageID:    req.ScopeWorkPackageID,
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

	// Object-level authorization: owner or assigned talent only. Without it any
	// session could list any project's amounts and talent ids.
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}
	allowed, err := h.svc.Store().UserMayViewProjectTransactions(c.UserContext(), projectID, userID)
	if err != nil {
		return handleServiceError(c, err)
	}
	if !allowed {
		return jsonError(c, fiber.StatusForbidden, "AUTH_FORBIDDEN", "not authorized for this project")
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

	// Object-level authorization: the transaction's project owner or the paid
	// talent. The detail carries talentId and the double-entry ledger lines.
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}
	allowed, err := h.svc.Store().UserMayViewTransaction(c.UserContext(), id, userID)
	if err != nil {
		return handleServiceError(c, err)
	}
	if !allowed {
		return jsonError(c, fiber.StatusNotFound, "NOT_FOUND", "transaction not found")
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

// ListPayments returns paginated transactions for the current user.
func (h *PaymentHandler) ListPayments(c *fiber.Ctx) error {
	userID, _ := c.Locals("userID").(string)
	if userID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_REQUIRED", "user ID required")
	}
	txType := c.Query("type", "")
	page, pageSize := clampPagination(c, 50)

	txns, total, err := h.svc.Store().ListByUser(c.UserContext(), userID, txType, page, pageSize)
	if err != nil {
		slog.Error("list payments error", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "failed to list payments")
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"items":    txns,
			"total":    total,
			"page":     page,
			"pageSize": pageSize,
		},
	})
}

// GetPaymentSummary returns spending/earning summary for the current user.
func (h *PaymentHandler) GetPaymentSummary(c *fiber.Ctx) error {
	userID, _ := c.Locals("userID").(string)
	if userID == "" {
		return jsonError(c, fiber.StatusUnauthorized, "AUTH_REQUIRED", "user ID required")
	}

	totalSpent, totalEarned, pending, thisMonth, err := h.svc.Store().GetSummaryByUser(c.UserContext(), userID)
	if err != nil {
		slog.Error("payment summary error", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "failed to get summary")
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"totalSpent":  totalSpent,
			"totalEarned": totalEarned,
			"pending":     pending,
			"thisMonth":   thisMonth,
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

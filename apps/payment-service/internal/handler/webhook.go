package handler

import (
	"bytes"
	"context"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

var callbackClient = &http.Client{
	Timeout:   10 * time.Second,
	Transport: otelhttp.NewTransport(http.DefaultTransport),
}

type midtransWebhookPayload struct {
	OrderID           string `json:"order_id"`
	StatusCode        string `json:"status_code"`
	GrossAmount       string `json:"gross_amount"`
	SignatureKey      string `json:"signature_key"`
	TransactionStatus string `json:"transaction_status"`
	TransactionID     string `json:"transaction_id,omitempty"`
	PaymentType       string `json:"payment_type,omitempty"`
	FraudStatus       string `json:"fraud_status,omitempty"`
}

type WebhookHandler struct {
	txnStore          store.TransactionStoreInterface
	ledgerStore       store.LedgerStoreInterface
	serverKey         string
	projectServiceURL string
	serviceAuthSecret string
}

func NewWebhookHandler(txnStore store.TransactionStoreInterface, ledgerStore store.LedgerStoreInterface, serverKey string, projectServiceURL string, serviceAuthSecret string) *WebhookHandler {
	if projectServiceURL == "" {
		projectServiceURL = "http://localhost:3002"
	}
	return &WebhookHandler{txnStore: txnStore, ledgerStore: ledgerStore, serverKey: serverKey, projectServiceURL: projectServiceURL, serviceAuthSecret: serviceAuthSecret}
}

func (h *WebhookHandler) Register(app fiber.Router) {
	g := app.Group("/api/v1/payments/webhook")
	g.Post("/midtrans", h.MidtransWebhook)
}

// POST /api/v1/payments/webhook/midtrans
func (h *WebhookHandler) MidtransWebhook(c *fiber.Ctx) error {
	var payload midtransWebhookPayload
	if err := c.BodyParser(&payload); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid webhook payload")
	}

	if payload.OrderID == "" || payload.StatusCode == "" || payload.GrossAmount == "" || payload.SignatureKey == "" || payload.TransactionStatus == "" {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "missing required webhook fields")
	}

	// Verify SHA512 signature: sha512(order_id + status_code + gross_amount + server_key)
	hash := sha512.Sum512([]byte(payload.OrderID + payload.StatusCode + payload.GrossAmount + h.serverKey))
	expectedSig := hex.EncodeToString(hash[:])

	// Constant-time, matching middleware/auth.go.
	if subtle.ConstantTimeCompare([]byte(payload.SignatureKey), []byte(expectedSig)) != 1 {
		slog.Error("webhook signature verification failed",
			"orderId", payload.OrderID,
		)
		return jsonError(c, fiber.StatusForbidden, "PAYMENT_GATEWAY_ERROR", "invalid signature")
	}

	ctx := c.UserContext()

	// Find transaction by order_id (mapped to idempotency_key)
	txn, err := h.txnStore.FindByIdempotencyKeyForWebhook(ctx, payload.OrderID)
	if err != nil {
		slog.Error("webhook lookup failed", "error", err, "orderId", payload.OrderID)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "lookup failed")
	}
	if txn == nil {
		slog.Error("webhook for unknown order", "orderId", payload.OrderID)
		return jsonError(c, fiber.StatusNotFound, "NOT_FOUND", "transaction not found")
	}

	// Paid amount must match what was owed.
	paidAmount, err := strconv.ParseInt(strings.SplitN(payload.GrossAmount, ".", 2)[0], 10, 64)
	if err != nil {
		return jsonError(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "invalid gross_amount")
	}
	if paidAmount != txn.Amount {
		slog.Error("webhook amount mismatch",
			"orderId", payload.OrderID, "paid", paidAmount, "owed", txn.Amount,
		)
		return jsonError(c, fiber.StatusBadRequest, "PAYMENT_AMOUNT_MISMATCH", "amount does not match")
	}

	// Map Midtrans transaction_status to internal status
	newStatus := mapMidtransStatus(payload.TransactionStatus, txn.Status)

	// Skip if status unchanged (idempotent)
	if txn.Status == newStatus {
		return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"received": true, "changed": false}})
	}

	previousStatus := txn.Status

	// Update transaction within a database transaction
	dbTx, err := h.txnStore.Pool().BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		slog.Error("begin webhook tx", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "transaction failed")
	}
	defer dbTx.Rollback(ctx) //nolint:errcheck

	// The earlier status read was outside this tx: two concurrent deliveries of
	// the same order could both pass it and double every side effect (ledger
	// funding, the REV- revision credit). Lock the row and re-check so only the
	// first delivery performs the transition.
	lockedStatus, err := h.txnStore.LockStatusTx(ctx, dbTx, txn.ID)
	if err != nil {
		slog.Error("lock transaction for webhook", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "lock failed")
	}
	if lockedStatus == newStatus {
		return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"received": true, "changed": false}})
	}

	var paymentMethod *string
	if payload.PaymentType != "" {
		paymentMethod = &payload.PaymentType
	}
	var gatewayRef *string
	if payload.TransactionID != "" {
		gatewayRef = &payload.TransactionID
	}

	_, err = h.txnStore.UpdateWebhookTx(ctx, dbTx, txn.ID, newStatus, paymentMethod, gatewayRef)
	if err != nil {
		slog.Error("update transaction from webhook", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "update failed")
	}

	// A settled escrow_in must fund the double-entry escrow account in the same
	// transaction: the Snap checkout only created the bare row, and without the
	// ledger credit every later milestone release fails with "escrow account not
	// found" and the talent is never paid.
	if txn.Type == store.TxTypeEscrowIn && newStatus == store.TxStatusCompleted {
		if err := h.fundEscrowLedgerTx(ctx, dbTx, txn); err != nil {
			slog.Error("fund escrow ledger from webhook", "error", err, "orderId", payload.OrderID)
			return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "escrow funding failed")
		}
	}

	// Determine event type based on new status
	eventType := store.EventEscrowCreated
	if newStatus == store.TxStatusCompleted {
		if txn.Type == store.TxTypeEscrowRelease {
			eventType = store.EventFundsReleased
		}
	} else if newStatus == store.TxStatusRefunded {
		eventType = store.EventRefundInitiated
	}

	grossAmountInt, _ := strconv.ParseInt(payload.GrossAmount, 10, 64)
	if grossAmountInt == 0 {
		grossAmountInt = txn.Amount
	}

	metadata, _ := json.Marshal(map[string]any{
		"source":               "midtrans_webhook",
		"midtrans_status":      payload.TransactionStatus,
		"midtrans_status_code": payload.StatusCode,
		"payment_type":         payload.PaymentType,
	})

	performedBy := "system-webhook"
	if txn.TalentID != nil {
		performedBy = *txn.TalentID
	}

	_, err = h.txnStore.CreateEventTx(ctx, dbTx, store.CreateTransactionEventInput{
		TransactionID:  txn.ID,
		EventType:      eventType,
		PreviousStatus: &previousStatus,
		NewStatus:      newStatus,
		Amount:         &grossAmountInt,
		Metadata:       unmarshalMetadata(metadata),
		PerformedBy:    performedBy,
	})
	if err != nil {
		slog.Error("create webhook event", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "event creation failed")
	}

	if err = dbTx.Commit(ctx); err != nil {
		slog.Error("commit webhook tx", "error", err)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "commit failed")
	}

	slog.Info("webhook processed",
		"orderId", payload.OrderID,
		"previousStatus", previousStatus,
		"newStatus", newStatus,
		"transactionId", txn.ID,
	)

	// Notify project-service on successful payment (settlement/capture)
	if newStatus == store.TxStatusCompleted {
		go h.notifyProjectService(txn.ProjectID, payload.OrderID, newStatus, txn.Amount)
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"received": true, "changed": true}})
}

// fundEscrowLedgerTx credits the project's escrow account for a settled
// escrow_in, mirroring PaymentService.CreateEscrow: debit escrow (liability),
// credit owner. Runs inside the webhook's transaction so the status flip and
// the funding commit together.
func (h *WebhookHandler) fundEscrowLedgerTx(ctx context.Context, dbTx pgx.Tx, txn *store.Transaction) error {
	ownerID, err := h.txnStore.GetProjectOwnerID(ctx, txn.ProjectID)
	if err != nil {
		return fmt.Errorf("resolve project owner: %w", err)
	}
	if ownerID == "" {
		return fmt.Errorf("project %s has no owner", txn.ProjectID)
	}

	ownerAccount, err := h.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
		OwnerType:   store.OwnerOwner,
		OwnerID:     &ownerID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Owner Account - %s", ownerID),
	})
	if err != nil {
		return fmt.Errorf("get owner account: %w", err)
	}
	if ownerAccount == nil {
		return fmt.Errorf("owner account unavailable for %s", ownerID)
	}

	escrowAccount, err := h.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
		OwnerType:   store.OwnerEscrow,
		OwnerID:     &txn.ProjectID,
		AccountType: store.AcctLiability,
		Name:        fmt.Sprintf("Escrow - Project %s", txn.ProjectID),
	})
	if err != nil {
		return fmt.Errorf("get escrow account: %w", err)
	}
	if escrowAccount == nil {
		return fmt.Errorf("escrow account unavailable for project %s", txn.ProjectID)
	}

	_, err = h.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, []store.LedgerEntryInput{
		{
			TransactionID: txn.ID,
			AccountID:     escrowAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        txn.Amount,
			Description:   fmt.Sprintf("Escrow deposit for project %s", txn.ProjectID),
			Metadata:      map[string]any{"projectId": txn.ProjectID, "source": "midtrans_webhook"},
		},
		{
			TransactionID: txn.ID,
			AccountID:     ownerAccount.ID,
			EntryType:     store.EntryCredit,
			Amount:        txn.Amount,
			Description:   fmt.Sprintf("Escrow deposit for project %s", txn.ProjectID),
			Metadata:      map[string]any{"projectId": txn.ProjectID, "source": "midtrans_webhook"},
		},
	})
	if err != nil {
		return fmt.Errorf("create escrow ledger entries: %w", err)
	}
	return nil
}

// notifyProjectService calls project-service internal API to update BRD/PRD/escrow status.
func (h *WebhookHandler) notifyProjectService(projectID, orderID, status string, amount int64) {
	// Extract project ID from order ID (format: BRD-{projectId}-{ts} or PRD-... or ESC-...)
	// The projectID from the transaction record is canonical, but we also pass orderId for type detection
	callbackURL := fmt.Sprintf("%s/api/v1/projects/%s/payment-callback", h.projectServiceURL, projectID)

	body, _ := json.Marshal(map[string]any{
		"orderId": orderID,
		"status":  status,
		"amount":  amount,
	})

	req, err := http.NewRequest(http.MethodPost, callbackURL, bytes.NewReader(body))
	if err != nil {
		slog.Error("failed to create payment callback request", "error", err, "projectId", projectID)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Auth", h.serviceAuthSecret)

	resp, err := callbackClient.Do(req)
	if err != nil {
		slog.Error("failed to notify project-service", "error", err, "projectId", projectID, "orderId", orderID)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		slog.Error("project-service payment callback returned error",
			"status", resp.StatusCode,
			"projectId", projectID,
			"orderId", orderID,
		)
		return
	}

	// Determine what was paid for logging
	paymentKind := "escrow"
	if strings.HasPrefix(orderID, "BRD-") {
		paymentKind = "brd"
	} else if strings.HasPrefix(orderID, "PRD-") {
		paymentKind = "prd"
	}

	slog.Info("project-service notified of payment",
		"projectId", projectID,
		"orderId", orderID,
		"paymentKind", paymentKind,
	)
}

func mapMidtransStatus(midtransStatus, currentStatus string) string {
	switch midtransStatus {
	case "capture", "settlement":
		return store.TxStatusCompleted
	case "pending":
		return store.TxStatusProcessing
	case "deny", "cancel", "expire":
		return store.TxStatusFailed
	case "refund", "partial_refund":
		return store.TxStatusRefunded
	default:
		return currentStatus
	}
}

func unmarshalMetadata(data []byte) map[string]any {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	return m
}

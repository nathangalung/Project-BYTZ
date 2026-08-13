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
	"sync"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Bounds on a single settlement callback, so a stuck one cannot pile up.
// The context gets a margin over the client deadline so the client's own
// timeout is what surfaces, rather than a context cancellation hiding it.
const (
	callbackTimeout    = 10 * time.Second
	callbackCtxTimeout = callbackTimeout + 5*time.Second
)

var callbackClient = &http.Client{
	Timeout:   callbackTimeout,
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
	// In-flight settlement callbacks, so shutdown can wait for them.
	callbacks sync.WaitGroup
}

// WaitForCallbacks blocks until in-flight settlement callbacks finish.
//
// The callback is a latency optimisation over payment.settled, which is the
// durable path, so losing one costs nothing but a slower unlock. Waiting is
// still worth it: an unwaited goroutine per settled webhook is a leak, and on
// shutdown it dies mid-request with its span never closed.
func (h *WebhookHandler) WaitForCallbacks() {
	h.callbacks.Wait()
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

	// Idempotent, and monotonic: a stale notification never undoes a
	// settlement. See supersedes.
	if !supersedes(txn.Status, newStatus) {
		slog.Info("webhook ignored, does not supersede current status",
			"orderId", payload.OrderID, "current", txn.Status, "incoming", newStatus)
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
	if !supersedes(lockedStatus, newStatus) {
		return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"received": true, "changed": false}})
	}

	// A partial refund carries the same field set as a full one, and what
	// Midtrans puts in gross_amount for it cannot be established from here.
	// Booking it as a full reversal would give back escrow the gateway never
	// returned, so refuse: the books stay untouched and the retrying
	// notification keeps the case visible until it is settled by hand.
	if payload.TransactionStatus == "partial_refund" {
		slog.Error("partial refund cannot be booked automatically",
			"orderId", payload.OrderID, "transactionId", txn.ID)
		return jsonError(c, fiber.StatusNotImplemented, "PAYMENT_PARTIAL_REFUND_UNSUPPORTED",
			"partial refunds are reconciled manually")
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

	// A gateway-initiated refund moves the deposit back out of the platform.
	// Without the matching ledger legs escrow keeps showing money that is gone,
	// and the next milestone release pays a talent out of it.
	if txn.Type == store.TxTypeEscrowIn && newStatus == store.TxStatusRefunded {
		if err := h.reverseEscrowLedgerTx(ctx, dbTx, txn); err != nil {
			slog.Error("reverse escrow ledger from webhook", "error", err, "orderId", payload.OrderID)
			return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "escrow reversal failed")
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

	// performed_by is FK-constrained to user.id. A literal like
	// "system-webhook" or a talent_profiles.id violates the FK and rolls the
	// whole settlement back, so the audit actor is the project owner - the
	// user whose payment the gateway is confirming.
	performedBy, err := h.txnStore.GetProjectOwnerID(ctx, txn.ProjectID)
	if err != nil || performedBy == "" {
		slog.Error("resolve webhook audit actor", "error", err, "projectId", txn.ProjectID)
		return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "audit actor resolution failed")
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

	// The internal refund path publishes this; a refund issued from the
	// Midtrans dashboard published nothing at all, so project-service never
	// learned the money went back. Same payload shape as ProcessRefund.
	if newStatus == store.TxStatusRefunded {
		if err = store.InsertOutboxEventTx(ctx, dbTx, store.OutboxEvent{
			AggregateType: "payment",
			AggregateID:   txn.ID,
			EventType:     "payment.refunded",
			Payload: map[string]any{
				"projectId":             txn.ProjectID,
				"originalTransactionId": txn.ID,
				"amount":                txn.Amount,
				"transactionId":         txn.ID,
				"reason":                "gateway_refund",
				"isPartial":             false,
			},
		}); err != nil {
			slog.Error("insert refund outbox event", "error", err, "orderId", payload.OrderID)
			return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "event publish failed")
		}
	}

	// A settled payment has to reach project-service, and the HTTP callback
	// below is attempted exactly once. If it fails, Midtrans redelivery cannot
	// rescue it either: supersedes(completed, completed) is false, so every
	// retry short-circuits before the notify. The result is an owner who paid
	// for a BRD that stays locked, or an escrow that is funded while the project
	// never leaves prd_approved. Publishing here, inside the same transaction
	// as the status change, is what makes the delivery survivable.
	if newStatus == store.TxStatusCompleted {
		if err = store.InsertOutboxEventTx(ctx, dbTx, store.OutboxEvent{
			AggregateType: "payment",
			AggregateID:   txn.ID,
			EventType:     "payment.settled",
			Payload: map[string]any{
				"projectId":     txn.ProjectID,
				"orderId":       payload.OrderID,
				"transactionId": txn.ID,
				"amount":        txn.Amount,
				"type":          txn.Type,
			},
		}); err != nil {
			slog.Error("insert settlement outbox event", "error", err, "orderId", payload.OrderID)
			return jsonError(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "event publish failed")
		}
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

	// Latency optimisation only. payment.settled above is the delivery that has
	// to arrive; this just gets there sooner on the happy path. Settling is
	// idempotent on both sides, so both running is a no-op.
	if newStatus == store.TxStatusCompleted {
		// Detached from the request context on purpose: the fiber ctx is
		// cancelled the moment this handler returns, and the callback outlives
		// it. Bounded by the client timeout, tracked so shutdown can drain it.
		callbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), callbackCtxTimeout)
		h.callbacks.Add(1)
		go func() {
			defer h.callbacks.Done()
			defer cancel()
			h.notifyProjectService(callbackCtx, txn.ProjectID, payload.OrderID, newStatus, txn.Amount)
		}()
	}

	return c.JSON(fiber.Map{"success": true, "data": fiber.Map{"received": true, "changed": true}})
}

// allocateEscrowShares splits a settled deposit across work packages in
// proportion to their amounts, the rounding remainder landing on the largest
// package - the convention packages/shared/src/pricing.ts already uses to
// share a project payout out per package. Returns nil when there is nothing to
// split against, which is the signal to fund one project level pool instead.
func allocateEscrowShares(deposit int64, packages []store.WorkPackage) []int64 {
	var total int64
	largest := 0
	for i, wp := range packages {
		if wp.Amount > 0 {
			total += wp.Amount
		}
		if wp.Amount > packages[largest].Amount {
			largest = i
		}
	}
	if deposit <= 0 || total <= 0 {
		return nil
	}

	shares := make([]int64, len(packages))
	var allocated int64
	for i, wp := range packages {
		if wp.Amount <= 0 {
			continue
		}
		shares[i] = deposit * wp.Amount / total
		allocated += shares[i]
	}
	shares[largest] += deposit - allocated
	return shares
}

// fundEscrowLedgerTx credits the project's escrow for a settled escrow_in:
// debit escrow (liability), credit owner. Runs inside the webhook's
// transaction so the status flip and the funding commit together.
//
// The deposit is split into one pool per work package. A single project pool
// let the first talent's approvals drain the money quoted to the second, who
// then could not be paid at all; per package pools make each talent's escrow
// unreachable from the others. Projects with no work packages keep one project
// level pool so nothing is stranded.
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

	packages, err := h.txnStore.GetWorkPackageAmounts(ctx, txn.ProjectID)
	if err != nil {
		return fmt.Errorf("list work packages: %w", err)
	}

	entries := []store.LedgerEntryInput{{
		TransactionID: txn.ID,
		AccountID:     ownerAccount.ID,
		EntryType:     store.EntryCredit,
		Amount:        txn.Amount,
		Description:   fmt.Sprintf("Escrow deposit for project %s", txn.ProjectID),
		Metadata:      map[string]any{"projectId": txn.ProjectID, "source": "midtrans_webhook"},
	}}

	for _, pool := range escrowPools(txn, packages) {
		escrowAccount, accErr := h.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
			OwnerType:   store.OwnerEscrow,
			OwnerID:     &pool.ownerID,
			AccountType: store.AcctLiability,
			Name:        pool.name,
		})
		if accErr != nil {
			return fmt.Errorf("get escrow account: %w", accErr)
		}
		if escrowAccount == nil {
			return fmt.Errorf("escrow account unavailable for %s", pool.ownerID)
		}
		entries = append(entries, store.LedgerEntryInput{
			TransactionID: txn.ID,
			AccountID:     escrowAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        pool.amount,
			Description:   fmt.Sprintf("Escrow deposit for project %s", txn.ProjectID),
			Metadata: map[string]any{
				"projectId": txn.ProjectID, "escrowOwnerId": pool.ownerID, "source": "midtrans_webhook",
			},
		})
	}

	_, err = h.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, entries)
	if err != nil {
		return fmt.Errorf("create escrow ledger entries: %w", err)
	}
	return nil
}

// reverseEscrowLedgerTx unwinds a settled deposit the gateway has refunded by
// mirroring every entry the funding wrote: debit owner, credit the escrow
// pools, the same directions ProcessRefund posts for the same money. Mirroring
// what was booked rather than recomputing the split keeps the reversal exact
// even after the work packages have been repriced.
//
// Runs only on completed -> refunded, which supersedes treats as terminal, so
// one deposit is never reversed twice.
//
// A refund arriving after milestones have already drawn on those pools takes
// them negative. That is a real deficit rather than a booking error - the money
// left through the gateway - and it needs an operator, not a guard here.
func (h *WebhookHandler) reverseEscrowLedgerTx(ctx context.Context, dbTx pgx.Tx, txn *store.Transaction) error {
	funding, err := h.ledgerStore.GetEntriesByTransactionTx(ctx, dbTx, txn.ID)
	if err != nil {
		return fmt.Errorf("read funding entries: %w", err)
	}
	// Nothing was ever credited, so there is nothing to give back and the
	// invariant holds trivially. Refusing here would only make the gateway
	// retry a deposit that predates ledger funding forever.
	if len(funding) == 0 {
		slog.Error("refunded deposit has no ledger entries to reverse",
			"transactionId", txn.ID, "projectId", txn.ProjectID)
		return nil
	}

	entries := make([]store.LedgerEntryInput, 0, len(funding))
	for _, e := range funding {
		entryType := store.EntryCredit
		if e.EntryType == store.EntryCredit {
			entryType = store.EntryDebit
		}
		entries = append(entries, store.LedgerEntryInput{
			TransactionID: txn.ID,
			AccountID:     e.AccountID,
			EntryType:     entryType,
			Amount:        e.Amount,
			Description:   fmt.Sprintf("Gateway refund reversal for project %s", txn.ProjectID),
			Metadata: map[string]any{
				"projectId": txn.ProjectID, "reversalOf": e.ID, "source": "midtrans_webhook",
			},
		})
	}

	if _, err := h.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, entries); err != nil {
		return fmt.Errorf("create refund reversal entries: %w", err)
	}
	return nil
}

// One escrow account to credit and how much of the deposit lands in it.
type escrowPool struct {
	ownerID string
	name    string
	amount  int64
}

func escrowPools(txn *store.Transaction, packages []store.WorkPackage) []escrowPool {
	shares := allocateEscrowShares(txn.Amount, packages)
	if shares == nil {
		return []escrowPool{{
			ownerID: txn.ProjectID,
			name:    fmt.Sprintf("Escrow - Project %s", txn.ProjectID),
			amount:  txn.Amount,
		}}
	}

	pools := make([]escrowPool, 0, len(packages))
	for i, wp := range packages {
		// A zero share would be a zero-amount ledger entry, which the
		// double-entry writer rejects.
		if shares[i] <= 0 {
			continue
		}
		pools = append(pools, escrowPool{
			ownerID: wp.ID,
			name:    fmt.Sprintf("Escrow - Work Package %s", wp.ID),
			amount:  shares[i],
		})
	}
	return pools
}

// notifyProjectService calls project-service internal API to update BRD/PRD/escrow status.
func (h *WebhookHandler) notifyProjectService(ctx context.Context, projectID, orderID, status string, amount int64) {
	// Extract project ID from order ID (format: BRD-{projectId}-{ts} or PRD-... or ESC-...)
	// The projectID from the transaction record is canonical, but we also pass orderId for type detection
	callbackURL := fmt.Sprintf("%s/api/v1/projects/%s/payment-callback", h.projectServiceURL, projectID)

	body, _ := json.Marshal(map[string]any{
		"orderId": orderID,
		"status":  status,
		"amount":  amount,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, callbackURL, bytes.NewReader(body))
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

// supersedes reports whether next may replace current.
//
// Midtrans documents that notifications can arrive out of order - settlement
// ahead of pending - and tells integrators to trust the Get Status API or
// ignore the stale pending. Comparing the two statuses for equality is not
// enough: completed -> processing -> completed passes that check and funds
// escrow a second time for one payment.
//
// Settlement and refund are terminal. A settled payment may still be
// refunded; nothing else moves it. A failed one may still settle, since an
// expiry can be followed by a late capture.
func supersedes(current, next string) bool {
	switch current {
	case store.TxStatusRefunded:
		return false
	case store.TxStatusCompleted:
		return next == store.TxStatusRefunded
	default:
		return current != next
	}
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

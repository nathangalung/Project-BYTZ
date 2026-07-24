package handler

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

// Shares RegisterAll with main, prevents drift.
func registerLikeProduction(app *fiber.App) {
	rejectAll := func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusUnauthorized).
			JSON(fiber.Map{"success": false, "error": fiber.Map{"code": "AUTH_UNAUTHORIZED"}})
	}

	RegisterAll(
		app,
		&PaymentHandler{},
		NewWebhookHandler(nil, nil, "server-key", "", "auth-secret"),
		rejectAll,
		rejectAll,
	)
}

func TestMidtransWebhook_ReachableWithoutSession(t *testing.T) {
	app := fiber.New()
	registerLikeProduction(app)

	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}

	// 400 handler ran, 401 auth blocked
	if resp.StatusCode == fiber.StatusUnauthorized {
		t.Fatalf("webhook is behind auth: got 401, so Midtrans callbacks never reach the handler")
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

// Fix must not open user routes.
func TestPaymentRoutes_StillRequireAuth(t *testing.T) {
	app := fiber.New()
	registerLikeProduction(app)

	for _, path := range []string{"/api/v1/payments/summary", "/api/v1/payments/list"} {
		resp, err := app.Test(httptest.NewRequest("GET", path, nil))
		if err != nil {
			t.Fatalf("test request failed: %v", err)
		}
		if resp.StatusCode != fiber.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", path, resp.StatusCode)
		}
	}
}

// Underpayment must not settle the transaction.
func TestMidtransWebhook_RejectsUnderpayment(t *testing.T) {
	const serverKey = "test-server-key"
	const orderID = "ORDER-UNDERPAY"
	const statusCode = "200"
	const paid = "1"

	hash := sha512.Sum512([]byte(orderID + statusCode + paid + serverKey))
	sig := hex.EncodeToString(hash[:])

	now := time.Now().UTC()
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 99000,
				Status: "pending", Type: store.TxTypeBRDPayment,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
	}

	app := fiber.New()
	NewWebhookHandler(txnStore, &store.MockLedgerStore{}, serverKey, "", "secret").Register(app)

	body := fmt.Sprintf(
		`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, paid, sig,
	)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("paying 1 against 99000 returned %d, want 400", resp.StatusCode)
	}
}

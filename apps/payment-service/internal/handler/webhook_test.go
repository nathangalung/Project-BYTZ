package handler

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/service"
	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5"
)

func TestMapMidtransStatus(t *testing.T) {
	tests := []struct {
		name          string
		midtransStatus string
		currentStatus string
		want          string
	}{
		{
			name:          "capture maps to completed",
			midtransStatus: "capture",
			currentStatus: "pending",
			want:          "completed",
		},
		{
			name:          "settlement maps to completed",
			midtransStatus: "settlement",
			currentStatus: "processing",
			want:          "completed",
		},
		{
			name:          "pending maps to processing",
			midtransStatus: "pending",
			currentStatus: "pending",
			want:          "processing",
		},
		{
			name:          "deny maps to failed",
			midtransStatus: "deny",
			currentStatus: "processing",
			want:          "failed",
		},
		{
			name:          "cancel maps to failed",
			midtransStatus: "cancel",
			currentStatus: "processing",
			want:          "failed",
		},
		{
			name:          "expire maps to failed",
			midtransStatus: "expire",
			currentStatus: "processing",
			want:          "failed",
		},
		{
			name:          "refund maps to refunded",
			midtransStatus: "refund",
			currentStatus: "completed",
			want:          "refunded",
		},
		{
			name:          "partial_refund maps to refunded",
			midtransStatus: "partial_refund",
			currentStatus: "completed",
			want:          "refunded",
		},
		{
			name:          "unknown status returns current",
			midtransStatus: "unknown_status",
			currentStatus: "processing",
			want:          "processing",
		},
		{
			name:          "empty string returns current",
			midtransStatus: "",
			currentStatus: "pending",
			want:          "pending",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapMidtransStatus(tt.midtransStatus, tt.currentStatus)
			if got != tt.want {
				t.Errorf("mapMidtransStatus(%q, %q) = %q, want %q",
					tt.midtransStatus, tt.currentStatus, got, tt.want)
			}
		})
	}
}

func TestUnmarshalMetadata(t *testing.T) {
	tests := []struct {
		name    string
		input   []byte
		wantNil bool
		wantKey string
		wantVal string
	}{
		{
			name:    "valid JSON object",
			input:   []byte(`{"source":"midtrans_webhook","status":"capture"}`),
			wantNil: false,
			wantKey: "source",
			wantVal: "midtrans_webhook",
		},
		{
			name:    "empty JSON object",
			input:   []byte(`{}`),
			wantNil: false,
		},
		{
			name:    "invalid JSON returns nil",
			input:   []byte(`not json`),
			wantNil: true,
		},
		{
			name:    "empty bytes returns nil",
			input:   []byte{},
			wantNil: true,
		},
		{
			name:    "null JSON",
			input:   []byte(`null`),
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := unmarshalMetadata(tt.input)
			if tt.wantNil {
				if got != nil {
					t.Errorf("expected nil, got %v", got)
				}
				return
			}
			if got == nil {
				t.Fatal("expected non-nil map")
			}
			if tt.wantKey != "" {
				val, ok := got[tt.wantKey]
				if !ok {
					t.Errorf("key %q not found in result", tt.wantKey)
				} else if val != tt.wantVal {
					t.Errorf("got[%q] = %v, want %q", tt.wantKey, val, tt.wantVal)
				}
			}
		})
	}
}

func TestNewWebhookHandler(t *testing.T) {
	tests := []struct {
		name              string
		projectServiceURL string
		wantURL           string
	}{
		{
			name:              "empty URL defaults to localhost",
			projectServiceURL: "",
			wantURL:           "http://localhost:3002",
		},
		{
			name:              "custom URL is preserved",
			projectServiceURL: "http://project-svc:3002",
			wantURL:           "http://project-svc:3002",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewWebhookHandler(nil, "server-key", tt.projectServiceURL, "auth-secret")
			if h == nil {
				t.Fatal("expected non-nil handler")
			}
			if h.projectServiceURL != tt.wantURL {
				t.Errorf("projectServiceURL = %q, want %q", h.projectServiceURL, tt.wantURL)
			}
			if h.serverKey != "server-key" {
				t.Errorf("serverKey = %q, want %q", h.serverKey, "server-key")
			}
			if h.serviceAuthSecret != "auth-secret" {
				t.Errorf("serviceAuthSecret = %q, want %q", h.serviceAuthSecret, "auth-secret")
			}
		})
	}
}

// --- Helper types and functions for handler integration tests ---

type paymentTestResponse struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func parsePaymentResponse(t *testing.T, resp *io.ReadCloser) paymentTestResponse {
	t.Helper()
	body, err := io.ReadAll(*resp)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	var result paymentTestResponse
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("unmarshal response: %v (body: %s)", err, string(body))
	}
	return result
}

// --- Webhook handler Fiber integration tests ---

func TestMidtransWebhook_InvalidJSON(t *testing.T) {
	wh := NewWebhookHandler(nil, "server-key", "", "auth-secret")
	app := fiber.New()
	wh.Register(app)

	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Success {
		t.Error("expected success=false")
	}
	if result.Error == nil || result.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected VALIDATION_ERROR, got %+v", result.Error)
	}
}

func TestMidtransWebhook_MissingRequiredFields(t *testing.T) {
	wh := NewWebhookHandler(nil, "server-key", "", "auth-secret")
	app := fiber.New()
	wh.Register(app)

	tests := []struct {
		name string
		body string
	}{
		{"missing order_id", `{"status_code":"200","gross_amount":"100000","signature_key":"abc","transaction_status":"capture"}`},
		{"missing status_code", `{"order_id":"ORD-1","gross_amount":"100000","signature_key":"abc","transaction_status":"capture"}`},
		{"missing gross_amount", `{"order_id":"ORD-1","status_code":"200","signature_key":"abc","transaction_status":"capture"}`},
		{"missing signature_key", `{"order_id":"ORD-1","status_code":"200","gross_amount":"100000","transaction_status":"capture"}`},
		{"missing transaction_status", `{"order_id":"ORD-1","status_code":"200","gross_amount":"100000","signature_key":"abc"}`},
		{"all empty", `{}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestMidtransWebhook_InvalidSignature(t *testing.T) {
	wh := NewWebhookHandler(nil, "server-key", "", "auth-secret")
	app := fiber.New()
	app.Use(recover.New())
	wh.Register(app)

	body := `{"order_id":"ORD-1","status_code":"200","gross_amount":"100000","signature_key":"bad-signature","transaction_status":"capture"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusForbidden {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusForbidden)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Error == nil || result.Error.Code != "PAYMENT_GATEWAY_ERROR" {
		t.Errorf("expected PAYMENT_GATEWAY_ERROR, got %+v", result.Error)
	}
}

func TestMidtransWebhook_ValidSignatureNilStore(t *testing.T) {
	serverKey := "server-key"
	orderID := "ORD-1"
	statusCode := "200"
	grossAmount := "100000"

	// Compute valid signature
	hash := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	validSig := hex.EncodeToString(hash[:])

	wh := NewWebhookHandler(nil, serverKey, "", "auth-secret")
	app := fiber.New()
	app.Use(recover.New())
	wh.Register(app)

	body := `{"order_id":"` + orderID + `","status_code":"` + statusCode + `","gross_amount":"` + grossAmount + `","signature_key":"` + validSig + `","transaction_status":"capture"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	// With nil store, should get 500 (panic recovered), NOT 400 or 403
	if resp.StatusCode == fiber.StatusBadRequest || resp.StatusCode == fiber.StatusForbidden {
		t.Errorf("status = %d, signature should have passed validation", resp.StatusCode)
	}
}

// --- Payment handler (jsonError / handleServiceError) Fiber integration tests ---

func TestJsonError_Format(t *testing.T) {
	app := fiber.New()
	app.Get("/test-err", func(c *fiber.Ctx) error {
		return jsonError(c, fiber.StatusBadRequest, "TEST_CODE", "test message")
	})

	req := httptest.NewRequest("GET", "/test-err", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Success {
		t.Error("expected success=false")
	}
	if result.Error == nil {
		t.Fatal("expected error object")
	}
	if result.Error.Code != "TEST_CODE" {
		t.Errorf("error code = %q, want %q", result.Error.Code, "TEST_CODE")
	}
	if result.Error.Message != "test message" {
		t.Errorf("error message = %q, want %q", result.Error.Message, "test message")
	}
}

func TestHandleServiceError_AppError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "validation error returns 400",
			err:        &service.AppError{Code: "VALIDATION_ERROR", Message: "bad input", StatusCode: 400},
			wantStatus: 400,
			wantCode:   "VALIDATION_ERROR",
		},
		{
			name:       "not found error returns 404",
			err:        &service.AppError{Code: "NOT_FOUND", Message: "missing", StatusCode: 404},
			wantStatus: 404,
			wantCode:   "NOT_FOUND",
		},
		{
			name:       "forbidden error returns 403",
			err:        &service.AppError{Code: "FORBIDDEN", Message: "not allowed", StatusCode: 403},
			wantStatus: 403,
			wantCode:   "FORBIDDEN",
		},
		{
			name:       "insufficient funds returns 400",
			err:        &service.AppError{Code: "PAYMENT_ESCROW_INSUFFICIENT_FUNDS", Message: "low", StatusCode: 400},
			wantStatus: 400,
			wantCode:   "PAYMENT_ESCROW_INSUFFICIENT_FUNDS",
		},
		{
			name:       "already processed returns 409",
			err:        &service.AppError{Code: "PAYMENT_ALREADY_PROCESSED", Message: "done", StatusCode: 409},
			wantStatus: 409,
			wantCode:   "PAYMENT_ALREADY_PROCESSED",
		},
		{
			name:       "external service error returns 502",
			err:        &service.AppError{Code: "EXTERNAL_SERVICE_ERROR", Message: "gateway down", StatusCode: 502},
			wantStatus: 502,
			wantCode:   "EXTERNAL_SERVICE_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := fiber.New()
			app.Get("/test", func(c *fiber.Ctx) error {
				return handleServiceError(c, tt.err)
			})
			req := httptest.NewRequest("GET", "/test", nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
			result := parsePaymentResponse(t, &resp.Body)
			if result.Success {
				t.Error("expected success=false")
			}
			if result.Error == nil || result.Error.Code != tt.wantCode {
				t.Errorf("expected code %q, got %+v", tt.wantCode, result.Error)
			}
		})
	}
}

func TestHandleServiceError_GenericError(t *testing.T) {
	app := fiber.New()
	app.Get("/test", func(c *fiber.Ctx) error {
		return handleServiceError(c, io.ErrUnexpectedEOF)
	})
	req := httptest.NewRequest("GET", "/test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Error == nil || result.Error.Code != "INTERNAL_ERROR" {
		t.Errorf("expected INTERNAL_ERROR, got %+v", result.Error)
	}
}

func TestNewPaymentHandler(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "key", "url")
	h := NewPaymentHandler(svc)
	if h == nil {
		t.Fatal("expected non-nil PaymentHandler")
	}
}

// --- Payment handler route integration tests (validation paths) ---

func newPaymentTestApp(h *PaymentHandler, wh *WebhookHandler) *fiber.App {
	app := fiber.New()
	app.Use(recover.New())

	authMiddleware := func(c *fiber.Ctx) error {
		userID := c.Get("X-User-ID")
		if userID != "" {
			c.Locals("userID", userID)
		}
		return c.Next()
	}

	h.RegisterWithAuth(app, authMiddleware)
	if wh != nil {
		wh.Register(app)
	}
	return app
}

func TestCreateEscrow_InvalidJSON(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Error == nil || result.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected VALIDATION_ERROR, got %+v", result.Error)
	}
}

func TestCreateEscrow_Validation(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	tests := []struct {
		name string
		body string
	}{
		{"missing projectId", `{"projectId":"","amount":10000,"ownerId":"owner-1","idempotencyKey":"key-1"}`},
		{"missing idempotencyKey", `{"projectId":"p-1","amount":10000,"ownerId":"owner-1","idempotencyKey":""}`},
		{"zero amount", `{"projectId":"p-1","amount":0,"ownerId":"owner-1","idempotencyKey":"key-1"}`},
		{"negative amount", `{"projectId":"p-1","amount":-100,"ownerId":"owner-1","idempotencyKey":"key-1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", "user-1")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestCreateEscrow_NoAuth(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	body := `{"projectId":"p-1","amount":10000,"ownerId":"","idempotencyKey":"key-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// No X-User-ID header and empty ownerId
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusUnauthorized)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if result.Error == nil || result.Error.Code != "AUTH_UNAUTHORIZED" {
		t.Errorf("expected AUTH_UNAUTHORIZED, got %+v", result.Error)
	}
}

func TestCreateSnapToken_InvalidJSON(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	req := httptest.NewRequest("POST", "/api/v1/payments/create-snap-token", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestCreateSnapToken_Validation(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	tests := []struct {
		name string
		body string
	}{
		{"missing projectId", `{"projectId":"","orderId":"ORD-1","amount":10000,"customerEmail":"a@b.com"}`},
		{"missing orderId", `{"projectId":"p-1","orderId":"","amount":10000,"customerEmail":"a@b.com"}`},
		{"zero amount", `{"projectId":"p-1","orderId":"ORD-1","amount":0,"customerEmail":"a@b.com"}`},
		{"negative amount", `{"projectId":"p-1","orderId":"ORD-1","amount":-1,"customerEmail":"a@b.com"}`},
		{"missing customerEmail", `{"projectId":"p-1","orderId":"ORD-1","amount":10000,"customerEmail":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/payments/create-snap-token", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", "user-1")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestReleaseEscrow_InvalidJSON(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "user-1")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestReleaseEscrow_Validation(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	tests := []struct {
		name string
		body string
	}{
		{"missing milestoneId", `{"milestoneId":"","projectId":"p-1","talentId":"t-1","amount":10000,"performedBy":"u-1","idempotencyKey":"k-1"}`},
		{"missing projectId", `{"milestoneId":"m-1","projectId":"","talentId":"t-1","amount":10000,"performedBy":"u-1","idempotencyKey":"k-1"}`},
		{"missing talentId", `{"milestoneId":"m-1","projectId":"p-1","talentId":"","amount":10000,"performedBy":"u-1","idempotencyKey":"k-1"}`},
		{"missing performedBy", `{"milestoneId":"m-1","projectId":"p-1","talentId":"t-1","amount":10000,"performedBy":"","idempotencyKey":"k-1"}`},
		{"missing idempotencyKey", `{"milestoneId":"m-1","projectId":"p-1","talentId":"t-1","amount":10000,"performedBy":"u-1","idempotencyKey":""}`},
		{"zero amount", `{"milestoneId":"m-1","projectId":"p-1","talentId":"t-1","amount":0,"performedBy":"u-1","idempotencyKey":"k-1"}`},
		{"negative amount", `{"milestoneId":"m-1","projectId":"p-1","talentId":"t-1","amount":-50,"performedBy":"u-1","idempotencyKey":"k-1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", "user-1")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestReleaseEscrow_NoAuth(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	body := `{"milestoneId":"m-1","projectId":"p-1","talentId":"t-1","amount":10000,"performedBy":"u-1","idempotencyKey":"k-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/release", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// No X-User-ID and no X-User-ID header fallback
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	// With no userID in locals but performedBy set, it falls back to X-User-ID header then performedBy
	// So it won't be unauthorized. It will try to verify project owner which panics with nil store.
	// Recover middleware catches the panic.
	if resp.StatusCode == fiber.StatusBadRequest {
		t.Errorf("status should not be 400, validation already passed")
	}
}

func TestProcessRefund_InvalidJSON(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	req := httptest.NewRequest("POST", "/api/v1/payments/refund", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestProcessRefund_Validation(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	tests := []struct {
		name string
		body string
	}{
		{"missing originalTransactionId", `{"originalTransactionId":"","amount":10000,"reason":"test","ownerId":"o-1","performedBy":"a-1","idempotencyKey":"k-1"}`},
		{"missing reason", `{"originalTransactionId":"txn-1","amount":10000,"reason":"","ownerId":"o-1","performedBy":"a-1","idempotencyKey":"k-1"}`},
		{"missing ownerId", `{"originalTransactionId":"txn-1","amount":10000,"reason":"test","ownerId":"","performedBy":"a-1","idempotencyKey":"k-1"}`},
		{"missing performedBy", `{"originalTransactionId":"txn-1","amount":10000,"reason":"test","ownerId":"o-1","performedBy":"","idempotencyKey":"k-1"}`},
		{"missing idempotencyKey", `{"originalTransactionId":"txn-1","amount":10000,"reason":"test","ownerId":"o-1","performedBy":"a-1","idempotencyKey":""}`},
		{"zero amount", `{"originalTransactionId":"txn-1","amount":0,"reason":"test","ownerId":"o-1","performedBy":"a-1","idempotencyKey":"k-1"}`},
		{"negative amount", `{"originalTransactionId":"txn-1","amount":-1,"reason":"test","ownerId":"o-1","performedBy":"a-1","idempotencyKey":"k-1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/payments/refund", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestGetProjectTransactions_EmptyProjectID(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := fiber.New()
	app.Use(recover.New())

	authMiddleware := func(c *fiber.Ctx) error {
		c.Locals("userID", "user-1")
		return c.Next()
	}
	h.RegisterWithAuth(app, authMiddleware)

	// Test with a valid path param (non-empty projectId) that will panic on nil store
	req := httptest.NewRequest("GET", "/api/v1/payments/project/proj-123", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	// Should not be 400 — projectId is present. Should be 500 from nil store panic.
	if resp.StatusCode == fiber.StatusBadRequest {
		t.Errorf("status = 400, projectId was provided so should not fail validation")
	}
}

func TestGetTransactionByID_EmptyID(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := fiber.New()
	app.Use(recover.New())

	authMiddleware := func(c *fiber.Ctx) error {
		c.Locals("userID", "user-1")
		return c.Next()
	}
	h.RegisterWithAuth(app, authMiddleware)

	// Test with a valid path param
	req := httptest.NewRequest("GET", "/api/v1/payments/txn-123", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	// Should not be 400. Should be 500 from nil store panic.
	if resp.StatusCode == fiber.StatusBadRequest {
		t.Errorf("status = 400, id was provided so should not fail validation")
	}
}

func TestCreateEscrow_OwnerIDFromLocals(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	// Provide ownerId in body but also X-User-ID header — header should override
	body := `{"projectId":"p-1","amount":10000,"ownerId":"body-owner","idempotencyKey":"key-1"}`
	req := httptest.NewRequest("POST", "/api/v1/payments/escrow", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "header-user")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test request failed: %v", err)
	}
	// Validation should pass (projectId, idempotencyKey, amount all valid, ownerID set from header)
	// Will fail on nil store, but not on validation
	if resp.StatusCode == fiber.StatusBadRequest {
		t.Errorf("status = 400, all fields should be valid")
	}
	if resp.StatusCode == fiber.StatusUnauthorized {
		t.Errorf("status = 401, auth should succeed with X-User-ID header")
	}
}

// --- Midtrans status mapping edge cases ---

func TestMapMidtransStatus_AllStatuses(t *testing.T) {
	// Ensure all documented Midtrans statuses are handled
	tests := []struct {
		midtransStatus string
		currentStatus  string
		want           string
	}{
		{"capture", "pending", "completed"},
		{"settlement", "processing", "completed"},
		{"pending", "pending", "processing"},
		{"deny", "processing", "failed"},
		{"cancel", "processing", "failed"},
		{"expire", "processing", "failed"},
		{"refund", "completed", "refunded"},
		{"partial_refund", "completed", "refunded"},
		{"authorize", "pending", "pending"},          // unknown -> return current
		{"challenge", "processing", "processing"},    // unknown -> return current
		{"failure", "processing", "processing"},      // unknown -> return current
	}

	for _, tt := range tests {
		got := mapMidtransStatus(tt.midtransStatus, tt.currentStatus)
		if got != tt.want {
			t.Errorf("mapMidtransStatus(%q, %q) = %q, want %q",
				tt.midtransStatus, tt.currentStatus, got, tt.want)
		}
	}
}

func TestUnmarshalMetadata_NestedJSON(t *testing.T) {
	input := []byte(`{"source":"webhook","details":{"key":"value","count":42}}`)
	got := unmarshalMetadata(input)
	if got == nil {
		t.Fatal("expected non-nil map")
	}
	details, ok := got["details"]
	if !ok {
		t.Fatal("expected 'details' key")
	}
	detailMap, ok := details.(map[string]any)
	if !ok {
		t.Fatalf("expected nested map, got %T", details)
	}
	if detailMap["key"] != "value" {
		t.Errorf("details.key = %v, want 'value'", detailMap["key"])
	}
}

func TestUnmarshalMetadata_ArrayJSON(t *testing.T) {
	// JSON array is not a map, should return nil from unmarshal to map[string]any
	input := []byte(`[1,2,3]`)
	got := unmarshalMetadata(input)
	if got != nil {
		t.Errorf("expected nil for JSON array, got %v", got)
	}
}

// --- RegisterWithAuth route registration test ---

func TestPaymentHandler_RouteRegistration(t *testing.T) {
	svc := service.NewPaymentService(nil, nil, "", "")
	h := NewPaymentHandler(svc)
	app := newPaymentTestApp(h, nil)

	// Verify all routes are registered by checking that they don't return 404
	routes := []struct {
		method string
		path   string
	}{
		{"POST", "/api/v1/payments/escrow"},
		{"POST", "/api/v1/payments/release"},
		{"POST", "/api/v1/payments/create-snap-token"},
		{"GET", "/api/v1/payments/project/test-id"},
		{"GET", "/api/v1/payments/test-id"},
		{"POST", "/api/v1/payments/refund"},
	}

	for _, r := range routes {
		t.Run(r.method+" "+r.path, func(t *testing.T) {
			var body io.Reader
			if r.method == "POST" {
				body = strings.NewReader("{}")
			}
			req := httptest.NewRequest(r.method, r.path, body)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", "user-1")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test request failed: %v", err)
			}
			if resp.StatusCode == fiber.StatusNotFound {
				t.Errorf("route %s %s returned 404, expected it to be registered", r.method, r.path)
			}
		})
	}
}

// --- Full MidtransWebhook flow tests with mock stores ---

func validWebhookSig(orderID, statusCode, grossAmount, serverKey string) string {
	hash := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	return hex.EncodeToString(hash[:])
}

func TestMidtransWebhook_FullFlow_StatusChanged(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ESC-proj-1-12345"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{
		CommitFn: func(_ context.Context) error { return nil },
	}

	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "pending", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return mockTx, nil
				},
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}

	// Mock project service for the notification callback
	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success":true}`))
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(txnStore, serverKey, projServer.URL, "service-auth-secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement","transaction_id":"midtrans-123","payment_type":"bank_transfer"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		result := parsePaymentResponse(t, &resp.Body)
		t.Fatalf("status = %d, want %d, error: %+v", resp.StatusCode, fiber.StatusOK, result.Error)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if !result.Success {
		t.Error("expected success=true")
	}
}

func TestMidtransWebhook_StatusUnchanged(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ESC-proj-1-12345"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "completed", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	result := parsePaymentResponse(t, &resp.Body)
	if !result.Success {
		t.Error("expected success=true")
	}
	// Parse data to check changed=false
	var data map[string]any
	json.Unmarshal(result.Data, &data)
	if data["changed"] != false {
		t.Errorf("expected changed=false, got %v", data["changed"])
	}
}

func TestMidtransWebhook_TransactionNotFound(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "UNKNOWN-ORDER"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)

	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, nil
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestMidtransWebhook_LookupError(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-ERR"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)

	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return nil, fmt.Errorf("db error")
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestMidtransWebhook_BeginTxError(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-TX-ERR"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "pending", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return nil, fmt.Errorf("pool error")
				},
			}
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestMidtransWebhook_UpdateWebhookTxError(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-UPD-ERR"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{}
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "pending", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return mockTx, nil
				},
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return nil, fmt.Errorf("update error")
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestMidtransWebhook_CreateEventTxError(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-EVT-ERR"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{}
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "pending", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return mockTx, nil
				},
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return nil, fmt.Errorf("event error")
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestMidtransWebhook_CommitError(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-CMT-ERR"
	statusCode := "200"
	grossAmount := "100000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{
		CommitFn: func(_ context.Context) error { return fmt.Errorf("commit error") },
	}
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "pending", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
					return mockTx, nil
				},
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestMidtransWebhook_RefundStatus(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-REFUND"
	statusCode := "200"
	grossAmount := "50000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	talentID := "talent-1"
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 50000,
				Status: "completed", Type: store.TxTypeEscrowRelease,
				TalentID: &talentID, CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "refunded", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}

	wh := NewWebhookHandler(txnStore, serverKey, "", "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"refund"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestMidtransWebhook_EscrowReleaseCompleted(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ESC-REL-ORDER"
	statusCode := "200"
	grossAmount := "75000"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 75000,
				Status: "processing", Type: store.TxTypeEscrowRelease,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}

	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(txnStore, serverKey, projServer.URL, "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"capture"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestMidtransWebhook_ZeroGrossAmount(t *testing.T) {
	serverKey := "test-server-key"
	orderID := "ORDER-ZERO-AMT"
	statusCode := "200"
	grossAmount := "0"
	sig := validWebhookSig(orderID, statusCode, grossAmount, serverKey)
	now := time.Now().UTC()

	mockTx := &store.MockTx{CommitFn: func(_ context.Context) error { return nil }}
	txnStore := &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, _ string) (*store.Transaction, error) {
			return &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 100000,
				Status: "pending", Type: store.TxTypeEscrowIn,
				CreatedAt: now, UpdatedAt: now,
			}, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{
				BeginTxFn: func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) { return mockTx, nil },
			}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, _, _ string, _ *string, _ *string) (*store.Transaction, error) {
			return &store.Transaction{ID: "txn-1", Status: "completed", CreatedAt: now, UpdatedAt: now}, nil
		},
		CreateEventTxFn: func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}

	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(txnStore, serverKey, projServer.URL, "secret")
	app := fiber.New()
	wh.Register(app)

	body := fmt.Sprintf(`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"settlement"}`,
		orderID, statusCode, grossAmount, sig)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

// --- notifyProjectService tests ---

func TestNotifyProjectService_Success(t *testing.T) {
	var receivedBody map[string]any
	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(nil, "key", projServer.URL, "auth-secret")
	wh.notifyProjectService("proj-1", "BRD-proj-1-123", "completed", 50000)

	// Give goroutine time to finish (notifyProjectService is called synchronously in test)
	if receivedBody["orderId"] != "BRD-proj-1-123" {
		t.Errorf("orderId = %v, want BRD-proj-1-123", receivedBody["orderId"])
	}
}

func TestNotifyProjectService_PRDPrefix(t *testing.T) {
	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(nil, "key", projServer.URL, "auth-secret")
	// Should not panic; covers the PRD prefix branch
	wh.notifyProjectService("proj-1", "PRD-proj-1-123", "completed", 50000)
}

func TestNotifyProjectService_ESCPrefix(t *testing.T) {
	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(nil, "key", projServer.URL, "auth-secret")
	// Covers the default "escrow" paymentKind branch
	wh.notifyProjectService("proj-1", "ESC-proj-1-123", "completed", 50000)
}

func TestNotifyProjectService_ServerError(t *testing.T) {
	projServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer projServer.Close()

	wh := NewWebhookHandler(nil, "key", projServer.URL, "auth-secret")
	// Should not panic; covers the error status branch
	wh.notifyProjectService("proj-1", "BRD-proj-1-123", "completed", 50000)
}

func TestNotifyProjectService_ConnectionError(t *testing.T) {
	wh := NewWebhookHandler(nil, "key", "http://localhost:1", "auth-secret")
	// Should not panic; covers the HTTP client error branch
	wh.notifyProjectService("proj-1", "BRD-proj-1-123", "completed", 50000)
}

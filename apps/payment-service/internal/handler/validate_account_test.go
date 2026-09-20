package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/store"
)

type validateResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Verified    bool   `json:"verified"`
		AccountName string `json:"accountName"`
		Reason      string `json:"reason"`
	} `json:"data"`
	Error *struct {
		Code string `json:"code"`
	} `json:"error"`
}

func validateApp(h *PaymentHandler) *fiber.App {
	app := fiber.New()
	app.Post("/validate", h.ValidateAccount)
	return app
}

func postValidate(t *testing.T, app *fiber.App, body string) (*http.Response, validateResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/validate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	var parsed validateResponse
	if decodeErr := json.NewDecoder(resp.Body).Decode(&parsed); decodeErr != nil {
		t.Fatalf("decode: %v", decodeErr)
	}
	return resp, parsed
}

func mockHandler() *PaymentHandler {
	return NewPaymentHandler(newMockPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}))
}

func TestValidateAccount_Unconfigured(t *testing.T) {
	// No SetIris: the default state, and any deployment without IRIS_API_KEY.
	_, body := postValidate(t, validateApp(mockHandler()),
		`{"provider":"bca","account":"1234567890","holderName":"Budi"}`)
	if body.Data.Verified {
		t.Fatal("an unconfigured client must not verify")
	}
	if body.Data.Reason != "validation_unavailable" {
		t.Fatalf("reason = %q, want validation_unavailable", body.Data.Reason)
	}
}

func TestValidateAccount_MissingFields(t *testing.T) {
	resp, body := postValidate(t, validateApp(mockHandler()), `{"provider":"bca"}`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	if body.Error == nil || body.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("error = %+v, want VALIDATION_ERROR", body.Error)
	}
}

func TestValidateAccount_NameMatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"account_no":"1234567890","account_name":"BUDI  SANTOSO","bank_name":"bca"}`))
	}))
	defer srv.Close()

	h := mockHandler()
	h.SetIris(iris.NewClient(srv.URL, "key"))
	// Claimed name differs only in case and spacing; it must still match.
	_, body := postValidate(t, validateApp(h),
		`{"provider":"bca","account":"1234567890","holderName":"budi santoso"}`)
	if !body.Data.Verified {
		t.Fatalf("expected verified, got %+v", body.Data)
	}
	if body.Data.AccountName != "BUDI  SANTOSO" {
		t.Fatalf("accountName = %q", body.Data.AccountName)
	}
}

func TestValidateAccount_NameMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"account_no":"1234567890","account_name":"SITI AMINAH","bank_name":"bca"}`))
	}))
	defer srv.Close()

	h := mockHandler()
	h.SetIris(iris.NewClient(srv.URL, "key"))
	_, body := postValidate(t, validateApp(h),
		`{"provider":"bca","account":"1234567890","holderName":"Budi Santoso"}`)
	if body.Data.Verified {
		t.Fatal("a name mismatch must not verify")
	}
	if body.Data.Reason != "name_mismatch" {
		t.Fatalf("reason = %q, want name_mismatch", body.Data.Reason)
	}
}

func TestValidateAccount_AccountRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error_message":"account not found"}`))
	}))
	defer srv.Close()

	h := mockHandler()
	h.SetIris(iris.NewClient(srv.URL, "key"))
	resp, body := postValidate(t, validateApp(h),
		`{"provider":"bca","account":"0000","holderName":"Budi"}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200 (a rejected account is an answer, not a failure)", resp.StatusCode)
	}
	if body.Data.Verified || body.Data.Reason != "account_not_found" {
		t.Fatalf("data = %+v, want unverified account_not_found", body.Data)
	}
}

func TestValidateAccount_GatewayError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	h := mockHandler()
	h.SetIris(iris.NewClient(srv.URL, "key"))
	resp, body := postValidate(t, validateApp(h),
		`{"provider":"bca","account":"1","holderName":"Budi"}`)
	if resp.StatusCode != fiber.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
	if body.Error == nil || body.Error.Code != "PAYMENT_GATEWAY_ERROR" {
		t.Fatalf("error = %+v, want PAYMENT_GATEWAY_ERROR", body.Error)
	}
}

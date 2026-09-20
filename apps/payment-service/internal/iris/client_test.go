package iris

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEnabled(t *testing.T) {
	if NewClient(SandboxBaseURL, "").Enabled() {
		t.Fatal("a client with no api key must report disabled")
	}
	if !NewClient(SandboxBaseURL, "key").Enabled() {
		t.Fatal("a client with an api key must report enabled")
	}
	if (*Client)(nil).Enabled() {
		t.Fatal("a nil client must report disabled")
	}
}

func TestValidateAccountDisabled(t *testing.T) {
	_, err := NewClient(SandboxBaseURL, "").ValidateAccount(context.Background(), "bca", "1234567890")
	if err == nil {
		t.Fatal("a disabled client must refuse to validate")
	}
}

func TestValidateAccountSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("bank"); got != "bca" {
			t.Errorf("bank = %q, want bca", got)
		}
		if got := r.URL.Query().Get("account"); got != "1234567890" {
			t.Errorf("account = %q, want 1234567890", got)
		}
		if auth := r.Header.Get("Authorization"); auth == "" || auth[:6] != "Basic " {
			t.Errorf("missing Basic auth header, got %q", auth)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"account_no":"1234567890","account_name":"Budi Santoso","bank_name":"bca"}`))
	}))
	defer srv.Close()

	res, err := NewClient(srv.URL, "key").ValidateAccount(context.Background(), "bca", "1234567890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.AccountName != "Budi Santoso" {
		t.Fatalf("account name = %q, want Budi Santoso", res.AccountName)
	}
}

func TestValidateAccountRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error_message":"account not found"}`))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "key").ValidateAccount(context.Background(), "bca", "0000000000")
	var invalid *InvalidAccountError
	if !errors.As(err, &invalid) {
		t.Fatalf("want InvalidAccountError, got %v", err)
	}
	if invalid.Message != "account not found" {
		t.Fatalf("message = %q, want account not found", invalid.Message)
	}
}

func TestValidateAccountServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "key").ValidateAccount(context.Background(), "bca", "1")
	var invalid *InvalidAccountError
	if err == nil || errors.As(err, &invalid) {
		t.Fatalf("a 5xx must be a transport error, not InvalidAccountError; got %v", err)
	}
}

func TestValidateAccountNoHolderName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"account_no":"1","account_name":"","bank_name":"bca"}`))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "key").ValidateAccount(context.Background(), "bca", "1")
	if err == nil {
		t.Fatal("an empty holder name must be an error")
	}
}

func TestCreatePayout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/payouts" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("X-Idempotency-Key") != "disburse:m1" {
			t.Errorf("idempotency key = %q", r.Header.Get("X-Idempotency-Key"))
		}
		var body struct {
			Payouts []map[string]any `json:"payouts"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Payouts[0]["amount"] != "3575000" {
			t.Errorf("amount = %v, want string 3575000", body.Payouts[0]["amount"])
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"payouts":[{"status":"queued","reference_no":"REF-1"}]}`))
	}))
	defer srv.Close()

	res, err := NewClient(srv.URL, "key").CreatePayout(context.Background(), PayoutRequest{
		BeneficiaryName:    "Budi",
		BeneficiaryAccount: "1234567890",
		BeneficiaryBank:    "bca",
		Amount:             3_575_000,
		Notes:              "Milestone 1",
		IdempotencyKey:     "disburse:m1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.ReferenceNo != "REF-1" {
		t.Fatalf("reference = %q, want REF-1", res.ReferenceNo)
	}
}

func TestCreatePayoutRejectsNonPositive(t *testing.T) {
	_, err := NewClient(SandboxBaseURL, "key").CreatePayout(context.Background(), PayoutRequest{Amount: 0})
	if err == nil {
		t.Fatal("a non-positive amount must be refused before any call")
	}
}

func TestCreatePayoutDisabled(t *testing.T) {
	_, err := NewClient(SandboxBaseURL, "").CreatePayout(context.Background(), PayoutRequest{Amount: 1})
	if err == nil {
		t.Fatal("a disabled client must refuse to create a payout")
	}
}

func TestCreatePayoutErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error_message":"insufficient balance"}`))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "key").CreatePayout(context.Background(), PayoutRequest{Amount: 1, IdempotencyKey: "k"})
	if err == nil || !strings.Contains(err.Error(), "insufficient balance") {
		t.Fatalf("want error carrying the Iris message, got %v", err)
	}
}

func TestCreatePayoutNoReference(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"payouts":[]}`))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "key").CreatePayout(context.Background(), PayoutRequest{Amount: 1, IdempotencyKey: "k"})
	if err == nil {
		t.Fatal("a response with no reference number must be an error")
	}
}

func TestApprovePayout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/payouts/approve" {
			t.Errorf("path = %q", r.URL.Path)
		}
		var body struct {
			ReferenceNos []string `json:"reference_nos"`
			OTP          string   `json:"otp"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body.ReferenceNos) != 1 || body.ReferenceNos[0] != "REF-1" {
			t.Errorf("reference_nos = %v", body.ReferenceNos)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	if err := NewClient(srv.URL, "key").ApprovePayout(context.Background(), []string{"REF-1"}, ""); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestApprovePayoutEmpty(t *testing.T) {
	if err := NewClient(SandboxBaseURL, "key").ApprovePayout(context.Background(), nil, ""); err == nil {
		t.Fatal("approving nothing must be an error")
	}
}

func TestApprovePayoutErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error_message":"wrong otp"}`))
	}))
	defer srv.Close()

	err := NewClient(srv.URL, "key").ApprovePayout(context.Background(), []string{"REF-1"}, "000000")
	if err == nil || !strings.Contains(err.Error(), "wrong otp") {
		t.Fatalf("want error carrying the Iris message, got %v", err)
	}
}

func TestIrisErrorMessageErrorsArray(t *testing.T) {
	if got := irisErrorMessage([]byte(`{"errors":["bad bank code"]}`)); got != "bad bank code" {
		t.Fatalf("message = %q, want bad bank code", got)
	}
	if got := irisErrorMessage([]byte(`not json`)); got != "account rejected" {
		t.Fatalf("message = %q, want fallback", got)
	}
}

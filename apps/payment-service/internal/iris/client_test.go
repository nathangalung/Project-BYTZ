package iris

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestIrisErrorMessageErrorsArray(t *testing.T) {
	if got := irisErrorMessage([]byte(`{"errors":["bad bank code"]}`)); got != "bad bank code" {
		t.Fatalf("message = %q, want bad bank code", got)
	}
	if got := irisErrorMessage([]byte(`not json`)); got != "account rejected" {
		t.Fatalf("message = %q, want fallback", got)
	}
}

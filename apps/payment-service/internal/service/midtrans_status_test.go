package service

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Midtrans names three fields to check together for a successful payment:
// status_code 200, transaction_status settlement or capture, and fraud_status
// ACCEPT where present. Treating a capture as paid without reading
// fraud_status releases escrow on a transaction the bank may still reverse.
func TestMidtransStatus_Settled(t *testing.T) {
	tests := []struct {
		name string
		in   MidtransStatus
		want bool
	}{
		{"settlement", MidtransStatus{StatusCode: "200", TransactionStatus: "settlement"}, true},
		{"capture accepted", MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "accept"}, true},
		{"capture challenged", MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "challenge"}, false},
		{"capture denied", MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "deny"}, false},
		{"pending", MidtransStatus{StatusCode: "201", TransactionStatus: "pending"}, false},
		{"expired", MidtransStatus{StatusCode: "202", TransactionStatus: "expire"}, false},
		{"settlement with non-200 code", MidtransStatus{StatusCode: "407", TransactionStatus: "settlement"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.in.Settled(); got != tt.want {
				t.Errorf("Settled() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMidtransStatusClient_FetchSendsServerKeyAsBasicUsername(t *testing.T) {
	var gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		// Includes a field the struct does not declare: Midtrans documents
		// that responses gain fields and integrators must not break on them.
		_, _ = w.Write([]byte(`{"order_id":"o-1","transaction_status":"settlement","status_code":"200","some_future_field":true}`))
	}))
	defer srv.Close()

	got, err := NewMidtransStatusClient(srv.URL, "SB-Mid-server-abc").Fetch(t.Context(), "o-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.TransactionStatus != "settlement" || !got.Settled() {
		t.Errorf("status = %+v, want a settled transaction", got)
	}
	if gotPath != "/v2/o-1/status" {
		t.Errorf("path = %q, want /v2/o-1/status", gotPath)
	}
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("SB-Mid-server-abc:"))
	if gotAuth != want {
		t.Errorf("auth header = %q, want %q", gotAuth, want)
	}
	if !strings.HasSuffix(want, "Og==") && !strings.Contains(want, "Basic ") {
		t.Errorf("auth header is not basic: %q", want)
	}
}

// A 404 is terminal: Midtrans has no such order, so retrying cannot help.
func TestMidtransStatusClient_FetchUnknownOrder(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	_, err := NewMidtransStatusClient(srv.URL, "k").Fetch(t.Context(), "missing")
	if !errors.Is(err, ErrOrderNotFound) {
		t.Errorf("err = %v, want ErrOrderNotFound", err)
	}
}

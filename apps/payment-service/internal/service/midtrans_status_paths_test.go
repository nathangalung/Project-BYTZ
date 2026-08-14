package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
Settled is the three-field check Midtrans documents: status_code 200,
transaction_status settlement or capture, and fraud_status ACCEPT where it is
present. Reading any one of them alone books money that is not in hand.
*/
func TestMidtransStatus_SettledRequiresAllThreeFields(t *testing.T) {
	tests := []struct {
		name   string
		status MidtransStatus
		want   bool
	}{
		{name: "settlement", status: MidtransStatus{StatusCode: "200", TransactionStatus: "settlement"}, want: true},
		{name: "capture accepted", status: MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "accept"}, want: true},
		{name: "capture accepted in upper case", status: MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "ACCEPT"}, want: true},
		{
			// The case the field exists for: a capture held for review is not
			// money in hand, however successful the status code looks.
			name:   "capture challenged by fraud review",
			status: MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "challenge"},
		},
		{name: "capture denied by fraud review", status: MidtransStatus{StatusCode: "200", TransactionStatus: "capture", FraudStatus: "deny"}},
		{name: "still pending", status: MidtransStatus{StatusCode: "200", TransactionStatus: "pending"}},
		{name: "expired", status: MidtransStatus{StatusCode: "200", TransactionStatus: "expire"}},
		{name: "cancelled", status: MidtransStatus{StatusCode: "200", TransactionStatus: "cancel"}},
		{name: "refunded is not a settlement", status: MidtransStatus{StatusCode: "200", TransactionStatus: "refund"}},
		{name: "settlement with a failure status code", status: MidtransStatus{StatusCode: "407", TransactionStatus: "settlement"}},
		{name: "empty", status: MidtransStatus{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.status.Settled(); got != tt.want {
				t.Errorf("Settled() = %v, want %v for %+v", got, tt.want, tt.status)
			}
		})
	}
}

// Reconciliation is the authoritative read of a payment's state, so every way
// the call can go wrong has to surface as an error. Returning a zero status
// would read as "not settled" and leave a paid owner locked out.
func TestMidtransStatusClient_FetchSurfacesEveryFailure(t *testing.T) {
	tests := []struct {
		name       string
		apiBase    string
		status     int
		body       string
		wantErr    string
		wantNotFnd bool
	}{
		{name: "gateway is unreachable", apiBase: "http://127.0.0.1:1", wantErr: "call midtrans status"},
		{name: "url cannot be turned into a request", apiBase: "http://bad\nhost", wantErr: "build status request"},
		{name: "gateway is broken", status: http.StatusInternalServerError, body: `{}`, wantErr: "midtrans status returned 500"},
		{name: "unauthorised", status: http.StatusUnauthorized, body: `{}`, wantErr: "midtrans status returned 401"},
		{name: "response is not json", status: http.StatusOK, body: `<html>maintenance</html>`, wantErr: "decode midtrans status"},
		{name: "unknown order is terminal", status: http.StatusNotFound, body: `{}`, wantNotFnd: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			apiBase := tt.apiBase
			if apiBase == "" {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.WriteHeader(tt.status)
					_, _ = w.Write([]byte(tt.body))
				}))
				defer server.Close()
				apiBase = server.URL
			}

			got, err := NewMidtransStatusClient(apiBase, "SB-Mid-server-key").
				Fetch(context.Background(), "ORD-1")

			if got != nil {
				t.Errorf("returned a status alongside the failure: %+v", got)
			}
			if tt.wantNotFnd {
				if !errors.Is(err, ErrOrderNotFound) {
					t.Fatalf("error = %v, want ErrOrderNotFound", err)
				}
				return
			}
			if err == nil {
				t.Fatal("a failed status read was reported as success")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want it to mention %q", err.Error(), tt.wantErr)
			}
			if errors.Is(err, ErrOrderNotFound) {
				t.Error("a transient failure was reported as a missing order, which is terminal")
			}
		})
	}
}

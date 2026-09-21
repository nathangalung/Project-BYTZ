package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/kerjacus/payment-service/internal/service"
	"github.com/kerjacus/payment-service/internal/store"
)

var errContactLookup = errors.New("connection reset")

/*
The phone and address on a Midtrans charge are read from the authenticated
user's own row, never from the checkout request.

A number taken off the body would put an arbitrary string on a real payment
record and into the gateway's fraud signals, so the request is probed with a
body that names a different phone and address and the payload is checked
against the row instead.
*/
func TestCreateSnapToken_TakesTheCustomerContactFromTheAuthenticatedRow(t *testing.T) {
	tests := []struct {
		name        string
		userID      string
		rowPhone    string
		rowAddress  string
		lookupErr   error
		wantPhone   any
		wantBilling bool
	}{
		{
			name:        "row has both",
			userID:      "user-1",
			rowPhone:    "+628111111111",
			rowAddress:  "Jl. Merdeka No. 10, Jakarta Selatan",
			wantPhone:   "+628111111111",
			wantBilling: true,
		},
		{
			name:      "row has neither",
			userID:    "user-1",
			wantPhone: nil,
		},
		{
			name:      "the lookup fails",
			userID:    "user-1",
			lookupErr: errContactLookup,
			wantPhone: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var sent map[string]any
			snapServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewDecoder(r.Body).Decode(&sent)
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"token":"snap-token-123","redirect_url":"https://pay.example.com"}`))
			}))
			defer snapServer.Close()

			var lookedUp string
			svc := service.NewPaymentService(&store.MockTransactionStore{
				GetCheckoutAmountFn: func(_ context.Context, _, _ string) (int64, error) { return 99000, nil },
				GetProjectOwnerIDFn: func(_ context.Context, _ string) (string, error) { return tt.userID, nil },
				GetUserContactFn: func(_ context.Context, userID string) (store.UserContact, error) {
					lookedUp = userID
					return store.UserContact{Phone: tt.rowPhone, Address: tt.rowAddress}, tt.lookupErr
				},
				CreateFn: func(_ context.Context, _ store.CreateTransactionInput) (*store.CreateResult, error) {
					return &store.CreateResult{IsNew: true, Transaction: store.Transaction{ID: "t-1"}}, nil
				},
			}, &store.MockLedgerStore{}, "test-key", snapServer.URL)
			app := newTestPaymentApp(svc)

			// The body names a phone and an address the server must ignore.
			body := `{"projectId":"p-1","checkoutType":"brd","itemName":"BRD",` +
				`"customerName":"User","customerEmail":"u@e.com",` +
				`"customerPhone":"+628999999999","customerAddress":"Jl. Penyerang No. 1"}`
			req := httptest.NewRequest("POST", "/api/v1/payments/create-snap-token", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-User-ID", tt.userID)

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusCreated {
				r := parseTestResp(t, resp.Body)
				t.Fatalf("status = %d, want %d, error: %+v", resp.StatusCode, fiber.StatusCreated, r.Error)
			}
			if lookedUp != tt.userID {
				t.Errorf("contact looked up for %q, want %q", lookedUp, tt.userID)
			}

			details, ok := sent["customer_details"].(map[string]any)
			if !ok {
				t.Fatalf("customer_details missing from %v", sent)
			}
			if got := details["phone"]; got != tt.wantPhone {
				t.Errorf("customer_details.phone = %v, want %v", got, tt.wantPhone)
			}
			billing, hasBilling := details["billing_address"].(map[string]any)
			if hasBilling != tt.wantBilling {
				t.Fatalf("billing_address present = %v, want %v", hasBilling, tt.wantBilling)
			}
			if tt.wantBilling && billing["address"] != tt.rowAddress {
				t.Errorf("billing_address.address = %v, want %q", billing["address"], tt.rowAddress)
			}
		})
	}
}

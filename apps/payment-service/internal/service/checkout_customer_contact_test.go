package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kerjacus/payment-service/internal/store"
)

/*
The owner's Mobile number on a real Midtrans transaction rendered as "-",
because customer_details carried only a name and an email. Phone and address
now travel with the charge, and both are optional on the account, so the
payload has to stay valid when either is missing: Midtrans rejects an empty
phone string outright, and an empty billing_address renders as a blank panel
on the payment sheet.
*/
func TestCreateSnapToken_SendsTheCustomerPhoneAndBillingAddress(t *testing.T) {
	const address = "Jl. Merdeka No. 10, Jakarta Selatan"

	tests := []struct {
		name            string
		phone           string
		address         string
		wantPhone       any
		wantBilling     bool
		wantBillingAddr string
	}{
		{
			name:            "phone and address both set",
			phone:           "+628123456789",
			address:         address,
			wantPhone:       "+628123456789",
			wantBilling:     true,
			wantBillingAddr: address,
		},
		{
			name:        "a phone with no address sends no billing block",
			phone:       "+628123456789",
			wantPhone:   "+628123456789",
			wantBilling: false,
		},
		{
			name:            "an address with no phone still bills",
			address:         address,
			wantPhone:       nil,
			wantBilling:     true,
			wantBillingAddr: address,
		},
		{
			name:        "neither set leaves customer_details as it was",
			wantPhone:   nil,
			wantBilling: false,
		},
		{
			name:            "an over-long address is cut to the Midtrans cap",
			phone:           "+628123456789",
			address:         strings.Repeat("a", 250),
			wantPhone:       "+628123456789",
			wantBilling:     true,
			wantBillingAddr: strings.Repeat("a", 200),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var sent map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewDecoder(r.Body).Decode(&sent)
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"token":"snap-tok","redirect_url":"https://pay.example/snap-tok"}`))
			}))
			defer server.Close()

			txnStore := &store.MockTransactionStore{
				GetCheckoutAmountFn: func(context.Context, string, string) (int64, error) { return 500_000, nil },
				CreateFn: func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
					return &store.CreateResult{
						Transaction: store.Transaction{ID: "txn-1", Amount: 500_000},
						IsNew:       true,
					}, nil
				},
			}
			svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", server.URL)

			in := snapInput(store.CheckoutBRD)
			in.CustomerPhone = tt.phone
			in.CustomerAddress = tt.address
			if _, err := svc.CreateSnapToken(context.Background(), in); err != nil {
				t.Fatalf("CreateSnapToken: %v", err)
			}

			details, ok := sent["customer_details"].(map[string]any)
			if !ok {
				t.Fatalf("customer_details missing from %v", sent)
			}
			if got := details["phone"]; got != tt.wantPhone {
				t.Errorf("customer_details.phone = %v, want %v", got, tt.wantPhone)
			}
			// What the payload already carried has to survive the addition.
			if details["first_name"] != "Budi" || details["email"] != "budi@example.com" {
				t.Errorf("customer_details lost its name or email: %v", details)
			}

			billing, hasBilling := details["billing_address"].(map[string]any)
			if hasBilling != tt.wantBilling {
				t.Fatalf("billing_address present = %v, want %v", hasBilling, tt.wantBilling)
			}
			if !tt.wantBilling {
				return
			}
			if billing["address"] != tt.wantBillingAddr {
				t.Errorf("billing_address.address = %v, want %q", billing["address"], tt.wantBillingAddr)
			}
			if billing["country_code"] != "IDN" {
				t.Errorf("billing_address.country_code = %v, want IDN", billing["country_code"])
			}
			if billing["first_name"] != "Budi" {
				t.Errorf("billing_address.first_name = %v, want Budi", billing["first_name"])
			}
			if billing["phone"] != tt.phone {
				t.Errorf("billing_address.phone = %v, want %q", billing["phone"], tt.phone)
			}
		})
	}
}

/*
A failed contact read must not cost the owner the checkout. Phone and address
are cosmetic to the charge, so the lookup is downgraded to a warning and the
Snap payload simply goes out without them.
*/
func TestGetUserContact_FallsBackToEmptyWhenTheLookupFails(t *testing.T) {
	tests := []struct {
		name    string
		contact store.UserContact
		err     error
		want    store.UserContact
	}{
		{
			name:    "row found",
			contact: store.UserContact{Phone: "+628123456789", Address: "Jl. Merdeka No. 10"},
			want:    store.UserContact{Phone: "+628123456789", Address: "Jl. Merdeka No. 10"},
		},
		{
			name: "lookup fails",
			err:  errBoom,
			want: store.UserContact{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotUserID string
			txnStore := &store.MockTransactionStore{
				GetUserContactFn: func(_ context.Context, userID string) (store.UserContact, error) {
					gotUserID = userID
					return tt.contact, tt.err
				},
			}
			svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", "")

			got := svc.GetUserContact(context.Background(), "user-1")
			if got != tt.want {
				t.Errorf("GetUserContact = %+v, want %+v", got, tt.want)
			}
			if gotUserID != "user-1" {
				t.Errorf("looked up %q, want user-1", gotUserID)
			}
		})
	}
}

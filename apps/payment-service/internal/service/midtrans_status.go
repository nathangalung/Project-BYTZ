package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Midtrans documents that a notification can be delayed or lost: settlement
// within 20s and expiry within 90s are SLAs, not guarantees, and delivery can
// arrive out of order. The stated remedy is to ask, rather than to wait, so
// this is the authoritative read of a transaction's state.
//
// GET {apiBase}/v2/{order_id}/status
// Authorization: Basic base64(serverKey + ":")   -- password half is empty
type MidtransStatusClient struct {
	apiBase   string
	serverKey string
	http      *http.Client
}

func NewMidtransStatusClient(apiBase, serverKey string) *MidtransStatusClient {
	return &MidtransStatusClient{
		apiBase:   apiBase,
		serverKey: serverKey,
		// Reconciliation runs in the background; it must not hang a worker.
		http: &http.Client{Timeout: 10 * time.Second},
	}
}

// MidtransStatus is parsed leniently on purpose. Midtrans documents that new
// fields may be added to responses and that integrators must not break on
// them, so unknown fields are ignored rather than rejected.
type MidtransStatus struct {
	OrderID           string `json:"order_id"`
	TransactionID     string `json:"transaction_id"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
	StatusCode        string `json:"status_code"`
	GrossAmount       string `json:"gross_amount"`
	PaymentType       string `json:"payment_type"`
}

// Settled reports whether this is a successful payment.
//
// Midtrans names three fields to check together: status_code 200,
// transaction_status settlement or capture, and fraud_status ACCEPT when it is
// present. A capture with fraud_status challenge is NOT money in hand.
func (s MidtransStatus) Settled() bool {
	if s.StatusCode != "200" {
		return false
	}
	if s.TransactionStatus != "settlement" && s.TransactionStatus != "capture" {
		return false
	}
	return s.FraudStatus == "" || s.FraudStatus == "accept" || s.FraudStatus == "ACCEPT"
}

// ErrOrderNotFound means Midtrans has no record of the order at all, which is
// terminal: polling again cannot conjure one.
var ErrOrderNotFound = fmt.Errorf("midtrans: order not found")

func (c *MidtransStatusClient) Fetch(ctx context.Context, orderID string) (*MidtransStatus, error) {
	url := fmt.Sprintf("%s/v2/%s/status", c.apiBase, orderID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build status request: %w", err)
	}
	// Server key as the username, empty password, per the Core API docs.
	auth := base64.StdEncoding.EncodeToString([]byte(c.serverKey + ":"))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Accept", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call midtrans status: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck

	if res.StatusCode == http.StatusNotFound {
		return nil, ErrOrderNotFound
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("midtrans status returned %d", res.StatusCode)
	}

	var out MidtransStatus
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode midtrans status: %w", err)
	}
	return &out, nil
}

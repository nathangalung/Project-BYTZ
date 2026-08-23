package service

import (
	"strings"
	"testing"
)

// The amount comes from checkoutType, the entitlement from the order id prefix.
//
// project-service decides what a settled payment unlocks by reading the prefix
// off the order id the browser minted (parseOrderRef, then the switch in
// PaymentSettlementService.settle). The price here comes from checkoutType via
// GetCheckoutAmount. Nothing else compares the two, so without this guard an
// owner can post checkoutType "brd" with a "PRD-" order id, be charged the BRD
// price and have prd_documents.paid_at stamped: the 199,000 entitlement for
// 99,000. It works in either direction, needs no race, and the idempotency key
// never catches it because every checkout mints a fresh order id.
func TestCreateSnapToken_RejectsPrefixThatDisagreesWithCheckoutType(t *testing.T) {
	svc := &PaymentService{}

	mismatched := []struct {
		name         string
		checkoutType string
		orderID      string
	}{
		{"brd priced, prd claimed", "brd", "PRD-abc123-1700000000-x1y2z3"},
		{"prd priced, brd claimed", "prd", "BRD-abc123-1700000000-x1y2z3"},
		{"brd priced, escrow claimed", "brd", "ESC-abc123-1700000000-x1y2z3"},
		{"escrow priced, brd claimed", "escrow", "BRD-abc123-1700000000-x1y2z3"},
		// An unrecognised prefix settles as "unknown order prefix", so the money
		// moves and nothing is granted.
		{"no recognised prefix", "brd", "ORD-123"},
	}

	for _, tt := range mismatched {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
				ProjectID:     "p-1",
				OrderID:       tt.orderID,
				CheckoutType:  tt.checkoutType,
				CustomerEmail: "owner@example.com",
			})
			if err == nil {
				t.Fatalf("accepted %s order id for a %s checkout", tt.orderID, tt.checkoutType)
			}
			appErr, ok := err.(*AppError)
			if !ok || appErr.Code != "VALIDATION_ERROR" {
				t.Fatalf("got %v, want VALIDATION_ERROR", err)
			}
		})
	}
}

// The honest client always agrees with itself; the guard must not stand in its way.
//
// Asserted against orderPrefixFor rather than through CreateSnapToken, because a
// matching prefix falls through to pricing and this service has no store wired.
func TestOrderPrefixFor_MatchesWhatTheClientMints(t *testing.T) {
	minted := map[string]string{
		"brd":      "BRD-abc123-1700000000-x1y2z3",
		"prd":      "PRD-abc123-1700000000-x1y2z3",
		"escrow":   "ESC-abc123-1700000000-x1y2z3",
		"revision": "REV-11111111-2222-3333-4444-555555555555-1700000000-x1",
	}

	for checkoutType, orderID := range minted {
		prefix := orderPrefixFor(checkoutType)
		if prefix == "" {
			t.Fatalf("%s has no prefix", checkoutType)
		}
		if !strings.HasPrefix(orderID, prefix) {
			t.Fatalf("%s mints %s which does not start with %s", checkoutType, orderID, prefix)
		}
	}

	// An unknown checkout type has no prefix, and checkoutTxType rejects it first.
	if orderPrefixFor("free") != "" {
		t.Fatal("unknown checkout type returned a prefix")
	}
}

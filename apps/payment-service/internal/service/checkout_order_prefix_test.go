package service

import (
	"strings"
	"testing"
)

// The amount comes from checkoutType, and so now does the entitlement.
//
// project-service decides what a settled payment unlocks by reading the prefix
// off the order id (parseOrderRef, then the switch in
// PaymentSettlementService.settle). The price comes from checkoutType via
// GetCheckoutAmount. While the browser minted the id, the two could disagree:
// an owner could post checkoutType "brd" with a "PRD-" order id, be charged the
// BRD price and have prd_documents.paid_at stamped. Deriving the prefix from
// checkoutType here removes the gap rather than guarding it, so this asserts the
// derivation holds for every checkout type.
func TestMintOrderID_PrefixFollowsCheckoutType(t *testing.T) {
	for checkoutType, prefix := range map[string]string{
		"brd":      "BRD-",
		"prd":      "PRD-",
		"escrow":   "ESC-",
		"revision": "REV-",
	} {
		t.Run(checkoutType, func(t *testing.T) {
			orderID, err := mintOrderID(checkoutType)
			if err != nil {
				t.Fatalf("mint %s: %v", checkoutType, err)
			}
			if !strings.HasPrefix(orderID, prefix) {
				t.Fatalf("%s minted %s, want prefix %s", checkoutType, orderID, prefix)
			}
		})
	}
}

// Midtrans rejects an order_id over 50 characters.
//
// The browser built a revision id as REV-{36-char milestone uuid}-{ts}-{rand},
// 61 characters, so every paid revision checkout was refused by the gateway.
// The milestone is carried on the transaction row instead, which is what keeps
// the minted id short.
func TestMintOrderID_StaysUnderMidtransLimit(t *testing.T) {
	for _, checkoutType := range []string{"brd", "prd", "escrow", "revision"} {
		orderID, err := mintOrderID(checkoutType)
		if err != nil {
			t.Fatalf("mint %s: %v", checkoutType, err)
		}
		if len(orderID) > maxOrderIDLen {
			t.Fatalf("%s minted %d characters (%s), Midtrans caps at %d",
				checkoutType, len(orderID), orderID, maxOrderIDLen)
		}
	}
}

// The id becomes the transaction's idempotency key, which is unique-constrained,
// and Midtrans requires an order_id never to repeat for the account. Two mints
// inside the same millisecond must still differ, so the random component has to
// carry it.
func TestMintOrderID_IsUnique(t *testing.T) {
	seen := make(map[string]bool, 500)
	for range 500 {
		orderID, err := mintOrderID("escrow")
		if err != nil {
			t.Fatalf("mint: %v", err)
		}
		if seen[orderID] {
			t.Fatalf("minted %s twice", orderID)
		}
		seen[orderID] = true
	}
}

// An unknown checkout type has no prefix, and checkoutTxType rejects it before
// anything is minted.
func TestCreateSnapToken_RejectsUnknownCheckoutType(t *testing.T) {
	svc := &PaymentService{}

	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID:     "p-1",
		CheckoutType:  "free",
		CustomerEmail: "owner@example.com",
	})
	if err == nil {
		t.Fatal("accepted an unknown checkout type")
	}
	appErr, ok := err.(*AppError)
	if !ok || appErr.Code != "VALIDATION_ERROR" {
		t.Fatalf("got %v, want VALIDATION_ERROR", err)
	}

	if orderPrefixFor("free") != "" {
		t.Fatal("unknown checkout type returned a prefix")
	}
}

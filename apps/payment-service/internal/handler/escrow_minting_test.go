package handler

import (
	"os"
	"strings"
	"testing"
)

// Funding escrow is something Midtrans tells us happened, never something a
// caller asserts. The route POST /api/v1/payments/escrow took an amount from
// the request body and wrote the full DEBIT-escrow / CREDIT-owner pair,
// marking the transaction completed with no gateway involvement at all.
//
// The ownership check did work, so this was never cross-tenant. It was worse
// in a quieter way: a project owner could mint their own escrow balance for
// any amount, and that phantom balance then satisfied the guard in
// ReleaseEscrow. Real payouts settle against money nobody paid, the talent
// account balance that GetSummaryByUser reports as earnings inflates, and the
// platform books fee revenue that does not exist.
//
// Nothing called it. project-service funds escrow through Snap checkout and
// learns of settlement from the webhook, which credits the account through
// fundEscrowLedgerTx.
func TestNoUserFacingEscrowCreation(t *testing.T) {
	src, err := os.ReadFile("payments.go")
	if err != nil {
		t.Fatalf("read payments.go: %v", err)
	}
	body := string(src)

	if strings.Contains(body, `g.Post("/escrow"`) {
		t.Error("POST /escrow is registered on the user-facing group; a client can mint escrow balance")
	}
	if strings.Contains(body, "func (h *PaymentHandler) CreateEscrow") {
		t.Error("CreateEscrow handler still exists; escrow is funded by the webhook, not by a caller")
	}
}

// The webhook remains the only way an escrow account is credited.
func TestWebhookStillFundsEscrow(t *testing.T) {
	src, err := os.ReadFile("webhook.go")
	if err != nil {
		t.Fatalf("read webhook.go: %v", err)
	}
	if !strings.Contains(string(src), "fundEscrowLedgerTx") {
		t.Error("the webhook no longer funds escrow; nothing else does")
	}
}

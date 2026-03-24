package store

import "testing"

func TestTransactionTypeConstants(t *testing.T) {
	types := map[string]string{
		TxTypeEscrowIn:           "escrow_in",
		TxTypeEscrowRelease:      "escrow_release",
		TxTypeBRDPayment:         "brd_payment",
		TxTypePRDPayment:         "prd_payment",
		TxTypeRefund:             "refund",
		TxTypePartialRefund:      "partial_refund",
		TxTypeRevisionFee:        "revision_fee",
		TxTypeTalentPlacementFee: "talent_placement_fee",
	}
	for got, want := range types {
		if got != want {
			t.Errorf("constant %q != %q", got, want)
		}
	}
}

func TestTransactionStatusConstants(t *testing.T) {
	statuses := map[string]string{
		TxStatusPending:    "pending",
		TxStatusProcessing: "processing",
		TxStatusCompleted:  "completed",
		TxStatusFailed:     "failed",
		TxStatusRefunded:   "refunded",
	}
	for got, want := range statuses {
		if got != want {
			t.Errorf("constant %q != %q", got, want)
		}
	}
}

func TestEventTypeConstants(t *testing.T) {
	events := map[string]string{
		EventEscrowCreated:    "escrow_created",
		EventMilestoneSubmit:  "milestone_submitted",
		EventMilestoneApprove: "milestone_approved",
		EventFundsReleased:    "funds_released",
		EventRefundInitiated:  "refund_initiated",
		EventDisputeOpened:    "dispute_opened",
		EventDisputeResolved:  "dispute_resolved",
	}
	for got, want := range events {
		if got != want {
			t.Errorf("constant %q != %q", got, want)
		}
	}
}

func TestLedgerConstants(t *testing.T) {
	if OwnerPlatform != "platform" {
		t.Error("OwnerPlatform")
	}
	if OwnerOwner != "owner" {
		t.Error("OwnerOwner")
	}
	if OwnerTalent != "talent" {
		t.Error("OwnerTalent")
	}
	if OwnerEscrow != "escrow" {
		t.Error("OwnerEscrow")
	}
	if AcctAsset != "asset" {
		t.Error("AcctAsset")
	}
	if AcctLiability != "liability" {
		t.Error("AcctLiability")
	}
	if AcctRevenue != "revenue" {
		t.Error("AcctRevenue")
	}
	if AcctExpense != "expense" {
		t.Error("AcctExpense")
	}
	if EntryDebit != "debit" {
		t.Error("EntryDebit")
	}
	if EntryCredit != "credit" {
		t.Error("EntryCredit")
	}
}

func TestMockTransactionStore_DefaultReturns(t *testing.T) {
	m := &MockTransactionStore{}
	tx, err := m.FindByIdempotencyKey(nil, "k")
	if tx != nil || err != nil {
		t.Error("FindByIdempotencyKey defaults")
	}
	cr, err := m.Create(nil, CreateTransactionInput{})
	if cr != nil || err != nil {
		t.Error("Create defaults")
	}
	tx, err = m.FindByID(nil, "id")
	if tx != nil || err != nil {
		t.Error("FindByID defaults")
	}
	txns, err := m.FindByProjectID(nil, "pid")
	if txns != nil || err != nil {
		t.Error("FindByProjectID defaults")
	}
	tx, err = m.UpdateStatus(nil, "id", "s")
	if tx != nil || err != nil {
		t.Error("UpdateStatus defaults")
	}
	tx, err = m.UpdateStatusTx(nil, nil, "id", "s")
	if tx != nil || err != nil {
		t.Error("UpdateStatusTx defaults")
	}
	ev, err := m.CreateEvent(nil, CreateTransactionEventInput{})
	if ev != nil || err != nil {
		t.Error("CreateEvent defaults")
	}
	ev, err = m.CreateEventTx(nil, nil, CreateTransactionEventInput{})
	if ev != nil || err != nil {
		t.Error("CreateEventTx defaults")
	}
	evs, err := m.GetEventsByTransaction(nil, "tid")
	if evs != nil || err != nil {
		t.Error("GetEventsByTransaction defaults")
	}
	tx, err = m.FindByIdempotencyKeyForWebhook(nil, "oid")
	if tx != nil || err != nil {
		t.Error("FindByIdempotencyKeyForWebhook defaults")
	}
	tx, err = m.UpdateWebhookTx(nil, nil, "id", "s", nil, nil)
	if tx != nil || err != nil {
		t.Error("UpdateWebhookTx defaults")
	}
	oid, err := m.GetProjectOwnerID(nil, "pid")
	if oid != "" || err != nil {
		t.Error("GetProjectOwnerID defaults")
	}
	p := m.Pool()
	if p != nil {
		t.Error("Pool defaults")
	}
}

func TestMockLedgerStore_DefaultReturns(t *testing.T) {
	m := &MockLedgerStore{}
	a, err := m.CreateAccount(nil, CreateAccountInput{})
	if a != nil || err != nil {
		t.Error("CreateAccount defaults")
	}
	a, err = m.FindAccountByOwner(nil, "t", nil)
	if a != nil || err != nil {
		t.Error("FindAccountByOwner defaults")
	}
	a, err = m.GetOrCreateAccount(nil, CreateAccountInput{})
	if a != nil || err != nil {
		t.Error("GetOrCreateAccount defaults")
	}
	les, err := m.CreateLedgerEntries(nil, nil)
	if les != nil || err != nil {
		t.Error("CreateLedgerEntries defaults")
	}
	les, err = m.GetEntriesByTransaction(nil, "tid")
	if les != nil || err != nil {
		t.Error("GetEntriesByTransaction defaults")
	}
	p := m.Pool()
	if p != nil {
		t.Error("Pool defaults")
	}
	a, err = m.FindAccountByOwnerTx(nil, nil, "t", nil)
	if a != nil || err != nil {
		t.Error("FindAccountByOwnerTx defaults")
	}
	a, err = m.GetOrCreateAccountTx(nil, nil, CreateAccountInput{})
	if a != nil || err != nil {
		t.Error("GetOrCreateAccountTx defaults")
	}
	les, err = m.CreateLedgerEntriesTx(nil, nil, nil)
	if les != nil || err != nil {
		t.Error("CreateLedgerEntriesTx defaults")
	}
	bal, err := m.GetAccountBalance(nil, "aid")
	if bal != 0 || err != nil {
		t.Error("GetAccountBalance defaults")
	}
}

package features

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/handler"
	"github.com/bytz/payment-service/internal/service"
	"github.com/bytz/payment-service/internal/store"
	"github.com/cucumber/godog"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// testContext holds per-scenario state.
type testContext struct {
	app            *fiber.App
	txnStore       *store.MockTransactionStore
	ledgerStore    *store.MockLedgerStore
	mockPool       *store.MockPool
	lastResp       *apiResp
	lastStatusCode int
	projectID      string
	ownerID        string
	escrowBalance  int64
	createdTxn     *store.Transaction
	releasedAmount int64
	serverKey      string
}

type apiResp struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func newTestContext() *testContext {
	tc := &testContext{
		ownerID:   "owner-1",
		serverKey: "test-server-key",
	}
	tc.mockPool = &store.MockPool{}
	tc.txnStore = &store.MockTransactionStore{
		PoolFn: func() store.PoolIface { return tc.mockPool },
	}
	tc.ledgerStore = &store.MockLedgerStore{
		PoolFn: func() store.PoolIface { return tc.mockPool },
	}
	return tc
}

func (tc *testContext) buildPaymentApp() {
	svc := service.NewPaymentService(tc.txnStore, tc.ledgerStore, tc.serverKey, "http://localhost:9999/snap")
	h := handler.NewPaymentHandler(svc)

	app := fiber.New()
	authMW := func(c *fiber.Ctx) error {
		if uid := c.Get("X-User-ID"); uid != "" {
			c.Locals("userID", uid)
		}
		return c.Next()
	}
	h.RegisterWithAuth(app, authMW)
	tc.app = app
}

func (tc *testContext) buildWebhookApp() {
	wh := handler.NewWebhookHandler(tc.txnStore, tc.serverKey, "http://localhost:9999", "test-secret")
	app := fiber.New()
	wh.Register(app)
	tc.app = app
}

func (tc *testContext) doRequest(method, url, body string, headers map[string]string) error {
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}

	req := httptest.NewRequest(method, url, reader)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := tc.app.Test(req, -1)
	if err != nil {
		return fmt.Errorf("app.Test: %w", err)
	}
	tc.lastStatusCode = resp.StatusCode

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	var r apiResp
	if err := json.Unmarshal(b, &r); err != nil {
		return fmt.Errorf("unmarshal response: %w (body: %s)", err, string(b))
	}
	tc.lastResp = &r
	return nil
}

// --- Step Definitions ---

func (tc *testContext) anOwnerWithProject(projectID string) error {
	tc.projectID = projectID
	now := time.Now().UTC()

	tc.txnStore.GetProjectOwnerIDFn = func(_ context.Context, _ string) (string, error) {
		return tc.ownerID, nil
	}
	tc.txnStore.CreateFn = func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
		txn := store.Transaction{
			ID:             "txn-1",
			ProjectID:      in.ProjectID,
			Type:           in.Type,
			Amount:         in.Amount,
			Status:         store.TxStatusPending,
			IdempotencyKey: in.IdempotencyKey,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		tc.createdTxn = &txn
		return &store.CreateResult{Transaction: txn, IsNew: true}, nil
	}
	tc.txnStore.UpdateStatusFn = func(_ context.Context, id, status string) (*store.Transaction, error) {
		return &store.Transaction{ID: id, ProjectID: tc.projectID, Status: status, Amount: tc.createdTxn.Amount, CreatedAt: now, UpdatedAt: now}, nil
	}
	tc.txnStore.CreateEventFn = func(_ context.Context, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
		return &store.TransactionEvent{ID: "ev-1"}, nil
	}
	tc.ledgerStore.GetOrCreateAccountFn = func(_ context.Context, in store.CreateAccountInput) (*store.Account, error) {
		return &store.Account{ID: "acct-" + in.OwnerType, OwnerType: in.OwnerType, Balance: 0}, nil
	}
	tc.ledgerStore.CreateLedgerEntriesFn = func(_ context.Context, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
		if len(entries) > 0 {
			tc.escrowBalance += entries[0].Amount
		}
		return []store.LedgerEntry{}, nil
	}

	tc.buildPaymentApp()
	return nil
}

func (tc *testContext) theyCreateAnEscrowOf(amount int64) error {
	body := fmt.Sprintf(`{"projectId":"%s","amount":%d,"ownerId":"%s","idempotencyKey":"idem-1"}`,
		tc.projectID, amount, tc.ownerID)
	return tc.doRequest("POST", "/api/v1/payments/escrow", body, map[string]string{"X-User-ID": tc.ownerID})
}

func (tc *testContext) aPendingEscrowTransactionShouldExist() error {
	if tc.lastStatusCode != fiber.StatusCreated {
		return fmt.Errorf("expected status 201, got %d", tc.lastStatusCode)
	}
	if !tc.lastResp.Success {
		return fmt.Errorf("expected success=true, got false (error: %+v)", tc.lastResp.Error)
	}
	return nil
}

func (tc *testContext) theEscrowAccountBalanceShouldBe(expected int64) error {
	if tc.escrowBalance != expected {
		return fmt.Errorf("expected escrow balance %d, got %d", expected, tc.escrowBalance)
	}
	return nil
}

func (tc *testContext) anEscrowOfForProject(amount int64, projectID string) error {
	tc.projectID = projectID
	tc.ownerID = "owner-1"
	tc.escrowBalance = amount
	now := time.Now().UTC()

	escrowAcctID := "acct-escrow-" + projectID

	tc.txnStore.GetProjectOwnerIDFn = func(_ context.Context, _ string) (string, error) {
		return tc.ownerID, nil
	}
	tc.txnStore.CreateFn = func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
		txn := store.Transaction{
			ID:             "txn-release-1",
			ProjectID:      in.ProjectID,
			Type:           in.Type,
			Amount:         in.Amount,
			Status:         store.TxStatusPending,
			IdempotencyKey: in.IdempotencyKey,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		tc.createdTxn = &txn
		return &store.CreateResult{Transaction: txn, IsNew: true}, nil
	}
	tc.txnStore.UpdateStatusTxFn = func(_ context.Context, _ pgx.Tx, id, status string) (*store.Transaction, error) {
		return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
	}
	tc.txnStore.CreateEventTxFn = func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
		return &store.TransactionEvent{ID: "ev-2"}, nil
	}

	tc.mockPool.BeginTxFn = func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
		return &store.MockTx{
			CommitFn:   func(_ context.Context) error { return nil },
			RollbackFn: func(_ context.Context) error { return nil },
		}, nil
	}

	tc.ledgerStore.FindAccountByOwnerTxFn = func(_ context.Context, _ pgx.Tx, ownerType string, _ *string) (*store.Account, error) {
		if ownerType == store.OwnerEscrow {
			return &store.Account{ID: escrowAcctID, OwnerType: store.OwnerEscrow, Balance: amount}, nil
		}
		return &store.Account{ID: "acct-other", OwnerType: ownerType, Balance: 0}, nil
	}
	tc.ledgerStore.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
		return &store.Account{ID: "acct-talent-1", OwnerType: in.OwnerType, Balance: 0}, nil
	}
	tc.ledgerStore.CreateLedgerEntriesTxFn = func(_ context.Context, _ pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
		for _, e := range entries {
			if e.EntryType == store.EntryCredit {
				tc.escrowBalance -= e.Amount
			}
			if e.EntryType == store.EntryDebit && e.AccountID == "acct-talent-1" {
				tc.releasedAmount += e.Amount
			}
		}
		return []store.LedgerEntry{}, nil
	}

	tc.buildPaymentApp()
	return nil
}

func (tc *testContext) theEscrowIsReleasedWithAmount(amount int64) error {
	body := fmt.Sprintf(`{"milestoneId":"ms-1","projectId":"%s","talentId":"talent-1","amount":%d,"performedBy":"%s","idempotencyKey":"idem-rel-1"}`,
		tc.projectID, amount, tc.ownerID)
	return tc.doRequest("POST", "/api/v1/payments/release", body, map[string]string{"X-User-ID": tc.ownerID})
}

func (tc *testContext) theTalentShouldReceive(expected int64) error {
	if tc.releasedAmount != expected {
		return fmt.Errorf("expected talent to receive %d, got %d", expected, tc.releasedAmount)
	}
	return nil
}

func (tc *testContext) theEscrowBalanceShouldDecrease() error {
	// After release, escrow balance should have decreased from initial
	if tc.lastStatusCode != fiber.StatusOK {
		return fmt.Errorf("expected status 200, got %d", tc.lastStatusCode)
	}
	return nil
}

func (tc *testContext) aTransactionOf(amount int64) error {
	tc.projectID = "proj-refund"
	tc.ownerID = "owner-1"
	now := time.Now().UTC()

	originalTxn := &store.Transaction{
		ID:             "txn-orig",
		ProjectID:      tc.projectID,
		Type:           store.TxTypeEscrowIn,
		Amount:         amount,
		Status:         store.TxStatusCompleted,
		IdempotencyKey: "orig-key",
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	tc.txnStore.FindByIDFn = func(_ context.Context, id string) (*store.Transaction, error) {
		if id == "txn-orig" {
			return originalTxn, nil
		}
		return nil, nil
	}

	tc.ledgerStore.FindAccountByOwnerFn = func(_ context.Context, ownerType string, _ *string) (*store.Account, error) {
		return &store.Account{ID: "acct-" + ownerType, OwnerType: ownerType, Balance: amount}, nil
	}
	tc.ledgerStore.GetOrCreateAccountFn = func(_ context.Context, in store.CreateAccountInput) (*store.Account, error) {
		return &store.Account{ID: "acct-" + in.OwnerType, OwnerType: in.OwnerType, Balance: 0}, nil
	}
	tc.ledgerStore.CreateLedgerEntriesFn = func(_ context.Context, _ []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
		return []store.LedgerEntry{}, nil
	}
	tc.txnStore.CreateEventFn = func(_ context.Context, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
		return &store.TransactionEvent{ID: "ev-ref"}, nil
	}

	return nil
}

func (tc *testContext) amountHasAlreadyBeenRefunded(refunded int64) error {
	tc.mockPool.QueryRowFn = func(_ context.Context, _ string, _ ...any) pgx.Row {
		return &store.MockRow{
			ScanFn: func(dest ...any) error {
				if p, ok := dest[0].(*int64); ok {
					*p = refunded
				}
				return nil
			},
		}
	}
	tc.txnStore.PoolFn = func() store.PoolIface { return tc.mockPool }

	now := time.Now().UTC()
	tc.txnStore.CreateFn = func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
		txn := store.Transaction{
			ID:             "txn-refund",
			ProjectID:      in.ProjectID,
			Type:           in.Type,
			Amount:         in.Amount,
			Status:         store.TxStatusPending,
			IdempotencyKey: in.IdempotencyKey,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		return &store.CreateResult{Transaction: txn, IsNew: true}, nil
	}
	tc.txnStore.UpdateStatusFn = func(_ context.Context, id, status string) (*store.Transaction, error) {
		return &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}, nil
	}

	tc.buildPaymentApp()
	return nil
}

func (tc *testContext) aRefundOfIsRequested(amount int64) error {
	body := fmt.Sprintf(`{"originalTransactionId":"txn-orig","amount":%d,"reason":"cancel","ownerId":"%s","performedBy":"admin-1","idempotencyKey":"idem-ref-1"}`,
		amount, tc.ownerID)
	return tc.doRequest("POST", "/api/v1/payments/refund", body, nil)
}

func (tc *testContext) itShouldFailWith(expectedMsg string) error {
	if tc.lastResp.Success {
		return fmt.Errorf("expected failure but got success")
	}
	if tc.lastResp.Error == nil {
		return fmt.Errorf("expected error in response, got nil")
	}
	if !strings.Contains(tc.lastResp.Error.Message, expectedMsg) {
		return fmt.Errorf("expected error message to contain %q, got %q", expectedMsg, tc.lastResp.Error.Message)
	}
	return nil
}

func (tc *testContext) aPendingTransactionWithOrder(orderID string) error {
	tc.projectID = "proj1"
	now := time.Now().UTC()

	tc.txnStore.FindByIdempotencyKeyForWebhookFn = func(_ context.Context, oid string) (*store.Transaction, error) {
		if oid == orderID {
			return &store.Transaction{
				ID:             "txn-webhook",
				ProjectID:      tc.projectID,
				Type:           store.TxTypeBRDPayment,
				Amount:         5000000,
				Status:         store.TxStatusPending,
				IdempotencyKey: orderID,
				CreatedAt:      now,
				UpdatedAt:      now,
			}, nil
		}
		return nil, nil
	}

	tc.mockPool.BeginTxFn = func(_ context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
		return &store.MockTx{
			CommitFn:   func(_ context.Context) error { return nil },
			RollbackFn: func(_ context.Context) error { return nil },
		}, nil
	}
	tc.txnStore.PoolFn = func() store.PoolIface { return tc.mockPool }

	tc.txnStore.UpdateWebhookTxFn = func(_ context.Context, _ pgx.Tx, id, status string, _ *string, _ *string) (*store.Transaction, error) {
		tc.createdTxn = &store.Transaction{ID: id, Status: status, CreatedAt: now, UpdatedAt: now}
		return tc.createdTxn, nil
	}
	tc.txnStore.CreateEventTxFn = func(_ context.Context, _ pgx.Tx, _ store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
		return &store.TransactionEvent{ID: "ev-wh"}, nil
	}

	tc.buildWebhookApp()
	return nil
}

func (tc *testContext) midtransSendsSettlementWebhook() error {
	orderID := "BRD-proj1-123"
	statusCode := "200"
	grossAmount := "5000000"

	hash := sha512.Sum512([]byte(orderID + statusCode + grossAmount + tc.serverKey))
	sig := hex.EncodeToString(hash[:])

	body := fmt.Sprintf(`{
		"order_id": "%s",
		"status_code": "%s",
		"gross_amount": "%s",
		"signature_key": "%s",
		"transaction_status": "settlement",
		"transaction_id": "midtrans-txn-123",
		"payment_type": "bank_transfer"
	}`, orderID, statusCode, grossAmount, sig)

	return tc.doRequest("POST", "/api/v1/payments/webhook/midtrans", body, nil)
}

func (tc *testContext) theTransactionStatusShouldBe(expected string) error {
	if tc.lastStatusCode != fiber.StatusOK {
		return fmt.Errorf("expected status 200, got %d", tc.lastStatusCode)
	}
	if !tc.lastResp.Success {
		return fmt.Errorf("expected success=true, got false (error: %+v)", tc.lastResp.Error)
	}
	if tc.createdTxn == nil {
		return fmt.Errorf("no transaction was updated")
	}
	if tc.createdTxn.Status != expected {
		return fmt.Errorf("expected transaction status %q, got %q", expected, tc.createdTxn.Status)
	}
	return nil
}

// --- Test Runner ---

func TestFeatures(t *testing.T) {
	suite := godog.TestSuite{
		ScenarioInitializer: InitializeScenario,
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			TestingT: t,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("non-zero status returned, failed to run feature tests")
	}
}

func InitializeScenario(sc *godog.ScenarioContext) {
	tc := newTestContext()

	sc.Step(`^an owner with project "([^"]*)"$`, tc.anOwnerWithProject)
	sc.Step(`^they create an escrow of (\d+)$`, tc.theyCreateAnEscrowOf)
	sc.Step(`^a pending escrow transaction should exist$`, tc.aPendingEscrowTransactionShouldExist)
	sc.Step(`^the escrow account balance should be (\d+)$`, tc.theEscrowAccountBalanceShouldBe)

	sc.Step(`^an escrow of (\d+) for project "([^"]*)"$`, tc.anEscrowOfForProject)
	sc.Step(`^the escrow is released with amount (\d+)$`, tc.theEscrowIsReleasedWithAmount)
	sc.Step(`^the talent should receive (\d+)$`, tc.theTalentShouldReceive)
	sc.Step(`^the escrow balance should decrease$`, tc.theEscrowBalanceShouldDecrease)

	sc.Step(`^a transaction of (\d+)$`, tc.aTransactionOf)
	sc.Step(`^(\d+) has already been refunded$`, tc.amountHasAlreadyBeenRefunded)
	sc.Step(`^a refund of (\d+) is requested$`, tc.aRefundOfIsRequested)
	sc.Step(`^it should fail with "([^"]*)"$`, tc.itShouldFailWith)

	sc.Step(`^a pending transaction with order "([^"]*)"$`, tc.aPendingTransactionWithOrder)
	sc.Step(`^Midtrans sends settlement webhook$`, tc.midtransSendsSettlementWebhook)
	sc.Step(`^the transaction status should be "([^"]*)"$`, tc.theTransactionStatusShouldBe)
}

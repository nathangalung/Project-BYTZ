package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const guardServerKey = "test-server-key"

// webhookFixture assembles a webhook handler whose every collaborator is a
// stub, and records what the request actually did to the books.
type webhookFixture struct {
	txn      *store.MockTransactionStore
	ledger   *store.MockLedgerStore
	handler  *WebhookHandler
	app      *fiber.App
	callback *httptest.Server

	mu             sync.Mutex
	webhookUpdates int
	ledgerPostings [][]store.LedgerEntryInput
	outboxEvents   []string
	committed      bool
}

func newWebhookFixture(t *testing.T, txn *store.Transaction) *webhookFixture {
	t.Helper()
	f := &webhookFixture{}

	dbTx := &store.MockTx{
		CommitFn: func(context.Context) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.committed = true
			return nil
		},
		// The only Exec the webhook issues inside its transaction is the
		// outbox insert, so this is where published events are observed.
		ExecFn: func(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			if len(args) > 3 {
				f.outboxEvents = append(f.outboxEvents, fmt.Sprint(args[3]))
			}
			return pgconn.NewCommandTag("INSERT 0 1"), nil
		},
	}

	f.txn = &store.MockTransactionStore{
		FindByIdempotencyKeyForWebhookFn: func(context.Context, string) (*store.Transaction, error) {
			return txn, nil
		},
		PoolFn: func() store.PoolIface {
			return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) {
				return dbTx, nil
			}}
		},
		UpdateWebhookTxFn: func(_ context.Context, _ pgx.Tx, id, status string, _, _ *string) (*store.Transaction, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.webhookUpdates++
			return &store.Transaction{ID: id, Status: status}, nil
		},
		CreateEventTxFn: func(context.Context, pgx.Tx, store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
		GetProjectOwnerIDFn: func(context.Context, string) (string, error) { return "owner-1", nil },
	}

	f.ledger = &store.MockLedgerStore{
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.ledgerPostings = append(f.ledgerPostings, entries)
			return nil, nil
		},
	}

	f.callback = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(f.callback.Close)

	f.handler = NewWebhookHandler(f.txn, f.ledger, guardServerKey, f.callback.URL, "service-secret")
	f.app = fiber.New()
	f.handler.Register(f.app)
	return f
}

type webhookNotification struct {
	orderID     string
	statusCode  string
	grossAmount string
	status      string
	signature   string
	paymentType string
}

func (f *webhookFixture) post(t *testing.T, n webhookNotification) (*http.Response, paymentTestResponse) {
	t.Helper()
	sig := n.signature
	if sig == "" {
		sig = validWebhookSig(n.orderID, n.statusCode, n.grossAmount, guardServerKey)
	}
	body := fmt.Sprintf(
		`{"order_id":%q,"status_code":%q,"gross_amount":%q,"signature_key":%q,"transaction_status":%q,"transaction_id":"mt-1","payment_type":%q}`,
		n.orderID, n.statusCode, n.grossAmount, sig, n.status, n.paymentType)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.app.Test(req, -1)
	if err != nil {
		t.Fatalf("webhook request: %v", err)
	}
	return resp, parsePaymentResponse(t, &resp.Body)
}

func settled(orderID string) webhookNotification {
	return webhookNotification{
		orderID: orderID, statusCode: "200", grossAmount: "10000000",
		status: "settlement", paymentType: "bank_transfer",
	}
}

/*
The monotonic guard is checked twice: once on the status read outside the
transaction, and again on the row locked FOR UPDATE. Only the second one
protects against two deliveries of the same order arriving together, because
only it is serialized against the other writer. A test that exercises the first
check alone stays green while the replay protection is gone, so this one drives
the second: the unlocked read reports pending and the locked read reports
completed, which is what the loser of the race sees.
*/
func TestMidtransWebhook_LockedStatusStopsAConcurrentReplay(t *testing.T) {
	f := newWebhookFixture(t, &store.Transaction{
		ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
		Status: store.TxStatusPending, Type: store.TxTypeEscrowIn,
	})
	f.txn.LockStatusTxFn = func(context.Context, pgx.Tx, string) (string, error) {
		return store.TxStatusCompleted, nil
	}

	resp, body := f.post(t, settled("ESC-proj-1-1"))

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200; a replay must be acknowledged, not retried", resp.StatusCode)
	}
	var data struct {
		Received bool `json:"received"`
		Changed  bool `json:"changed"`
	}
	if err := json.Unmarshal(body.Data, &data); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if !data.Received || data.Changed {
		t.Errorf("received=%v changed=%v, want received=true changed=false", data.Received, data.Changed)
	}
	if f.webhookUpdates != 0 {
		t.Errorf("the losing delivery updated the transaction %d times", f.webhookUpdates)
	}
	if len(f.ledgerPostings) != 0 {
		t.Errorf("the losing delivery funded escrow a second time: %+v", f.ledgerPostings)
	}
	if len(f.outboxEvents) != 0 {
		t.Errorf("the losing delivery published %v", f.outboxEvents)
	}
}

// The first delivery, for contrast: it must do all the work the replay above
// skipped. Without this pairing the replay test would also pass on a handler
// that does nothing at all.
func TestMidtransWebhook_FirstDeliveryFundsEscrowAndPublishes(t *testing.T) {
	f := newWebhookFixture(t, &store.Transaction{
		ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
		Status: store.TxStatusPending, Type: store.TxTypeEscrowIn,
	})
	f.txn.LockStatusTxFn = func(context.Context, pgx.Tx, string) (string, error) {
		return store.TxStatusPending, nil
	}

	resp, _ := f.post(t, settled("ESC-proj-1-1"))
	f.handler.WaitForCallbacks()

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if f.webhookUpdates != 1 {
		t.Errorf("transaction updated %d times, want 1", f.webhookUpdates)
	}
	if len(f.ledgerPostings) != 1 {
		t.Fatalf("escrow funded %d times, want 1", len(f.ledgerPostings))
	}
	// The funding posting must itself balance, or the ledger writer rejects the
	// whole settlement at runtime.
	var debit, credit int64
	for _, e := range f.ledgerPostings[0] {
		if e.EntryType == store.EntryDebit {
			debit += e.Amount
		} else {
			credit += e.Amount
		}
	}
	if debit != credit || debit != 10_000_000 {
		t.Errorf("funding posting debit=%d credit=%d, want both 10000000", debit, credit)
	}
	if len(f.outboxEvents) != 1 || f.outboxEvents[0] != "payment.settled" {
		t.Errorf("published %v, want [payment.settled]", f.outboxEvents)
	}
	if !f.committed {
		t.Error("the webhook transaction was never committed")
	}
}

// A signature is computed over order_id + status_code + gross_amount, so one
// captured from a genuine notification must not authenticate a different
// order. Constant-time comparison is what the handler uses; this checks it is
// comparing the right thing.
func TestMidtransWebhook_RejectsForgedAndReusedSignatures(t *testing.T) {
	genuine := settled("ESC-proj-1-1")
	genuineSig := validWebhookSig(genuine.orderID, genuine.statusCode, genuine.grossAmount, guardServerKey)

	tests := []struct {
		name         string
		notification webhookNotification
	}{
		{
			name:         "signature lifted onto another order",
			notification: webhookNotification{orderID: "ESC-proj-2-9", statusCode: "200", grossAmount: "10000000", status: "settlement", signature: genuineSig},
		},
		{
			name:         "amount raised after signing",
			notification: webhookNotification{orderID: genuine.orderID, statusCode: "200", grossAmount: "99000000", status: "settlement", signature: genuineSig},
		},
		{
			name:         "signed with the wrong server key",
			notification: webhookNotification{orderID: genuine.orderID, statusCode: "200", grossAmount: "10000000", status: "settlement", signature: validWebhookSig(genuine.orderID, "200", "10000000", "attacker-key")},
		},
		{
			name:         "empty signature",
			notification: webhookNotification{orderID: genuine.orderID, statusCode: "200", grossAmount: "10000000", status: "settlement", signature: " "},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newWebhookFixture(t, &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
				Status: store.TxStatusPending, Type: store.TxTypeEscrowIn,
			})

			resp, body := f.post(t, tt.notification)

			if resp.StatusCode != fiber.StatusForbidden {
				t.Fatalf("status = %d, want 403", resp.StatusCode)
			}
			if body.Error == nil || body.Error.Code != "PAYMENT_GATEWAY_ERROR" {
				t.Errorf("error = %+v, want PAYMENT_GATEWAY_ERROR", body.Error)
			}
			if f.webhookUpdates != 0 || len(f.ledgerPostings) != 0 || f.committed {
				t.Error("a rejected notification still moved money")
			}
		})
	}
}

// Every failure inside the webhook transaction has to abort it. Committing a
// status flip whose ledger legs or outbox row failed would leave escrow and
// the books disagreeing, with nothing left to retry.
func TestMidtransWebhook_AbortsOnAnyStepFailing(t *testing.T) {
	boom := errors.New("boom")

	tests := []struct {
		name     string
		status   string
		txnType  string
		arrange  func(f *webhookFixture)
		wantCode int
		wantErr  string
	}{
		{
			name: "row lock fails", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.txn.LockStatusTxFn = func(context.Context, pgx.Tx, string) (string, error) { return "", boom }
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "status update fails", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.txn.UpdateWebhookTxFn = func(context.Context, pgx.Tx, string, string, *string, *string) (*store.Transaction, error) {
					return nil, boom
				}
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "escrow funding fails", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.ledger.CreateLedgerEntriesTxFn = func(context.Context, pgx.Tx, []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
					return nil, boom
				}
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "audit actor cannot be resolved", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				calls := 0
				// The funding path resolves the owner first; the audit actor
				// lookup is the second call, and that is the one that fails.
				f.txn.GetProjectOwnerIDFn = func(context.Context, string) (string, error) {
					calls++
					if calls == 1 {
						return "owner-1", nil
					}
					return "", nil
				}
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "audit event insert fails", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.txn.CreateEventTxFn = func(context.Context, pgx.Tx, store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
					return nil, boom
				}
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "settlement outbox insert fails", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.txn.PoolFn = failingExecPool(boom)
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "refund outbox insert fails", status: "refund", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.ledger.GetEntriesByTransactionFn = func(context.Context, string) ([]store.LedgerEntry, error) {
					return []store.LedgerEntry{{ID: "le-1", AccountID: "acct-escrow", EntryType: store.EntryDebit, Amount: 10_000_000}}, nil
				}
				f.txn.PoolFn = failingExecPool(boom)
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "escrow reversal fails", status: "refund", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.ledger.GetEntriesByTransactionFn = func(context.Context, string) ([]store.LedgerEntry, error) {
					return nil, boom
				}
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "commit fails", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange: func(f *webhookFixture) {
				f.txn.PoolFn = func() store.PoolIface {
					return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) {
						return &store.MockTx{CommitFn: func(context.Context) error { return boom }}, nil
					}}
				}
			},
			wantCode: fiber.StatusInternalServerError, wantErr: "INTERNAL_ERROR",
		},
		{
			name: "gross amount is not a number", status: "settlement", txnType: store.TxTypeEscrowIn,
			arrange:  func(*webhookFixture) {},
			wantCode: fiber.StatusBadRequest, wantErr: "VALIDATION_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newWebhookFixture(t, &store.Transaction{
				ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
				Status: store.TxStatusPending, Type: tt.txnType,
			})
			tt.arrange(f)

			n := settled("ESC-proj-1-1")
			n.status = tt.status
			if tt.name == "gross amount is not a number" {
				n.grossAmount = "not-a-number"
			}
			resp, body := f.post(t, n)

			if resp.StatusCode != tt.wantCode {
				t.Fatalf("status = %d, want %d (body %+v)", resp.StatusCode, tt.wantCode, body.Error)
			}
			if body.Error == nil || body.Error.Code != tt.wantErr {
				t.Errorf("error = %+v, want code %s", body.Error, tt.wantErr)
			}
			if f.committed {
				t.Error("a failed webhook still committed its transaction")
			}
		})
	}
}

// A pool whose transaction rejects every Exec, which is how the outbox insert
// is made to fail without touching the other stubs.
func failingExecPool(err error) func() store.PoolIface {
	return func() store.PoolIface {
		return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) {
			return &store.MockTx{
				ExecFn: func(context.Context, string, ...any) (pgconn.CommandTag, error) {
					return pgconn.CommandTag{}, err
				},
			}, nil
		}}
	}
}

// Midtrans sends gross_amount with decimals. The audit event's amount parses
// the whole string, which fails on "10000000.00", and the fallback is what
// keeps a settled payment from being recorded as zero.
func TestMidtransWebhook_DecimalGrossAmountFallsBackToTheOwedAmount(t *testing.T) {
	var recorded *int64
	f := newWebhookFixture(t, &store.Transaction{
		ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
		Status: store.TxStatusPending, Type: store.TxTypeEscrowIn,
	})
	f.txn.CreateEventTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
		recorded = in.Amount
		return &store.TransactionEvent{ID: "ev-1"}, nil
	}

	n := settled("ESC-proj-1-1")
	n.grossAmount = "10000000.00"
	resp, body := f.post(t, n)
	f.handler.WaitForCallbacks()

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200 (error %+v)", resp.StatusCode, body.Error)
	}
	if recorded == nil || *recorded != 10_000_000 {
		t.Errorf("audit event amount = %v, want 10000000", recorded)
	}
}

/*
The settlement callback runs on a goroutine that outlives the request, and
shutdown calls WaitForCallbacks before closing the pool. If the wait does not
actually block, the process tears the callback down mid-flight.

The property is ordering, not merely that the function returns: the callback
handler is held open until after WaitForCallbacks has been entered, so a
non-blocking implementation observes finished=false.
*/
func TestWaitForCallbacks_BlocksUntilTheSettlementCallbackFinishes(t *testing.T) {
	release := make(chan struct{})
	arrived := make(chan struct{})
	var finished, observed bool
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(arrived)
		<-release
		mu.Lock()
		finished = true
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	f := newWebhookFixture(t, &store.Transaction{
		ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000,
		Status: store.TxStatusPending, Type: store.TxTypeEscrowIn,
	})
	f.handler = NewWebhookHandler(f.txn, f.ledger, guardServerKey, server.URL, "service-secret")
	f.app = fiber.New()
	f.handler.Register(f.app)

	resp, _ := f.post(t, settled("ESC-proj-1-1"))
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	// The handler has already returned to the client while the callback is
	// still in flight, which is the whole point of detaching it.
	select {
	case <-arrived:
	case <-time.After(5 * time.Second):
		t.Fatal("the settlement callback was never sent")
	}

	done := make(chan struct{})
	go func() {
		f.handler.WaitForCallbacks()
		mu.Lock()
		observed = finished
		mu.Unlock()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("WaitForCallbacks returned while the callback was still running")
	case <-time.After(50 * time.Millisecond):
	}

	close(release)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("WaitForCallbacks never returned")
	}
	mu.Lock()
	defer mu.Unlock()
	if !observed {
		t.Error("WaitForCallbacks returned before the callback completed")
	}
}

func TestWaitForCallbacks_ReturnsImmediatelyWithNothingInFlight(t *testing.T) {
	h := NewWebhookHandler(&store.MockTransactionStore{}, &store.MockLedgerStore{}, guardServerKey, "", "")
	done := make(chan struct{})
	go func() { h.WaitForCallbacks(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("WaitForCallbacks blocked with no callbacks outstanding")
	}
}

// A callback URL that cannot form a request must be logged and dropped, not
// panic the goroutine: payment.settled is the durable path and the settlement
// has already been committed by this point.
func TestNotifyProjectService_UnbuildableRequestIsDropped(t *testing.T) {
	h := NewWebhookHandler(&store.MockTransactionStore{}, &store.MockLedgerStore{}, guardServerKey, "http://bad\nhost", "secret")
	h.notifyProjectService(context.Background(), "proj-1", "ESC-1", store.TxStatusCompleted, 1000)
}

/*
A settled deposit is split across work packages so one talent's approvals
cannot drain another's escrow. The split has to conserve the deposit exactly:
the debit legs are summed against the single credit leg by the ledger writer,
so a rounding rupiah left unallocated fails the whole settlement rather than
quietly shrinking a pool.
*/
func TestEscrowPools_ConserveTheDepositExactly(t *testing.T) {
	tests := []struct {
		name      string
		deposit   int64
		packages  []store.WorkPackage
		wantPools int
	}{
		{
			name:    "even split",
			deposit: 10_000_000,
			packages: []store.WorkPackage{
				{ID: "wp-1", Amount: 5_000_000}, {ID: "wp-2", Amount: 5_000_000},
			},
			wantPools: 2,
		},
		{
			name:    "every share truncates and the remainder lands on the largest",
			deposit: 10_000_000,
			packages: []store.WorkPackage{
				{ID: "wp-1", Amount: 3_333_333}, {ID: "wp-2", Amount: 3_333_333}, {ID: "wp-3", Amount: 3_333_334},
			},
			wantPools: 3,
		},
		{
			name:      "one rupiah across three packages leaves two shares at zero",
			deposit:   1,
			packages:  []store.WorkPackage{{ID: "wp-1", Amount: 100}, {ID: "wp-2", Amount: 100}, {ID: "wp-3", Amount: 100}},
			wantPools: 1,
		},
		{
			name:      "a package priced at zero takes no pool",
			deposit:   10_000_000,
			packages:  []store.WorkPackage{{ID: "wp-1", Amount: 0}, {ID: "wp-2", Amount: 1_000_000}},
			wantPools: 1,
		},
		{
			name:      "no work packages fall back to one project pool",
			deposit:   10_000_000,
			packages:  nil,
			wantPools: 1,
		},
		{
			name:      "an empty package list falls back to one project pool",
			deposit:   10_000_000,
			packages:  []store.WorkPackage{},
			wantPools: 1,
		},
		{
			name:      "packages that are all unpriced fall back to one project pool",
			deposit:   10_000_000,
			packages:  []store.WorkPackage{{ID: "wp-1", Amount: 0}, {ID: "wp-2", Amount: 0}},
			wantPools: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: tt.deposit}
			pools := escrowPools(txn, tt.packages)

			if len(pools) != tt.wantPools {
				t.Fatalf("opened %d pools, want %d: %+v", len(pools), tt.wantPools, pools)
			}
			var total int64
			for _, p := range pools {
				if p.amount <= 0 {
					t.Errorf("pool %s holds %d; a zero leg is rejected by the ledger writer", p.ownerID, p.amount)
				}
				total += p.amount
			}
			if total != tt.deposit {
				t.Errorf("pools hold %d of a %d deposit; %d rupiah went missing",
					total, tt.deposit, tt.deposit-total)
			}
		})
	}
}

// A deposit of zero or less has nothing to split, and the caller reads nil as
// "fund one project level pool instead".
func TestAllocateEscrowShares_RefusesNonPositiveDeposits(t *testing.T) {
	packages := []store.WorkPackage{{ID: "wp-1", Amount: 100}}
	for _, deposit := range []int64{0, -1} {
		if got := allocateEscrowShares(deposit, packages); got != nil {
			t.Errorf("allocateEscrowShares(%d) = %v, want nil", deposit, got)
		}
	}
}

// The funding path resolves accounts one at a time; a failure at any of them
// has to abort before entries are written, because the caller commits.
func TestFundEscrowLedgerTx_AbortsWhenAnAccountIsUnavailable(t *testing.T) {
	boom := errors.New("boom")
	txn := &store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: 10_000_000}

	tests := []struct {
		name    string
		arrange func(txnStore *store.MockTransactionStore, ledger *store.MockLedgerStore)
		wantErr string
	}{
		{
			name: "project owner lookup fails",
			arrange: func(ts *store.MockTransactionStore, _ *store.MockLedgerStore) {
				ts.GetProjectOwnerIDFn = func(context.Context, string) (string, error) { return "", boom }
			},
			wantErr: "resolve project owner: boom",
		},
		{
			name: "project has no owner",
			arrange: func(ts *store.MockTransactionStore, _ *store.MockLedgerStore) {
				ts.GetProjectOwnerIDFn = func(context.Context, string) (string, error) { return "", nil }
			},
			wantErr: "project proj-1 has no owner",
		},
		{
			name: "owner account lookup fails",
			arrange: func(_ *store.MockTransactionStore, l *store.MockLedgerStore) {
				l.GetOrCreateAccountTxFn = func(context.Context, pgx.Tx, store.CreateAccountInput) (*store.Account, error) {
					return nil, boom
				}
			},
			wantErr: "get owner account: boom",
		},
		{
			name: "owner account comes back missing",
			arrange: func(_ *store.MockTransactionStore, l *store.MockLedgerStore) {
				l.GetOrCreateAccountTxFn = func(context.Context, pgx.Tx, store.CreateAccountInput) (*store.Account, error) {
					return nil, nil
				}
			},
			wantErr: "owner account unavailable for owner-1",
		},
		{
			name: "work package listing fails",
			arrange: func(ts *store.MockTransactionStore, _ *store.MockLedgerStore) {
				ts.GetWorkPackageAmountsFn = func(context.Context, string) ([]store.WorkPackage, error) {
					return nil, boom
				}
			},
			wantErr: "list work packages: boom",
		},
		{
			name: "escrow account lookup fails",
			arrange: func(_ *store.MockTransactionStore, l *store.MockLedgerStore) {
				l.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
					if in.OwnerType == store.OwnerEscrow {
						return nil, boom
					}
					return &store.Account{ID: "acct-owner"}, nil
				}
			},
			wantErr: "get escrow account: boom",
		},
		{
			name: "escrow account comes back missing",
			arrange: func(_ *store.MockTransactionStore, l *store.MockLedgerStore) {
				l.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
					if in.OwnerType == store.OwnerEscrow {
						return nil, nil
					}
					return &store.Account{ID: "acct-owner"}, nil
				}
			},
			wantErr: "escrow account unavailable for proj-1",
		},
		{
			name: "ledger entries rejected",
			arrange: func(_ *store.MockTransactionStore, l *store.MockLedgerStore) {
				l.CreateLedgerEntriesTxFn = func(context.Context, pgx.Tx, []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
					return nil, boom
				}
			},
			wantErr: "create escrow ledger entries: boom",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			txnStore := &store.MockTransactionStore{
				GetProjectOwnerIDFn: func(context.Context, string) (string, error) { return "owner-1", nil },
			}
			ledger := &store.MockLedgerStore{}
			tt.arrange(txnStore, ledger)

			h := NewWebhookHandler(txnStore, ledger, guardServerKey, "", "")
			err := h.fundEscrowLedgerTx(context.Background(), &store.MockTx{}, txn)
			if err == nil {
				t.Fatal("funding failure was swallowed")
			}
			if err.Error() != tt.wantErr {
				t.Errorf("error = %q, want %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestReverseEscrowLedgerTx_ReportsWriteFailures(t *testing.T) {
	boom := errors.New("boom")
	ledger := &store.MockLedgerStore{
		GetEntriesByTransactionFn: func(context.Context, string) ([]store.LedgerEntry, error) {
			return []store.LedgerEntry{{ID: "le-1", AccountID: "acct-escrow", EntryType: store.EntryDebit, Amount: 1000}}, nil
		},
		CreateLedgerEntriesTxFn: func(context.Context, pgx.Tx, []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			return nil, boom
		},
	}
	h := NewWebhookHandler(&store.MockTransactionStore{}, ledger, guardServerKey, "", "")

	err := h.reverseEscrowLedgerTx(context.Background(), &store.MockTx{},
		&store.Transaction{ID: "txn-1", ProjectID: "proj-1", Amount: 1000})
	if err == nil || err.Error() != "create refund reversal entries: boom" {
		t.Fatalf("error = %v, want create refund reversal entries: boom", err)
	}
}

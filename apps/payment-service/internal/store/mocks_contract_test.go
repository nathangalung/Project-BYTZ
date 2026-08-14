package store

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

/*
These stubs stand in for the database in every handler and service test, so a
stub that forwards the wrong argument makes those tests assert against the
wrong row while still passing. Several take two strings of the same type -
(milestoneID, projectID), (txnID, userID), (ownerType, ownerID) - where a
transposition is invisible at the call site and silently removes the
project scoping the real queries rely on.

Each case therefore passes distinguishable values and checks what arrived.
store_test.go covers the other half: what each stub returns when no function is
set.
*/
func TestMockTransactionStore_ForwardsItsArgumentsInOrder(t *testing.T) {
	ctx := context.Background()
	tx := &MockTx{}
	var got []any
	record := func(v ...any) { got = v }

	m := &MockTransactionStore{
		FindByIdempotencyKeyFn: func(_ context.Context, key string) (*Transaction, error) {
			record(key)
			return &Transaction{ID: "txn-1"}, nil
		},
		CreateFn: func(_ context.Context, in CreateTransactionInput) (*CreateResult, error) {
			record(in.ProjectID, in.Amount)
			return &CreateResult{IsNew: true}, nil
		},
		FindByIDFn: func(_ context.Context, id string) (*Transaction, error) {
			record(id)
			return nil, nil
		},
		FindByProjectIDFn: func(_ context.Context, projectID string) ([]Transaction, error) {
			record(projectID)
			return []Transaction{{ID: "txn-1"}}, nil
		},
		UpdateStatusFn: func(_ context.Context, id, status string) (*Transaction, error) {
			record(id, status)
			return nil, nil
		},
		UpdateStatusTxFn: func(_ context.Context, gotTx pgx.Tx, id, status string) (*Transaction, error) {
			record(gotTx, id, status)
			return nil, nil
		},
		CreateEventFn: func(_ context.Context, in CreateTransactionEventInput) (*TransactionEvent, error) {
			record(in.TransactionID, in.EventType)
			return nil, nil
		},
		CreateEventTxFn: func(_ context.Context, gotTx pgx.Tx, in CreateTransactionEventInput) (*TransactionEvent, error) {
			record(gotTx, in.TransactionID)
			return nil, nil
		},
		GetEventsByTransactionFn: func(_ context.Context, transactionID string) ([]TransactionEvent, error) {
			record(transactionID)
			return nil, nil
		},
		FindByIdempotencyKeyForWebhookFn: func(_ context.Context, orderID string) (*Transaction, error) {
			record(orderID)
			return nil, nil
		},
		UpdateWebhookTxFn: func(_ context.Context, gotTx pgx.Tx, id, status string, method, ref *string) (*Transaction, error) {
			record(gotTx, id, status, *method, *ref)
			return nil, nil
		},
		GetProjectOwnerIDFn: func(_ context.Context, projectID string) (string, error) {
			record(projectID)
			return "owner-1", nil
		},
		GetCheckoutAmountFn: func(_ context.Context, projectID, checkoutType string) (int64, error) {
			record(projectID, checkoutType)
			return 500_000, nil
		},
		GetMilestoneAmountFn: func(_ context.Context, milestoneID, projectID string) (int64, error) {
			record(milestoneID, projectID)
			return 1_000_000, nil
		},
		GetMilestoneWorkPackageIDFn: func(_ context.Context, milestoneID, projectID string) (*string, error) {
			record(milestoneID, projectID)
			return nil, nil
		},
		GetMilestonePricingFn: func(_ context.Context, milestoneID, projectID string) (*MilestonePricing, error) {
			record(milestoneID, projectID)
			return &MilestonePricing{}, nil
		},
		GetWorkPackageAmountsFn: func(_ context.Context, projectID string) ([]WorkPackage, error) {
			record(projectID)
			return []WorkPackage{{ID: "wp-1"}}, nil
		},
		UserMayViewTransactionFn: func(_ context.Context, txnID, userID string) (bool, error) {
			record(txnID, userID)
			return false, nil
		},
		UserMayViewProjectTransactionsFn: func(_ context.Context, projectID, userID string) (bool, error) {
			record(projectID, userID)
			return false, nil
		},
		LockStatusTxFn: func(_ context.Context, gotTx pgx.Tx, id string) (string, error) {
			record(gotTx, id)
			return TxStatusCompleted, nil
		},
		ListByUserFn: func(_ context.Context, userID, txType string, page, pageSize int) ([]Transaction, int, error) {
			record(userID, txType, page, pageSize)
			return nil, 7, nil
		},
		GetSummaryByUserFn: func(_ context.Context, userID string) (int64, int64, int64, int64, error) {
			record(userID)
			return 1, 2, 3, 4, nil
		},
		PoolFn: func() PoolIface { return &MockPool{} },
	}

	method, ref := "bank_transfer", "mt-1"
	tests := []struct {
		name string
		call func()
		want []any
	}{
		{"FindByIdempotencyKey", func() { _, _ = m.FindByIdempotencyKey(ctx, "key-1") }, []any{"key-1"}},
		{"Create", func() {
			_, _ = m.Create(ctx, CreateTransactionInput{ProjectID: "proj-1", Amount: 10_000_000})
		}, []any{"proj-1", int64(10_000_000)}},
		{"FindByID", func() { _, _ = m.FindByID(ctx, "txn-1") }, []any{"txn-1"}},
		{"FindByProjectID", func() { _, _ = m.FindByProjectID(ctx, "proj-1") }, []any{"proj-1"}},
		{"UpdateStatus", func() { _, _ = m.UpdateStatus(ctx, "txn-1", TxStatusCompleted) }, []any{"txn-1", TxStatusCompleted}},
		{"UpdateStatusTx", func() { _, _ = m.UpdateStatusTx(ctx, tx, "txn-1", TxStatusCompleted) }, []any{tx, "txn-1", TxStatusCompleted}},
		{"CreateEvent", func() {
			_, _ = m.CreateEvent(ctx, CreateTransactionEventInput{TransactionID: "txn-1", EventType: EventFundsReleased})
		}, []any{"txn-1", EventFundsReleased}},
		{"CreateEventTx", func() {
			_, _ = m.CreateEventTx(ctx, tx, CreateTransactionEventInput{TransactionID: "txn-1"})
		}, []any{tx, "txn-1"}},
		{"GetEventsByTransaction", func() { _, _ = m.GetEventsByTransaction(ctx, "txn-1") }, []any{"txn-1"}},
		{"FindByIdempotencyKeyForWebhook", func() { _, _ = m.FindByIdempotencyKeyForWebhook(ctx, "ORD-1") }, []any{"ORD-1"}},
		{"UpdateWebhookTx", func() {
			_, _ = m.UpdateWebhookTx(ctx, tx, "txn-1", TxStatusCompleted, &method, &ref)
		}, []any{tx, "txn-1", TxStatusCompleted, method, ref}},
		{"GetProjectOwnerID", func() { _, _ = m.GetProjectOwnerID(ctx, "proj-1") }, []any{"proj-1"}},
		{"GetCheckoutAmount", func() { _, _ = m.GetCheckoutAmount(ctx, "proj-1", CheckoutBRD) }, []any{"proj-1", CheckoutBRD}},
		{"GetMilestoneAmount", func() { _, _ = m.GetMilestoneAmount(ctx, "ms-1", "proj-1") }, []any{"ms-1", "proj-1"}},
		{"GetMilestoneWorkPackageID", func() { _, _ = m.GetMilestoneWorkPackageID(ctx, "ms-1", "proj-1") }, []any{"ms-1", "proj-1"}},
		{"GetMilestonePricing", func() { _, _ = m.GetMilestonePricing(ctx, "ms-1", "proj-1") }, []any{"ms-1", "proj-1"}},
		{"GetWorkPackageAmounts", func() { _, _ = m.GetWorkPackageAmounts(ctx, "proj-1") }, []any{"proj-1"}},
		{"UserMayViewTransaction", func() { _, _ = m.UserMayViewTransaction(ctx, "txn-1", "user-1") }, []any{"txn-1", "user-1"}},
		{"UserMayViewProjectTransactions", func() { _, _ = m.UserMayViewProjectTransactions(ctx, "proj-1", "user-1") }, []any{"proj-1", "user-1"}},
		{"LockStatusTx", func() { _, _ = m.LockStatusTx(ctx, tx, "txn-1") }, []any{tx, "txn-1"}},
		{"ListByUser", func() { _, _, _ = m.ListByUser(ctx, "user-1", TxTypeRefund, 3, 25) }, []any{"user-1", TxTypeRefund, 3, 25}},
		{"GetSummaryByUser", func() { _, _, _, _, _ = m.GetSummaryByUser(ctx, "user-1") }, []any{"user-1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got = nil
			tt.call()
			assertForwarded(t, tt.name, got, tt.want)
		})
	}

	if m.Pool() == nil {
		t.Error("Pool did not delegate to PoolFn")
	}
}

func TestMockLedgerStore_ForwardsItsArgumentsInOrder(t *testing.T) {
	ctx := context.Background()
	tx := &MockTx{}
	ownerID := "owner-1"
	var got []any
	record := func(v ...any) { got = v }

	m := &MockLedgerStore{
		CreateAccountFn: func(_ context.Context, in CreateAccountInput) (*Account, error) {
			record(in.OwnerType, in.OwnerID)
			return nil, nil
		},
		FindAccountByOwnerFn: func(_ context.Context, ownerType string, id *string) (*Account, error) {
			record(ownerType, id)
			return nil, nil
		},
		FindEscrowAccountsFn: func(_ context.Context, projectID string) ([]Account, error) {
			record(projectID)
			return []Account{{ID: "acct-1"}}, nil
		},
		GetOrCreateAccountFn: func(_ context.Context, in CreateAccountInput) (*Account, error) {
			record(in.OwnerType, in.AccountType)
			return nil, nil
		},
		CreateLedgerEntriesFn: func(_ context.Context, entries []LedgerEntryInput) ([]LedgerEntry, error) {
			record(len(entries))
			return nil, nil
		},
		GetEntriesByTransactionFn: func(_ context.Context, transactionID string) ([]LedgerEntry, error) {
			record(transactionID)
			return nil, nil
		},
		FindAccountByOwnerTxFn: func(_ context.Context, gotTx pgx.Tx, ownerType string, id *string) (*Account, error) {
			record(gotTx, ownerType, id)
			return nil, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, gotTx pgx.Tx, in CreateAccountInput) (*Account, error) {
			record(gotTx, in.OwnerType)
			return nil, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, gotTx pgx.Tx, entries []LedgerEntryInput) ([]LedgerEntry, error) {
			record(gotTx, len(entries))
			return nil, nil
		},
		GetAccountBalanceFn: func(_ context.Context, accountID string) (int64, error) {
			record(accountID)
			return 0, nil
		},
		PoolFn: func() PoolIface { return &MockPool{} },
	}

	entries := []LedgerEntryInput{{Amount: 1}, {Amount: 2}}
	tests := []struct {
		name string
		call func()
		want []any
	}{
		{"CreateAccount", func() {
			_, _ = m.CreateAccount(ctx, CreateAccountInput{OwnerType: OwnerEscrow, OwnerID: &ownerID})
		}, []any{OwnerEscrow, &ownerID}},
		{"FindAccountByOwner", func() { _, _ = m.FindAccountByOwner(ctx, OwnerTalent, &ownerID) }, []any{OwnerTalent, &ownerID}},
		{"FindEscrowAccountsForProject", func() { _, _ = m.FindEscrowAccountsForProject(ctx, "proj-1") }, []any{"proj-1"}},
		// Both escrow lookups share one stub, so the transaction variant must
		// reach the same function with the same project id.
		{"FindEscrowAccountsForProjectTx", func() { _, _ = m.FindEscrowAccountsForProjectTx(ctx, tx, "proj-1") }, []any{"proj-1"}},
		{"GetOrCreateAccount", func() {
			_, _ = m.GetOrCreateAccount(ctx, CreateAccountInput{OwnerType: OwnerPlatform, AccountType: AcctRevenue})
		}, []any{OwnerPlatform, AcctRevenue}},
		{"CreateLedgerEntries", func() { _, _ = m.CreateLedgerEntries(ctx, entries) }, []any{2}},
		{"GetEntriesByTransaction", func() { _, _ = m.GetEntriesByTransaction(ctx, "txn-1") }, []any{"txn-1"}},
		{"GetEntriesByTransactionTx", func() { _, _ = m.GetEntriesByTransactionTx(ctx, tx, "txn-1") }, []any{"txn-1"}},
		{"FindAccountByOwnerTx", func() { _, _ = m.FindAccountByOwnerTx(ctx, tx, OwnerEscrow, &ownerID) }, []any{tx, OwnerEscrow, &ownerID}},
		{"GetOrCreateAccountTx", func() {
			_, _ = m.GetOrCreateAccountTx(ctx, tx, CreateAccountInput{OwnerType: OwnerTalent})
		}, []any{tx, OwnerTalent}},
		{"CreateLedgerEntriesTx", func() { _, _ = m.CreateLedgerEntriesTx(ctx, tx, entries) }, []any{tx, 2}},
		{"GetAccountBalance", func() { _, _ = m.GetAccountBalance(ctx, "acct-1") }, []any{"acct-1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got = nil
			tt.call()
			assertForwarded(t, tt.name, got, tt.want)
		})
	}

	if m.Pool() == nil {
		t.Error("Pool did not delegate to PoolFn")
	}
}

func assertForwarded(t *testing.T, name string, got, want []any) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s did not delegate to its function", name)
	}
	if len(got) != len(want) {
		t.Fatalf("%s forwarded %d arguments, want %d", name, len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%s argument %d = %v, want %v", name, i, got[i], want[i])
		}
	}
}

func TestMockPoolAndTx_Delegate(t *testing.T) {
	ctx := context.Background()
	tx := &MockTx{}

	var beganWith pgx.TxOptions
	var sqlSeen []string
	pool := &MockPool{
		BeginTxFn: func(_ context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
			beganWith = opts
			return tx, nil
		},
		QueryRowFn: func(_ context.Context, sql string, _ ...any) pgx.Row {
			sqlSeen = append(sqlSeen, sql)
			return &MockRow{}
		},
		QueryFn: func(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
			sqlSeen = append(sqlSeen, sql)
			return newFakeRows(), nil
		},
		ExecFn: func(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
			sqlSeen = append(sqlSeen, sql)
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
	}

	got, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil || got != pgx.Tx(tx) {
		t.Fatalf("BeginTx = (%v, %v), want the stub transaction", got, err)
	}
	if beganWith.IsoLevel != pgx.Serializable {
		t.Errorf("isolation level not forwarded: %q", beganWith.IsoLevel)
	}
	pool.QueryRow(ctx, "SELECT 1")
	if _, err := pool.Query(ctx, "SELECT 2"); err != nil {
		t.Fatalf("Query: %v", err)
	}
	tag, err := pool.Exec(ctx, "UPDATE t SET x = 1")
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Errorf("command tag = %q, want one row affected", tag.String())
	}
	if len(sqlSeen) != 3 {
		t.Errorf("forwarded %d statements, want 3", len(sqlSeen))
	}

	// pgx.Tx is a wide interface; the stub implements the rest inertly so a
	// caller reaching for one gets a zero value rather than a panic.
	if _, err := tx.Begin(ctx); err != nil {
		t.Errorf("Begin: %v", err)
	}
	if n, err := tx.CopyFrom(ctx, pgx.Identifier{"t"}, nil, nil); n != 0 || err != nil {
		t.Errorf("CopyFrom = (%d, %v), want (0, nil)", n, err)
	}
	if tx.SendBatch(ctx, nil) != nil {
		t.Error("SendBatch returned a non-nil result")
	}
	if tx.LargeObjects() != (pgx.LargeObjects{}) {
		t.Error("LargeObjects returned a non-zero value")
	}
	if sd, err := tx.Prepare(ctx, "s", "SELECT 1"); sd != nil || err != nil {
		t.Errorf("Prepare = (%v, %v), want (nil, nil)", sd, err)
	}
	if rows, err := tx.Query(ctx, "SELECT 1"); rows != nil || err != nil {
		t.Errorf("Query = (%v, %v), want (nil, nil)", rows, err)
	}
	if tx.Conn() != nil {
		t.Error("Conn returned a non-nil connection")
	}

	// The transaction stubs default to succeeding, and delegate when wired.
	committed, rolledBack := false, false
	wired := &MockTx{
		CommitFn:   func(context.Context) error { committed = true; return nil },
		RollbackFn: func(context.Context) error { rolledBack = true; return nil },
		QueryRowFn: func(context.Context, string, ...any) pgx.Row { return &MockRow{} },
		ExecFn: func(context.Context, string, ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("INSERT 0 1"), nil
		},
	}
	if err := wired.Commit(ctx); err != nil || !committed {
		t.Error("Commit did not delegate")
	}
	if err := wired.Rollback(ctx); err != nil || !rolledBack {
		t.Error("Rollback did not delegate")
	}
	if wired.QueryRow(ctx, "SELECT 1") == nil {
		t.Error("QueryRow did not delegate")
	}
	if _, err := wired.Exec(ctx, "INSERT INTO t VALUES (1)"); err != nil {
		t.Errorf("Exec did not delegate: %v", err)
	}

	bare := &MockTx{}
	if err := bare.Commit(ctx); err != nil {
		t.Errorf("bare Commit = %v, want nil", err)
	}
	if err := bare.Rollback(ctx); err != nil {
		t.Errorf("bare Rollback = %v, want nil", err)
	}
	if bare.QueryRow(ctx, "SELECT 1") == nil {
		t.Error("bare QueryRow returned nil rather than an inert row")
	}
	if _, err := bare.Exec(ctx, "SELECT 1"); err != nil {
		t.Errorf("bare Exec = %v, want nil", err)
	}
	if err := (&MockRow{}).Scan(); err != nil {
		t.Errorf("bare Scan = %v, want nil", err)
	}

	barePool := &MockPool{}
	if tx, err := barePool.BeginTx(ctx, pgx.TxOptions{}); tx != nil || err != nil {
		t.Errorf("bare BeginTx = (%v, %v), want (nil, nil)", tx, err)
	}
	if barePool.QueryRow(ctx, "SELECT 1") != nil {
		t.Error("bare QueryRow returned a row")
	}
	if rows, err := barePool.Query(ctx, "SELECT 1"); rows != nil || err != nil {
		t.Errorf("bare Query = (%v, %v), want (nil, nil)", rows, err)
	}
	if tag, err := barePool.Exec(ctx, "SELECT 1"); err != nil || tag.String() != "" {
		t.Errorf("bare Exec = (%q, %v), want an empty tag", tag.String(), err)
	}
}

// An outbox row written inside a traced request carries the trace context, so
// the publish span downstream joins the same trace rather than starting a new
// one.
func TestInsertOutboxEventTx_CarriesTheActiveTraceContext(t *testing.T) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	tp := sdktrace.NewTracerProvider()
	defer func() { _ = tp.Shutdown(context.Background()) }()

	ctx, span := tp.Tracer("test").Start(context.Background(), "webhook")
	defer span.End()

	tx := &countingTx{}
	if err := InsertOutboxEventTx(ctx, tx, OutboxEvent{
		AggregateType: "payment", AggregateID: "txn-1", EventType: "payment.settled",
		Payload: map[string]any{"projectId": "p-1"},
	}); err != nil {
		t.Fatalf("InsertOutboxEventTx: %v", err)
	}

	traceArg := tx.execs[0].args[5]
	traceJSON, ok := traceArg.([]byte)
	if !ok || len(traceJSON) == 0 {
		t.Fatalf("trace context column = %#v, want a serialised carrier", traceArg)
	}
	wantTraceID := span.SpanContext().TraceID().String()
	if !strings.Contains(string(traceJSON), wantTraceID) {
		t.Errorf("trace context %s does not carry trace id %s", traceJSON, wantTraceID)
	}

	// Without an active span there is nothing to carry, and the column stays
	// null rather than holding an empty object.
	plain := &countingTx{}
	if err := InsertOutboxEventTx(context.Background(), plain, OutboxEvent{EventType: "payment.settled"}); err != nil {
		t.Fatalf("InsertOutboxEventTx: %v", err)
	}
	if got := plain.execs[0].args[5]; got != nil && len(got.([]byte)) != 0 {
		t.Errorf("trace context = %v, want nil outside a trace", got)
	}
}

/*
The defaults these stubs fall back to when a test wires nothing. They are not
all zero values, and the non-zero ones decide what an unwired test is actually
asserting.

The two access checks default to true. That is deliberate - most tests are not
about authorization and would otherwise all need wiring - but it means a route
whose authorization is removed still passes any test that does not set them.
Pinning the defaults here is what makes that a documented choice rather than an
accident, and any change to them has to come through this test.
*/
func TestMockStores_Defaults(t *testing.T) {
	ctx := context.Background()
	m := &MockTransactionStore{}

	if amount, err := m.GetCheckoutAmount(ctx, "p-1", CheckoutBRD); amount != 0 || err != nil {
		t.Errorf("GetCheckoutAmount default = (%d, %v), want (0, nil)", amount, err)
	}
	if amount, err := m.GetMilestoneAmount(ctx, "ms-1", "p-1"); amount != 0 || err != nil {
		t.Errorf("GetMilestoneAmount default = (%d, %v), want (0, nil)", amount, err)
	}
	if wp, err := m.GetMilestoneWorkPackageID(ctx, "ms-1", "p-1"); wp != nil || err != nil {
		t.Errorf("GetMilestoneWorkPackageID default = (%v, %v), want (nil, nil)", wp, err)
	}
	if p, err := m.GetMilestonePricing(ctx, "ms-1", "p-1"); p != nil || err != nil {
		t.Errorf("GetMilestonePricing default = (%v, %v), want (nil, nil)", p, err)
	}
	if wps, err := m.GetWorkPackageAmounts(ctx, "p-1"); wps != nil || err != nil {
		t.Errorf("GetWorkPackageAmounts default = (%v, %v), want (nil, nil)", wps, err)
	}
	if allowed, err := m.UserMayViewTransaction(ctx, "txn-1", "user-1"); !allowed || err != nil {
		t.Errorf("UserMayViewTransaction default = (%v, %v), want (true, nil)", allowed, err)
	}
	if allowed, err := m.UserMayViewProjectTransactions(ctx, "p-1", "user-1"); !allowed || err != nil {
		t.Errorf("UserMayViewProjectTransactions default = (%v, %v), want (true, nil)", allowed, err)
	}
	// Pending is the status that lets a release or refund proceed; defaulting
	// to completed would make every idempotency test a no-op.
	if status, err := m.LockStatusTx(ctx, &MockTx{}, "txn-1"); status != TxStatusPending || err != nil {
		t.Errorf("LockStatusTx default = (%q, %v), want (pending, nil)", status, err)
	}
	if txns, total, err := m.ListByUser(ctx, "user-1", "", 1, 50); txns != nil || total != 0 || err != nil {
		t.Errorf("ListByUser default = (%v, %d, %v), want (nil, 0, nil)", txns, total, err)
	}
	if a, b, c, d, err := m.GetSummaryByUser(ctx, "user-1"); a|b|c|d != 0 || err != nil {
		t.Errorf("GetSummaryByUser default = (%d, %d, %d, %d, %v), want zeroes", a, b, c, d, err)
	}

	l := &MockLedgerStore{}
	if accounts, err := l.FindEscrowAccountsForProject(ctx, "p-1"); accounts != nil || err != nil {
		t.Errorf("FindEscrowAccountsForProject default = (%v, %v), want (nil, nil)", accounts, err)
	}
	if accounts, err := l.FindEscrowAccountsForProjectTx(ctx, &MockTx{}, "p-1"); accounts != nil || err != nil {
		t.Errorf("FindEscrowAccountsForProjectTx default = (%v, %v), want (nil, nil)", accounts, err)
	}
	if entries, err := l.GetEntriesByTransactionTx(ctx, &MockTx{}, "txn-1"); entries != nil || err != nil {
		t.Errorf("GetEntriesByTransactionTx default = (%v, %v), want (nil, nil)", entries, err)
	}
}

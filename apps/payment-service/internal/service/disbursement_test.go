package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/store"
)

type fakeDisbStore struct {
	account    *store.TalentPayoutAccount
	accountErr error
	inserted   []store.EnqueueDisbursementInput
	byID       map[string]*store.Disbursement
	byRef      map[string]*store.Disbursement
	claim      *store.Disbursement
	claimErr   error
	executed   []string
	executedTo []string
	failed     []string
	failedRef  *string
	ambiguous  []string
	stuck      []store.Disbursement
	listResult []store.Disbursement
	listStatus string
}

func (f *fakeDisbStore) GetVerifiedPayoutAccountTx(_ context.Context, _ pgx.Tx, _ string) (*store.TalentPayoutAccount, error) {
	return f.account, f.accountErr
}
func (f *fakeDisbStore) InsertPendingTx(_ context.Context, _ pgx.Tx, in store.EnqueueDisbursementInput) error {
	f.inserted = append(f.inserted, in)
	return nil
}
func (f *fakeDisbStore) GetByID(_ context.Context, id string) (*store.Disbursement, error) {
	return f.byID[id], nil
}
func (f *fakeDisbStore) ClaimForExecution(_ context.Context, _ string) (*store.Disbursement, error) {
	return f.claim, f.claimErr
}
func (f *fakeDisbStore) MarkExecuted(_ context.Context, id, ref, _ string) error {
	f.executed = append(f.executed, id)
	f.executedTo = append(f.executedTo, ref)
	return nil
}
func (f *fakeDisbStore) MarkFailed(_ context.Context, id, reason string, ref *string) error {
	f.failed = append(f.failed, id+":"+reason)
	f.failedRef = ref
	return nil
}
func (f *fakeDisbStore) MarkAmbiguous(_ context.Context, id, reason string) error {
	f.ambiguous = append(f.ambiguous, id+":"+reason)
	return nil
}
func (f *fakeDisbStore) ListByStatus(_ context.Context, status string, _ int) ([]store.Disbursement, error) {
	f.listStatus = status
	return f.listResult, nil
}
func (f *fakeDisbStore) FindByReferenceNo(_ context.Context, ref string) (*store.Disbursement, error) {
	return f.byRef[ref], nil
}
func (f *fakeDisbStore) ListStuck(_ context.Context, _ time.Duration, _ int) ([]store.Disbursement, error) {
	return f.stuck, nil
}

// The settlement path runs inside a real serializable transaction, so these
// three have no meaning without a database. The pg integration tests cover
// them; here they exist to satisfy the interface, and Pool returning nil makes
// any test that accidentally reaches settlement fail loudly rather than pass on
// a stub that silently agrees.
func (f *fakeDisbStore) LockByIDTx(context.Context, pgx.Tx, string) (*store.Disbursement, error) {
	return nil, errors.New("fakeDisbStore does not implement settlement; use the pg integration tests")
}
func (f *fakeDisbStore) LockByReferenceTx(context.Context, pgx.Tx, string) (*store.Disbursement, error) {
	return nil, errors.New("fakeDisbStore does not implement settlement; use the pg integration tests")
}
func (f *fakeDisbStore) SetStatusTx(context.Context, pgx.Tx, string, string, *string) error {
	return errors.New("fakeDisbStore does not implement settlement; use the pg integration tests")
}
func (f *fakeDisbStore) Pool() store.PoolIface { return nil }

type fakeIris struct {
	enabled    bool
	createRes  *iris.PayoutResult
	createErr  error
	approveErr error
	statusRes  *iris.PayoutStatus
	statusErr  error
	created    []iris.PayoutRequest
	approved   [][]string
	statusOf   []string
}

func (f *fakeIris) Enabled() bool { return f.enabled }
func (f *fakeIris) CreatePayout(_ context.Context, in iris.PayoutRequest) (*iris.PayoutResult, error) {
	f.created = append(f.created, in)
	return f.createRes, f.createErr
}
func (f *fakeIris) ApprovePayout(_ context.Context, refs []string, _ string) error {
	f.approved = append(f.approved, refs)
	return f.approveErr
}
func (f *fakeIris) GetPayout(_ context.Context, ref string) (*iris.PayoutStatus, error) {
	f.statusOf = append(f.statusOf, ref)
	return f.statusRes, f.statusErr
}

func newDisbSvc(st disbursementStore, ir irisPayouts) *DisbursementService {
	return NewDisbursementService(st, &store.MockLedgerStore{}, ir, "")
}

func verifiedAccount() *store.TalentPayoutAccount {
	return &store.TalentPayoutAccount{Provider: "bca", Account: "123", HolderName: "Budi", Verified: true}
}

func TestEnqueueOnReleaseTx_VerifiedInserts(t *testing.T) {
	st := &fakeDisbStore{account: verifiedAccount()}
	svc := newDisbSvc(st, &fakeIris{})
	err := svc.EnqueueOnReleaseTx(context.Background(), nil, EnqueueOnReleaseInput{
		ProjectID: "p1", TalentID: "t1", NetAmount: 3_575_000, IdempotencyKey: "disburse:m1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(st.inserted) != 1 || st.inserted[0].Amount != 3_575_000 {
		t.Fatalf("expected one insert of the net amount, got %+v", st.inserted)
	}
	if st.inserted[0].Provider != "bca" || st.inserted[0].HolderName != "Budi" {
		t.Fatalf("beneficiary not snapshotted: %+v", st.inserted[0])
	}
}

func TestEnqueueOnReleaseTx_UnverifiedSkips(t *testing.T) {
	acct := verifiedAccount()
	acct.Verified = false
	st := &fakeDisbStore{account: acct}
	svc := newDisbSvc(st, &fakeIris{})
	if err := svc.EnqueueOnReleaseTx(context.Background(), nil, EnqueueOnReleaseInput{
		TalentID: "t1", NetAmount: 100, IdempotencyKey: "k",
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(st.inserted) != 0 {
		t.Fatal("an unverified account must not enqueue a payout")
	}
}

func TestEnqueueOnReleaseTx_NoAccountSkips(t *testing.T) {
	st := &fakeDisbStore{account: nil}
	svc := newDisbSvc(st, &fakeIris{})
	if err := svc.EnqueueOnReleaseTx(context.Background(), nil, EnqueueOnReleaseInput{
		TalentID: "t1", NetAmount: 100, IdempotencyKey: "k",
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(st.inserted) != 0 {
		t.Fatal("no account must not enqueue a payout")
	}
}

func TestEnqueueOnReleaseTx_ZeroAmountSkips(t *testing.T) {
	st := &fakeDisbStore{account: verifiedAccount()}
	svc := newDisbSvc(st, &fakeIris{})
	if err := svc.EnqueueOnReleaseTx(context.Background(), nil, EnqueueOnReleaseInput{
		TalentID: "t1", NetAmount: 0, IdempotencyKey: "k",
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(st.inserted) != 0 {
		t.Fatal("a zero amount must not enqueue a payout")
	}
}

func TestEnqueueOnReleaseTx_AccountErrorPropagates(t *testing.T) {
	st := &fakeDisbStore{accountErr: errors.New("db down")}
	svc := newDisbSvc(st, &fakeIris{})
	if err := svc.EnqueueOnReleaseTx(context.Background(), nil, EnqueueOnReleaseInput{
		TalentID: "t1", NetAmount: 100, IdempotencyKey: "k",
	}); err == nil {
		t.Fatal("a store error must fail the release, not silently skip")
	}
}

func pendingDisbursement() *store.Disbursement {
	return &store.Disbursement{
		ID: "d1", ProjectID: "p1", TalentID: "t1", Amount: 3_575_000,
		BeneficiaryProvider: "bca", BeneficiaryAccount: "123", BeneficiaryName: "Budi",
		Status: store.DisbursementQueued, IdempotencyKey: "disburse:m1",
	}
}

func TestExecute_HappyPath(t *testing.T) {
	d := pendingDisbursement()
	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{enabled: true, createRes: &iris.PayoutResult{ReferenceNo: "REF-1"}}
	svc := newDisbSvc(st, ir)

	_, err := svc.Execute(context.Background(), "d1", "admin1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ir.created) != 1 || ir.created[0].Amount != 3_575_000 {
		t.Fatalf("payout not created with the net amount: %+v", ir.created)
	}
	if len(ir.approved) != 1 || ir.approved[0][0] != "REF-1" {
		t.Fatalf("payout not approved by reference: %+v", ir.approved)
	}
	if len(st.executed) != 1 {
		t.Fatal("executed payout not recorded")
	}
}

func TestExecute_Disabled(t *testing.T) {
	svc := newDisbSvc(&fakeDisbStore{}, &fakeIris{enabled: false})
	_, err := svc.Execute(context.Background(), "d1", "admin1")
	if err == nil {
		t.Fatal("a disabled gateway must refuse to execute")
	}
}

func TestExecute_AlreadyClaimedConflict(t *testing.T) {
	done := pendingDisbursement()
	done.Status = store.DisbursementCompleted
	st := &fakeDisbStore{claim: nil, byID: map[string]*store.Disbursement{"d1": done}}
	svc := newDisbSvc(st, &fakeIris{enabled: true})
	_, err := svc.Execute(context.Background(), "d1", "admin1")
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Code != "CONFLICT" {
		t.Fatalf("want CONFLICT, got %v", err)
	}
}

func TestExecute_NotFound(t *testing.T) {
	st := &fakeDisbStore{claim: nil, byID: map[string]*store.Disbursement{}}
	svc := newDisbSvc(st, &fakeIris{enabled: true})
	_, err := svc.Execute(context.Background(), "missing", "admin1")
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Code != "NOT_FOUND" {
		t.Fatalf("want NOT_FOUND, got %v", err)
	}
}

// A definitive rejection is Iris saying it created nothing. That, and only
// that, returns the payout to the set ClaimForExecution can pick up again.
func TestExecute_DefinitiveRejectionMarksFailed(t *testing.T) {
	d := pendingDisbursement()
	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{
		enabled:   true,
		createErr: &iris.PayoutRejectedError{Status: 400, Message: "insufficient balance"},
	}
	svc := newDisbSvc(st, ir)

	if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
		t.Fatal("a create rejection must surface as an error")
	}
	if len(st.failed) != 1 {
		t.Fatalf("a definitive rejection must mark the row failed, got %v", st.failed)
	}
	if len(st.ambiguous) != 0 {
		t.Fatalf("a definitive rejection is not ambiguous, got %v", st.ambiguous)
	}
	if st.failedRef != nil {
		t.Fatal("no reference exists yet on a create rejection")
	}
}

/*
The no-double-pay case (M2).

A create that times out may have reached Iris and produced a payout. Marking
such a row 'failed' puts it back in ClaimForExecution's claimable set
(status IN ('pending','failed')), and the next execute POSTs a second payout for
the same milestone - Midtrans honours X-Idempotency-Key for five minutes only,
so the retry is not deduplicated. The row must stay queued instead.
*/
func TestExecute_AmbiguousCreateIsNotMarkedRetryable(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"client timeout", &iris.AmbiguousError{Op: "create payout", Err: context.DeadlineExceeded}},
		{"gateway 502", &iris.AmbiguousError{Op: "create payout", Status: 502, Err: errors.New("bad gateway")}},
		{"connection reset", &iris.AmbiguousError{Op: "create payout", Err: errors.New("connection reset by peer")}},
		{"200 with an unreadable body", &iris.AmbiguousError{Op: "create payout", Status: 200, Err: errors.New("unexpected EOF")}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := pendingDisbursement()
			st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
			ir := &fakeIris{enabled: true, createErr: tc.err}
			svc := newDisbSvc(st, ir)

			if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
				t.Fatal("an unresolved create must surface as an error")
			}
			if len(st.failed) != 0 {
				t.Fatalf("an unresolved create must not be marked failed (it becomes claimable): %v", st.failed)
			}
			if len(st.ambiguous) != 1 {
				t.Fatalf("an unresolved create must be recorded as ambiguous, got %v", st.ambiguous)
			}
			if len(ir.created) != 1 {
				t.Fatalf("the payout must not be created again in the same call: %d creates", len(ir.created))
			}
		})
	}
}

// M3: a row that already carries a reference has a payout at the gateway. The
// retry must resume it, never create a second one. This is the approve-retry
// path, where a failed approve left the reference behind.
func TestExecute_RetryWithReferenceResumesInsteadOfCreating(t *testing.T) {
	ref := "REF-EXISTING"
	d := pendingDisbursement()
	d.Status = store.DisbursementFailed
	d.IrisReferenceNo = &ref

	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{
		enabled:   true,
		statusRes: &iris.PayoutStatus{ReferenceNo: ref, Status: iris.PayoutQueued},
		createRes: &iris.PayoutResult{ReferenceNo: "REF-SECOND"},
	}
	svc := newDisbSvc(st, ir)

	if _, err := svc.Execute(context.Background(), "d1", "admin1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ir.created) != 0 {
		t.Fatalf("a payout with an existing reference must never be created again: %+v", ir.created)
	}
	if len(ir.statusOf) != 1 || ir.statusOf[0] != ref {
		t.Fatalf("the existing payout's status must be read first, got %v", ir.statusOf)
	}
	if len(ir.approved) != 1 || ir.approved[0][0] != ref {
		t.Fatalf("the EXISTING reference must be the one approved, got %v", ir.approved)
	}
	if len(st.executedTo) != 1 || st.executedTo[0] != ref {
		t.Fatalf("the existing reference must be the one recorded, got %v", st.executedTo)
	}
}

// A reference we stored that Iris cannot find is a contradiction. Creating
// again to "fix" it is exactly the double-pay, so the row is held instead.
func TestExecute_UnreadableResumeStatusCreatesNothing(t *testing.T) {
	ref := "REF-EXISTING"
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"iris does not know the reference", iris.ErrPayoutNotFound},
		{"status call timed out", &iris.AmbiguousError{Op: "get payout", Err: context.DeadlineExceeded}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := pendingDisbursement()
			d.Status = store.DisbursementFailed
			d.IrisReferenceNo = &ref
			st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
			ir := &fakeIris{enabled: true, statusErr: tc.err, createRes: &iris.PayoutResult{ReferenceNo: "REF-SECOND"}}
			svc := newDisbSvc(st, ir)

			if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
				t.Fatal("an unresolvable resume must surface as an error")
			}
			if len(ir.created) != 0 {
				t.Fatalf("nothing may be created when the existing payout's state is unknown: %+v", ir.created)
			}
			if len(st.failed) != 0 {
				t.Fatalf("the row must not become claimable again: %v", st.failed)
			}
			if len(st.ambiguous) != 1 {
				t.Fatalf("the row must be held with the reason recorded, got %v", st.ambiguous)
			}
		})
	}
}

// The reference must be durable before approval is attempted: it is the only
// handle on a payout that already exists at the gateway.
func TestExecute_RecordsReferenceBeforeApproving(t *testing.T) {
	d := pendingDisbursement()
	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{
		enabled:    true,
		createRes:  &iris.PayoutResult{ReferenceNo: "REF-7"},
		approveErr: errors.New("otp rejected"),
	}
	svc := newDisbSvc(st, ir)

	if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
		t.Fatal("an approve failure must surface as an error")
	}
	if len(st.executedTo) != 1 || st.executedTo[0] != "REF-7" {
		t.Fatalf("the reference must be recorded before approval, got %v", st.executedTo)
	}
	if st.failedRef == nil || *st.failedRef != "REF-7" {
		t.Fatalf("the failure must keep the reference, got %v", st.failedRef)
	}
}

// Iris's four payout words map onto the enum one for one; anything else is
// refused rather than filed as a success or a failure.
func TestSettleByReference_RejectsUnusableInput(t *testing.T) {
	svc := newDisbSvc(&fakeDisbStore{}, &fakeIris{enabled: true})

	for _, tc := range []struct{ name, ref, status string }{
		{"no reference", "", iris.PayoutCompleted},
		{"unknown status", "REF-1", "reversed"},
		{"empty status", "REF-1", ""},
		{"a status that is not a payout state", "REF-1", "settlement"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.SettleByReference(context.Background(), tc.ref, tc.status, "")
			var appErr *AppError
			if !errors.As(err, &appErr) || appErr.Code != "VALIDATION_ERROR" {
				t.Fatalf("want VALIDATION_ERROR, got %v", err)
			}
		})
	}
}

// The notified amount is cross-checked and reported, never enforced: the payout
// has already happened at the bank, and refusing the notification would only
// make Midtrans retry it forever for a payout that really did settle.
func TestCheckNotifiedAmount(t *testing.T) {
	d := pendingDisbursement() // 3_575_000
	st := &fakeDisbStore{byRef: map[string]*store.Disbursement{"REF-1": d}}
	svc := newDisbSvc(st, &fakeIris{enabled: true})

	cases := []struct {
		name, ref, reported string
		wantErr             bool
	}{
		{"matches with a decimal tail", "REF-1", "3575000.0", false},
		{"matches without a tail", "REF-1", "3575000", false},
		{"diverges", "REF-1", "999999.0", true},
		{"unreadable", "REF-1", "not-a-number", true},
		// An unknown reference is the settlement's 404 to report, not this
		// check's, so it stays quiet rather than raising twice.
		{"unknown reference", "REF-MISSING", "3575000.0", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.CheckNotifiedAmount(context.Background(), tc.ref, tc.reported)
			if (err != nil) != tc.wantErr {
				t.Fatalf("CheckNotifiedAmount = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// The rank is what makes a redelivered or out-of-order notification harmless.
// Nothing may move a payout out of a settled state: that is the walk-back that
// makes a paid row claimable again.
func TestPayoutRank_SettledIsTerminal(t *testing.T) {
	cases := []struct {
		name            string
		current, next   string
		wantAdvancement bool
	}{
		{"queued to completed", store.DisbursementQueued, store.DisbursementCompleted, true},
		{"queued to processed", store.DisbursementQueued, store.DisbursementProcessed, true},
		{"processed to completed", store.DisbursementProcessed, store.DisbursementCompleted, true},
		{"queued to failed", store.DisbursementQueued, store.DisbursementFailed, true},
		{"failed to completed", store.DisbursementFailed, store.DisbursementCompleted, true},
		{"completed redelivered", store.DisbursementCompleted, store.DisbursementCompleted, false},
		{"completed back to processed", store.DisbursementCompleted, store.DisbursementProcessed, false},
		{"completed back to failed", store.DisbursementCompleted, store.DisbursementFailed, false},
		{"processed back to failed", store.DisbursementProcessed, store.DisbursementFailed, false},
		{"processed back to queued", store.DisbursementProcessed, store.DisbursementQueued, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := payoutRank(tc.next) > payoutRank(tc.current)
			if got != tc.wantAdvancement {
				t.Fatalf("%s -> %s advances = %v, want %v", tc.current, tc.next, got, tc.wantAdvancement)
			}
		})
	}
}

func TestExecute_ApproveFailureKeepsReference(t *testing.T) {
	d := pendingDisbursement()
	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{enabled: true, createRes: &iris.PayoutResult{ReferenceNo: "REF-9"}, approveErr: errors.New("otp")}
	svc := newDisbSvc(st, ir)

	if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
		t.Fatal("an approve failure must surface as an error")
	}
	if st.failedRef == nil || *st.failedRef != "REF-9" {
		t.Fatalf("approve failure must keep the reference for later reconciliation, got %v", st.failedRef)
	}
}

func TestList_RejectsUnknownStatus(t *testing.T) {
	svc := newDisbSvc(&fakeDisbStore{}, &fakeIris{})
	if _, err := svc.List(context.Background(), "bogus", 10); err == nil {
		t.Fatal("an unknown status must be rejected")
	}
}

func TestList_DelegatesKnownStatus(t *testing.T) {
	st := &fakeDisbStore{listResult: []store.Disbursement{*pendingDisbursement()}}
	svc := newDisbSvc(st, &fakeIris{})
	out, err := svc.List(context.Background(), store.DisbursementPending, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) != 1 || st.listStatus != store.DisbursementPending {
		t.Fatalf("list did not delegate the status, got %q len %d", st.listStatus, len(out))
	}
}

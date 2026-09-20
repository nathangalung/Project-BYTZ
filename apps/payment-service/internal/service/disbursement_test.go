package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/store"
)

type fakeDisbStore struct {
	account    *store.TalentPayoutAccount
	accountErr error
	inserted   []store.EnqueueDisbursementInput
	byID       map[string]*store.Disbursement
	claim      *store.Disbursement
	claimErr   error
	executed   []string
	failed     []string
	failedRef  *string
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
func (f *fakeDisbStore) MarkExecuted(_ context.Context, id, _, _ string) error {
	f.executed = append(f.executed, id)
	return nil
}
func (f *fakeDisbStore) MarkFailed(_ context.Context, id, reason string, ref *string) error {
	f.failed = append(f.failed, id+":"+reason)
	f.failedRef = ref
	return nil
}
func (f *fakeDisbStore) ListByStatus(_ context.Context, status string, _ int) ([]store.Disbursement, error) {
	f.listStatus = status
	return f.listResult, nil
}

type fakeIris struct {
	enabled    bool
	createRes  *iris.PayoutResult
	createErr  error
	approveErr error
	created    []iris.PayoutRequest
	approved   [][]string
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

func verifiedAccount() *store.TalentPayoutAccount {
	return &store.TalentPayoutAccount{Provider: "bca", Account: "123", HolderName: "Budi", Verified: true}
}

func TestEnqueueOnReleaseTx_VerifiedInserts(t *testing.T) {
	st := &fakeDisbStore{account: verifiedAccount()}
	svc := NewDisbursementService(st, &fakeIris{}, "")
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
	svc := NewDisbursementService(st, &fakeIris{}, "")
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
	svc := NewDisbursementService(st, &fakeIris{}, "")
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
	svc := NewDisbursementService(st, &fakeIris{}, "")
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
	svc := NewDisbursementService(st, &fakeIris{}, "")
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
	svc := NewDisbursementService(st, ir, "")

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
	svc := NewDisbursementService(&fakeDisbStore{}, &fakeIris{enabled: false}, "")
	_, err := svc.Execute(context.Background(), "d1", "admin1")
	if err == nil {
		t.Fatal("a disabled gateway must refuse to execute")
	}
}

func TestExecute_AlreadyClaimedConflict(t *testing.T) {
	done := pendingDisbursement()
	done.Status = store.DisbursementCompleted
	st := &fakeDisbStore{claim: nil, byID: map[string]*store.Disbursement{"d1": done}}
	svc := NewDisbursementService(st, &fakeIris{enabled: true}, "")
	_, err := svc.Execute(context.Background(), "d1", "admin1")
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Code != "CONFLICT" {
		t.Fatalf("want CONFLICT, got %v", err)
	}
}

func TestExecute_NotFound(t *testing.T) {
	st := &fakeDisbStore{claim: nil, byID: map[string]*store.Disbursement{}}
	svc := NewDisbursementService(st, &fakeIris{enabled: true}, "")
	_, err := svc.Execute(context.Background(), "missing", "admin1")
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Code != "NOT_FOUND" {
		t.Fatalf("want NOT_FOUND, got %v", err)
	}
}

func TestExecute_CreateFailureMarksFailed(t *testing.T) {
	d := pendingDisbursement()
	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{enabled: true, createErr: errors.New("insufficient balance")}
	svc := NewDisbursementService(st, ir, "")

	if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
		t.Fatal("a create failure must surface as an error")
	}
	if len(st.failed) != 1 {
		t.Fatal("a create failure must mark the row failed")
	}
	if st.failedRef != nil {
		t.Fatal("no reference exists yet on a create failure")
	}
}

func TestExecute_ApproveFailureKeepsReference(t *testing.T) {
	d := pendingDisbursement()
	st := &fakeDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}}
	ir := &fakeIris{enabled: true, createRes: &iris.PayoutResult{ReferenceNo: "REF-9"}, approveErr: errors.New("otp")}
	svc := NewDisbursementService(st, ir, "")

	if _, err := svc.Execute(context.Background(), "d1", "admin1"); err == nil {
		t.Fatal("an approve failure must surface as an error")
	}
	if st.failedRef == nil || *st.failedRef != "REF-9" {
		t.Fatalf("approve failure must keep the reference for later reconciliation, got %v", st.failedRef)
	}
}

func TestList_RejectsUnknownStatus(t *testing.T) {
	svc := NewDisbursementService(&fakeDisbStore{}, &fakeIris{}, "")
	if _, err := svc.List(context.Background(), "bogus", 10); err == nil {
		t.Fatal("an unknown status must be rejected")
	}
}

func TestList_DelegatesKnownStatus(t *testing.T) {
	st := &fakeDisbStore{listResult: []store.Disbursement{*pendingDisbursement()}}
	svc := NewDisbursementService(st, &fakeIris{}, "")
	out, err := svc.List(context.Background(), store.DisbursementPending, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) != 1 || st.listStatus != store.DisbursementPending {
		t.Fatalf("list did not delegate the status, got %q len %d", st.listStatus, len(out))
	}
}

package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var errBoom = errors.New("boom")

// assertAppError checks the structured error a handler will map to a status
// code. Asserting only that an error occurred would pass on the wrong refusal.
func assertAppError(t *testing.T, err error, wantCode string, wantStatus int) *AppError {
	t.Helper()
	if err == nil {
		t.Fatalf("expected a %s error, got nil", wantCode)
	}
	var appErr *AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error is %T (%v), want *AppError", err, err)
	}
	if appErr.Code != wantCode {
		t.Errorf("code = %q, want %q", appErr.Code, wantCode)
	}
	if appErr.StatusCode != wantStatus {
		t.Errorf("status = %d, want %d", appErr.StatusCode, wantStatus)
	}
	return appErr
}

// --- release ---

// releaseFixture wires a release that succeeds, so each test can break exactly
// one thing.
type releaseFixture struct {
	txn      *store.MockTransactionStore
	ledger   *store.MockLedgerStore
	dbTx     *store.MockTx
	postings [][]store.LedgerEntryInput
	outbox   []string
	commits  int
}

func newReleaseFixture() *releaseFixture {
	f := &releaseFixture{}
	f.dbTx = &store.MockTx{
		CommitFn: func(context.Context) error { f.commits++; return nil },
		ExecFn: func(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
			if len(args) > 3 {
				f.outbox = append(f.outbox, fmt.Sprint(args[3]))
			}
			return pgconn.NewCommandTag("INSERT 0 1"), nil
		},
	}
	now := time.Now().UTC()
	f.txn = &store.MockTransactionStore{
		GetMilestonePricingFn: projectPricingFn(fixtureProjectPrice, fixtureProjectPayout),
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-rel", ProjectID: in.ProjectID, Amount: in.Amount, Status: store.TxStatusPending, CreatedAt: now, UpdatedAt: now},
				IsNew:       true,
			}, nil
		},
		UpdateStatusTxFn: func(_ context.Context, _ pgx.Tx, id, status string) (*store.Transaction, error) {
			return &store.Transaction{ID: id, Status: status}, nil
		},
		CreateEventTxFn: func(context.Context, pgx.Tx, store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
	f.ledger = &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) { return f.dbTx, nil }}
		},
		FindAccountByOwnerTxFn: func(context.Context, pgx.Tx, string, *string) (*store.Account, error) {
			return &store.Account{ID: "acct-escrow", Balance: 1_000_000}, nil
		},
		GetOrCreateAccountTxFn: func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-" + in.OwnerType}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, e []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			f.postings = append(f.postings, e)
			return []store.LedgerEntry{}, nil
		},
	}
	return f
}

func (f *releaseFixture) svc() *PaymentService {
	return NewPaymentService(f.txn, f.ledger, "", "")
}

func releaseInput() ReleaseEscrowInput {
	return ReleaseEscrowInput{
		MilestoneID: "ms-1", ProjectID: "p-1", TalentID: "t-1",
		Amount: fixtureReleaseAmount, FeeAmount: fixtureReleaseFee,
		PerformedBy: "owner-1", IdempotencyKey: "k-rel-1",
	}
}

/*
The fee is re-derived from the stored project split and the caller's figure has
to equal it exactly. A range check would accept the zero fee project-service
falls back to on anomalous pricing, which releases the whole milestone to the
talent and earns the platform nothing.
*/
func TestReleaseEscrow_AcceptsOnlyTheFeeTheBracketYields(t *testing.T) {
	tests := []struct {
		name    string
		fee     int64
		wantErr bool
	}{
		{name: "the exact bracket fee", fee: fixtureReleaseFee},
		{name: "no fee at all", fee: 0, wantErr: true},
		{name: "one rupiah under", fee: fixtureReleaseFee - 1, wantErr: true},
		{name: "one rupiah over", fee: fixtureReleaseFee + 1, wantErr: true},
		{name: "the whole milestone claimed as fee", fee: fixtureReleaseAmount, wantErr: true},
		{name: "a negative fee, inflating the talent payout", fee: -1_000, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newReleaseFixture()
			in := releaseInput()
			in.FeeAmount = tt.fee

			_, err := f.svc().ReleaseEscrow(context.Background(), in)

			if tt.wantErr {
				assertAppError(t, err, "VALIDATION_ERROR", 400)
				if len(f.postings) != 0 {
					t.Errorf("a rejected fee still wrote %d ledger postings", len(f.postings))
				}
				if f.commits != 0 {
					t.Error("a rejected release still committed")
				}
				return
			}
			if err != nil {
				t.Fatalf("the bracket fee was refused: %v", err)
			}
			if len(f.postings) != 1 {
				t.Fatalf("wrote %d postings, want 1", len(f.postings))
			}
		})
	}
}

// The three legs of a release: gross out of escrow, the talent share in, the
// platform fee recognised as revenue. They must balance, and the talent must
// receive exactly the difference.
func TestReleaseEscrow_SplitsGrossIntoTalentShareAndPlatformFee(t *testing.T) {
	f := newReleaseFixture()

	txn, err := f.svc().ReleaseEscrow(context.Background(), releaseInput())
	if err != nil {
		t.Fatalf("ReleaseEscrow: %v", err)
	}
	if txn.Status != store.TxStatusCompleted {
		t.Errorf("status = %q, want completed", txn.Status)
	}
	if len(f.postings) != 1 {
		t.Fatalf("wrote %d postings, want 1", len(f.postings))
	}

	byAccount := map[string]int64{}
	var debit, credit int64
	for _, e := range f.postings[0] {
		byAccount[e.AccountID] += e.Amount
		if e.EntryType == store.EntryDebit {
			debit += e.Amount
		} else {
			credit += e.Amount
		}
	}
	if debit != credit {
		t.Errorf("release posting is unbalanced: debit=%d credit=%d", debit, credit)
	}
	if got := byAccount["acct-escrow"]; got != fixtureReleaseAmount {
		t.Errorf("escrow gave up %d, want the gross %d", got, fixtureReleaseAmount)
	}
	wantTalent := fixtureReleaseAmount - fixtureReleaseFee
	if got := byAccount["acct-talent"]; got != wantTalent {
		t.Errorf("talent received %d, want %d", got, wantTalent)
	}
	if got := byAccount["acct-platform"]; got != fixtureReleaseFee {
		t.Errorf("platform earned %d, want %d", got, fixtureReleaseFee)
	}
	if len(f.outbox) != 1 || f.outbox[0] != "payment.released" {
		t.Errorf("published %v, want [payment.released]", f.outbox)
	}
}

// A zero-fee bracket would post only two legs; the platform account must not
// be opened, because a zero-amount entry is rejected by the ledger writer.
func TestReleaseEscrow_ZeroFeeBracketPostsNoRevenueLeg(t *testing.T) {
	f := newReleaseFixture()
	// A project whose payout is its whole price yields no platform fee.
	f.txn.GetMilestonePricingFn = projectPricingFn(1_000_000, 815_000)

	platformOpened := false
	f.ledger.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
		if in.OwnerType == store.OwnerPlatform {
			platformOpened = true
		}
		return &store.Account{ID: "acct-" + in.OwnerType}, nil
	}

	in := releaseInput()
	in.Amount = 1 // a one rupiah slice brackets to a zero fee
	in.FeeAmount = 0
	if _, err := f.svc().ReleaseEscrow(context.Background(), in); err != nil {
		t.Fatalf("ReleaseEscrow: %v", err)
	}
	if platformOpened {
		t.Error("a zero fee still opened the platform revenue account")
	}
	if len(f.postings[0]) != 2 {
		t.Errorf("posted %d legs, want 2", len(f.postings[0]))
	}
}

func TestReleaseEscrow_RefusesUnpricedMilestones(t *testing.T) {
	price, payout := fixtureProjectPrice, fixtureProjectPayout
	pkgAmount := int64(200_000)

	tests := []struct {
		name    string
		pricing func(context.Context, string, string) (*store.MilestonePricing, error)
		amount  int64
		fee     int64
		wantErr string
	}{
		{
			name:    "pricing lookup fails",
			pricing: func(context.Context, string, string) (*store.MilestonePricing, error) { return nil, errBoom },
			amount:  fixtureReleaseAmount, fee: fixtureReleaseFee,
			wantErr: "",
		},
		{
			name:    "milestone has no pricing row",
			pricing: func(context.Context, string, string) (*store.MilestonePricing, error) { return nil, nil },
			amount:  fixtureReleaseAmount, fee: fixtureReleaseFee,
			wantErr: "milestone has no pricing to derive the platform fee from",
		},
		{
			name: "project carries no pricing at all",
			pricing: func(context.Context, string, string) (*store.MilestonePricing, error) {
				return &store.MilestonePricing{}, nil
			},
			amount: fixtureReleaseAmount, fee: fixtureReleaseFee,
			wantErr: "milestone has no pricing to derive the platform fee from",
		},
		{
			// Nothing else re-reads these columns after the PRD is priced, so a
			// payout belonging to no bracket would otherwise flow into every
			// milestone the project settles.
			name: "stored payout does not match its bracket",
			pricing: func(context.Context, string, string) (*store.MilestonePricing, error) {
				bad := int64(950_000)
				return &store.MilestonePricing{ProjectPrice: &price, ProjectPayout: &bad}, nil
			},
			amount: fixtureReleaseAmount, fee: fixtureReleaseFee,
			wantErr: "project payout does not match the platform fee bracket",
		},
		{
			name: "work package pricing yields an implausible fee",
			pricing: func(context.Context, string, string) (*store.MilestonePricing, error) {
				zero := int64(0)
				return &store.MilestonePricing{
					PackageAmount: &pkgAmount, PackagePayout: &zero,
					ProjectPrice: &price, ProjectPayout: &payout,
				}, nil
			},
			amount: fixtureReleaseAmount, fee: fixtureReleaseFee,
			wantErr: "milestone pricing does not yield a valid platform fee",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newReleaseFixture()
			f.txn.GetMilestonePricingFn = tt.pricing
			in := releaseInput()
			in.Amount, in.FeeAmount = tt.amount, tt.fee

			_, err := f.svc().ReleaseEscrow(context.Background(), in)
			if err == nil {
				t.Fatal("an unpriced milestone was released")
			}
			if tt.wantErr == "" {
				// A lookup failure is an infrastructure error, not a 400.
				var appErr *AppError
				if errors.As(err, &appErr) {
					t.Errorf("lookup failure surfaced as %s, want a plain error", appErr.Code)
				}
			} else {
				appErr := assertAppError(t, err, "VALIDATION_ERROR", 400)
				if appErr.Message != tt.wantErr {
					t.Errorf("message = %q, want %q", appErr.Message, tt.wantErr)
				}
			}
			if len(f.postings) != 0 {
				t.Error("an unpriced milestone still wrote ledger entries")
			}
		})
	}
}

// The work package split is what a team project's milestones price from; the
// project totals are only the fallback for a milestone with no package.
func TestReleaseEscrow_PrefersTheWorkPackageSplit(t *testing.T) {
	price, payout := fixtureProjectPrice, fixtureProjectPayout
	pkgAmount, pkgPayout := int64(200_000), int64(100_000)

	f := newReleaseFixture()
	f.txn.GetMilestonePricingFn = func(context.Context, string, string) (*store.MilestonePricing, error) {
		return &store.MilestonePricing{
			PackageAmount: &pkgAmount, PackagePayout: &pkgPayout,
			ProjectPrice: &price, ProjectPayout: &payout,
		}, nil
	}

	in := releaseInput()
	in.Amount = 50_000
	// Half the package goes to the talent, so half the milestone is fee. The
	// project bracket would have said 9,250.
	in.FeeAmount = 25_000

	if _, err := f.svc().ReleaseEscrow(context.Background(), in); err != nil {
		t.Fatalf("the work package split was not used: %v", err)
	}
}

// A milestone that names a work package draws from that package's pool, not
// the project pool, so one talent's approvals cannot reach another's escrow.
func TestReleaseEscrow_DrawsFromTheMilestonesOwnPool(t *testing.T) {
	tests := []struct {
		name          string
		workPackageID *string
		wantOwner     string
	}{
		{name: "milestone on a work package", workPackageID: ptr("wp-7"), wantOwner: "wp-7"},
		{name: "integration milestone falls back to the project", workPackageID: nil, wantOwner: "p-1"},
		{name: "empty work package id falls back to the project", workPackageID: ptr(""), wantOwner: "p-1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newReleaseFixture()
			f.txn.GetMilestoneWorkPackageIDFn = func(context.Context, string, string) (*string, error) {
				return tt.workPackageID, nil
			}
			var lookedUp string
			f.ledger.FindAccountByOwnerTxFn = func(_ context.Context, _ pgx.Tx, _ string, ownerID *string) (*store.Account, error) {
				if ownerID != nil {
					lookedUp = *ownerID
				}
				return &store.Account{ID: "acct-escrow", Balance: 1_000_000}, nil
			}
			var createdWith *string
			f.txn.CreateFn = func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
				createdWith = in.WorkPackageID
				return &store.CreateResult{Transaction: store.Transaction{ID: "txn-rel", Status: store.TxStatusPending}, IsNew: true}, nil
			}

			if _, err := f.svc().ReleaseEscrow(context.Background(), releaseInput()); err != nil {
				t.Fatalf("ReleaseEscrow: %v", err)
			}
			if lookedUp != tt.wantOwner {
				t.Errorf("drew from escrow owner %q, want %q", lookedUp, tt.wantOwner)
			}
			// The project level fallback must not be recorded as a work
			// package id, or the refund path would scope to a package that
			// does not exist.
			if tt.wantOwner == "p-1" && createdWith != nil {
				t.Errorf("transaction recorded work package %q for a project level release", *createdWith)
			}
			if tt.wantOwner != "p-1" && (createdWith == nil || *createdWith != tt.wantOwner) {
				t.Errorf("transaction work package = %v, want %q", createdWith, tt.wantOwner)
			}
		})
	}
}

// A release whose key was already spent by a settled attempt returns that
// settlement; one that never settled is resumed, and the locked re-read
// decides which.
func TestReleaseEscrow_IdempotencyDependsOnWhetherTheEarlierAttemptSettled(t *testing.T) {
	tests := []struct {
		name         string
		storedStatus string
		lockedStatus string
		lockErr      error
		wantPostings int
		wantStatus   string
		wantErr      bool
	}{
		{name: "settled attempt is returned untouched", storedStatus: store.TxStatusCompleted, wantStatus: store.TxStatusCompleted},
		{name: "refunded attempt is returned untouched", storedStatus: store.TxStatusRefunded, wantStatus: store.TxStatusRefunded},
		{
			name: "pending attempt is resumed", storedStatus: store.TxStatusPending,
			lockedStatus: store.TxStatusPending, wantPostings: 1, wantStatus: store.TxStatusCompleted,
		},
		{
			// The other delivery settled between the read and the lock.
			name: "a racing attempt that settled first wins", storedStatus: store.TxStatusPending,
			lockedStatus: store.TxStatusCompleted, wantStatus: store.TxStatusCompleted,
		},
		{
			name: "lock failure aborts rather than paying twice", storedStatus: store.TxStatusPending,
			lockErr: errBoom, wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newReleaseFixture()
			f.txn.CreateFn = func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
				return &store.CreateResult{
					Transaction: store.Transaction{ID: "txn-rel", Status: tt.storedStatus},
					IsNew:       false,
				}, nil
			}
			f.txn.LockStatusTxFn = func(context.Context, pgx.Tx, string) (string, error) {
				return tt.lockedStatus, tt.lockErr
			}

			txn, err := f.svc().ReleaseEscrow(context.Background(), releaseInput())

			if tt.wantErr {
				if err == nil {
					t.Fatal("a failed lock still released escrow")
				}
				if len(f.postings) != 0 {
					t.Error("wrote ledger entries after a failed lock")
				}
				return
			}
			if err != nil {
				t.Fatalf("ReleaseEscrow: %v", err)
			}
			if txn.Status != tt.wantStatus {
				t.Errorf("status = %q, want %q", txn.Status, tt.wantStatus)
			}
			if len(f.postings) != tt.wantPostings {
				t.Errorf("wrote %d postings, want %d", len(f.postings), tt.wantPostings)
			}
		})
	}
}

func TestReleaseEscrow_RefusesWhatEscrowCannotCover(t *testing.T) {
	tests := []struct {
		name    string
		account *store.Account
		findErr error
		amount  int64
		fee     int64
		wantErr string
	}{
		{name: "no escrow account for the milestone", account: nil, amount: fixtureReleaseAmount, fee: fixtureReleaseFee, wantErr: "PAYMENT_ESCROW_INSUFFICIENT_FUNDS"},
		{name: "balance below the milestone", account: &store.Account{ID: "e", Balance: 1}, amount: fixtureReleaseAmount, fee: fixtureReleaseFee, wantErr: "PAYMENT_ESCROW_INSUFFICIENT_FUNDS"},
		{name: "zero release amount", account: &store.Account{ID: "e", Balance: 1_000_000}, amount: 0, fee: 0, wantErr: "VALIDATION_ERROR"},
		{name: "negative release amount", account: &store.Account{ID: "e", Balance: 1_000_000}, amount: -50_000, fee: 0, wantErr: "VALIDATION_ERROR"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newReleaseFixture()
			f.ledger.FindAccountByOwnerTxFn = func(context.Context, pgx.Tx, string, *string) (*store.Account, error) {
				return tt.account, tt.findErr
			}
			in := releaseInput()
			in.Amount, in.FeeAmount = tt.amount, tt.fee

			_, err := f.svc().ReleaseEscrow(context.Background(), in)
			var appErr *AppError
			if !errors.As(err, &appErr) {
				t.Fatalf("error = %v, want *AppError", err)
			}
			if appErr.Code != tt.wantErr {
				t.Errorf("code = %q, want %q", appErr.Code, tt.wantErr)
			}
			if len(f.postings) != 0 {
				t.Error("wrote ledger entries for a release escrow cannot cover")
			}
		})
	}
}

// Anything failing after the balance check must abort the transaction. A
// committed status flip with no ledger legs reports a talent paid who is not.
func TestReleaseEscrow_AbortsOnAnyStepFailing(t *testing.T) {
	tests := []struct {
		name    string
		arrange func(f *releaseFixture)
	}{
		{name: "work package lookup fails", arrange: func(f *releaseFixture) {
			f.txn.GetMilestoneWorkPackageIDFn = func(context.Context, string, string) (*string, error) { return nil, errBoom }
		}},
		{name: "transaction row cannot be created", arrange: func(f *releaseFixture) {
			f.txn.CreateFn = func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) { return nil, errBoom }
		}},
		{name: "transaction cannot be opened", arrange: func(f *releaseFixture) {
			f.ledger.PoolFn = func() store.PoolIface {
				return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) { return nil, errBoom }}
			}
		}},
		{name: "escrow lookup fails", arrange: func(f *releaseFixture) {
			f.ledger.FindAccountByOwnerTxFn = func(context.Context, pgx.Tx, string, *string) (*store.Account, error) { return nil, errBoom }
		}},
		{name: "talent account cannot be opened", arrange: func(f *releaseFixture) {
			f.ledger.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
				if in.OwnerType == store.OwnerTalent {
					return nil, errBoom
				}
				return &store.Account{ID: "acct-" + in.OwnerType}, nil
			}
		}},
		{name: "platform revenue account cannot be opened", arrange: func(f *releaseFixture) {
			f.ledger.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
				if in.OwnerType == store.OwnerPlatform {
					return nil, errBoom
				}
				return &store.Account{ID: "acct-" + in.OwnerType}, nil
			}
		}},
		{name: "platform revenue account comes back missing", arrange: func(f *releaseFixture) {
			f.ledger.GetOrCreateAccountTxFn = func(_ context.Context, _ pgx.Tx, in store.CreateAccountInput) (*store.Account, error) {
				if in.OwnerType == store.OwnerPlatform {
					return nil, nil
				}
				return &store.Account{ID: "acct-" + in.OwnerType}, nil
			}
		}},
		{name: "ledger entries rejected", arrange: func(f *releaseFixture) {
			f.ledger.CreateLedgerEntriesTxFn = func(context.Context, pgx.Tx, []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
				return nil, errBoom
			}
		}},
		{name: "status update fails", arrange: func(f *releaseFixture) {
			f.txn.UpdateStatusTxFn = func(context.Context, pgx.Tx, string, string) (*store.Transaction, error) { return nil, errBoom }
		}},
		{name: "audit event fails", arrange: func(f *releaseFixture) {
			f.txn.CreateEventTxFn = func(context.Context, pgx.Tx, store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
				return nil, errBoom
			}
		}},
		{name: "outbox insert fails", arrange: func(f *releaseFixture) {
			f.dbTx.ExecFn = func(context.Context, string, ...any) (pgconn.CommandTag, error) {
				return pgconn.CommandTag{}, errBoom
			}
		}},
		{name: "commit fails", arrange: func(f *releaseFixture) {
			f.dbTx.CommitFn = func(context.Context) error { f.commits++; return errBoom }
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newReleaseFixture()
			tt.arrange(f)

			txn, err := f.svc().ReleaseEscrow(context.Background(), releaseInput())
			if err == nil {
				t.Fatalf("a failed release reported success: %+v", txn)
			}
			if txn != nil {
				t.Errorf("returned a transaction alongside the failure: %+v", txn)
			}
		})
	}
}

// --- refund ---

type refundFixture struct {
	txn      *store.MockTransactionStore
	ledger   *store.MockLedgerStore
	dbTx     *store.MockTx
	postings [][]store.LedgerEntryInput
	outbox   []string
	statuses []string
	commits  int
	refunded int64
	funded   int64
}

func newRefundFixture(original *store.Transaction) *refundFixture {
	f := &refundFixture{funded: 100_000_000}
	f.dbTx = &store.MockTx{
		CommitFn: func(context.Context) error { f.commits++; return nil },
		ExecFn: func(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
			if len(args) > 3 {
				f.outbox = append(f.outbox, fmt.Sprint(args[3]))
			}
			return pgconn.NewCommandTag("INSERT 0 1"), nil
		},
		QueryRowFn: func(context.Context, string, ...any) pgx.Row {
			return &store.MockRow{ScanFn: func(dest ...any) error {
				*(dest[0].(*int64)) = f.refunded
				*(dest[1].(*int64)) = f.funded
				return nil
			}}
		},
	}
	f.txn = &store.MockTransactionStore{
		FindByIDFn: func(context.Context, string) (*store.Transaction, error) { return original, nil },
		CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{
				Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: store.TxStatusPending},
				IsNew:       true,
			}, nil
		},
		UpdateStatusTxFn: func(_ context.Context, _ pgx.Tx, id, status string) (*store.Transaction, error) {
			f.statuses = append(f.statuses, id+"="+status)
			return &store.Transaction{ID: id, Status: status}, nil
		},
		CreateEventTxFn: func(context.Context, pgx.Tx, store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
			return &store.TransactionEvent{ID: "ev-1"}, nil
		},
	}
	f.ledger = &store.MockLedgerStore{
		PoolFn: func() store.PoolIface {
			return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) { return f.dbTx, nil }}
		},
		FindEscrowAccountsFn: func(context.Context, string) ([]store.Account, error) {
			return []store.Account{{ID: "acct-escrow", Balance: 100_000_000}}, nil
		},
		FindAccountByOwnerTxFn: func(context.Context, pgx.Tx, string, *string) (*store.Account, error) {
			return &store.Account{ID: "acct-escrow-wp", Balance: 100_000_000}, nil
		},
		GetOrCreateAccountTxFn: func(context.Context, pgx.Tx, store.CreateAccountInput) (*store.Account, error) {
			return &store.Account{ID: "acct-owner"}, nil
		},
		CreateLedgerEntriesTxFn: func(_ context.Context, _ pgx.Tx, e []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
			f.postings = append(f.postings, e)
			return []store.LedgerEntry{}, nil
		},
	}
	return f
}

func (f *refundFixture) svc() *PaymentService { return NewPaymentService(f.txn, f.ledger, "", "") }

func completedDeposit(amount int64) *store.Transaction {
	return &store.Transaction{
		ID: "orig-1", ProjectID: "p-1", Amount: amount,
		Status: store.TxStatusCompleted, Type: store.TxTypeEscrowIn,
	}
}

// A refund the size of the deposit is full and marks the original refunded;
// anything smaller is partial and leaves the original alone, so the rest stays
// refundable.
func TestProcessRefund_SizesAgainstTheOriginalDeposit(t *testing.T) {
	tests := []struct {
		name         string
		amount       int64
		wantType     string
		wantEvent    string
		wantOriginal bool
		wantErrCode  string
	}{
		{name: "full refund", amount: 10_000_000, wantType: store.TxTypeRefund, wantEvent: "payment.refunded", wantOriginal: true},
		{name: "partial refund", amount: 4_000_000, wantType: store.TxTypePartialRefund, wantEvent: "payment.partial_refund"},
		{name: "one rupiah short of full is still partial", amount: 9_999_999, wantType: store.TxTypePartialRefund, wantEvent: "payment.partial_refund"},
		{name: "more than the deposit", amount: 10_000_001, wantErrCode: "VALIDATION_ERROR"},
		{name: "zero", amount: 0, wantErrCode: "VALIDATION_ERROR"},
		{name: "negative", amount: -1, wantErrCode: "VALIDATION_ERROR"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newRefundFixture(completedDeposit(10_000_000))
			var createdType string
			f.txn.CreateFn = func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
				createdType = in.Type
				return &store.CreateResult{
					Transaction: store.Transaction{ID: "txn-refund", ProjectID: in.ProjectID, Amount: in.Amount, Status: store.TxStatusPending},
					IsNew:       true,
				}, nil
			}

			_, err := f.svc().ProcessRefund(context.Background(), refundInput(tt.amount))

			if tt.wantErrCode != "" {
				assertAppError(t, err, tt.wantErrCode, 400)
				if len(f.postings) != 0 {
					t.Error("a rejected refund still wrote ledger entries")
				}
				return
			}
			if err != nil {
				t.Fatalf("ProcessRefund: %v", err)
			}
			if createdType != tt.wantType {
				t.Errorf("transaction type = %q, want %q", createdType, tt.wantType)
			}
			if len(f.outbox) != 1 || f.outbox[0] != tt.wantEvent {
				t.Errorf("published %v, want [%s]", f.outbox, tt.wantEvent)
			}
			markedOriginal := false
			for _, s := range f.statuses {
				if s == "orig-1="+store.TxStatusRefunded {
					markedOriginal = true
				}
			}
			if markedOriginal != tt.wantOriginal {
				t.Errorf("original marked refunded = %v, want %v", markedOriginal, tt.wantOriginal)
			}
		})
	}
}

/*
A project-wide refund draws the pools down fullest first, so it empties the
largest work package before touching smaller ones a talent may still be working
against. The draws must sum to exactly the refund, and each pool must give up
no more than it holds.
*/
func TestProcessRefund_SpreadsAcrossPoolsFullestFirst(t *testing.T) {
	tests := []struct {
		name      string
		balances  []int64
		amount    int64
		wantDraws []int64
		wantErr   bool
	}{
		{name: "one pool covers it", balances: []int64{10_000_000}, amount: 4_000_000, wantDraws: []int64{4_000_000}},
		{name: "spills into the second pool", balances: []int64{6_000_000, 4_000_000}, amount: 9_000_000, wantDraws: []int64{6_000_000, 3_000_000}},
		{name: "drains every pool exactly", balances: []int64{6_000_000, 4_000_000}, amount: 10_000_000, wantDraws: []int64{6_000_000, 4_000_000}},
		{name: "skips an empty pool", balances: []int64{5_000_000, 0, 5_000_000}, amount: 7_000_000, wantDraws: []int64{5_000_000, 2_000_000}},
		{name: "a negative pool is not treated as available", balances: []int64{-1_000_000, 5_000_000}, amount: 5_000_000, wantDraws: []int64{5_000_000}},
		{name: "more than every pool holds", balances: []int64{6_000_000, 3_000_000}, amount: 10_000_000, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newRefundFixture(completedDeposit(10_000_000))
			accounts := make([]store.Account, len(tt.balances))
			for i, b := range tt.balances {
				accounts[i] = store.Account{ID: fmt.Sprintf("acct-%d", i), Balance: b}
			}
			f.ledger.FindEscrowAccountsFn = func(context.Context, string) ([]store.Account, error) {
				return accounts, nil
			}

			_, err := f.svc().ProcessRefund(context.Background(), refundInput(tt.amount))

			if tt.wantErr {
				assertAppError(t, err, "PAYMENT_ESCROW_INSUFFICIENT_FUNDS", 400)
				if len(f.postings) != 0 {
					t.Error("an over-refund still wrote ledger entries")
				}
				return
			}
			if err != nil {
				t.Fatalf("ProcessRefund: %v", err)
			}
			if len(f.postings) != 1 {
				t.Fatalf("wrote %d postings, want 1", len(f.postings))
			}

			var ownerDebit int64
			var credits []int64
			for _, e := range f.postings[0] {
				if e.EntryType == store.EntryDebit {
					ownerDebit += e.Amount
					continue
				}
				credits = append(credits, e.Amount)
			}
			if ownerDebit != tt.amount {
				t.Errorf("owner received %d, want %d", ownerDebit, tt.amount)
			}
			if len(credits) != len(tt.wantDraws) {
				t.Fatalf("drew from %d pools, want %d (%v)", len(credits), len(tt.wantDraws), credits)
			}
			var total int64
			for i, got := range credits {
				if got != tt.wantDraws[i] {
					t.Errorf("draw %d = %d, want %d", i, got, tt.wantDraws[i])
				}
				total += got
			}
			if total != tt.amount {
				t.Errorf("draws total %d, want %d", total, tt.amount)
			}
		})
	}
}

// A deposit that names a work package refunds that package only. Reaching the
// whole project would take back money quoted to a different talent.
func TestProcessRefund_ScopesToTheWorkPackageTheDepositNames(t *testing.T) {
	tests := []struct {
		name          string
		workPackageID *string
		account       *store.Account
		findErr       error
		wantScoped    bool
		wantErr       bool
	}{
		{name: "scoped to the named package", workPackageID: ptr("wp-3"), account: &store.Account{ID: "acct-wp-3", Balance: 10_000_000}, wantScoped: true},
		{name: "project wide when no package is named", workPackageID: nil, wantScoped: false},
		{name: "empty package id is project wide", workPackageID: ptr(""), wantScoped: false},
		{name: "named package has no escrow account", workPackageID: ptr("wp-3"), account: nil, wantErr: true},
		{name: "package lookup fails", workPackageID: ptr("wp-3"), findErr: errBoom, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := completedDeposit(10_000_000)
			original.WorkPackageID = tt.workPackageID
			f := newRefundFixture(original)

			scopedLookup, projectLookup := false, false
			f.ledger.FindAccountByOwnerTxFn = func(context.Context, pgx.Tx, string, *string) (*store.Account, error) {
				scopedLookup = true
				return tt.account, tt.findErr
			}
			f.ledger.FindEscrowAccountsFn = func(context.Context, string) ([]store.Account, error) {
				projectLookup = true
				return []store.Account{{ID: "acct-project", Balance: 10_000_000}}, nil
			}

			_, err := f.svc().ProcessRefund(context.Background(), refundInput(10_000_000))

			if tt.wantErr {
				if err == nil {
					t.Fatal("a refund with no reachable escrow completed")
				}
				return
			}
			if err != nil {
				t.Fatalf("ProcessRefund: %v", err)
			}
			if scopedLookup != tt.wantScoped || projectLookup == tt.wantScoped {
				t.Errorf("scoped lookup = %v, project lookup = %v; want scoped=%v",
					scopedLookup, projectLookup, tt.wantScoped)
			}
		})
	}
}

// The cap is project-wide on both sides: what has already been refunded
// against what was actually funded. A project funded twice must stay
// refundable for the second deposit.
func TestProcessRefund_CapsAgainstEscrowActuallyFunded(t *testing.T) {
	tests := []struct {
		name      string
		refunded  int64
		funded    int64
		amount    int64
		wantErr   bool
		scanFails bool
	}{
		{name: "first refund on a funded project", refunded: 0, funded: 10_000_000, amount: 10_000_000},
		{name: "second deposit is still refundable", refunded: 10_000_000, funded: 20_000_000, amount: 10_000_000},
		{name: "exactly exhausting the funding", refunded: 9_000_000, funded: 10_000_000, amount: 1_000_000},
		{name: "one rupiah beyond the funding", refunded: 9_000_000, funded: 10_000_000, amount: 1_000_001, wantErr: true},
		{name: "nothing was ever funded", refunded: 0, funded: 0, amount: 1, wantErr: true},
		{name: "the cap query fails", scanFails: true, amount: 1_000_000, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newRefundFixture(completedDeposit(20_000_000))
			f.refunded, f.funded = tt.refunded, tt.funded
			if tt.scanFails {
				f.dbTx.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
					return &store.MockRow{ScanFn: func(...any) error { return errBoom }}
				}
			}

			_, err := f.svc().ProcessRefund(context.Background(), refundInput(tt.amount))

			if tt.wantErr {
				if err == nil {
					t.Fatal("a refund beyond the escrow funded was allowed")
				}
				if len(f.postings) != 0 {
					t.Error("a capped refund still wrote ledger entries")
				}
				return
			}
			if err != nil {
				t.Fatalf("ProcessRefund: %v", err)
			}
		})
	}
}

func TestProcessRefund_IdempotencyDependsOnWhetherTheEarlierAttemptSettled(t *testing.T) {
	tests := []struct {
		name         string
		storedStatus string
		lockedStatus string
		lockErr      error
		wantPostings int
		wantErr      bool
	}{
		{name: "settled refund is returned untouched", storedStatus: store.TxStatusCompleted},
		{name: "refunded attempt is returned untouched", storedStatus: store.TxStatusRefunded},
		{name: "pending attempt is resumed", storedStatus: store.TxStatusPending, lockedStatus: store.TxStatusPending, wantPostings: 1},
		{name: "a racing attempt that settled first wins", storedStatus: store.TxStatusPending, lockedStatus: store.TxStatusCompleted},
		{name: "lock failure aborts rather than refunding twice", storedStatus: store.TxStatusPending, lockErr: errBoom, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newRefundFixture(completedDeposit(10_000_000))
			f.txn.CreateFn = func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
				return &store.CreateResult{
					Transaction: store.Transaction{ID: "txn-refund", Status: tt.storedStatus},
					IsNew:       false,
				}, nil
			}
			f.txn.LockStatusTxFn = func(context.Context, pgx.Tx, string) (string, error) {
				return tt.lockedStatus, tt.lockErr
			}

			_, err := f.svc().ProcessRefund(context.Background(), refundInput(4_000_000))
			if tt.wantErr {
				if err == nil {
					t.Fatal("a failed lock still refunded")
				}
				return
			}
			if err != nil {
				t.Fatalf("ProcessRefund: %v", err)
			}
			if len(f.postings) != tt.wantPostings {
				t.Errorf("wrote %d postings, want %d", len(f.postings), tt.wantPostings)
			}
		})
	}
}

func TestProcessRefund_AbortsOnAnyStepFailing(t *testing.T) {
	tests := []struct {
		name    string
		arrange func(f *refundFixture)
	}{
		{name: "original lookup fails", arrange: func(f *refundFixture) {
			f.txn.FindByIDFn = func(context.Context, string) (*store.Transaction, error) { return nil, errBoom }
		}},
		{name: "refund row cannot be created", arrange: func(f *refundFixture) {
			f.txn.CreateFn = func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) { return nil, errBoom }
		}},
		{name: "transaction cannot be opened", arrange: func(f *refundFixture) {
			f.ledger.PoolFn = func() store.PoolIface {
				return &store.MockPool{BeginTxFn: func(context.Context, pgx.TxOptions) (pgx.Tx, error) { return nil, errBoom }}
			}
		}},
		{name: "escrow listing fails", arrange: func(f *refundFixture) {
			f.ledger.FindEscrowAccountsFn = func(context.Context, string) ([]store.Account, error) { return nil, errBoom }
		}},
		{name: "owner account cannot be opened", arrange: func(f *refundFixture) {
			f.ledger.GetOrCreateAccountTxFn = func(context.Context, pgx.Tx, store.CreateAccountInput) (*store.Account, error) {
				return nil, errBoom
			}
		}},
		{name: "ledger entries rejected", arrange: func(f *refundFixture) {
			f.ledger.CreateLedgerEntriesTxFn = func(context.Context, pgx.Tx, []store.LedgerEntryInput) ([]store.LedgerEntry, error) {
				return nil, errBoom
			}
		}},
		{name: "refund status update fails", arrange: func(f *refundFixture) {
			f.txn.UpdateStatusTxFn = func(context.Context, pgx.Tx, string, string) (*store.Transaction, error) { return nil, errBoom }
		}},
		{name: "marking the original refunded fails", arrange: func(f *refundFixture) {
			f.txn.UpdateStatusTxFn = func(_ context.Context, _ pgx.Tx, id, status string) (*store.Transaction, error) {
				if id == "orig-1" {
					return nil, errBoom
				}
				return &store.Transaction{ID: id, Status: status}, nil
			}
		}},
		{name: "audit event fails", arrange: func(f *refundFixture) {
			f.txn.CreateEventTxFn = func(context.Context, pgx.Tx, store.CreateTransactionEventInput) (*store.TransactionEvent, error) {
				return nil, errBoom
			}
		}},
		{name: "outbox insert fails", arrange: func(f *refundFixture) {
			f.dbTx.ExecFn = func(context.Context, string, ...any) (pgconn.CommandTag, error) {
				return pgconn.CommandTag{}, errBoom
			}
		}},
		{name: "commit fails", arrange: func(f *refundFixture) {
			f.dbTx.CommitFn = func(context.Context) error { return errBoom }
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newRefundFixture(completedDeposit(10_000_000))
			tt.arrange(f)

			txn, err := f.svc().ProcessRefund(context.Background(), refundInput(10_000_000))
			if err == nil {
				t.Fatalf("a failed refund reported success: %+v", txn)
			}
			if txn != nil {
				t.Errorf("returned a transaction alongside the failure: %+v", txn)
			}
		})
	}
}

// --- checkout ---

func TestCheckoutTxType(t *testing.T) {
	tests := []struct {
		checkout string
		want     string
		wantErr  bool
	}{
		{checkout: store.CheckoutBRD, want: store.TxTypeBRDPayment},
		{checkout: store.CheckoutPRD, want: store.TxTypePRDPayment},
		{checkout: store.CheckoutEscrow, want: store.TxTypeEscrowIn},
		{checkout: store.CheckoutRevision, want: store.TxTypeRevisionFee},
		{checkout: "subscription", wantErr: true},
		{checkout: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.checkout, func(t *testing.T) {
			got, err := checkoutTxType(tt.checkout)
			if tt.wantErr {
				assertAppError(t, err, "VALIDATION_ERROR", 400)
				return
			}
			if err != nil {
				t.Fatalf("checkoutTxType(%q): %v", tt.checkout, err)
			}
			if got != tt.want {
				t.Errorf("checkoutTxType(%q) = %q, want %q", tt.checkout, got, tt.want)
			}
		})
	}
}

func snapServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(s.Close)
	return s
}

func snapInput(checkoutType string) CreateSnapTokenInput {
	// The order id prefix has to agree with the checkout type; CreateSnapToken
	// refuses the pair otherwise, which is what keeps the price and the
	// entitlement from coming out of different fields.
	return CreateSnapTokenInput{
		ProjectID: "p-1", OrderID: orderPrefixFor(checkoutType) + "1", CheckoutType: checkoutType,
		ItemName: "Business Requirement Document", CustomerName: "Budi", CustomerEmail: "budi@example.com",
	}
}

/*
The price is read from the database, never from the request. A checkout that
prices to nothing is refused rather than sent to the gateway: Midtrans rejects
a zero gross_amount, and an unpriced document reaching checkout means the row
the webhook will later match against does not exist yet.
*/
func TestCreateSnapToken_PricesFromTheServerAndRefusesNothing(t *testing.T) {
	tests := []struct {
		name        string
		checkout    string
		milestoneID string
		storedPrice int64
		msAmount    int64
		priceErr    error
		wantAmount  int64
		wantErrCode string
	}{
		{name: "brd priced", checkout: store.CheckoutBRD, storedPrice: 500_000, wantAmount: 500_000},
		{name: "prd priced", checkout: store.CheckoutPRD, storedPrice: 1_500_000, wantAmount: 1_500_000},
		{name: "escrow priced from the project total", checkout: store.CheckoutEscrow, storedPrice: 10_000_000, wantAmount: 10_000_000},
		{name: "revision is ten percent of the milestone", checkout: store.CheckoutRevision, milestoneID: "ms-1", msAmount: 1_000_000, wantAmount: 100_000},
		{name: "revision rounds the ten percent up", checkout: store.CheckoutRevision, milestoneID: "ms-1", msAmount: 1_000_001, wantAmount: 100_001},
		{name: "unpriced document", checkout: store.CheckoutBRD, storedPrice: 0, wantErrCode: "NOT_FOUND"},
		{name: "negatively priced document", checkout: store.CheckoutBRD, storedPrice: -1, wantErrCode: "NOT_FOUND"},
		{name: "revision on an unpriced milestone", checkout: store.CheckoutRevision, milestoneID: "ms-1", msAmount: 0, wantErrCode: "NOT_FOUND"},
		{name: "revision without a milestone", checkout: store.CheckoutRevision, wantErrCode: "VALIDATION_ERROR"},
		{name: "unknown checkout type", checkout: "subscription", wantErrCode: "VALIDATION_ERROR"},
		{name: "price lookup fails", checkout: store.CheckoutBRD, priceErr: errBoom},
		{name: "milestone lookup fails", checkout: store.CheckoutRevision, milestoneID: "ms-1", priceErr: errBoom},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := snapServer(t, http.StatusCreated, `{"token":"snap-tok","redirect_url":"https://pay.example/snap-tok"}`)
			var sentAmount int64
			txnStore := &store.MockTransactionStore{
				GetCheckoutAmountFn: func(context.Context, string, string) (int64, error) {
					return tt.storedPrice, tt.priceErr
				},
				GetMilestoneAmountFn: func(context.Context, string, string) (int64, error) {
					return tt.msAmount, tt.priceErr
				},
				CreateFn: func(_ context.Context, in store.CreateTransactionInput) (*store.CreateResult, error) {
					sentAmount = in.Amount
					return &store.CreateResult{Transaction: store.Transaction{ID: "txn-1", Amount: in.Amount}, IsNew: true}, nil
				},
			}
			svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", server.URL)

			in := snapInput(tt.checkout)
			in.MilestoneID = tt.milestoneID
			result, err := svc.CreateSnapToken(context.Background(), in)

			if tt.priceErr != nil {
				if err == nil {
					t.Fatal("a failed price lookup produced a checkout")
				}
				return
			}
			if tt.wantErrCode != "" {
				status := 400
				if tt.wantErrCode == "NOT_FOUND" {
					status = 404
				}
				assertAppError(t, err, tt.wantErrCode, status)
				if sentAmount != 0 {
					t.Errorf("an unpriced checkout still created a %d transaction", sentAmount)
				}
				return
			}
			if err != nil {
				t.Fatalf("CreateSnapToken: %v", err)
			}
			if sentAmount != tt.wantAmount {
				t.Errorf("charged %d, want %d", sentAmount, tt.wantAmount)
			}
			if result.Token != "snap-tok" {
				t.Errorf("token = %q, want snap-tok", result.Token)
			}
			if result.RedirectURL != "https://pay.example/snap-tok" {
				t.Errorf("redirectUrl = %q", result.RedirectURL)
			}
		})
	}
}

/*
Reusing an order id after the price changed is refused. Midtrans would capture
the new figure while the stored row still holds the old one, and the webhook
compares the two and rejects the settlement as a mismatch: money taken, escrow
never funded.
*/
func TestCreateSnapToken_RefusesAReusedOrderIDAtADifferentPrice(t *testing.T) {
	tests := []struct {
		name        string
		storedPrice int64
		freshPrice  int64
		wantErr     bool
	}{
		{name: "same price is a safe retry", storedPrice: 500_000, freshPrice: 500_000},
		{name: "price went up", storedPrice: 500_000, freshPrice: 750_000, wantErr: true},
		{name: "price went down", storedPrice: 500_000, freshPrice: 250_000, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := snapServer(t, http.StatusOK, `{"token":"snap-tok"}`)
			txnStore := &store.MockTransactionStore{
				GetCheckoutAmountFn: func(context.Context, string, string) (int64, error) { return tt.freshPrice, nil },
				CreateFn: func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
					return &store.CreateResult{
						Transaction: store.Transaction{ID: "txn-1", Amount: tt.storedPrice},
						IsNew:       false,
					}, nil
				},
			}
			svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", server.URL)

			_, err := svc.CreateSnapToken(context.Background(), snapInput(store.CheckoutBRD))
			if tt.wantErr {
				assertAppError(t, err, "CONFLICT", 409)
				return
			}
			if err != nil {
				t.Fatalf("a same-price retry was refused: %v", err)
			}
		})
	}
}

func TestCreateSnapToken_ValidatesItsInput(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(in *CreateSnapTokenInput)
		wantErr string
	}{
		{name: "missing order id", mutate: func(in *CreateSnapTokenInput) { in.OrderID = "" }, wantErr: "orderId is required"},
		{name: "missing customer email", mutate: func(in *CreateSnapTokenInput) { in.CustomerEmail = "" }, wantErr: "customerEmail is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewPaymentService(&store.MockTransactionStore{}, &store.MockLedgerStore{}, "key", "")
			in := snapInput(store.CheckoutBRD)
			tt.mutate(&in)

			_, err := svc.CreateSnapToken(context.Background(), in)
			appErr := assertAppError(t, err, "VALIDATION_ERROR", 400)
			if appErr.Message != tt.wantErr {
				t.Errorf("message = %q, want %q", appErr.Message, tt.wantErr)
			}
		})
	}
}

// The gateway is external, so every way it can fail has to end as a 502 the
// caller can retry, never as a token the owner cannot pay with.
func TestCreateSnapToken_SurfacesGatewayFailures(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		url        string
		wantCode   string
		wantStatus int
	}{
		{name: "gateway rejects the request", status: http.StatusBadRequest, body: `{"error_messages":["bad"]}`, wantCode: "EXTERNAL_SERVICE_ERROR", wantStatus: 502},
		{name: "gateway is unreachable", url: "http://127.0.0.1:1/snap", wantCode: "EXTERNAL_SERVICE_ERROR", wantStatus: 502},
		{name: "gateway returns an empty token", status: http.StatusCreated, body: `{"token":""}`, wantCode: "EXTERNAL_SERVICE_ERROR", wantStatus: 502},
		{name: "gateway returns unparseable json", status: http.StatusCreated, body: `not json`},
		{name: "url cannot be turned into a request", url: "http://bad\nhost/snap"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := tt.url
			if url == "" {
				url = snapServer(t, tt.status, tt.body).URL
			}
			txnStore := &store.MockTransactionStore{
				GetCheckoutAmountFn: func(context.Context, string, string) (int64, error) { return 500_000, nil },
				CreateFn: func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
					return &store.CreateResult{Transaction: store.Transaction{ID: "txn-1", Amount: 500_000}, IsNew: true}, nil
				},
			}
			svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", url)

			result, err := svc.CreateSnapToken(context.Background(), snapInput(store.CheckoutBRD))
			if err == nil {
				t.Fatalf("a gateway failure produced a token: %+v", result)
			}
			if tt.wantCode != "" {
				assertAppError(t, err, tt.wantCode, tt.wantStatus)
			}
		})
	}
}

func TestCreateSnapToken_TransactionRowFailureStopsTheCheckout(t *testing.T) {
	txnStore := &store.MockTransactionStore{
		GetCheckoutAmountFn: func(context.Context, string, string) (int64, error) { return 500_000, nil },
		CreateFn: func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
			return nil, errBoom
		},
	}
	svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", "http://127.0.0.1:1")

	if _, err := svc.CreateSnapToken(context.Background(), snapInput(store.CheckoutBRD)); err == nil {
		t.Fatal("a checkout was opened without the row the webhook matches against")
	}
}

// --- reads ---

func TestGetEscrowBalance_FailureIsNotAnEmptyBalance(t *testing.T) {
	ledger := &store.MockLedgerStore{
		FindEscrowAccountsFn: func(context.Context, string) ([]store.Account, error) { return nil, errBoom },
	}
	svc := NewPaymentService(&store.MockTransactionStore{}, ledger, "", "")

	balance, err := svc.GetEscrowBalance(context.Background(), "p-1")
	if err == nil {
		t.Fatal("a failed escrow lookup reported a balance")
	}
	if balance != 0 {
		t.Errorf("balance = %d alongside an error, want 0", balance)
	}
}

func TestGetTransactionByID_AssemblesTheDetailOrFails(t *testing.T) {
	tests := []struct {
		name     string
		txn      *store.Transaction
		findErr  error
		eventErr error
		entryErr error
		wantCode string
	}{
		{name: "assembled", txn: &store.Transaction{ID: "txn-1", Amount: 10_000_000}},
		{name: "unknown transaction", txn: nil, wantCode: "NOT_FOUND"},
		{name: "lookup fails", findErr: errBoom},
		{name: "events lookup fails", txn: &store.Transaction{ID: "txn-1"}, eventErr: errBoom},
		{name: "ledger lookup fails", txn: &store.Transaction{ID: "txn-1"}, entryErr: errBoom},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			txnStore := &store.MockTransactionStore{
				FindByIDFn: func(context.Context, string) (*store.Transaction, error) { return tt.txn, tt.findErr },
				GetEventsByTransactionFn: func(context.Context, string) ([]store.TransactionEvent, error) {
					return []store.TransactionEvent{{ID: "ev-1"}}, tt.eventErr
				},
			}
			ledger := &store.MockLedgerStore{
				GetEntriesByTransactionFn: func(context.Context, string) ([]store.LedgerEntry, error) {
					return []store.LedgerEntry{{ID: "le-1"}}, tt.entryErr
				},
			}
			svc := NewPaymentService(txnStore, ledger, "", "")

			detail, err := svc.GetTransactionByID(context.Background(), "txn-1")
			if tt.wantCode != "" {
				assertAppError(t, err, tt.wantCode, 404)
				return
			}
			if tt.findErr != nil || tt.eventErr != nil || tt.entryErr != nil {
				if err == nil {
					t.Fatal("a failed lookup produced a detail")
				}
				return
			}
			if err != nil {
				t.Fatalf("GetTransactionByID: %v", err)
			}
			if detail.ID != "txn-1" || len(detail.Events) != 1 || len(detail.LedgerEntries) != 1 {
				t.Errorf("detail = %+v, want the transaction with its events and ledger lines", detail)
			}
		})
	}
}

func TestPaymentService_StoreExposesTheTransactionStore(t *testing.T) {
	txnStore := &store.MockTransactionStore{}
	svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "", "")
	if svc.Store() != txnStore {
		t.Error("Store() did not return the store the service was built with")
	}
}

func TestConflictErr(t *testing.T) {
	err := conflictErr("order id already used")
	if err.Code != "CONFLICT" || err.StatusCode != 409 {
		t.Errorf("conflictErr = %+v, want CONFLICT/409", err)
	}
	if err.Error() != "order id already used" {
		t.Errorf("Error() = %q, want the message", err.Error())
	}
}

// A gateway that announces a body it does not deliver must fail the checkout,
// not hand back a half-read token.
func TestCreateSnapToken_TruncatedGatewayResponseFailsTheCheckout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "512")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"token":"snap-`))
	}))
	defer server.Close()

	txnStore := &store.MockTransactionStore{
		GetCheckoutAmountFn: func(context.Context, string, string) (int64, error) { return 500_000, nil },
		CreateFn: func(context.Context, store.CreateTransactionInput) (*store.CreateResult, error) {
			return &store.CreateResult{Transaction: store.Transaction{ID: "txn-1", Amount: 500_000}, IsNew: true}, nil
		},
	}
	svc := NewPaymentService(txnStore, &store.MockLedgerStore{}, "key", server.URL)

	result, err := svc.CreateSnapToken(context.Background(), snapInput(store.CheckoutBRD))
	if err == nil {
		t.Fatalf("a truncated gateway response produced a token: %+v", result)
	}
	if !strings.Contains(err.Error(), "read snap response") {
		t.Errorf("error = %q, want it to mention read snap response", err.Error())
	}
}

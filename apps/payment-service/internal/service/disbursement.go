package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/store"
)

// disbursementStore is the slice of the store the disbursement service needs,
// named here so the service can be tested against a fake.
type disbursementStore interface {
	GetVerifiedPayoutAccountTx(ctx context.Context, tx pgx.Tx, talentID string) (*store.TalentPayoutAccount, error)
	InsertPendingTx(ctx context.Context, tx pgx.Tx, in store.EnqueueDisbursementInput) error
	GetByID(ctx context.Context, id string) (*store.Disbursement, error)
	ClaimForExecution(ctx context.Context, id string) (*store.Disbursement, error)
	MarkExecuted(ctx context.Context, id, referenceNo, approvedBy string) error
	MarkFailed(ctx context.Context, id, reason string, referenceNo *string) error
	MarkAmbiguous(ctx context.Context, id, reason string) error
	ListByStatus(ctx context.Context, status string, limit int) ([]store.Disbursement, error)
	ListStuck(ctx context.Context, olderThan time.Duration, limit int) ([]store.Disbursement, error)
	LockByIDTx(ctx context.Context, tx pgx.Tx, id string) (*store.Disbursement, error)
	LockByReferenceTx(ctx context.Context, tx pgx.Tx, referenceNo string) (*store.Disbursement, error)
	SetStatusTx(ctx context.Context, tx pgx.Tx, id, status string, failureReason *string) error
	Pool() store.PoolIface
}

// disbursementLedger is the double-entry surface a settled payout needs: the
// two accounts its legs land on, the writer that enforces debits == credits,
// and the probe that says whether this payout is already on the books.
type disbursementLedger interface {
	GetOrCreateAccountTx(ctx context.Context, tx pgx.Tx, in store.CreateAccountInput) (*store.Account, error)
	CreateLedgerEntriesTx(ctx context.Context, tx pgx.Tx, entries []store.LedgerEntryInput) ([]store.LedgerEntry, error)
	PayoutBookedTx(ctx context.Context, tx pgx.Tx, transactionID, disbursementID string) (bool, error)
}

// irisPayouts is the Iris surface the service uses, named so tests can stand in
// a fake without a live gateway.
type irisPayouts interface {
	Enabled() bool
	CreatePayout(ctx context.Context, in iris.PayoutRequest) (*iris.PayoutResult, error)
	ApprovePayout(ctx context.Context, referenceNos []string, otp string) error
	GetPayout(ctx context.Context, referenceNo string) (*iris.PayoutStatus, error)
}

// DisbursementService turns released milestones into real payouts through Iris.
// It exists only when disbursement is enabled; where it is absent, releases
// write the ledger as before and nothing is paid out.
type DisbursementService struct {
	store       disbursementStore
	ledger      disbursementLedger
	iris        irisPayouts
	approverOTP string
}

func NewDisbursementService(st disbursementStore, ledger disbursementLedger, irisClient irisPayouts, approverOTP string) *DisbursementService {
	return &DisbursementService{store: st, ledger: ledger, iris: irisClient, approverOTP: approverOTP}
}

// EnqueueOnReleaseInput is the released milestone a payout should be recorded
// for. NetAmount is what the talent is owed after the platform fee.
type EnqueueOnReleaseInput struct {
	ProjectID     string
	TalentID      string
	MilestoneID   *string
	WorkPackageID *string
	TransactionID *string
	NetAmount     int64
	// IdempotencyKey ties the payout to the release, so a replayed release does
	// not enqueue a second one.
	IdempotencyKey string
}

// EnqueueOnReleaseTx records a pending payout inside the release transaction, so
// a milestone that pays the ledger cannot commit without a payout record beside
// it. A talent with no verified destination is a no-op, not an error: the money
// is owed in the ledger and waits for a verified account rather than being sent
// to unchecked digits or blocking the release.
func (s *DisbursementService) EnqueueOnReleaseTx(ctx context.Context, tx pgx.Tx, in EnqueueOnReleaseInput) error {
	if in.NetAmount <= 0 {
		return nil
	}
	account, err := s.store.GetVerifiedPayoutAccountTx(ctx, tx, in.TalentID)
	if err != nil {
		return fmt.Errorf("read payout account: %w", err)
	}
	if account == nil || !account.Verified {
		slog.Warn("release has no verified payout destination; not enqueuing a payout",
			"talentId", in.TalentID, "milestoneId", in.MilestoneID)
		return nil
	}
	return s.store.InsertPendingTx(ctx, tx, store.EnqueueDisbursementInput{
		ProjectID:      in.ProjectID,
		TalentID:       in.TalentID,
		MilestoneID:    in.MilestoneID,
		WorkPackageID:  in.WorkPackageID,
		TransactionID:  in.TransactionID,
		Amount:         in.NetAmount,
		Provider:       account.Provider,
		Account:        account.Account,
		HolderName:     account.HolderName,
		IdempotencyKey: in.IdempotencyKey,
	})
}

/*
Execute sends a recorded payout to the bank: claim it, create it on Iris, then
approve it. A claim that finds nothing means the payout was already sent or does
not exist.

Two rules keep this from paying twice.

A claimed row that already carries an Iris reference is never created again. It
got that reference from a create that landed, so the payout exists at the
gateway; the only honest next step is to ask Iris what became of it and resume
from there. This is what an approve retry hits: approval failing left the row
failed-with-a-reference, and the old code walked straight back into
CreatePayout and sent a second payout for the same milestone.

A create whose outcome cannot be established is not a failure to retry. Iris
deduplicates on X-Idempotency-Key for five minutes, so a timed-out create that
did land is invisible to a retry made later and becomes a second payout. Such a
row stays 'queued' - outside ClaimForExecution's claimable set - with the
ambiguity recorded, and is resolved by the operator or the reconciliation sweep
rather than by guessing. Only a definitive rejection, where Iris answered that
it created nothing, returns the row to the retryable set.
*/
func (s *DisbursementService) Execute(ctx context.Context, id, approvedBy string) (*store.Disbursement, error) {
	if !s.iris.Enabled() {
		return nil, externalServiceErr("payouts are not configured")
	}

	claimed, err := s.store.ClaimForExecution(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("claim disbursement: %w", err)
	}
	if claimed == nil {
		// Either it does not exist or it is already queued or further along.
		existing, getErr := s.store.GetByID(ctx, id)
		if getErr != nil {
			return nil, fmt.Errorf("load disbursement: %w", getErr)
		}
		if existing == nil {
			return nil, notFoundErr("disbursement not found")
		}
		return nil, conflictErr(fmt.Sprintf("disbursement is already %s", existing.Status))
	}

	if claimed.IrisReferenceNo != nil && *claimed.IrisReferenceNo != "" {
		return s.resumeExisting(ctx, claimed, approvedBy)
	}

	result, err := s.iris.CreatePayout(ctx, iris.PayoutRequest{
		BeneficiaryName:    claimed.BeneficiaryName,
		BeneficiaryAccount: claimed.BeneficiaryAccount,
		BeneficiaryBank:    claimed.BeneficiaryProvider,
		Amount:             claimed.Amount,
		Notes:              disbursementNote(claimed),
		IdempotencyKey:     claimed.IdempotencyKey,
	})
	if err != nil {
		var rejected *iris.PayoutRejectedError
		if errors.As(err, &rejected) {
			// Iris answered, and its answer is that nothing was created.
			_ = s.store.MarkFailed(ctx, id, err.Error(), nil)
			return nil, externalServiceErr("could not create payout")
		}
		return nil, s.parkAmbiguousCreate(ctx, claimed, err)
	}

	// The reference is recorded before approval is attempted. It is the only
	// handle on a payout that now exists at the gateway, and an approve that
	// fails or never answers must not be able to lose it.
	if markErr := s.store.MarkExecuted(ctx, id, result.ReferenceNo, approvedBy); markErr != nil {
		return nil, fmt.Errorf("record executed payout: %w", markErr)
	}

	if approveErr := s.iris.ApprovePayout(ctx, []string{result.ReferenceNo}, s.approverOTP); approveErr != nil {
		// Failed-with-a-reference: retryable, and the retry resumes the
		// existing payout rather than creating a second one.
		_ = s.store.MarkFailed(ctx, id, approveErr.Error(), &result.ReferenceNo)
		return nil, externalServiceErr("could not approve payout")
	}

	return s.store.GetByID(ctx, id)
}

// parkAmbiguousCreate leaves a payout whose create outcome is unknown in
// 'queued' and says so loudly. Returning the error is the caller's cue that
// nothing is confirmed; the row is deliberately not retryable.
func (s *DisbursementService) parkAmbiguousCreate(ctx context.Context, d *store.Disbursement, cause error) error {
	reason := fmt.Sprintf("create outcome unknown, payout may exist at the gateway: %v", cause)
	if markErr := s.store.MarkAmbiguous(ctx, d.ID, reason); markErr != nil {
		slog.Error("could not record an ambiguous payout create",
			"disbursementId", d.ID, "error", markErr)
	}
	slog.Error("payout create outcome is unknown; left queued and not retried",
		"disbursementId", d.ID, "idempotencyKey", d.IdempotencyKey,
		"amount", d.Amount, "error", cause)
	return externalServiceErr("payout create outcome is unknown; it is held for reconciliation")
}

/*
resumeExisting continues a payout that already has an Iris reference, without
creating anything.

Iris's own answer decides what happens: a payout still waiting for approval is
approved, and one the bank has already taken or refused is settled through the
same path a notification would take, ledger booking included. An answer we
cannot get leaves the row exactly as it is.
*/
func (s *DisbursementService) resumeExisting(ctx context.Context, d *store.Disbursement, approvedBy string) (*store.Disbursement, error) {
	ref := *d.IrisReferenceNo

	status, err := s.iris.GetPayout(ctx, ref)
	if err != nil {
		// Including ErrPayoutNotFound. A reference we stored that Iris does not
		// recognise is a contradiction, not a licence to create a second
		// payout, so it is held for a human exactly like an unknown outcome.
		return nil, s.parkAmbiguousCreate(ctx, d, fmt.Errorf("resume reference %s: %w", ref, err))
	}

	switch status.Status {
	case iris.PayoutQueued:
		if approveErr := s.iris.ApprovePayout(ctx, []string{ref}, s.approverOTP); approveErr != nil {
			_ = s.store.MarkFailed(ctx, d.ID, approveErr.Error(), &ref)
			return nil, externalServiceErr("could not approve payout")
		}
		if markErr := s.store.MarkExecuted(ctx, d.ID, ref, approvedBy); markErr != nil {
			return nil, fmt.Errorf("record executed payout: %w", markErr)
		}
	case iris.PayoutProcessed, iris.PayoutCompleted, iris.PayoutFailed:
		if _, settleErr := s.settleByID(ctx, d.ID, status.Status, status.FailureReason()); settleErr != nil {
			return nil, settleErr
		}
	default:
		return nil, s.parkAmbiguousCreate(ctx, d,
			fmt.Errorf("iris reported unknown status %q for reference %s", status.Status, ref))
	}

	return s.store.GetByID(ctx, d.ID)
}

// List returns disbursements in a status, for the operator queue. An unknown
// status is rejected rather than returning an empty list that reads as "none".
func (s *DisbursementService) List(ctx context.Context, status string, limit int) ([]store.Disbursement, error) {
	switch status {
	case store.DisbursementPending, store.DisbursementQueued, store.DisbursementProcessed,
		store.DisbursementCompleted, store.DisbursementFailed:
	default:
		return nil, validationErr(fmt.Sprintf("unknown disbursement status %q", status))
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.store.ListByStatus(ctx, status, limit)
}

// SettleOutcome is what a payout notification or a sweep learned: the status
// the row now carries, and whether this delivery is the one that moved it. A
// replay reports Changed false, which is how the endpoint answers "received,
// nothing to do" rather than pretending to have acted.
type SettleOutcome struct {
	DisbursementID string `json:"disbursementId"`
	Status         string `json:"status"`
	Changed        bool   `json:"changed"`
	LedgerBooked   bool   `json:"ledgerBooked"`
}

/*
payoutRank orders the states a payout passes through, so a notification that
does not advance it is ignored.

It is the same shape as supersedes in the Snap webhook, and for the same reason:
notifications are retried, can arrive out of order, and must never walk a payout
backwards. 'processed' and 'completed' both mean the money left, so nothing may
move a payout out of them - in particular not a late 'failed', which would make
the row claimable again and pay the talent twice.

'failed' outranks 'queued' but not the settled pair, so a bank rejection settles
a queued payout while a genuine later success can still correct a row this
service marked failed because its own approve call did not answer.
*/
func payoutRank(status string) int {
	switch status {
	case store.DisbursementPending:
		return 0
	case store.DisbursementQueued:
		return 1
	case store.DisbursementFailed:
		return 2
	case store.DisbursementProcessed:
		return 3
	case store.DisbursementCompleted:
		return 4
	default:
		return -1
	}
}

// irisStatusToDisbursement maps what Iris reports onto the disbursement_status
// enum. The four payout words are the same in both, and anything else is
// refused rather than guessed at: silently filing an unrecognised status as a
// success or a failure is how money goes missing.
func irisStatusToDisbursement(irisStatus string) (string, bool) {
	switch irisStatus {
	case iris.PayoutQueued:
		return store.DisbursementQueued, true
	case iris.PayoutProcessed:
		return store.DisbursementProcessed, true
	case iris.PayoutCompleted:
		return store.DisbursementCompleted, true
	case iris.PayoutFailed:
		return store.DisbursementFailed, true
	default:
		return "", false
	}
}

// SettleByReference applies an Iris-reported status to the payout that carries
// that reference. It is what the payout notification endpoint calls; the
// reference is the only identifier a notification has.
func (s *DisbursementService) SettleByReference(ctx context.Context, referenceNo, irisStatus, failureReason string) (*SettleOutcome, error) {
	if referenceNo == "" {
		return nil, validationErr("reference_no is required")
	}
	return s.settle(ctx, irisStatus, failureReason, func(ctx context.Context, tx pgx.Tx) (*store.Disbursement, error) {
		return s.store.LockByReferenceTx(ctx, tx, referenceNo)
	})
}

// settleByID is SettleByReference for a payout we already have the row id for:
// the resume branch and the reconciliation sweep, both of which read the status
// from Iris themselves.
func (s *DisbursementService) settleByID(ctx context.Context, id, irisStatus, failureReason string) (*SettleOutcome, error) {
	return s.settle(ctx, irisStatus, failureReason, func(ctx context.Context, tx pgx.Tx) (*store.Disbursement, error) {
		return s.store.LockByIDTx(ctx, tx, id)
	})
}

/*
settle transitions one payout and, when that transition means the money left,
books it in the ledger - both inside one serializable transaction that holds the
disbursement's row lock the whole way.

The lock is what makes this idempotent under concurrency. Two deliveries of one
notification, or a notification racing the sweep, serialise on it: the second
one reads the status the first wrote and finds nothing to advance. Without it
both could read 'queued', both could find the ledger unbooked, and the payout
would be booked twice.

The ledger probe is the second guard, for the sequence the status machine
cannot catch on its own: Iris reports 'processed' and then 'completed', two
legitimate advances for one payout that must produce one set of entries.
*/
func (s *DisbursementService) settle(
	ctx context.Context,
	irisStatus, failureReason string,
	lock func(ctx context.Context, tx pgx.Tx) (*store.Disbursement, error),
) (*SettleOutcome, error) {
	next, ok := irisStatusToDisbursement(irisStatus)
	if !ok {
		return nil, validationErr(fmt.Sprintf("unknown payout status %q", irisStatus))
	}

	return store.RunSerializable(ctx, s.store.Pool(),
		store.SerializableLabels{Begin: "begin payout settlement", Commit: "commit payout settlement"},
		func(tx pgx.Tx, _ int) (*SettleOutcome, error) {
			d, err := lock(ctx, tx)
			if err != nil {
				return nil, fmt.Errorf("lock disbursement: %w", err)
			}
			if d == nil {
				return nil, notFoundErr("no payout matches that reference")
			}

			outcome := &SettleOutcome{DisbursementID: d.ID, Status: d.Status}

			// Book first: a payout can reach 'completed' through 'processed',
			// and the entries must be written on whichever advance arrives
			// first, not only on the final one.
			if next == store.DisbursementProcessed || next == store.DisbursementCompleted {
				booked, bookErr := s.bookPayoutTx(ctx, tx, d)
				if bookErr != nil {
					return nil, bookErr
				}
				outcome.LedgerBooked = booked
			}

			if payoutRank(next) <= payoutRank(d.Status) {
				slog.Info("payout notification does not advance the payout; ignored",
					"disbursementId", d.ID, "current", d.Status, "incoming", next)
				return outcome, nil
			}

			var reason *string
			if next == store.DisbursementFailed && failureReason != "" {
				reason = &failureReason
			}
			if err := s.store.SetStatusTx(ctx, tx, d.ID, next, reason); err != nil {
				return nil, err
			}

			outcome.Status = next
			outcome.Changed = true
			return outcome, nil
		})
}

/*
bookPayoutTx writes the double entry for money that has actually left for the
bank, once. It reports whether this call is the one that wrote it.

The legs, and why they point this way. This ledger's convention - stated on
bookDocumentRevenueTx and enforced by CreateLedgerEntriesTx, where a debit adds
to a balance and a credit takes away - is that a credit takes the money off the
account giving it up and a debit puts it on the account that now holds it.
ReleaseEscrow debits the talent's asset account by the net amount, so that
balance is what the platform still owes the talent. Paying it settles that
obligation, so the payout CREDITS the talent account, and the matching debit
lands on the platform's cash account, which carries what has gone out through
the bank.

That is the opposite of the textbook "debit the payable, credit cash" wording,
because this ledger runs its accounts in the debit-positive flow direction
throughout - platform revenue is debited when revenue is earned, not credited.
Debiting the talent here would add the payout to what they are owed instead of
clearing it, and the talent's balance would grow every time they were paid.

Both accounts use existing account_type and account_owner_type members, and the
cash account is an ordinary row rather than a schema change - see
store.PlatformCashOwnerID.
*/
func (s *DisbursementService) bookPayoutTx(ctx context.Context, tx pgx.Tx, d *store.Disbursement) (bool, error) {
	if d.TransactionID == nil || *d.TransactionID == "" {
		// ledger_entries.transaction_id is NOT NULL, so a payout with no
		// release transaction behind it has nothing to hang entries off. The
		// status still settles; the gap is visible rather than silent.
		slog.Error("settled payout has no transaction to book against",
			"disbursementId", d.ID, "talentId", d.TalentID, "amount", d.Amount)
		return false, nil
	}
	transactionID := *d.TransactionID

	booked, err := s.ledger.PayoutBookedTx(ctx, tx, transactionID, d.ID)
	if err != nil {
		return false, err
	}
	if booked {
		return false, nil
	}

	talentAccount, err := s.ledger.GetOrCreateAccountTx(ctx, tx, store.CreateAccountInput{
		OwnerType:   store.OwnerTalent,
		OwnerID:     &d.TalentID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Talent Payout - %s", d.TalentID),
	})
	if err != nil {
		return false, fmt.Errorf("get talent account: %w", err)
	}
	if talentAccount == nil {
		return false, fmt.Errorf("talent account unavailable for %s", d.TalentID)
	}

	cashOwnerID := store.PlatformCashOwnerID
	cashAccount, err := s.ledger.GetOrCreateAccountTx(ctx, tx, store.CreateAccountInput{
		OwnerType:   store.OwnerPlatform,
		OwnerID:     &cashOwnerID,
		AccountType: store.AcctAsset,
		Name:        store.PlatformCashAccountName,
	})
	if err != nil {
		return false, fmt.Errorf("get platform cash account: %w", err)
	}
	if cashAccount == nil {
		return false, fmt.Errorf("platform cash account unavailable")
	}

	reference := ""
	if d.IrisReferenceNo != nil {
		reference = *d.IrisReferenceNo
	}
	meta := map[string]any{
		// disbursementId is what PayoutBookedTx matches on, so a replay finds
		// these entries and writes nothing.
		"disbursementId":  d.ID,
		"irisReferenceNo": reference,
		"projectId":       d.ProjectID,
		"milestoneId":     d.MilestoneID,
		"talentId":        d.TalentID,
		"source":          "iris_payout",
	}
	description := fmt.Sprintf("Payout %s to %s", reference, d.BeneficiaryName)

	if _, err := s.ledger.CreateLedgerEntriesTx(ctx, tx, []store.LedgerEntryInput{
		{
			TransactionID: transactionID,
			AccountID:     talentAccount.ID,
			EntryType:     store.EntryCredit,
			Amount:        d.Amount,
			Description:   description,
			Metadata:      meta,
		},
		{
			TransactionID: transactionID,
			AccountID:     cashAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        d.Amount,
			Description:   description,
			Metadata:      meta,
		},
	}); err != nil {
		return false, fmt.Errorf("book payout ledger entries: %w", err)
	}
	return true, nil
}

func disbursementNote(d *store.Disbursement) string {
	if d.MilestoneID != nil {
		return fmt.Sprintf("KerjaCUS milestone payout %s", *d.MilestoneID)
	}
	return fmt.Sprintf("KerjaCUS payout for project %s", d.ProjectID)
}

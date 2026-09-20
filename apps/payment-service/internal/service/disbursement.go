package service

import (
	"context"
	"fmt"
	"log/slog"

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
	ListByStatus(ctx context.Context, status string, limit int) ([]store.Disbursement, error)
}

// irisPayouts is the Iris surface the service uses, named so tests can stand in
// a fake without a live gateway.
type irisPayouts interface {
	Enabled() bool
	CreatePayout(ctx context.Context, in iris.PayoutRequest) (*iris.PayoutResult, error)
	ApprovePayout(ctx context.Context, referenceNos []string, otp string) error
}

// DisbursementService turns released milestones into real payouts through Iris.
// It exists only when disbursement is enabled; where it is absent, releases
// write the ledger as before and nothing is paid out.
type DisbursementService struct {
	store       disbursementStore
	iris        irisPayouts
	approverOTP string
}

func NewDisbursementService(st disbursementStore, irisClient irisPayouts, approverOTP string) *DisbursementService {
	return &DisbursementService{store: st, iris: irisClient, approverOTP: approverOTP}
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

// Execute sends a recorded payout to the bank: claim it, create it on Iris, then
// approve it. A claim that finds nothing means the payout was already sent or
// does not exist. A gateway failure marks the row failed with the reason and
// leaves it retryable; the Iris create is idempotent on the payout key, so a
// retry cannot pay twice.
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

	result, err := s.iris.CreatePayout(ctx, iris.PayoutRequest{
		BeneficiaryName:    claimed.BeneficiaryName,
		BeneficiaryAccount: claimed.BeneficiaryAccount,
		BeneficiaryBank:    claimed.BeneficiaryProvider,
		Amount:             claimed.Amount,
		Notes:              disbursementNote(claimed),
		IdempotencyKey:     claimed.IdempotencyKey,
	})
	if err != nil {
		_ = s.store.MarkFailed(ctx, id, err.Error(), nil)
		return nil, externalServiceErr("could not create payout")
	}

	if approveErr := s.iris.ApprovePayout(ctx, []string{result.ReferenceNo}, s.approverOTP); approveErr != nil {
		// Keep the reference: the create landed, so a status callback can still
		// resolve the payout even though approval did not go through here.
		_ = s.store.MarkFailed(ctx, id, approveErr.Error(), &result.ReferenceNo)
		return nil, externalServiceErr("could not approve payout")
	}

	if markErr := s.store.MarkExecuted(ctx, id, result.ReferenceNo, approvedBy); markErr != nil {
		return nil, fmt.Errorf("record executed payout: %w", markErr)
	}
	return s.store.GetByID(ctx, id)
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

func disbursementNote(d *store.Disbursement) string {
	if d.MilestoneID != nil {
		return fmt.Sprintf("KerjaCUS milestone payout %s", *d.MilestoneID)
	}
	return fmt.Sprintf("KerjaCUS payout for project %s", d.ProjectID)
}

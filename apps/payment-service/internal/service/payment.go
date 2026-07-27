package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/bytz/payment-service/internal/pricing"
	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

var midtransClient = &http.Client{
	Timeout:   10 * time.Second,
	Transport: otelhttp.NewTransport(http.DefaultTransport),
}

// Structured error codes mirroring the TS AppError codes
type AppError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	StatusCode int    `json:"-"`
}

func (e *AppError) Error() string {
	return e.Message
}

func newAppError(code, message string, status int) *AppError {
	return &AppError{Code: code, Message: message, StatusCode: status}
}

// Common error constructors
func validationErr(msg string) *AppError { return newAppError("VALIDATION_ERROR", msg, 400) }
func notFoundErr(msg string) *AppError   { return newAppError("NOT_FOUND", msg, 404) }
func conflictErr(msg string) *AppError   { return newAppError("CONFLICT", msg, 409) }
func insufficientErr(msg string) *AppError {
	return newAppError("PAYMENT_ESCROW_INSUFFICIENT_FUNDS", msg, 400)
}
func alreadyProcessedErr(msg string) *AppError {
	return newAppError("PAYMENT_ALREADY_PROCESSED", msg, 409)
}
func externalServiceErr(msg string) *AppError { return newAppError("EXTERNAL_SERVICE_ERROR", msg, 502) }

type ReleaseEscrowInput struct {
	MilestoneID string
	ProjectID   string
	TalentID    string
	// Amount is the gross milestone slice leaving escrow; FeeAmount is the
	// platform's bracket share of it. The talent receives the difference.
	Amount         int64
	FeeAmount      int64
	PerformedBy    string
	IdempotencyKey string
}

type ProcessRefundInput struct {
	OriginalTransactionID string
	Amount                int64
	Reason                string
	OwnerID               string
	PerformedBy           string
	IdempotencyKey        string
}

type CreateSnapTokenInput struct {
	ProjectID    string
	OrderID      string
	CheckoutType string
	// Set for revision checkouts; the fee prices off this milestone.
	MilestoneID   string
	ItemName      string
	CustomerName  string
	CustomerEmail string
}

type SnapTokenResult struct {
	Token       string `json:"token"`
	RedirectURL string `json:"redirectUrl"`
}

type TransactionDetail struct {
	store.Transaction
	Events        []store.TransactionEvent `json:"events"`
	LedgerEntries []store.LedgerEntry      `json:"ledgerEntries"`
}

func forbiddenErr(msg string) *AppError { return newAppError("FORBIDDEN", msg, 403) }

type PaymentService struct {
	txnStore          store.TransactionStoreInterface
	ledgerStore       store.LedgerStoreInterface
	midtransServerKey string
	midtransSnapURL   string
}

func NewPaymentService(txnStore store.TransactionStoreInterface, ledgerStore store.LedgerStoreInterface, midtransServerKey, midtransSnapURL string) *PaymentService {
	return &PaymentService{
		txnStore:          txnStore,
		ledgerStore:       ledgerStore,
		midtransServerKey: midtransServerKey,
		midtransSnapURL:   midtransSnapURL,
	}
}

// Store returns the transaction store for direct queries.
func (s *PaymentService) Store() store.TransactionStoreInterface {
	return s.txnStore
}

// VerifyProjectOwner checks that the given userId is the owner of the project.
func (s *PaymentService) VerifyProjectOwner(ctx context.Context, projectID, userID string) error {
	ownerID, err := s.txnStore.GetProjectOwnerID(ctx, projectID)
	if err != nil {
		return fmt.Errorf("verify project owner: %w", err)
	}
	if ownerID == "" {
		return notFoundErr("project not found")
	}
	if ownerID != userID {
		return forbiddenErr("only the project owner can release escrow")
	}
	return nil
}

// Escrow is held per work package, so a project's balance is the sum of its
// accounts. Callers size project-wide refunds against this.
func (s *PaymentService) GetEscrowBalance(ctx context.Context, projectID string) (int64, error) {
	accounts, err := s.ledgerStore.FindEscrowAccountsForProject(ctx, projectID)
	if err != nil {
		return 0, fmt.Errorf("find escrow accounts: %w", err)
	}
	var total int64
	for _, a := range accounts {
		total += a.Balance
	}
	return total, nil
}

/*
escrowOwnerFor resolves which escrow account a milestone draws from.

Escrow is keyed by work package: one pool per package, so approving talent A's
milestones cannot drain the money owed to talent B. A milestone with no work
package - an integration milestone, or a project the PRD never decomposed -
falls back to the project level account, which is where the funding path puts
the money in that case.

Resolved here rather than taken from the request body so a caller cannot key a
release to the wrong pool.
*/
func (s *PaymentService) escrowOwnerFor(ctx context.Context, milestoneID, projectID string) (string, error) {
	workPackageID, err := s.txnStore.GetMilestoneWorkPackageID(ctx, milestoneID, projectID)
	if err != nil {
		return "", fmt.Errorf("resolve milestone work package: %w", err)
	}
	if workPackageID != nil && *workPackageID != "" {
		return *workPackageID, nil
	}
	return projectID, nil
}

/*
expectedFee re-derives the platform's slice of a milestone from the stored
pricing, so a caller cannot decide what the platform earns.

The ratio is the milestone's work package talent_payout / amount, falling back
to the project totals for a milestone with no package - the same basis
project-service prices from, which is why the two agree to the rupiah. The
bracket table cannot be applied to the milestone amount directly: a milestone
is a slice of a project and brackets key on the project total.

The project split is checked against the published table on the way through.
Nothing else re-reads those columns after the PRD is priced, so a payout that
belongs to no bracket would otherwise propagate into every milestone the
project settles.
*/
func (s *PaymentService) expectedFee(ctx context.Context, milestoneID, projectID string, amount int64) (int64, error) {
	basis, err := s.txnStore.GetMilestonePricing(ctx, milestoneID, projectID)
	if err != nil {
		return 0, fmt.Errorf("resolve milestone pricing: %w", err)
	}
	if basis == nil {
		return 0, validationErr("milestone has no pricing to derive the platform fee from")
	}

	if basis.ProjectPrice != nil && basis.ProjectPayout != nil &&
		!pricing.ProjectPayoutMatchesBracket(*basis.ProjectPrice, *basis.ProjectPayout) {
		slog.Error("project payout does not match its fee bracket",
			"projectId", projectID,
			"finalPrice", *basis.ProjectPrice,
			"talentPayout", *basis.ProjectPayout)
		return 0, validationErr("project payout does not match the platform fee bracket")
	}

	gross, payout := int64(0), int64(0)
	switch {
	case basis.PackageAmount != nil && *basis.PackageAmount > 0 && basis.PackagePayout != nil:
		gross, payout = *basis.PackageAmount, *basis.PackagePayout
	case basis.ProjectPrice != nil && basis.ProjectPayout != nil:
		gross, payout = *basis.ProjectPrice, *basis.ProjectPayout
	default:
		return 0, validationErr("milestone has no pricing to derive the platform fee from")
	}

	fee, err := pricing.MilestoneFee(amount, gross, payout)
	if err != nil {
		// project-service pays the talent in full here and logs. Refusing keeps
		// the anomaly visible instead of settling at a fee the platform never
		// agreed to.
		slog.Error("cannot derive milestone fee",
			"projectId", projectID, "milestoneId", milestoneID, "error", err)
		return 0, validationErr("milestone pricing does not yield a valid platform fee")
	}
	return fee, nil
}

func (s *PaymentService) ReleaseEscrow(ctx context.Context, in ReleaseEscrowInput) (*store.Transaction, error) {
	if in.Amount <= 0 {
		return nil, validationErr("release amount must be positive")
	}

	// The fee is re-derived rather than validated for plausibility. A range
	// check accepted whatever the caller sent, including the zero fee
	// project-service falls back to on anomalous pricing, which released the
	// whole milestone to the talent and earned the platform nothing.
	wantFee, err := s.expectedFee(ctx, in.MilestoneID, in.ProjectID, in.Amount)
	if err != nil {
		return nil, err
	}
	if in.FeeAmount != wantFee {
		slog.Error("release fee does not match the bracket table",
			"projectId", in.ProjectID, "milestoneId", in.MilestoneID,
			"requested", in.FeeAmount, "expected", wantFee)
		return nil, validationErr(fmt.Sprintf("fee %d does not match the %d this milestone brackets to", in.FeeAmount, wantFee))
	}

	escrowOwnerID, err := s.escrowOwnerFor(ctx, in.MilestoneID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	var workPackageID *string
	if escrowOwnerID != in.ProjectID {
		workPackageID = &escrowOwnerID
	}

	result, err := s.txnStore.Create(ctx, store.CreateTransactionInput{
		ProjectID:      in.ProjectID,
		WorkPackageID:  workPackageID,
		MilestoneID:    &in.MilestoneID,
		TalentID:       &in.TalentID,
		Type:           store.TxTypeEscrowRelease,
		Amount:         in.Amount,
		IdempotencyKey: in.IdempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("create release transaction: %w", err)
	}
	// Only a completed release is a replay. Create commits the row on the pool
	// before the ledger tx runs, so a ledger failure leaves a committed pending
	// row under this key; returning that as success reported the talent paid
	// when no ledger entry existed. project-service then defers to the 14-day
	// auto-release, which reuses the same key and got the same false success,
	// so the money was never paid and no retry remained in the system.
	if !result.IsNew {
		switch result.Transaction.Status {
		case store.TxStatusCompleted, store.TxStatusRefunded:
			slog.Info("idempotent release request", "key", in.IdempotencyKey)
			return &result.Transaction, nil
		default:
			slog.Warn("resuming a release that never settled",
				"key", in.IdempotencyKey,
				"transactionId", result.Transaction.ID,
				"status", result.Transaction.Status)
		}
	}

	txn := result.Transaction

	// Wrap balance check + ledger entries + status update in a single serializable transaction
	dbTx, err := s.ledgerStore.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin release tx: %w", err)
	}
	defer dbTx.Rollback(ctx) //nolint:errcheck

	// A resumed attempt races any other delivery holding the same key. Lock the
	// row and re-check: whoever settles first wins and the loser returns that
	// settlement rather than writing a second set of ledger entries.
	if !result.IsNew {
		lockedStatus, lockErr := s.txnStore.LockStatusTx(ctx, dbTx, txn.ID)
		if lockErr != nil {
			return nil, fmt.Errorf("lock release transaction: %w", lockErr)
		}
		if lockedStatus == store.TxStatusCompleted || lockedStatus == store.TxStatusRefunded {
			txn.Status = lockedStatus
			return &txn, nil
		}
	}

	escrowAccount, err := s.ledgerStore.FindAccountByOwnerTx(ctx, dbTx, store.OwnerEscrow, &escrowOwnerID)
	if err != nil {
		return nil, fmt.Errorf("find escrow account: %w", err)
	}
	if escrowAccount == nil {
		return nil, insufficientErr(fmt.Sprintf("no escrow account holds funds for %s", escrowOwnerID))
	}
	if escrowAccount.Balance < in.Amount {
		return nil, insufficientErr(fmt.Sprintf("insufficient escrow balance: %d < %d", escrowAccount.Balance, in.Amount))
	}

	talentAccount, err := s.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
		OwnerType:   store.OwnerTalent,
		OwnerID:     &in.TalentID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Talent Payout - %s", in.TalentID),
	})
	if err != nil {
		return nil, fmt.Errorf("get talent account: %w", err)
	}

	// Double-entry: the gross milestone leaves escrow, the talent share lands
	// on the talent account and the platform fee is recognised as revenue.
	talentAmount := in.Amount - in.FeeAmount
	meta := map[string]any{"projectId": in.ProjectID, "milestoneId": in.MilestoneID, "talentId": in.TalentID}
	entries := []store.LedgerEntryInput{
		{
			TransactionID: txn.ID,
			AccountID:     talentAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        talentAmount,
			Description:   fmt.Sprintf("Milestone payment for milestone %s", in.MilestoneID),
			Metadata:      meta,
		},
		{
			TransactionID: txn.ID,
			AccountID:     escrowAccount.ID,
			EntryType:     store.EntryCredit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Escrow release for milestone %s", in.MilestoneID),
			Metadata:      meta,
		},
	}
	if in.FeeAmount > 0 {
		platformAccount, accErr := s.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
			OwnerType:   store.OwnerPlatform,
			AccountType: store.AcctRevenue,
			Name:        "Platform Revenue",
		})
		if accErr != nil {
			return nil, fmt.Errorf("get platform revenue account: %w", accErr)
		}
		if platformAccount == nil {
			return nil, fmt.Errorf("platform revenue account unavailable")
		}
		entries = append(entries, store.LedgerEntryInput{
			TransactionID: txn.ID,
			AccountID:     platformAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        in.FeeAmount,
			Description:   fmt.Sprintf("Platform fee for milestone %s", in.MilestoneID),
			Metadata:      meta,
		})
	}
	_, err = s.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, entries)
	if err != nil {
		return nil, fmt.Errorf("create ledger entries: %w", err)
	}

	updated, err := s.txnStore.UpdateStatusTx(ctx, dbTx, txn.ID, store.TxStatusCompleted)
	if err != nil {
		return nil, fmt.Errorf("update status: %w", err)
	}

	prevStatus := store.TxStatusPending
	_, err = s.txnStore.CreateEventTx(ctx, dbTx, store.CreateTransactionEventInput{
		TransactionID:  txn.ID,
		EventType:      store.EventFundsReleased,
		PreviousStatus: &prevStatus,
		NewStatus:      store.TxStatusCompleted,
		Amount:         &in.Amount,
		Metadata:       map[string]any{"projectId": in.ProjectID, "milestoneId": in.MilestoneID, "talentId": in.TalentID},
		PerformedBy:    in.PerformedBy,
	})
	if err != nil {
		return nil, fmt.Errorf("create release event: %w", err)
	}

	if err = store.InsertOutboxEventTx(ctx, dbTx, store.OutboxEvent{
		AggregateType: "payment",
		AggregateID:   txn.ID,
		EventType:     "payment.released",
		Payload: map[string]any{
			"projectId":   in.ProjectID,
			"milestoneId": in.MilestoneID,
			"talentId":    in.TalentID,
			// amount is what the talent actually receives; consumers format
			// it into the payout notification.
			"amount":        talentAmount,
			"grossAmount":   in.Amount,
			"feeAmount":     in.FeeAmount,
			"transactionId": txn.ID,
		},
	}); err != nil {
		return nil, fmt.Errorf("insert outbox event: %w", err)
	}

	if err = dbTx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit release tx: %w", err)
	}

	return updated, nil
}

// One escrow pool giving up part of a refund.
type escrowDraw struct {
	accountID string
	amount    int64
}

// refundableEscrow lists the pools a refund may draw from. A transaction that
// names a work package refunds that package only; anything project-wide can
// reach every pool.
func (s *PaymentService) refundableEscrow(ctx context.Context, dbTx pgx.Tx, original *store.Transaction) ([]store.Account, error) {
	if original.WorkPackageID != nil && *original.WorkPackageID != "" {
		account, err := s.ledgerStore.FindAccountByOwnerTx(ctx, dbTx, store.OwnerEscrow, original.WorkPackageID)
		if err != nil {
			return nil, fmt.Errorf("find escrow account: %w", err)
		}
		if account == nil {
			return nil, nil
		}
		return []store.Account{*account}, nil
	}

	accounts, err := s.ledgerStore.FindEscrowAccountsForProjectTx(ctx, dbTx, original.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("find escrow accounts: %w", err)
	}
	return accounts, nil
}

// drawFromEscrow takes amount out of the pools, fullest first, so a project
// wide refund empties the largest package before it touches the smaller ones
// that a talent may still be working against. Refuses to overdraw: escrow that
// is not there has already been paid out to somebody.
func drawFromEscrow(accounts []store.Account, amount int64) ([]escrowDraw, error) {
	var draws []escrowDraw
	remaining := amount

	for _, account := range accounts {
		if remaining == 0 {
			break
		}
		if account.Balance <= 0 {
			continue
		}
		take := account.Balance
		if take > remaining {
			take = remaining
		}
		draws = append(draws, escrowDraw{accountID: account.ID, amount: take})
		remaining -= take
	}

	if remaining > 0 {
		return nil, insufficientErr(fmt.Sprintf("insufficient escrow balance: %d < %d", amount-remaining, amount))
	}
	return draws, nil
}

func (s *PaymentService) ProcessRefund(ctx context.Context, in ProcessRefundInput) (*store.Transaction, error) {
	if in.Amount <= 0 {
		return nil, validationErr("refund amount must be positive")
	}

	original, err := s.txnStore.FindByID(ctx, in.OriginalTransactionID)
	if err != nil {
		return nil, fmt.Errorf("find original transaction: %w", err)
	}
	if original == nil {
		return nil, notFoundErr("original transaction not found")
	}
	if original.Status == store.TxStatusRefunded {
		return nil, alreadyProcessedErr("transaction already refunded")
	}
	if in.Amount > original.Amount {
		return nil, validationErr("refund amount cannot exceed original transaction amount")
	}

	isPartial := in.Amount < original.Amount
	refundType := store.TxTypeRefund
	if isPartial {
		refundType = store.TxTypePartialRefund
	}

	result, err := s.txnStore.Create(ctx, store.CreateTransactionInput{
		ProjectID:      original.ProjectID,
		WorkPackageID:  original.WorkPackageID,
		MilestoneID:    original.MilestoneID,
		TalentID:       original.TalentID,
		Type:           refundType,
		Amount:         in.Amount,
		IdempotencyKey: in.IdempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("create refund transaction: %w", err)
	}
	// Only a settled refund is a replay. Create commits the row on the pool
	// before the ledger tx runs, and that tx is Serializable so a serialization
	// failure is an expected outcome. A ledger failure therefore leaves a
	// committed pending row under this key, and returning it as success told
	// the owner their money was back when no ledger entry existed. The key was
	// spent, so no retry remained anywhere in the system.
	if !result.IsNew {
		switch result.Transaction.Status {
		case store.TxStatusCompleted, store.TxStatusRefunded:
			slog.Info("idempotent refund request", "key", in.IdempotencyKey)
			return &result.Transaction, nil
		default:
			slog.Warn("resuming a refund that never settled",
				"key", in.IdempotencyKey,
				"transactionId", result.Transaction.ID,
				"status", result.Transaction.Status)
		}
	}

	txn := result.Transaction

	// atomic refund + lock against concurrent refunds
	dbTx, err := s.ledgerStore.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin refund tx: %w", err)
	}
	defer dbTx.Rollback(ctx) //nolint:errcheck

	// A resumed attempt races any other delivery holding the same key. Lock the
	// row and re-check: whoever settles first wins, and the loser returns that
	// settlement instead of writing a second set of ledger entries.
	if !result.IsNew {
		lockedStatus, lockErr := s.txnStore.LockStatusTx(ctx, dbTx, txn.ID)
		if lockErr != nil {
			return nil, fmt.Errorf("lock refund transaction: %w", lockErr)
		}
		if lockedStatus == store.TxStatusCompleted || lockedStatus == store.TxStatusRefunded {
			txn.Status = lockedStatus
			return &txn, nil
		}
	}

	// Race-safe cap, inside the tx. Both sides are project-wide: refunds
	// already paid against escrow actually funded.
	//
	// This used to sum refunds across the project and compare them to the one
	// transaction being refunded. On a project funded twice, refunding the
	// second deposit was rejected because the first had already consumed the
	// project-wide sum, and the owner's retry then saw the first deposit alone
	// satisfy the loop and stop - so the project reported a full refund while
	// the second deposit stayed in escrow forever.
	var totalRefunded, totalFunded int64
	err = dbTx.QueryRow(ctx,
		`SELECT
		   COALESCE(SUM(amount) FILTER (
		     WHERE type IN ('refund', 'partial_refund') AND id <> $2
		   ), 0),
		   COALESCE(SUM(amount) FILTER (WHERE type = 'escrow_in'), 0)
		 FROM transactions
		 WHERE project_id = $1 AND status = 'completed' AND deleted_at IS NULL`,
		original.ProjectID, txn.ID).Scan(&totalRefunded, &totalFunded)
	if err != nil {
		return nil, fmt.Errorf("check refunded amount: %w", err)
	}
	if totalRefunded+in.Amount > totalFunded {
		return nil, insufficientErr("total refund exceeds escrow funded for this project")
	}

	escrowAccounts, err := s.refundableEscrow(ctx, dbTx, original)
	if err != nil {
		return nil, err
	}
	// Same two guards ReleaseEscrow applies. Without them a refund after a
	// full release drove the escrow account negative, paying the same money
	// out twice, and a refund with no escrow account at all completed and
	// published payment.refunded with no double-entry pair behind it.
	draws, err := drawFromEscrow(escrowAccounts, in.Amount)
	if err != nil {
		return nil, err
	}

	ownerAccount, err := s.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
		OwnerType:   store.OwnerOwner,
		OwnerID:     &in.OwnerID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Owner Account - %s", in.OwnerID),
	})
	if err != nil {
		return nil, fmt.Errorf("get owner account: %w", err)
	}

	// debit owner, credit every escrow pool the refund draws from
	refundMeta := map[string]any{"originalTransactionId": in.OriginalTransactionID, "reason": in.Reason}
	refundEntries := []store.LedgerEntryInput{
		{
			TransactionID: txn.ID,
			AccountID:     ownerAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Refund: %s", in.Reason),
			Metadata:      refundMeta,
		},
	}
	for _, draw := range draws {
		refundEntries = append(refundEntries, store.LedgerEntryInput{
			TransactionID: txn.ID,
			AccountID:     draw.accountID,
			EntryType:     store.EntryCredit,
			Amount:        draw.amount,
			Description:   fmt.Sprintf("Refund from escrow: %s", in.Reason),
			Metadata:      refundMeta,
		})
	}
	_, err = s.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, refundEntries)
	if err != nil {
		return nil, fmt.Errorf("create refund ledger entries: %w", err)
	}

	updated, err := s.txnStore.UpdateStatusTx(ctx, dbTx, txn.ID, store.TxStatusCompleted)
	if err != nil {
		return nil, fmt.Errorf("update refund status: %w", err)
	}

	if !isPartial {
		_, err = s.txnStore.UpdateStatusTx(ctx, dbTx, in.OriginalTransactionID, store.TxStatusRefunded)
		if err != nil {
			return nil, fmt.Errorf("mark original refunded: %w", err)
		}
	}

	prevStatus := store.TxStatusPending
	_, err = s.txnStore.CreateEventTx(ctx, dbTx, store.CreateTransactionEventInput{
		TransactionID:  txn.ID,
		EventType:      store.EventRefundInitiated,
		PreviousStatus: &prevStatus,
		NewStatus:      store.TxStatusCompleted,
		Amount:         &in.Amount,
		Metadata:       map[string]any{"originalTransactionId": in.OriginalTransactionID, "reason": in.Reason, "isPartial": isPartial},
		PerformedBy:    in.PerformedBy,
	})
	if err != nil {
		return nil, fmt.Errorf("create refund event: %w", err)
	}

	refundEventType := "payment.refunded"
	if isPartial {
		refundEventType = "payment.partial_refund"
	}
	if err = store.InsertOutboxEventTx(ctx, dbTx, store.OutboxEvent{
		AggregateType: "payment",
		AggregateID:   txn.ID,
		EventType:     refundEventType,
		Payload: map[string]any{
			"projectId":             original.ProjectID,
			"originalTransactionId": in.OriginalTransactionID,
			"amount":                in.Amount,
			"transactionId":         txn.ID,
			"reason":                in.Reason,
			"isPartial":             isPartial,
		},
	}); err != nil {
		return nil, fmt.Errorf("insert outbox event: %w", err)
	}

	if err = dbTx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit refund tx: %w", err)
	}

	return updated, nil
}

// Maps checkout type to transaction type.
func checkoutTxType(checkoutType string) (string, error) {
	switch checkoutType {
	case store.CheckoutBRD:
		return store.TxTypeBRDPayment, nil
	case store.CheckoutPRD:
		return store.TxTypePRDPayment, nil
	case store.CheckoutEscrow:
		return store.TxTypeEscrowIn, nil
	case store.CheckoutRevision:
		return store.TxTypeRevisionFee, nil
	default:
		return "", validationErr("checkoutType must be brd, prd, escrow or revision")
	}
}

// Moderate-rate revision fee per policy: 10% of the milestone amount.
const revisionFeePercent = 10

func (s *PaymentService) CreateSnapToken(ctx context.Context, in CreateSnapTokenInput) (*SnapTokenResult, error) {
	if in.OrderID == "" {
		return nil, validationErr("orderId is required")
	}
	if in.CustomerEmail == "" {
		return nil, validationErr("customerEmail is required")
	}

	txType, err := checkoutTxType(in.CheckoutType)
	if err != nil {
		return nil, err
	}

	var amount int64
	var milestoneID *string
	if in.CheckoutType == store.CheckoutRevision {
		if in.MilestoneID == "" {
			return nil, validationErr("milestoneId is required for a revision checkout")
		}
		msAmount, err := s.txnStore.GetMilestoneAmount(ctx, in.MilestoneID, in.ProjectID)
		if err != nil {
			return nil, fmt.Errorf("resolve milestone amount: %w", err)
		}
		amount = (msAmount*revisionFeePercent + 99) / 100
		milestoneID = &in.MilestoneID
	} else {
		amount, err = s.txnStore.GetCheckoutAmount(ctx, in.ProjectID, in.CheckoutType)
		if err != nil {
			return nil, fmt.Errorf("resolve checkout amount: %w", err)
		}
	}
	if amount <= 0 {
		return nil, notFoundErr("no priced document for this checkout")
	}

	// Webhook matches order_id to this row.
	result, err := s.txnStore.Create(ctx, store.CreateTransactionInput{
		ProjectID:      in.ProjectID,
		MilestoneID:    milestoneID,
		Type:           txType,
		Amount:         amount,
		IdempotencyKey: in.OrderID,
	})
	if err != nil {
		return nil, fmt.Errorf("create checkout transaction: %w", err)
	}

	// A reused order id keeps the stored row untouched while the Snap request
	// below is built from the freshly priced amount. Midtrans would capture the
	// new figure, then the webhook compares it to the stale row and rejects it
	// as an amount mismatch: money taken, escrow never funded. Reuse is only
	// safe when the amount has not moved.
	if !result.IsNew && result.Transaction.Amount != amount {
		return nil, conflictErr("order id already used for a different amount")
	}

	// Build Midtrans Snap request body
	snapReq := map[string]any{
		"transaction_details": map[string]any{
			"order_id":     in.OrderID,
			"gross_amount": amount,
		},
		"customer_details": map[string]any{
			"first_name": in.CustomerName,
			"email":      in.CustomerEmail,
		},
	}

	if in.ItemName != "" {
		snapReq["item_details"] = []map[string]any{
			{
				"id":       in.ProjectID,
				"price":    amount,
				"quantity": 1,
				"name":     truncate(in.ItemName, 50),
			},
		}
	}

	body, err := json.Marshal(snapReq)
	if err != nil {
		return nil, fmt.Errorf("marshal snap request: %w", err)
	}

	// Call Midtrans Snap API
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.midtransSnapURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create snap request: %w", err)
	}

	authHeader := base64.StdEncoding.EncodeToString([]byte(s.midtransServerKey + ":"))
	req.Header.Set("Authorization", "Basic "+authHeader)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := midtransClient.Do(req)
	if err != nil {
		slog.Error("midtrans snap API call failed", "error", err)
		return nil, externalServiceErr("failed to connect to payment gateway")
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read snap response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		slog.Error("midtrans snap API error",
			"status", resp.StatusCode,
			"body", string(respBody),
			"orderId", in.OrderID,
		)
		return nil, externalServiceErr(fmt.Sprintf("payment gateway returned status %d", resp.StatusCode))
	}

	var snapResp struct {
		Token       string `json:"token"`
		RedirectURL string `json:"redirect_url"`
	}
	if err := json.Unmarshal(respBody, &snapResp); err != nil {
		return nil, fmt.Errorf("unmarshal snap response: %w", err)
	}

	if snapResp.Token == "" {
		slog.Error("midtrans snap returned empty token", "body", string(respBody))
		return nil, externalServiceErr("payment gateway returned empty token")
	}

	slog.Info("snap token created", "orderId", in.OrderID, "projectId", in.ProjectID)

	return &SnapTokenResult{
		Token:       snapResp.Token,
		RedirectURL: snapResp.RedirectURL,
	}, nil
}

// truncate limits a string to maxLen characters
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func (s *PaymentService) GetProjectTransactions(ctx context.Context, projectID string) ([]store.Transaction, error) {
	return s.txnStore.FindByProjectID(ctx, projectID)
}

func (s *PaymentService) GetTransactionByID(ctx context.Context, id string) (*TransactionDetail, error) {
	txn, err := s.txnStore.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("find transaction: %w", err)
	}
	if txn == nil {
		return nil, notFoundErr("transaction not found")
	}

	events, err := s.txnStore.GetEventsByTransaction(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get events: %w", err)
	}

	entries, err := s.ledgerStore.GetEntriesByTransaction(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get ledger entries: %w", err)
	}

	return &TransactionDetail{
		Transaction:   *txn,
		Events:        events,
		LedgerEntries: entries,
	}, nil
}

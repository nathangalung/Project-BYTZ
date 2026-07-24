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
func insufficientErr(msg string) *AppError {
	return newAppError("PAYMENT_ESCROW_INSUFFICIENT_FUNDS", msg, 400)
}
func alreadyProcessedErr(msg string) *AppError {
	return newAppError("PAYMENT_ALREADY_PROCESSED", msg, 409)
}
func externalServiceErr(msg string) *AppError { return newAppError("EXTERNAL_SERVICE_ERROR", msg, 502) }

type CreateEscrowInput struct {
	ProjectID      string
	Amount         int64
	WorkPackageID  *string
	TalentID       *string
	OwnerID        string
	IdempotencyKey string
}

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

func (s *PaymentService) CreateEscrow(ctx context.Context, in CreateEscrowInput) (*store.Transaction, error) {
	if in.Amount <= 0 {
		return nil, validationErr("escrow amount must be positive")
	}

	result, err := s.txnStore.Create(ctx, store.CreateTransactionInput{
		ProjectID:      in.ProjectID,
		WorkPackageID:  in.WorkPackageID,
		TalentID:       in.TalentID,
		Type:           store.TxTypeEscrowIn,
		Amount:         in.Amount,
		IdempotencyKey: in.IdempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("create escrow transaction: %w", err)
	}
	// idempotent replay
	if !result.IsNew {
		slog.Info("idempotent escrow request", "key", in.IdempotencyKey, "status", result.Transaction.Status)
		return &result.Transaction, nil
	}

	txn := result.Transaction

	// atomic ledger + status
	dbTx, err := s.ledgerStore.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin escrow tx: %w", err)
	}
	defer dbTx.Rollback(ctx) //nolint:errcheck

	ownerAccount, err := s.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
		OwnerType:   store.OwnerOwner,
		OwnerID:     &in.OwnerID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Owner Account - %s", in.OwnerID),
	})
	if err != nil {
		return nil, fmt.Errorf("get owner account: %w", err)
	}

	escrowAccount, err := s.ledgerStore.GetOrCreateAccountTx(ctx, dbTx, store.CreateAccountInput{
		OwnerType:   store.OwnerEscrow,
		OwnerID:     &in.ProjectID,
		AccountType: store.AcctLiability,
		Name:        fmt.Sprintf("Escrow - Project %s", in.ProjectID),
	})
	if err != nil {
		return nil, fmt.Errorf("get escrow account: %w", err)
	}

	// debit escrow, credit owner
	_, err = s.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, []store.LedgerEntryInput{
		{
			TransactionID: txn.ID,
			AccountID:     escrowAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Escrow deposit for project %s", in.ProjectID),
			Metadata:      map[string]any{"projectId": in.ProjectID, "workPackageId": in.WorkPackageID},
		},
		{
			TransactionID: txn.ID,
			AccountID:     ownerAccount.ID,
			EntryType:     store.EntryCredit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Escrow deposit for project %s", in.ProjectID),
			Metadata:      map[string]any{"projectId": in.ProjectID, "workPackageId": in.WorkPackageID},
		},
	})
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
		EventType:      store.EventEscrowCreated,
		PreviousStatus: &prevStatus,
		NewStatus:      store.TxStatusCompleted,
		Amount:         &in.Amount,
		Metadata:       map[string]any{"projectId": in.ProjectID, "workPackageId": in.WorkPackageID, "ownerId": in.OwnerID},
		PerformedBy:    in.OwnerID,
	})
	if err != nil {
		return nil, fmt.Errorf("create escrow event: %w", err)
	}

	if err = store.InsertOutboxEventTx(ctx, dbTx, store.OutboxEvent{
		AggregateType: "payment",
		AggregateID:   txn.ID,
		EventType:     "payment.escrow.created",
		Payload: map[string]any{
			"projectId":     in.ProjectID,
			"workPackageId": in.WorkPackageID,
			"talentId":      in.TalentID,
			"ownerId":       in.OwnerID,
			"amount":        in.Amount,
			"transactionId": txn.ID,
		},
	}); err != nil {
		return nil, fmt.Errorf("insert outbox event: %w", err)
	}

	if err = dbTx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit escrow tx: %w", err)
	}

	return updated, nil
}

// GetEscrowBalance returns the remaining escrow ledger balance for a project,
// zero when the project has no escrow account yet.
func (s *PaymentService) GetEscrowBalance(ctx context.Context, projectID string) (int64, error) {
	account, err := s.ledgerStore.FindAccountByOwner(ctx, store.OwnerEscrow, &projectID)
	if err != nil {
		return 0, fmt.Errorf("find escrow account: %w", err)
	}
	if account == nil {
		return 0, nil
	}
	return account.Balance, nil
}

func (s *PaymentService) ReleaseEscrow(ctx context.Context, in ReleaseEscrowInput) (*store.Transaction, error) {
	if in.Amount <= 0 {
		return nil, validationErr("release amount must be positive")
	}
	if in.FeeAmount < 0 || in.FeeAmount >= in.Amount {
		return nil, validationErr("fee must be non-negative and below the release amount")
	}

	result, err := s.txnStore.Create(ctx, store.CreateTransactionInput{
		ProjectID:      in.ProjectID,
		MilestoneID:    &in.MilestoneID,
		TalentID:       &in.TalentID,
		Type:           store.TxTypeEscrowRelease,
		Amount:         in.Amount,
		IdempotencyKey: in.IdempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("create release transaction: %w", err)
	}
	if !result.IsNew {
		slog.Info("idempotent release request", "key", in.IdempotencyKey)
		return &result.Transaction, nil
	}

	txn := result.Transaction

	// Wrap balance check + ledger entries + status update in a single serializable transaction
	dbTx, err := s.ledgerStore.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin release tx: %w", err)
	}
	defer dbTx.Rollback(ctx) //nolint:errcheck

	escrowAccount, err := s.ledgerStore.FindAccountByOwnerTx(ctx, dbTx, store.OwnerEscrow, &in.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("find escrow account: %w", err)
	}
	if escrowAccount == nil {
		return nil, insufficientErr("escrow account not found for this project")
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
	// idempotent replay
	if !result.IsNew {
		slog.Info("idempotent refund request", "key", in.IdempotencyKey, "status", result.Transaction.Status)
		return &result.Transaction, nil
	}

	txn := result.Transaction

	// atomic refund + lock against concurrent refunds
	dbTx, err := s.ledgerStore.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin refund tx: %w", err)
	}
	defer dbTx.Rollback(ctx) //nolint:errcheck

	// race-safe sum check inside tx
	var totalRefunded int64
	err = dbTx.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM transactions
		 WHERE project_id = $1 AND type IN ('refund', 'partial_refund')
		 AND status = 'completed' AND id <> $2`,
		original.ProjectID, txn.ID).Scan(&totalRefunded)
	if err != nil {
		return nil, fmt.Errorf("check refunded amount: %w", err)
	}
	if totalRefunded+in.Amount > original.Amount {
		return nil, insufficientErr("total refund exceeds original amount")
	}

	escrowAccount, err := s.ledgerStore.FindAccountByOwnerTx(ctx, dbTx, store.OwnerEscrow, &original.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("find escrow account: %w", err)
	}
	// Same two guards ReleaseEscrow applies. Without them a refund after a
	// full release drove the escrow account negative, paying the same money
	// out twice, and a refund with no escrow account at all completed and
	// published payment.refunded with no double-entry pair behind it.
	if escrowAccount == nil {
		return nil, insufficientErr("escrow account not found for this project")
	}
	if escrowAccount.Balance < in.Amount {
		return nil, insufficientErr(fmt.Sprintf("insufficient escrow balance: %d < %d", escrowAccount.Balance, in.Amount))
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

	// debit owner, credit escrow
	_, err = s.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, []store.LedgerEntryInput{
		{
			TransactionID: txn.ID,
			AccountID:     ownerAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Refund: %s", in.Reason),
			Metadata:      map[string]any{"originalTransactionId": in.OriginalTransactionID, "reason": in.Reason},
		},
		{
			TransactionID: txn.ID,
			AccountID:     escrowAccount.ID,
			EntryType:     store.EntryCredit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Refund from escrow: %s", in.Reason),
			Metadata:      map[string]any{"originalTransactionId": in.OriginalTransactionID, "reason": in.Reason},
		},
	})
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
	if _, err := s.txnStore.Create(ctx, store.CreateTransactionInput{
		ProjectID:      in.ProjectID,
		MilestoneID:    milestoneID,
		Type:           txType,
		Amount:         amount,
		IdempotencyKey: in.OrderID,
	}); err != nil {
		return nil, fmt.Errorf("create checkout transaction: %w", err)
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

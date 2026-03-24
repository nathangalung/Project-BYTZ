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

	"github.com/bytz/payment-service/internal/store"
	"github.com/jackc/pgx/v5"
)

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
func validationErr(msg string) *AppError  { return newAppError("VALIDATION_ERROR", msg, 400) }
func notFoundErr(msg string) *AppError    { return newAppError("NOT_FOUND", msg, 404) }
func insufficientErr(msg string) *AppError { return newAppError("PAYMENT_ESCROW_INSUFFICIENT_FUNDS", msg, 400) }
func alreadyProcessedErr(msg string) *AppError { return newAppError("PAYMENT_ALREADY_PROCESSED", msg, 409) }
func externalServiceErr(msg string) *AppError  { return newAppError("EXTERNAL_SERVICE_ERROR", msg, 502) }

type CreateEscrowInput struct {
	ProjectID      string
	Amount         int64
	WorkPackageID  *string
	TalentID       *string
	OwnerID        string
	IdempotencyKey string
}

type ReleaseEscrowInput struct {
	MilestoneID    string
	ProjectID      string
	TalentID       string
	Amount         int64
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
	Amount       int64
	ItemName     string
	CustomerName string
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
	if !result.IsNew {
		slog.Info("idempotent escrow request", "key", in.IdempotencyKey)
		return &result.Transaction, nil
	}

	txn := result.Transaction

	// Get or create accounts for double-entry bookkeeping
	ownerAccount, err := s.ledgerStore.GetOrCreateAccount(ctx, store.CreateAccountInput{
		OwnerType:   store.OwnerOwner,
		OwnerID:     &in.OwnerID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Owner Account - %s", in.OwnerID),
	})
	if err != nil {
		return nil, fmt.Errorf("get owner account: %w", err)
	}

	escrowAccount, err := s.ledgerStore.GetOrCreateAccount(ctx, store.CreateAccountInput{
		OwnerType:   store.OwnerEscrow,
		OwnerID:     &in.ProjectID,
		AccountType: store.AcctLiability,
		Name:        fmt.Sprintf("Escrow - Project %s", in.ProjectID),
	})
	if err != nil {
		return nil, fmt.Errorf("get escrow account: %w", err)
	}

	// Double-entry: debit escrow (money held), credit owner (money out)
	_, err = s.ledgerStore.CreateLedgerEntries(ctx, []store.LedgerEntryInput{
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

	updated, err := s.txnStore.UpdateStatus(ctx, txn.ID, store.TxStatusCompleted)
	if err != nil {
		return nil, fmt.Errorf("update status: %w", err)
	}

	prevStatus := store.TxStatusPending
	_, err = s.txnStore.CreateEvent(ctx, store.CreateTransactionEventInput{
		TransactionID:  txn.ID,
		EventType:      store.EventEscrowCreated,
		PreviousStatus: &prevStatus,
		NewStatus:      store.TxStatusCompleted,
		Amount:         &in.Amount,
		Metadata:       map[string]any{"projectId": in.ProjectID, "workPackageId": in.WorkPackageID, "ownerId": in.OwnerID},
		PerformedBy:    in.OwnerID,
	})
	if err != nil {
		slog.Error("failed to create escrow event", "error", err, "transactionId", txn.ID)
	}

	return updated, nil
}

func (s *PaymentService) ReleaseEscrow(ctx context.Context, in ReleaseEscrowInput) (*store.Transaction, error) {
	if in.Amount <= 0 {
		return nil, validationErr("release amount must be positive")
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

	// Double-entry: debit talent (money in), credit escrow (money out)
	_, err = s.ledgerStore.CreateLedgerEntriesTx(ctx, dbTx, []store.LedgerEntryInput{
		{
			TransactionID: txn.ID,
			AccountID:     talentAccount.ID,
			EntryType:     store.EntryDebit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Milestone payment for milestone %s", in.MilestoneID),
			Metadata:      map[string]any{"projectId": in.ProjectID, "milestoneId": in.MilestoneID, "talentId": in.TalentID},
		},
		{
			TransactionID: txn.ID,
			AccountID:     escrowAccount.ID,
			EntryType:     store.EntryCredit,
			Amount:        in.Amount,
			Description:   fmt.Sprintf("Escrow release for milestone %s", in.MilestoneID),
			Metadata:      map[string]any{"projectId": in.ProjectID, "milestoneId": in.MilestoneID, "talentId": in.TalentID},
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

	// Check total already-refunded amount to prevent double-spend
	var totalRefunded int64
	err = s.txnStore.Pool().QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM transactions
		 WHERE project_id = $1 AND type IN ('refund', 'partial_refund')
		 AND status = 'completed'`,
		original.ProjectID).Scan(&totalRefunded)
	if err != nil {
		return nil, fmt.Errorf("check refunded amount: %w", err)
	}

	if totalRefunded+in.Amount > original.Amount {
		return nil, insufficientErr("total refund exceeds original amount")
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
	if !result.IsNew {
		slog.Info("idempotent refund request", "key", in.IdempotencyKey)
		return &result.Transaction, nil
	}

	txn := result.Transaction

	escrowAccount, err := s.ledgerStore.FindAccountByOwner(ctx, store.OwnerEscrow, &original.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("find escrow account: %w", err)
	}

	ownerAccount, err := s.ledgerStore.GetOrCreateAccount(ctx, store.CreateAccountInput{
		OwnerType:   store.OwnerOwner,
		OwnerID:     &in.OwnerID,
		AccountType: store.AcctAsset,
		Name:        fmt.Sprintf("Owner Account - %s", in.OwnerID),
	})
	if err != nil {
		return nil, fmt.Errorf("get owner account: %w", err)
	}

	if escrowAccount != nil {
		// Double-entry: debit owner (money back), credit escrow (money out)
		_, err = s.ledgerStore.CreateLedgerEntries(ctx, []store.LedgerEntryInput{
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
	}

	updated, err := s.txnStore.UpdateStatus(ctx, txn.ID, store.TxStatusCompleted)
	if err != nil {
		return nil, fmt.Errorf("update refund status: %w", err)
	}

	// Mark original as refunded if full refund
	if !isPartial {
		_, err = s.txnStore.UpdateStatus(ctx, in.OriginalTransactionID, store.TxStatusRefunded)
		if err != nil {
			slog.Error("failed to mark original as refunded", "error", err, "id", in.OriginalTransactionID)
		}
	}

	prevStatus := store.TxStatusPending
	_, err = s.txnStore.CreateEvent(ctx, store.CreateTransactionEventInput{
		TransactionID:  txn.ID,
		EventType:      store.EventRefundInitiated,
		PreviousStatus: &prevStatus,
		NewStatus:      store.TxStatusCompleted,
		Amount:         &in.Amount,
		Metadata:       map[string]any{"originalTransactionId": in.OriginalTransactionID, "reason": in.Reason, "isPartial": isPartial},
		PerformedBy:    in.PerformedBy,
	})
	if err != nil {
		slog.Error("failed to create refund event", "error", err, "transactionId", txn.ID)
	}

	return updated, nil
}

func (s *PaymentService) CreateSnapToken(ctx context.Context, in CreateSnapTokenInput) (*SnapTokenResult, error) {
	if in.Amount <= 0 {
		return nil, validationErr("amount must be positive")
	}
	if in.OrderID == "" {
		return nil, validationErr("orderId is required")
	}
	if in.CustomerEmail == "" {
		return nil, validationErr("customerEmail is required")
	}

	// Build Midtrans Snap request body
	snapReq := map[string]any{
		"transaction_details": map[string]any{
			"order_id":     in.OrderID,
			"gross_amount": in.Amount,
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
				"price":    in.Amount,
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

	resp, err := http.DefaultClient.Do(req)
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

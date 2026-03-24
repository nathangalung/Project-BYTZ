package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Transaction types matching the DB enum
const (
	TxTypeEscrowIn           = "escrow_in"
	TxTypeEscrowRelease      = "escrow_release"
	TxTypeBRDPayment         = "brd_payment"
	TxTypePRDPayment         = "prd_payment"
	TxTypeRefund             = "refund"
	TxTypePartialRefund      = "partial_refund"
	TxTypeRevisionFee        = "revision_fee"
	TxTypeTalentPlacementFee = "talent_placement_fee"
)

// Transaction statuses matching the DB enum
const (
	TxStatusPending    = "pending"
	TxStatusProcessing = "processing"
	TxStatusCompleted  = "completed"
	TxStatusFailed     = "failed"
	TxStatusRefunded   = "refunded"
)

// Transaction event types matching the DB enum
const (
	EventEscrowCreated    = "escrow_created"
	EventMilestoneSubmit  = "milestone_submitted"
	EventMilestoneApprove = "milestone_approved"
	EventFundsReleased    = "funds_released"
	EventRefundInitiated  = "refund_initiated"
	EventDisputeOpened    = "dispute_opened"
	EventDisputeResolved  = "dispute_resolved"
)

type Transaction struct {
	ID                string     `json:"id"`
	ProjectID         string     `json:"projectId"`
	WorkPackageID     *string    `json:"workPackageId"`
	MilestoneID       *string    `json:"milestoneId"`
	TalentID          *string    `json:"talentId"`
	Type              string     `json:"type"`
	Amount            int64      `json:"amount"`
	Status            string     `json:"status"`
	PaymentMethod     *string    `json:"paymentMethod"`
	PaymentGatewayRef *string    `json:"paymentGatewayRef"`
	IdempotencyKey    string     `json:"idempotencyKey"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	DeletedAt         *time.Time `json:"deletedAt,omitempty"`
}

type TransactionEvent struct {
	ID             string          `json:"id"`
	TransactionID  string          `json:"transactionId"`
	EventType      string          `json:"eventType"`
	PreviousStatus *string         `json:"previousStatus"`
	NewStatus      string          `json:"newStatus"`
	Amount         *int64          `json:"amount"`
	Metadata       json.RawMessage `json:"metadata"`
	PerformedBy    string          `json:"performedBy"`
	CreatedAt      time.Time       `json:"createdAt"`
}

type CreateTransactionInput struct {
	ProjectID         string
	WorkPackageID     *string
	MilestoneID       *string
	TalentID          *string
	Type              string
	Amount            int64
	IdempotencyKey    string
	PaymentMethod     *string
	PaymentGatewayRef *string
}

type CreateTransactionEventInput struct {
	TransactionID  string
	EventType      string
	PreviousStatus *string
	NewStatus      string
	Amount         *int64
	Metadata       map[string]any
	PerformedBy    string
}

// CreateResult holds the created (or existing) transaction and whether it was newly created.
type CreateResult struct {
	Transaction Transaction
	IsNew       bool
}

type TransactionStore struct {
	pool *pgxpool.Pool
}

func NewTransactionStore(pool *pgxpool.Pool) *TransactionStore {
	return &TransactionStore{pool: pool}
}

func (s *TransactionStore) FindByIdempotencyKey(ctx context.Context, key string) (*Transaction, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, project_id, work_package_id, milestone_id, talent_id,
		       type, amount, status, payment_method, payment_gateway_ref,
		       idempotency_key, created_at, updated_at, deleted_at
		FROM transactions
		WHERE idempotency_key = $1 AND deleted_at IS NULL
		LIMIT 1
	`, key)

	return scanTransaction(row)
}

func (s *TransactionStore) Create(ctx context.Context, in CreateTransactionInput) (*CreateResult, error) {
	existing, err := s.FindByIdempotencyKey(ctx, in.IdempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("idempotency check: %w", err)
	}
	if existing != nil {
		return &CreateResult{Transaction: *existing, IsNew: false}, nil
	}

	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()

	row := s.pool.QueryRow(ctx, `
		INSERT INTO transactions (
			id, project_id, work_package_id, milestone_id, talent_id,
			type, amount, status, payment_method, payment_gateway_ref,
			idempotency_key, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING id, project_id, work_package_id, milestone_id, talent_id,
		          type, amount, status, payment_method, payment_gateway_ref,
		          idempotency_key, created_at, updated_at, deleted_at
	`, id, in.ProjectID, in.WorkPackageID, in.MilestoneID, in.TalentID,
		in.Type, in.Amount, TxStatusPending, in.PaymentMethod, in.PaymentGatewayRef,
		in.IdempotencyKey, now, now)

	tx, err := scanTransaction(row)
	if err != nil {
		return nil, fmt.Errorf("insert transaction: %w", err)
	}
	return &CreateResult{Transaction: *tx, IsNew: true}, nil
}

func (s *TransactionStore) FindByID(ctx context.Context, id string) (*Transaction, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, project_id, work_package_id, milestone_id, talent_id,
		       type, amount, status, payment_method, payment_gateway_ref,
		       idempotency_key, created_at, updated_at, deleted_at
		FROM transactions
		WHERE id = $1 AND deleted_at IS NULL
		LIMIT 1
	`, id)

	return scanTransaction(row)
}

func (s *TransactionStore) FindByProjectID(ctx context.Context, projectID string) ([]Transaction, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, project_id, work_package_id, milestone_id, talent_id,
		       type, amount, status, payment_method, payment_gateway_ref,
		       idempotency_key, created_at, updated_at, deleted_at
		FROM transactions
		WHERE project_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query by project: %w", err)
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		tx, err := scanTransactionRows(rows)
		if err != nil {
			return nil, err
		}
		txns = append(txns, *tx)
	}
	return txns, rows.Err()
}

func (s *TransactionStore) UpdateStatus(ctx context.Context, id, status string) (*Transaction, error) {
	now := time.Now().UTC()
	row := s.pool.QueryRow(ctx, `
		UPDATE transactions SET status = $1, updated_at = $2
		WHERE id = $3
		RETURNING id, project_id, work_package_id, milestone_id, talent_id,
		          type, amount, status, payment_method, payment_gateway_ref,
		          idempotency_key, created_at, updated_at, deleted_at
	`, status, now, id)

	return scanTransaction(row)
}

// UpdateStatusTx updates a transaction status within an existing pgx.Tx.
func (s *TransactionStore) UpdateStatusTx(ctx context.Context, tx pgx.Tx, id, status string) (*Transaction, error) {
	now := time.Now().UTC()
	row := tx.QueryRow(ctx, `
		UPDATE transactions SET status = $1, updated_at = $2
		WHERE id = $3
		RETURNING id, project_id, work_package_id, milestone_id, talent_id,
		          type, amount, status, payment_method, payment_gateway_ref,
		          idempotency_key, created_at, updated_at, deleted_at
	`, status, now, id)

	return scanTransaction(row)
}

func (s *TransactionStore) CreateEvent(ctx context.Context, in CreateTransactionEventInput) (*TransactionEvent, error) {
	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()

	metaJSON, err := json.Marshal(in.Metadata)
	if err != nil {
		return nil, fmt.Errorf("marshal metadata: %w", err)
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO transaction_events (
			id, transaction_id, event_type, previous_status, new_status,
			amount, metadata, performed_by, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, transaction_id, event_type, previous_status, new_status,
		          amount, metadata, performed_by, created_at
	`, id, in.TransactionID, in.EventType, in.PreviousStatus, in.NewStatus,
		in.Amount, metaJSON, in.PerformedBy, now)

	return scanTransactionEvent(row)
}

// CreateEventTx creates a transaction event within an existing pgx.Tx.
func (s *TransactionStore) CreateEventTx(ctx context.Context, tx pgx.Tx, in CreateTransactionEventInput) (*TransactionEvent, error) {
	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()

	metaJSON, err := json.Marshal(in.Metadata)
	if err != nil {
		return nil, fmt.Errorf("marshal metadata: %w", err)
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO transaction_events (
			id, transaction_id, event_type, previous_status, new_status,
			amount, metadata, performed_by, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, transaction_id, event_type, previous_status, new_status,
		          amount, metadata, performed_by, created_at
	`, id, in.TransactionID, in.EventType, in.PreviousStatus, in.NewStatus,
		in.Amount, metaJSON, in.PerformedBy, now)

	return scanTransactionEvent(row)
}

func (s *TransactionStore) GetEventsByTransaction(ctx context.Context, transactionID string) ([]TransactionEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, transaction_id, event_type, previous_status, new_status,
		       amount, metadata, performed_by, created_at
		FROM transaction_events
		WHERE transaction_id = $1
		ORDER BY created_at DESC
	`, transactionID)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var events []TransactionEvent
	for rows.Next() {
		ev, err := scanTransactionEventRows(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, *ev)
	}
	return events, rows.Err()
}

// FindByIdempotencyKeyForWebhook looks up a transaction by idempotency_key (used as order_id by Midtrans).
func (s *TransactionStore) FindByIdempotencyKeyForWebhook(ctx context.Context, orderID string) (*Transaction, error) {
	return s.FindByIdempotencyKey(ctx, orderID)
}

// UpdateWebhookTx updates transaction fields from a webhook within a pgx.Tx.
func (s *TransactionStore) UpdateWebhookTx(ctx context.Context, tx pgx.Tx, id, status string, paymentMethod, gatewayRef *string) (*Transaction, error) {
	now := time.Now().UTC()
	row := tx.QueryRow(ctx, `
		UPDATE transactions
		SET status = $1,
		    payment_method = COALESCE($2, payment_method),
		    payment_gateway_ref = COALESCE($3, payment_gateway_ref),
		    updated_at = $4
		WHERE id = $5
		RETURNING id, project_id, work_package_id, milestone_id, talent_id,
		          type, amount, status, payment_method, payment_gateway_ref,
		          idempotency_key, created_at, updated_at, deleted_at
	`, status, paymentMethod, gatewayRef, now, id)

	return scanTransaction(row)
}

// GetProjectOwnerID returns the owner_id of a project, or empty string if not found.
func (s *TransactionStore) GetProjectOwnerID(ctx context.Context, projectID string) (string, error) {
	var ownerID string
	err := s.pool.QueryRow(ctx,
		`SELECT owner_id FROM projects WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
		projectID,
	).Scan(&ownerID)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("query project owner: %w", err)
	}
	return ownerID, nil
}

// Pool exposes the underlying pool for use with BeginTx.
func (s *TransactionStore) Pool() PoolIface {
	return s.pool
}

// --- row scanners ---

func scanTransaction(row pgx.Row) (*Transaction, error) {
	var t Transaction
	err := row.Scan(
		&t.ID, &t.ProjectID, &t.WorkPackageID, &t.MilestoneID, &t.TalentID,
		&t.Type, &t.Amount, &t.Status, &t.PaymentMethod, &t.PaymentGatewayRef,
		&t.IdempotencyKey, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan transaction: %w", err)
	}
	return &t, nil
}

func scanTransactionRows(rows pgx.Rows) (*Transaction, error) {
	var t Transaction
	err := rows.Scan(
		&t.ID, &t.ProjectID, &t.WorkPackageID, &t.MilestoneID, &t.TalentID,
		&t.Type, &t.Amount, &t.Status, &t.PaymentMethod, &t.PaymentGatewayRef,
		&t.IdempotencyKey, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan transaction row: %w", err)
	}
	return &t, nil
}

func scanTransactionEvent(row pgx.Row) (*TransactionEvent, error) {
	var e TransactionEvent
	err := row.Scan(
		&e.ID, &e.TransactionID, &e.EventType, &e.PreviousStatus, &e.NewStatus,
		&e.Amount, &e.Metadata, &e.PerformedBy, &e.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan transaction event: %w", err)
	}
	return &e, nil
}

func scanTransactionEventRows(rows pgx.Rows) (*TransactionEvent, error) {
	var e TransactionEvent
	err := rows.Scan(
		&e.ID, &e.TransactionID, &e.EventType, &e.PreviousStatus, &e.NewStatus,
		&e.Amount, &e.Metadata, &e.PerformedBy, &e.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan transaction event row: %w", err)
	}
	return &e, nil
}

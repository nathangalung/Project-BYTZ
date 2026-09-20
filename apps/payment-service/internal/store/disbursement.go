package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Disbursement statuses matching the DB enum. A disbursement tracks a real bank
// movement through Iris, separate from the ledger's account of what is owed.
const (
	DisbursementPending   = "pending"
	DisbursementQueued    = "queued"
	DisbursementProcessed = "processed"
	DisbursementCompleted = "completed"
	DisbursementFailed    = "failed"
)

// TalentPayoutAccount is a talent's destination as stored on their profile.
// Verified reports whether payout_verified_at is set: only a verified account is
// paid, so a talent whose account was never confirmed accrues in the ledger but
// is not disbursed to unchecked digits.
type TalentPayoutAccount struct {
	Provider   string
	Account    string
	HolderName string
	Verified   bool
}

type Disbursement struct {
	ID                  string     `json:"id"`
	ProjectID           string     `json:"projectId"`
	MilestoneID         *string    `json:"milestoneId"`
	WorkPackageID       *string    `json:"workPackageId"`
	TalentID            string     `json:"talentId"`
	TransactionID       *string    `json:"transactionId"`
	Amount              int64      `json:"amount"`
	BeneficiaryProvider string     `json:"beneficiaryProvider"`
	BeneficiaryAccount  string     `json:"beneficiaryAccount"`
	BeneficiaryName     string     `json:"beneficiaryName"`
	Status              string     `json:"status"`
	IrisReferenceNo     *string    `json:"irisReferenceNo"`
	IdempotencyKey      string     `json:"idempotencyKey"`
	ApprovedBy          *string    `json:"approvedBy"`
	ApprovedAt          *time.Time `json:"approvedAt"`
	FailureReason       *string    `json:"failureReason"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

// EnqueueDisbursementInput is a pending payout to record inside the release
// transaction. Amount is the net owed to the talent (gross minus platform fee).
type EnqueueDisbursementInput struct {
	ProjectID      string
	TalentID       string
	MilestoneID    *string
	WorkPackageID  *string
	TransactionID  *string
	Amount         int64
	Provider       string
	Account        string
	HolderName     string
	IdempotencyKey string
}

type DisbursementStore struct {
	pool PoolIface
}

func NewDisbursementStore(pool *pgxpool.Pool) *DisbursementStore {
	return &DisbursementStore{pool: pool}
}

func (s *DisbursementStore) Pool() PoolIface { return s.pool }

// GetVerifiedPayoutAccountTx reads a talent's payout destination. It returns nil
// when no account is on file; the Verified flag reflects payout_verified_at, so
// the caller can record a pending row while refusing to actually pay an
// unverified destination.
func (s *DisbursementStore) GetVerifiedPayoutAccountTx(ctx context.Context, tx pgx.Tx, talentID string) (*TalentPayoutAccount, error) {
	var provider, account, holder *string
	var verifiedAt *time.Time
	err := tx.QueryRow(ctx,
		`SELECT payout_provider, payout_account_number, payout_account_holder_name, payout_verified_at
		 FROM talent_profiles WHERE id = $1 LIMIT 1`,
		talentID).Scan(&provider, &account, &holder, &verifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query talent payout account: %w", err)
	}
	if provider == nil || account == nil || holder == nil {
		return nil, nil
	}
	return &TalentPayoutAccount{
		Provider:   *provider,
		Account:    *account,
		HolderName: *holder,
		Verified:   verifiedAt != nil,
	}, nil
}

// InsertPendingTx records a pending payout. ON CONFLICT DO NOTHING on the
// idempotency key means a retried release does not enqueue a second payout for
// the same milestone.
func (s *DisbursementStore) InsertPendingTx(ctx context.Context, tx pgx.Tx, in EnqueueDisbursementInput) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO disbursements
		   (id, project_id, milestone_id, work_package_id, talent_id, transaction_id,
		    amount, beneficiary_provider, beneficiary_account, beneficiary_name,
		    status, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
		 ON CONFLICT (idempotency_key) DO NOTHING`,
		uuid.NewString(), in.ProjectID, in.MilestoneID, in.WorkPackageID, in.TalentID, in.TransactionID,
		in.Amount, in.Provider, in.Account, in.HolderName, in.IdempotencyKey)
	if err != nil {
		return fmt.Errorf("insert pending disbursement: %w", err)
	}
	return nil
}

const disbursementColumns = `id, project_id, milestone_id, work_package_id, talent_id, transaction_id,
	amount, beneficiary_provider, beneficiary_account, beneficiary_name, status,
	iris_reference_no, idempotency_key, approved_by, approved_at, failure_reason,
	created_at, updated_at`

func scanDisbursement(row pgx.Row) (*Disbursement, error) {
	var d Disbursement
	err := row.Scan(&d.ID, &d.ProjectID, &d.MilestoneID, &d.WorkPackageID, &d.TalentID, &d.TransactionID,
		&d.Amount, &d.BeneficiaryProvider, &d.BeneficiaryAccount, &d.BeneficiaryName, &d.Status,
		&d.IrisReferenceNo, &d.IdempotencyKey, &d.ApprovedBy, &d.ApprovedAt, &d.FailureReason,
		&d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *DisbursementStore) GetByID(ctx context.Context, id string) (*Disbursement, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+disbursementColumns+` FROM disbursements WHERE id = $1`, id)
	d, err := scanDisbursement(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get disbursement: %w", err)
	}
	return d, nil
}

// ClaimForExecution moves a payout from pending or failed to queued, returning
// the claimed row. A payout already queued or further along returns nil: the
// compare-and-set is what stops two executors sending the same money twice, and
// it lets a failed payout be retried (the Iris create is idempotent on its key).
// The single UPDATE ... RETURNING is atomic on its own, so it needs no wrapping
// transaction.
func (s *DisbursementStore) ClaimForExecution(ctx context.Context, id string) (*Disbursement, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE disbursements SET status = 'queued', updated_at = now()
		 WHERE id = $1 AND status IN ('pending','failed')
		 RETURNING `+disbursementColumns, id)
	d, err := scanDisbursement(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim disbursement: %w", err)
	}
	return d, nil
}

// MarkExecuted records the Iris reference and the approver after a payout has
// been created and approved. Status stays queued until Iris reports it moving to
// the bank via the status callback.
func (s *DisbursementStore) MarkExecuted(ctx context.Context, id, referenceNo, approvedBy string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE disbursements
		 SET iris_reference_no = $2, approved_by = $3, approved_at = now(),
		     failure_reason = NULL, updated_at = now()
		 WHERE id = $1`,
		id, referenceNo, approvedBy)
	if err != nil {
		return fmt.Errorf("mark disbursement executed: %w", err)
	}
	return nil
}

// MarkFailed records why a payout could not be sent and returns it to a state a
// later execution can retry. referenceNo is set when Iris accepted the create
// but approval failed, so the status callback can still resolve it.
func (s *DisbursementStore) MarkFailed(ctx context.Context, id, reason string, referenceNo *string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE disbursements
		 SET status = 'failed', failure_reason = $2, iris_reference_no = COALESCE($3, iris_reference_no),
		     updated_at = now()
		 WHERE id = $1`,
		id, reason, referenceNo)
	if err != nil {
		return fmt.Errorf("mark disbursement failed: %w", err)
	}
	return nil
}

// ListByStatus returns disbursements in a given status, oldest first, for the
// operator queue that approves and monitors payouts.
func (s *DisbursementStore) ListByStatus(ctx context.Context, status string, limit int) ([]Disbursement, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+disbursementColumns+` FROM disbursements WHERE status = $1 ORDER BY created_at ASC LIMIT $2`,
		status, limit)
	if err != nil {
		return nil, fmt.Errorf("list disbursements: %w", err)
	}
	defer rows.Close()

	var out []Disbursement
	for rows.Next() {
		d, scanErr := scanDisbursement(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan disbursement: %w", scanErr)
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

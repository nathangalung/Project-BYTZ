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

// settledStatuses are the states that mean money has already left for the bank.
// Nothing an executor learns afterwards may move a row out of one of them: the
// payout happened, and a row that walks back to 'failed' is re-claimable and
// would be paid a second time.
const settledStatuses = `('processed','completed')`

// MarkExecuted records the Iris reference and the approver after a payout has
// been created and approved. Status stays queued until Iris reports it moving to
// the bank, either through the payout notification or through the sweep.
//
// Guarded on the row not having settled already. Iris can deliver its
// notification before this update lands - the create response and the callback
// race - and an unguarded write would clear the failure_reason and timestamps
// of a payout that is already booked.
func (s *DisbursementStore) MarkExecuted(ctx context.Context, id, referenceNo, approvedBy string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE disbursements
		 SET iris_reference_no = $2, approved_by = $3, approved_at = now(),
		     failure_reason = NULL, updated_at = now()
		 WHERE id = $1 AND status NOT IN `+settledStatuses,
		id, referenceNo, approvedBy)
	if err != nil {
		return fmt.Errorf("mark disbursement executed: %w", err)
	}
	return nil
}

/*
MarkFailed records why a payout could not be sent and returns it to a state a
later execution can retry. referenceNo is set when Iris accepted the create but
approval failed, so the reference survives for reconciliation.

The status guard is the point. Without it this was a double-pay: Execute
approves the payout, Iris's notification settles the row to completed and books
the ledger, and then Execute's own approve response times out and calls
MarkFailed - which reset a paid row to 'failed', where ClaimForExecution picks
it up and sends the money again. A settled payout is terminal here.
*/
func (s *DisbursementStore) MarkFailed(ctx context.Context, id, reason string, referenceNo *string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE disbursements
		 SET status = 'failed', failure_reason = $2, iris_reference_no = COALESCE($3, iris_reference_no),
		     updated_at = now()
		 WHERE id = $1 AND status NOT IN `+settledStatuses,
		id, reason, referenceNo)
	if err != nil {
		return fmt.Errorf("mark disbursement failed: %w", err)
	}
	return nil
}

/*
MarkAmbiguous records an attempt whose outcome could not be established, without
moving the row out of 'queued'.

This is the whole no-double-pay rule in one statement. A create that timed out
may or may not have produced a payout at Iris, and Iris deduplicates on
X-Idempotency-Key for five minutes only, so a later retry is a second payout
rather than a replay. 'queued' is not in ClaimForExecution's claimable set, so
leaving the row there is what stops anything creating again; the reason is
stored so the row reads as needing attention in the operator queue, and the
reconciliation sweep reports it.
*/
func (s *DisbursementStore) MarkAmbiguous(ctx context.Context, id, reason string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE disbursements
		 SET failure_reason = $2, updated_at = now()
		 WHERE id = $1 AND status = 'queued'`,
		id, reason)
	if err != nil {
		return fmt.Errorf("mark disbursement ambiguous: %w", err)
	}
	return nil
}

// FindByReferenceNo looks a payout up by the reference Iris knows it under,
// which is the only identifier a payout notification carries.
func (s *DisbursementStore) FindByReferenceNo(ctx context.Context, referenceNo string) (*Disbursement, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+disbursementColumns+` FROM disbursements WHERE iris_reference_no = $1 LIMIT 1`,
		referenceNo)
	d, err := scanDisbursement(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get disbursement by reference: %w", err)
	}
	return d, nil
}

// LockByIDTx takes the row lock a settlement runs under. Everything the
// settlement then does - reading the current status, checking whether the
// ledger already carries this payout, writing both - happens while it is held,
// so two notifications for one payout are serialised rather than both finding
// an unbooked row.
func (s *DisbursementStore) LockByIDTx(ctx context.Context, tx pgx.Tx, id string) (*Disbursement, error) {
	row := tx.QueryRow(ctx,
		`SELECT `+disbursementColumns+` FROM disbursements WHERE id = $1 FOR UPDATE`, id)
	d, err := scanDisbursement(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock disbursement: %w", err)
	}
	return d, nil
}

// LockByReferenceTx is LockByIDTx keyed on the Iris reference, for the payout
// notification, which knows nothing else about the row.
func (s *DisbursementStore) LockByReferenceTx(ctx context.Context, tx pgx.Tx, referenceNo string) (*Disbursement, error) {
	row := tx.QueryRow(ctx,
		`SELECT `+disbursementColumns+` FROM disbursements WHERE iris_reference_no = $1 FOR UPDATE`,
		referenceNo)
	d, err := scanDisbursement(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock disbursement by reference: %w", err)
	}
	return d, nil
}

// SetStatusTx writes the status Iris reported, inside the settlement's
// transaction. failureReason is cleared on a success and recorded on a failure,
// so a row never carries the reason for an attempt it has since moved past.
func (s *DisbursementStore) SetStatusTx(ctx context.Context, tx pgx.Tx, id, status string, failureReason *string) error {
	_, err := tx.Exec(ctx,
		`UPDATE disbursements
		 SET status = $2::disbursement_status, failure_reason = $3, updated_at = now()
		 WHERE id = $1`,
		id, status, failureReason)
	if err != nil {
		return fmt.Errorf("set disbursement status: %w", err)
	}
	return nil
}

/*
ListStuck returns payouts that have sat in a non-terminal state longer than
olderThan, oldest first.

'queued' and 'processed' are both included. A queued payout that never moved is
the failure this whole path exists for - before the payout notification endpoint
there was no transition out of queued at all - and a processed one is a payout
the bank took but never confirmed delivered. Both are answered by asking Iris.
*/
func (s *DisbursementStore) ListStuck(ctx context.Context, olderThan time.Duration, limit int) ([]Disbursement, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+disbursementColumns+`
		 FROM disbursements
		 WHERE status IN ('queued','processed')
		   AND updated_at < now() - make_interval(secs => $1)
		 ORDER BY updated_at ASC
		 LIMIT $2`,
		olderThan.Seconds(), limit)
	if err != nil {
		return nil, fmt.Errorf("list stuck disbursements: %w", err)
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

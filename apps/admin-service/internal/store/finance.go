package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// FinanceSummary captures top-line finance numbers for the admin dashboard.
type FinanceSummary struct {
	TotalRevenue     int64 `json:"totalRevenue"`
	ThisMonthRevenue int64 `json:"thisMonthRevenue"`
	LastMonthRevenue int64 `json:"lastMonthRevenue"`
	BrdRevenue       int64 `json:"brdRevenue"`
	PrdRevenue       int64 `json:"prdRevenue"`
	MarginRevenue    int64 `json:"marginRevenue"`
	RevisionFee      int64 `json:"revisionFee"`
	PlacementFee     int64 `json:"placementFee"`
	EscrowHeld       int64 `json:"escrowHeld"`
}

// EscrowProjectRow shows escrow position per active project.
type EscrowProjectRow struct {
	ProjectID    string `json:"projectId"`
	ProjectTitle string `json:"projectTitle"`
	Status       string `json:"status"`
	TotalEscrow  int64  `json:"totalEscrow"`
	Released     int64  `json:"released"`
	Remaining    int64  `json:"remaining"`
}

// TransactionRow is the global transactions view for admin finance.
type TransactionRow struct {
	ID                string    `json:"id"`
	ProjectID         string    `json:"projectId"`
	ProjectTitle      string    `json:"projectTitle"`
	TalentID          *string   `json:"talentId"`
	TalentName        *string   `json:"talentName"`
	Type              string    `json:"type"`
	Amount            int64     `json:"amount"`
	Status            string    `json:"status"`
	PaymentMethod     *string   `json:"paymentMethod"`
	PaymentGatewayRef *string   `json:"paymentGatewayRef"`
	CreatedAt         time.Time `json:"createdAt"`
}

type TransactionListResult struct {
	Items []TransactionRow `json:"items"`
	Total int64            `json:"total"`
}

type TransactionFilters struct {
	Type     string
	Search   string
	Page     int
	PageSize int
}

type FinanceStore struct {
	pool PoolIface
}

func NewFinanceStore(pool *pgxpool.Pool) *FinanceStore {
	return &FinanceStore{pool: pool}
}

// Project positions where escrow may still be held.
//
// matched, partially_active, disputed and on_hold were separate statuses and
// are now facts: a complete team is team_completed_at, an open seat is a work
// package, a dispute is an unresolved row and a hold is on_hold_at. None of
// them changes whether escrow is held, so the two positions cover all six.
var activeEscrowStatuses = []string{
	"matching",
	"in_progress",
	"final_review",
}

// GetSummary aggregates revenue figures and escrow held.
func (s *FinanceStore) GetSummary(ctx context.Context) (*FinanceSummary, error) {
	out := &FinanceSummary{}

	/*
	   Every revenue figure comes from one place: the debit legs on the
	   platform account, classified by the transaction each leg hangs off.

	   It used to come from two. The platform fee legs gave the margin, and a
	   second CTE counted document, revision and placement revenue straight off
	   the transactions table - because the payment webhook settled those
	   payments without writing a ledger entry at all, so the ledger genuinely
	   did not know about them. It does now: the webhook books debit-platform /
	   credit-owner for a brd, prd or revision payment in the same transaction
	   that marks it completed, exactly as packages/db/src/seed.ts does. With
	   both sources live the same rupiah was counted twice in TotalRevenue,
	   which is what a seeded database already showed.

	   Escrow deposits are absent by construction rather than by exclusion: a
	   deposit never touches the platform account, because it is a liability
	   owed onward and not income. The gross escrow_release is absent for the
	   same reason - only the platform's fee slice of it is booked here, the
	   talent's share goes to the talent account.

	   The monthly buckets key off the ledger entry's own created_at, which is
	   when the revenue was recognised, rather than off the transaction row.
	   The margin figures were always bucketed that way; the document figures
	   now join them.
	*/
	row := s.pool.QueryRow(ctx,
		`WITH legs AS (
		    SELECT le.amount, le.created_at, t.type
		      FROM ledger_entries le
		      JOIN accounts a ON a.id = le.account_id
		      JOIN transactions t ON t.id = le.transaction_id
		     WHERE a.owner_type = 'platform'
		       AND le.entry_type = 'debit'
		       AND t.deleted_at IS NULL
		 )
		 SELECT
		    COALESCE(SUM(amount), 0),
		    COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('month', now())), 0),
		    COALESCE(SUM(amount) FILTER (
		      WHERE created_at >= date_trunc('month', now()) - interval '1 month'
		        AND created_at <  date_trunc('month', now())), 0),
		    COALESCE(SUM(amount) FILTER (WHERE type = 'brd_payment'), 0),
		    COALESCE(SUM(amount) FILTER (WHERE type = 'prd_payment'), 0),
		    COALESCE(SUM(amount) FILTER (WHERE type = 'escrow_release'), 0),
		    COALESCE(SUM(amount) FILTER (WHERE type = 'revision_fee'), 0),
		    COALESCE(SUM(amount) FILTER (WHERE type = 'talent_placement_fee'), 0)
		 FROM legs`)

	if err := row.Scan(
		&out.TotalRevenue, &out.ThisMonthRevenue, &out.LastMonthRevenue,
		&out.BrdRevenue, &out.PrdRevenue, &out.MarginRevenue,
		&out.RevisionFee, &out.PlacementFee,
	); err != nil {
		return nil, fmt.Errorf("finance summary: %w", err)
	}

	// Held is what came into escrow minus what went out, and a refund leaves
	// escrow as surely as a release: it pays the owner back from the same pool.
	// Netting releases alone kept every cancellation and dispute refund counted
	// as held forever. Measured in production: Rp 169 jt shown, Rp 153 jt left.
	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(CASE WHEN type = 'escrow_in' THEN amount ELSE 0 END), 0)
		     - COALESCE(SUM(CASE WHEN type IN ('escrow_release', 'refund', 'partial_refund') THEN amount ELSE 0 END), 0)
		   FROM transactions
		  WHERE status = 'completed' AND deleted_at IS NULL`,
	).Scan(&out.EscrowHeld); err != nil {
		return nil, fmt.Errorf("escrow held: %w", err)
	}

	return out, nil
}

// GetEscrowByProject lists projects with non-zero escrow remaining, sorted by remaining desc.
func (s *FinanceStore) GetEscrowByProject(ctx context.Context, limit int) ([]EscrowProjectRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx,
		`SELECT p.id, p.title, p.status,
		        COALESCE(SUM(CASE WHEN t.type = 'escrow_in' THEN t.amount ELSE 0 END), 0) AS total_in,
		        COALESCE(SUM(CASE WHEN t.type = 'escrow_release' THEN t.amount ELSE 0 END), 0) AS total_out
		   FROM projects p
		   LEFT JOIN transactions t ON t.project_id = p.id
		         AND t.status = 'completed' AND t.deleted_at IS NULL
		  WHERE p.deleted_at IS NULL
		    AND p.status = ANY($1)
		  GROUP BY p.id, p.title, p.status
		 HAVING COALESCE(SUM(CASE WHEN t.type = 'escrow_in' THEN t.amount ELSE 0 END), 0)
		      - COALESCE(SUM(CASE WHEN t.type = 'escrow_release' THEN t.amount ELSE 0 END), 0) > 0
		  ORDER BY (COALESCE(SUM(CASE WHEN t.type = 'escrow_in' THEN t.amount ELSE 0 END), 0)
		         - COALESCE(SUM(CASE WHEN t.type = 'escrow_release' THEN t.amount ELSE 0 END), 0)) DESC
		  LIMIT $2`,
		activeEscrowStatuses, limit)
	if err != nil {
		return nil, fmt.Errorf("escrow by project: %w", err)
	}
	defer rows.Close()

	out := make([]EscrowProjectRow, 0)
	for rows.Next() {
		var e EscrowProjectRow
		var totalIn, totalOut int64
		if err := rows.Scan(&e.ProjectID, &e.ProjectTitle, &e.Status, &totalIn, &totalOut); err != nil {
			return nil, fmt.Errorf("scan escrow row: %w", err)
		}
		e.TotalEscrow = totalIn
		e.Released = totalOut
		e.Remaining = totalIn - totalOut
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetTransactionsList returns paginated transactions across all projects.
func (s *FinanceStore) GetTransactionsList(ctx context.Context, f TransactionFilters) (*TransactionListResult, error) {
	offset := (f.Page - 1) * f.PageSize

	where := `WHERE t.deleted_at IS NULL`
	args := []any{}
	argIdx := 1

	if f.Type != "" {
		where += fmt.Sprintf(` AND t.type = $%d`, argIdx)
		args = append(args, f.Type)
		argIdx++
	}
	if f.Search != "" {
		pattern := "%" + f.Search + "%"
		where += fmt.Sprintf(` AND (p.title ILIKE $%d OR u.name ILIKE $%d)`, argIdx, argIdx)
		args = append(args, pattern)
		argIdx++
	}

	countQuery := `SELECT COUNT(*)
	                 FROM transactions t
	                 JOIN projects p ON p.id = t.project_id
	                 LEFT JOIN talent_profiles tp ON tp.id = t.talent_id
	                 LEFT JOIN "user" u ON u.id = tp.user_id ` + where
	var total int64
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count transactions: %w", err)
	}

	itemsQuery := fmt.Sprintf(
		`SELECT t.id, t.project_id, p.title,
		        t.talent_id, u.name,
		        t.type, t.amount, t.status, t.payment_method, t.payment_gateway_ref, t.created_at
		   FROM transactions t
		   JOIN projects p ON p.id = t.project_id
		   LEFT JOIN talent_profiles tp ON tp.id = t.talent_id
		   LEFT JOIN "user" u ON u.id = tp.user_id
		   %s
		   ORDER BY t.created_at DESC
		   LIMIT $%d OFFSET $%d`,
		where, argIdx, argIdx+1)
	args = append(args, f.PageSize, offset)

	rows, err := s.pool.Query(ctx, itemsQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("list transactions: %w", err)
	}
	defer rows.Close()

	items := make([]TransactionRow, 0)
	for rows.Next() {
		var r TransactionRow
		if err := rows.Scan(
			&r.ID, &r.ProjectID, &r.ProjectTitle,
			&r.TalentID, &r.TalentName,
			&r.Type, &r.Amount, &r.Status, &r.PaymentMethod, &r.PaymentGatewayRef, &r.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		items = append(items, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &TransactionListResult{Items: items, Total: total}, nil
}

// LedgerDriftRow reports one account whose stored balance disagrees with its
// ledger entries.
type LedgerDriftRow struct {
	AccountID     string  `json:"accountId"`
	OwnerType     string  `json:"ownerType"`
	OwnerID       *string `json:"ownerId"`
	Name          string  `json:"name"`
	StoredBalance int64   `json:"storedBalance"`
	LedgerBalance int64   `json:"ledgerBalance"`
	Drift         int64   `json:"drift"`
}

// LedgerReconciliation is the result of checking stored balances against the
// append-only ledger.
type LedgerReconciliation struct {
	AccountsChecked int              `json:"accountsChecked"`
	DriftedAccounts int              `json:"driftedAccounts"`
	TotalDrift      int64            `json:"totalDrift"`
	Rows            []LedgerDriftRow `json:"rows"`
}

/*
ReconcileLedger compares every account's stored balance against the sum of its
ledger entries.

accounts.balance is maintained by application arithmetic in the payment service
and is the sole gate on releasing and refunding money, yet nothing has ever
verified it against ledger_entries - the append-only record it is derived from.
Several paths can drift it silently, so this exists to make drift observable.

It reports and never corrects. An automatic correction would paper over the bug
that caused the drift, and the ledger is the audit record, so a human decides
which side is wrong.
*/
func (s *FinanceStore) ReconcileLedger(ctx context.Context) (*LedgerReconciliation, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT a.id, a.owner_type, a.owner_id, a.name, a.balance,
		        COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount
		                          ELSE -l.amount END), 0) AS ledger_balance
		   FROM accounts a
		   LEFT JOIN ledger_entries l ON l.account_id = a.id
		  GROUP BY a.id, a.owner_type, a.owner_id, a.name, a.balance
		  ORDER BY ABS(a.balance - COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount
		                                             ELSE -l.amount END), 0)) DESC`)
	if err != nil {
		return nil, fmt.Errorf("reconcile ledger: %w", err)
	}
	defer rows.Close()

	out := &LedgerReconciliation{Rows: make([]LedgerDriftRow, 0)}
	for rows.Next() {
		var r LedgerDriftRow
		if err := rows.Scan(&r.AccountID, &r.OwnerType, &r.OwnerID, &r.Name,
			&r.StoredBalance, &r.LedgerBalance); err != nil {
			return nil, fmt.Errorf("scan reconciliation row: %w", err)
		}
		out.AccountsChecked++
		r.Drift = r.StoredBalance - r.LedgerBalance
		if r.Drift != 0 {
			out.DriftedAccounts++
			out.TotalDrift += r.Drift
			// Only drifted accounts are returned; a clean ledger sends an empty list.
			out.Rows = append(out.Rows, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

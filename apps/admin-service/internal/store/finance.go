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

// Active project statuses where escrow may still be held.
var activeEscrowStatuses = []string{
	"matched",
	"in_progress",
	"partially_active",
	"review",
	"disputed",
	"on_hold",
}

// GetSummary aggregates revenue figures and escrow held.
func (s *FinanceStore) GetSummary(ctx context.Context) (*FinanceSummary, error) {
	out := &FinanceSummary{}

	// Revenue excludes escrow deposits (a liability owed onward, not income)
	// and takes the platform margin from the fee ledger legs booked at
	// release, not the gross escrow_release amount which mostly belongs to
	// the talent. The fee legs are the debits on the platform revenue
	// account; document/revision/placement fees still come from
	// transactions because those are pure platform income.
	row := s.pool.QueryRow(ctx,
		`WITH fees AS (
		    SELECT
		      COALESCE(SUM(le.amount), 0) AS total,
		      COALESCE(SUM(le.amount) FILTER (WHERE le.created_at >= date_trunc('month', now())), 0) AS this_month,
		      COALESCE(SUM(le.amount) FILTER (
		        WHERE le.created_at >= date_trunc('month', now()) - interval '1 month'
		          AND le.created_at <  date_trunc('month', now())), 0) AS last_month
		    FROM ledger_entries le
		    JOIN accounts a ON a.id = le.account_id
		    WHERE a.owner_type = 'platform' AND le.entry_type = 'debit'
		 ), doc AS (
		    SELECT
		      COALESCE(SUM(CASE WHEN type IN ('brd_payment','prd_payment','revision_fee','talent_placement_fee') THEN amount ELSE 0 END), 0) AS total,
		      COALESCE(SUM(CASE WHEN type IN ('brd_payment','prd_payment','revision_fee','talent_placement_fee')
		        AND created_at >= date_trunc('month', now()) THEN amount ELSE 0 END), 0) AS this_month,
		      COALESCE(SUM(CASE WHEN type IN ('brd_payment','prd_payment','revision_fee','talent_placement_fee')
		        AND created_at >= date_trunc('month', now()) - interval '1 month'
		        AND created_at <  date_trunc('month', now()) THEN amount ELSE 0 END), 0) AS last_month,
		      COALESCE(SUM(CASE WHEN type = 'brd_payment' THEN amount ELSE 0 END), 0) AS brd,
		      COALESCE(SUM(CASE WHEN type = 'prd_payment' THEN amount ELSE 0 END), 0) AS prd,
		      COALESCE(SUM(CASE WHEN type = 'revision_fee' THEN amount ELSE 0 END), 0) AS revision_fee,
		      COALESCE(SUM(CASE WHEN type = 'talent_placement_fee' THEN amount ELSE 0 END), 0) AS placement_fee
		    FROM transactions
		    WHERE status = 'completed' AND deleted_at IS NULL
		 )
		 SELECT
		    doc.total + fees.total,
		    doc.this_month + fees.this_month,
		    doc.last_month + fees.last_month,
		    doc.brd, doc.prd, fees.total, doc.revision_fee, doc.placement_fee
		 FROM doc, fees`)

	if err := row.Scan(
		&out.TotalRevenue, &out.ThisMonthRevenue, &out.LastMonthRevenue,
		&out.BrdRevenue, &out.PrdRevenue, &out.MarginRevenue,
		&out.RevisionFee, &out.PlacementFee,
	); err != nil {
		return nil, fmt.Errorf("finance summary: %w", err)
	}

	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(CASE WHEN type = 'escrow_in' THEN amount ELSE 0 END), 0)
		     - COALESCE(SUM(CASE WHEN type = 'escrow_release' THEN amount ELSE 0 END), 0)
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

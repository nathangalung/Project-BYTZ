package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DisputeRow is the list-view row for admin disputes.
type DisputeRow struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	ProjectTitle     string     `json:"projectTitle"`
	WorkPackageID    *string    `json:"workPackageId"`
	WorkPackageTitle *string    `json:"workPackageTitle"`
	InitiatedBy      string     `json:"initiatedBy"`
	InitiatedByName  string     `json:"initiatedByName"`
	InitiatedByRole  string     `json:"initiatedByRole"`
	AgainstUserID    string     `json:"againstUserId"`
	AgainstUserName  string     `json:"againstUserName"`
	AgainstUserRole  string     `json:"againstUserRole"`
	Reason           string     `json:"reason"`
	Status           string     `json:"status"`
	Amount           int64      `json:"amount"`
	ResolutionType   *string    `json:"resolutionType"`
	ResolvedAt       *time.Time `json:"resolvedAt"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// DisputeListResult wraps paginated disputes.
type DisputeListResult struct {
	Items []DisputeRow `json:"items"`
	Total int64        `json:"total"`
}

// DisputeFilters narrows the list query.
type DisputeFilters struct {
	Status   string
	Page     int
	PageSize int
}

// DisputeStatusEvent is a row in the dispute status timeline.
type DisputeStatusEvent struct {
	FromStatus string    `json:"fromStatus"`
	ToStatus   string    `json:"toStatus"`
	CreatedAt  time.Time `json:"createdAt"`
}

// DisputeDetail is the full record for the expanded admin view.
type DisputeDetail struct {
	DisputeRow
	EvidenceURLs  []string             `json:"evidenceUrls"`
	Resolution    *string              `json:"resolution"`
	ResolvedBy    *string              `json:"resolvedBy"`
	StatusHistory []DisputeStatusEvent `json:"statusHistory"`
}

type DisputeStore struct {
	pool *pgxpool.Pool
}

func NewDisputeStore(pool *pgxpool.Pool) *DisputeStore {
	return &DisputeStore{pool: pool}
}

// disputeListSelect is the shared SELECT clause for list and counts.
const disputeListBase = `
  FROM disputes d
  JOIN projects p ON p.id = d.project_id
  LEFT JOIN work_packages wp ON wp.id = d.work_package_id
  LEFT JOIN "user" ui ON ui.id = d.initiated_by
  LEFT JOIN "user" ua ON ua.id = d.against_user_id
`

// GetDisputesList returns paginated disputes with enriched fields.
func (s *DisputeStore) GetDisputesList(ctx context.Context, f DisputeFilters) (*DisputeListResult, error) {
	offset := (f.Page - 1) * f.PageSize

	where := "WHERE 1=1"
	args := []any{}
	argIdx := 1
	if f.Status != "" {
		where += fmt.Sprintf(" AND d.status = $%d", argIdx)
		args = append(args, f.Status)
		argIdx++
	}

	var total int64
	countSQL := "SELECT COUNT(*) " + disputeListBase + where
	if err := s.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count disputes: %w", err)
	}

	itemsSQL := fmt.Sprintf(
		`SELECT d.id, d.project_id, p.title,
		        d.work_package_id, wp.title,
		        d.initiated_by, ui.name, ui.role,
		        d.against_user_id, ua.name, ua.role,
		        d.reason, d.status,
		        COALESCE(wp.amount, p.final_price, 0) AS amount,
		        d.resolution_type, d.resolved_at, d.created_at, d.updated_at
		   %s
		   %s
		  ORDER BY d.created_at DESC
		  LIMIT $%d OFFSET $%d`,
		disputeListBase, where, argIdx, argIdx+1)
	args = append(args, f.PageSize, offset)

	rows, err := s.pool.Query(ctx, itemsSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("list disputes: %w", err)
	}
	defer rows.Close()

	items := make([]DisputeRow, 0)
	for rows.Next() {
		var r DisputeRow
		if err := rows.Scan(
			&r.ID, &r.ProjectID, &r.ProjectTitle,
			&r.WorkPackageID, &r.WorkPackageTitle,
			&r.InitiatedBy, &r.InitiatedByName, &r.InitiatedByRole,
			&r.AgainstUserID, &r.AgainstUserName, &r.AgainstUserRole,
			&r.Reason, &r.Status, &r.Amount,
			&r.ResolutionType, &r.ResolvedAt, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan dispute: %w", err)
		}
		items = append(items, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &DisputeListResult{Items: items, Total: total}, nil
}

// GetStatusCounts returns the number of disputes per status.
func (s *DisputeStore) GetStatusCounts(ctx context.Context) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT status::text, COUNT(*) FROM disputes GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("dispute status counts: %w", err)
	}
	defer rows.Close()

	out := map[string]int64{
		"open":         0,
		"under_review": 0,
		"mediation":    0,
		"resolved":     0,
		"escalated":    0,
	}
	for rows.Next() {
		var s string
		var n int64
		if err := rows.Scan(&s, &n); err != nil {
			return nil, fmt.Errorf("scan status count: %w", err)
		}
		out[s] = n
	}
	return out, rows.Err()
}

// GetDisputeByID returns one dispute with evidence and status timeline.
func (s *DisputeStore) GetDisputeByID(ctx context.Context, id string) (*DisputeDetail, error) {
	var d DisputeDetail
	var evidenceRaw []byte
	row := s.pool.QueryRow(ctx,
		`SELECT d.id, d.project_id, p.title,
		        d.work_package_id, wp.title,
		        d.initiated_by, ui.name, ui.role,
		        d.against_user_id, ua.name, ua.role,
		        d.reason, d.status,
		        COALESCE(wp.amount, p.final_price, 0) AS amount,
		        d.resolution_type, d.resolved_at, d.created_at, d.updated_at,
		        d.evidence_urls, d.resolution, d.resolved_by
		   `+disputeListBase+`
		  WHERE d.id = $1`, id)
	if err := row.Scan(
		&d.ID, &d.ProjectID, &d.ProjectTitle,
		&d.WorkPackageID, &d.WorkPackageTitle,
		&d.InitiatedBy, &d.InitiatedByName, &d.InitiatedByRole,
		&d.AgainstUserID, &d.AgainstUserName, &d.AgainstUserRole,
		&d.Reason, &d.Status, &d.Amount,
		&d.ResolutionType, &d.ResolvedAt, &d.CreatedAt, &d.UpdatedAt,
		&evidenceRaw, &d.Resolution, &d.ResolvedBy,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get dispute: %w", err)
	}

	d.EvidenceURLs = make([]string, 0)
	if len(evidenceRaw) > 0 {
		_ = json.Unmarshal(evidenceRaw, &d.EvidenceURLs)
	}

	history, err := s.getStatusHistory(ctx, id)
	if err != nil {
		return nil, err
	}
	d.StatusHistory = history

	return &d, nil
}

// getStatusHistory reads dispute.status_changed events from the outbox.
func (s *DisputeStore) getStatusHistory(ctx context.Context, id string) ([]DisputeStatusEvent, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT payload, created_at
		   FROM outbox_events
		  WHERE aggregate_type = 'dispute'
		    AND aggregate_id = $1
		    AND event_type = 'dispute.status_changed'
		  ORDER BY created_at ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("dispute history: %w", err)
	}
	defer rows.Close()

	out := make([]DisputeStatusEvent, 0)
	for rows.Next() {
		var payload []byte
		var createdAt time.Time
		if err := rows.Scan(&payload, &createdAt); err != nil {
			return nil, fmt.Errorf("scan history: %w", err)
		}
		var parsed struct {
			FromStatus string `json:"fromStatus"`
			ToStatus   string `json:"toStatus"`
		}
		if err := json.Unmarshal(payload, &parsed); err != nil {
			continue
		}
		out = append(out, DisputeStatusEvent{
			FromStatus: parsed.FromStatus,
			ToStatus:   parsed.ToStatus,
			CreatedAt:  createdAt,
		})
	}
	return out, rows.Err()
}

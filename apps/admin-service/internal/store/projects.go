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

// List row for /api/v1/admin/projects.
type ProjectListItem struct {
	ID                    string    `json:"id"`
	Title                 string    `json:"title"`
	OwnerID               string    `json:"ownerId"`
	OwnerName             string    `json:"ownerName"`
	OwnerEmail            string    `json:"ownerEmail"`
	Status                string    `json:"status"`
	Category              string    `json:"category"`
	TeamSize              int       `json:"teamSize"`
	BudgetMin             int       `json:"budgetMin"`
	BudgetMax             int       `json:"budgetMax"`
	FinalPrice            *int      `json:"finalPrice"`
	PlatformFee           *int      `json:"platformFee"`
	EstimatedTimelineDays int       `json:"estimatedTimelineDays"`
	Progress              int       `json:"progress"`
	CreatedAt             time.Time `json:"createdAt"`
}

type ProjectListResult struct {
	Items []ProjectListItem `json:"items"`
	Total int64             `json:"total"`
}

type ProjectFilters struct {
	Status   string
	Search   string
	Page     int
	PageSize int
}

// Worker assigned to a project.
type ProjectAssignmentRow struct {
	ID               string     `json:"id"`
	TalentID         string     `json:"talentId"`
	TalentUserID     string     `json:"talentUserId"`
	TalentName       string     `json:"talentName"`
	RoleLabel        *string    `json:"roleLabel"`
	WorkPackageID    *string    `json:"workPackageId"`
	WorkPackageTitle *string    `json:"workPackageTitle"`
	AcceptanceStatus string     `json:"acceptanceStatus"`
	Status           string     `json:"status"`
	StartedAt        *time.Time `json:"startedAt"`
	CompletedAt     *time.Time `json:"completedAt"`
	CreatedAt        time.Time  `json:"createdAt"`
}

// Milestone for project detail.
type ProjectMilestoneRow struct {
	ID               string     `json:"id"`
	WorkPackageID    *string    `json:"workPackageId"`
	WorkPackageTitle *string    `json:"workPackageTitle"`
	AssignedTalentID *string    `json:"assignedTalentId"`
	AssignedTalent   *string    `json:"assignedTalent"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	MilestoneType    string     `json:"milestoneType"`
	OrderIndex       int        `json:"orderIndex"`
	Amount           int        `json:"amount"`
	Status           string     `json:"status"`
	RevisionCount    int        `json:"revisionCount"`
	DueDate          time.Time  `json:"dueDate"`
	SubmittedAt      *time.Time `json:"submittedAt"`
	CompletedAt      *time.Time `json:"completedAt"`
}

// Transaction for project detail.
type ProjectTransactionRow struct {
	ID                string    `json:"id"`
	WorkPackageID     *string   `json:"workPackageId"`
	MilestoneID       *string   `json:"milestoneId"`
	TalentID          *string   `json:"talentId"`
	TalentName        *string   `json:"talentName"`
	Type              string    `json:"type"`
	Amount            int       `json:"amount"`
	Status            string    `json:"status"`
	PaymentMethod     *string   `json:"paymentMethod"`
	PaymentGatewayRef *string   `json:"paymentGatewayRef"`
	CreatedAt         time.Time `json:"createdAt"`
}

// Work package for project detail.
type ProjectWorkPackageRow struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Description    string          `json:"description"`
	OrderIndex     int             `json:"orderIndex"`
	RequiredSkills json.RawMessage `json:"requiredSkills"`
	EstimatedHours float64         `json:"estimatedHours"`
	Amount         int             `json:"amount"`
	TalentPayout   int             `json:"talentPayout"`
	Status         string          `json:"status"`
}

// Dispute summary for project detail.
type ProjectDisputeRow struct {
	ID             string     `json:"id"`
	WorkPackageID  *string    `json:"workPackageId"`
	InitiatedBy    string     `json:"initiatedBy"`
	InitiatedName  *string    `json:"initiatedName"`
	AgainstUserID  string     `json:"againstUserId"`
	AgainstName    *string    `json:"againstName"`
	Reason         string     `json:"reason"`
	Status         string     `json:"status"`
	ResolutionType *string    `json:"resolutionType"`
	ResolvedAt     *time.Time `json:"resolvedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// Full project detail bundle.
type ProjectDetail struct {
	ProjectListItem
	Description           string                  `json:"description"`
	ProjectType           string                  `json:"projectType"`
	CompanyName           *string                 `json:"companyName"`
	CompanyRole           *string                 `json:"companyRole"`
	Visibility            string                  `json:"visibility"`
	CompletenessScore     int                     `json:"completenessScore"`
	DocumentFileURL       *string                 `json:"documentFileUrl"`
	DocumentType          *string                 `json:"documentType"`
	TalentPayout          *int                    `json:"talentPayout"`
	Preferences           json.RawMessage         `json:"preferences"`
	UpdatedAt             time.Time               `json:"updatedAt"`
	WorkPackages          []ProjectWorkPackageRow `json:"workPackages"`
	Workers               []ProjectAssignmentRow  `json:"workers"`
	Milestones            []ProjectMilestoneRow   `json:"milestones"`
	Transactions          []ProjectTransactionRow `json:"transactions"`
	Disputes              []ProjectDisputeRow     `json:"disputes"`
}

type ProjectStore struct {
	pool *pgxpool.Pool
}

func NewProjectStore(pool *pgxpool.Pool) *ProjectStore {
	return &ProjectStore{pool: pool}
}

// Paginated projects with filters.
func (s *ProjectStore) GetProjectsList(ctx context.Context, f ProjectFilters) (*ProjectListResult, error) {
	offset := (f.Page - 1) * f.PageSize

	baseWhere := `WHERE p.deleted_at IS NULL`
	args := []any{}
	argIdx := 1

	if f.Status != "" {
		baseWhere += fmt.Sprintf(` AND p.status = $%d`, argIdx)
		args = append(args, f.Status)
		argIdx++
	}
	if f.Search != "" {
		pattern := "%" + f.Search + "%"
		baseWhere += fmt.Sprintf(` AND (p.title ILIKE $%d OR u.name ILIKE $%d OR u.email ILIKE $%d)`, argIdx, argIdx, argIdx)
		args = append(args, pattern)
		argIdx++
	}

	countQuery := `SELECT COUNT(*) FROM projects p LEFT JOIN "user" u ON u.id = p.owner_id ` + baseWhere
	var total int64
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count projects: %w", err)
	}

	itemsQuery := fmt.Sprintf(
		`SELECT p.id, p.title, p.owner_id, u.name, u.email, p.status, p.category,
		        p.team_size, p.budget_min, p.budget_max, p.final_price, p.platform_fee,
		        p.estimated_timeline_days, p.progress, p.created_at
		   FROM projects p
		   LEFT JOIN "user" u ON u.id = p.owner_id
		   %s
		   ORDER BY p.created_at DESC
		   LIMIT $%d OFFSET $%d`,
		baseWhere, argIdx, argIdx+1)
	args = append(args, f.PageSize, offset)

	rows, err := s.pool.Query(ctx, itemsQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	var items []ProjectListItem
	for rows.Next() {
		var p ProjectListItem
		var ownerName, ownerEmail *string
		if err := rows.Scan(
			&p.ID, &p.Title, &p.OwnerID, &ownerName, &ownerEmail,
			&p.Status, &p.Category, &p.TeamSize,
			&p.BudgetMin, &p.BudgetMax, &p.FinalPrice, &p.PlatformFee,
			&p.EstimatedTimelineDays, &p.Progress, &p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		if ownerName != nil {
			p.OwnerName = *ownerName
		}
		if ownerEmail != nil {
			p.OwnerEmail = *ownerEmail
		}
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []ProjectListItem{}
	}

	return &ProjectListResult{Items: items, Total: total}, nil
}

// Full project detail or nil.
func (s *ProjectStore) GetProjectByID(ctx context.Context, id string) (*ProjectDetail, error) {
	d := &ProjectDetail{
		WorkPackages: []ProjectWorkPackageRow{},
		Workers:      []ProjectAssignmentRow{},
		Milestones:   []ProjectMilestoneRow{},
		Transactions: []ProjectTransactionRow{},
		Disputes:     []ProjectDisputeRow{},
	}

	var ownerName, ownerEmail *string
	err := s.pool.QueryRow(ctx,
		`SELECT p.id, p.title, p.owner_id, u.name, u.email, p.status, p.category,
		        p.team_size, p.budget_min, p.budget_max, p.final_price, p.platform_fee,
		        p.estimated_timeline_days, p.progress, p.created_at,
		        p.description, p.project_type, p.company_name, p.company_role,
		        p.visibility, p.completeness_score, p.document_file_url, p.document_type,
		        p.talent_payout, p.preferences, p.updated_at
		   FROM projects p
		   LEFT JOIN "user" u ON u.id = p.owner_id
		  WHERE p.id = $1 AND p.deleted_at IS NULL`, id).
		Scan(&d.ID, &d.Title, &d.OwnerID, &ownerName, &ownerEmail,
			&d.Status, &d.Category, &d.TeamSize,
			&d.BudgetMin, &d.BudgetMax, &d.FinalPrice, &d.PlatformFee,
			&d.EstimatedTimelineDays, &d.Progress, &d.CreatedAt,
			&d.Description, &d.ProjectType, &d.CompanyName, &d.CompanyRole,
			&d.Visibility, &d.CompletenessScore, &d.DocumentFileURL, &d.DocumentType,
			&d.TalentPayout, &d.Preferences, &d.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get project: %w", err)
	}
	if ownerName != nil {
		d.OwnerName = *ownerName
	}
	if ownerEmail != nil {
		d.OwnerEmail = *ownerEmail
	}

	wpRows, err := s.pool.Query(ctx,
		`SELECT id, title, description, order_index, required_skills,
		        estimated_hours, amount, talent_payout, status
		   FROM work_packages
		  WHERE project_id = $1
		  ORDER BY order_index ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("list work packages: %w", err)
	}
	defer wpRows.Close()
	for wpRows.Next() {
		var wp ProjectWorkPackageRow
		if err := wpRows.Scan(&wp.ID, &wp.Title, &wp.Description, &wp.OrderIndex,
			&wp.RequiredSkills, &wp.EstimatedHours, &wp.Amount, &wp.TalentPayout, &wp.Status); err != nil {
			return nil, fmt.Errorf("scan work package: %w", err)
		}
		d.WorkPackages = append(d.WorkPackages, wp)
	}
	if err := wpRows.Err(); err != nil {
		return nil, err
	}

	assignRows, err := s.pool.Query(ctx,
		`SELECT pa.id, pa.talent_id, tp.user_id, u.name,
		        pa.role_label, pa.work_package_id, wp.title,
		        pa.acceptance_status, pa.status, pa.started_at, pa.completed_at, pa.created_at
		   FROM project_assignments pa
		   JOIN talent_profiles tp ON tp.id = pa.talent_id
		   LEFT JOIN "user" u ON u.id = tp.user_id
		   LEFT JOIN work_packages wp ON wp.id = pa.work_package_id
		  WHERE pa.project_id = $1
		  ORDER BY pa.created_at ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("list assignments: %w", err)
	}
	defer assignRows.Close()
	for assignRows.Next() {
		var a ProjectAssignmentRow
		var talentName *string
		if err := assignRows.Scan(&a.ID, &a.TalentID, &a.TalentUserID, &talentName,
			&a.RoleLabel, &a.WorkPackageID, &a.WorkPackageTitle,
			&a.AcceptanceStatus, &a.Status, &a.StartedAt, &a.CompletedAt, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan assignment: %w", err)
		}
		if talentName != nil {
			a.TalentName = *talentName
		}
		d.Workers = append(d.Workers, a)
	}
	if err := assignRows.Err(); err != nil {
		return nil, err
	}

	mRows, err := s.pool.Query(ctx,
		`SELECT m.id, m.work_package_id, wp.title,
		        m.assigned_talent_id, u.name,
		        m.title, m.description, m.milestone_type, m.order_index,
		        m.amount, m.status, m.revision_count,
		        m.due_date, m.submitted_at, m.completed_at
		   FROM milestones m
		   LEFT JOIN work_packages wp ON wp.id = m.work_package_id
		   LEFT JOIN talent_profiles tp ON tp.id = m.assigned_talent_id
		   LEFT JOIN "user" u ON u.id = tp.user_id
		  WHERE m.project_id = $1
		  ORDER BY m.order_index ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("list milestones: %w", err)
	}
	defer mRows.Close()
	for mRows.Next() {
		var m ProjectMilestoneRow
		if err := mRows.Scan(&m.ID, &m.WorkPackageID, &m.WorkPackageTitle,
			&m.AssignedTalentID, &m.AssignedTalent,
			&m.Title, &m.Description, &m.MilestoneType, &m.OrderIndex,
			&m.Amount, &m.Status, &m.RevisionCount,
			&m.DueDate, &m.SubmittedAt, &m.CompletedAt); err != nil {
			return nil, fmt.Errorf("scan milestone: %w", err)
		}
		d.Milestones = append(d.Milestones, m)
	}
	if err := mRows.Err(); err != nil {
		return nil, err
	}

	txRows, err := s.pool.Query(ctx,
		`SELECT t.id, t.work_package_id, t.milestone_id,
		        t.talent_id, u.name,
		        t.type, t.amount, t.status, t.payment_method, t.payment_gateway_ref, t.created_at
		   FROM transactions t
		   LEFT JOIN talent_profiles tp ON tp.id = t.talent_id
		   LEFT JOIN "user" u ON u.id = tp.user_id
		  WHERE t.project_id = $1 AND t.deleted_at IS NULL
		  ORDER BY t.created_at DESC`, id)
	if err != nil {
		return nil, fmt.Errorf("list transactions: %w", err)
	}
	defer txRows.Close()
	for txRows.Next() {
		var t ProjectTransactionRow
		if err := txRows.Scan(&t.ID, &t.WorkPackageID, &t.MilestoneID,
			&t.TalentID, &t.TalentName,
			&t.Type, &t.Amount, &t.Status, &t.PaymentMethod, &t.PaymentGatewayRef, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		d.Transactions = append(d.Transactions, t)
	}
	if err := txRows.Err(); err != nil {
		return nil, err
	}

	dRows, err := s.pool.Query(ctx,
		`SELECT d.id, d.work_package_id, d.initiated_by, ui.name,
		        d.against_user_id, ua.name,
		        d.reason, d.status, d.resolution_type, d.resolved_at, d.created_at
		   FROM disputes d
		   LEFT JOIN "user" ui ON ui.id = d.initiated_by
		   LEFT JOIN "user" ua ON ua.id = d.against_user_id
		  WHERE d.project_id = $1
		  ORDER BY d.created_at DESC`, id)
	if err != nil {
		return nil, fmt.Errorf("list disputes: %w", err)
	}
	defer dRows.Close()
	for dRows.Next() {
		var ds ProjectDisputeRow
		if err := dRows.Scan(&ds.ID, &ds.WorkPackageID, &ds.InitiatedBy, &ds.InitiatedName,
			&ds.AgainstUserID, &ds.AgainstName,
			&ds.Reason, &ds.Status, &ds.ResolutionType, &ds.ResolvedAt, &ds.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan dispute: %w", err)
		}
		d.Disputes = append(d.Disputes, ds)
	}
	if err := dRows.Err(); err != nil {
		return nil, err
	}

	return d, nil
}

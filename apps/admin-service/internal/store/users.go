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

type User struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	Name      string     `json:"name"`
	Phone     *string    `json:"phone"`
	Role      string     `json:"role"`
	AvatarURL *string    `json:"avatarUrl"`
	IsVerified bool      `json:"isVerified"`
	Locale    string     `json:"locale"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
}

type UserListResult struct {
	Items []User `json:"items"`
	Total int64  `json:"total"`
}

type UserFilters struct {
	Role     string
	Search   string
	Page     int
	PageSize int
}

type AuditLog struct {
	ID         string          `json:"id"`
	AdminID    string          `json:"adminId"`
	AdminName  *string         `json:"adminName"`
	AdminEmail *string         `json:"adminEmail"`
	Action     string          `json:"action"`
	TargetType string          `json:"targetType"`
	TargetID   string          `json:"targetId"`
	Details    json.RawMessage `json:"details"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type AuditLogResult struct {
	Items []AuditLog `json:"items"`
	Total int64      `json:"total"`
}

type PlatformSetting struct {
	ID          string          `json:"id"`
	Key         string          `json:"key"`
	Value       json.RawMessage `json:"value"`
	Description *string         `json:"description"`
	UpdatedBy   *string         `json:"updatedBy"`
	UpdatedAt   *time.Time      `json:"updatedAt"`
}

type TalentProfile struct {
	ID                     string          `json:"id"`
	UserID                 string          `json:"userId"`
	Bio                    *string         `json:"bio"`
	YearsOfExperience      int             `json:"yearsOfExperience"`
	Tier                   string          `json:"tier"`
	EducationUniversity    *string         `json:"educationUniversity"`
	EducationMajor         *string         `json:"educationMajor"`
	EducationYear          *int            `json:"educationYear"`
	Location               *string         `json:"location"`
	AvailabilityStatus     string          `json:"availabilityStatus"`
	VerificationStatus     string          `json:"verificationStatus"`
	PortfolioLinks         json.RawMessage `json:"portfolioLinks"`
	DomainExpertise        json.RawMessage `json:"domainExpertise"`
	TotalProjectsCompleted int             `json:"totalProjectsCompleted"`
	TotalProjectsActive    int             `json:"totalProjectsActive"`
	AverageRating          *float64        `json:"averageRating"`
	PemerataanPenalty      float64         `json:"pemerataanPenalty"`
	CreatedAt              time.Time       `json:"createdAt"`
	UpdatedAt              time.Time       `json:"updatedAt"`
}

type TalentSkillEntry struct {
	SkillID          string `json:"skillId"`
	SkillName        string `json:"skillName"`
	Category         string `json:"category"`
	ProficiencyLevel string `json:"proficiencyLevel"`
	IsPrimary        bool   `json:"isPrimary"`
}

type TalentPenaltyEntry struct {
	ID               string     `json:"id"`
	Type             string     `json:"type"`
	Reason           string     `json:"reason"`
	RelatedProjectID *string    `json:"relatedProjectId"`
	IssuedByID       string     `json:"issuedById"`
	IssuedByName     *string    `json:"issuedByName"`
	AppealStatus     string     `json:"appealStatus"`
	AppealNote       *string    `json:"appealNote"`
	ExpiresAt        *time.Time `json:"expiresAt"`
	CreatedAt        time.Time  `json:"createdAt"`
}

type TalentProjectHistoryEntry struct {
	AssignmentID     string     `json:"assignmentId"`
	ProjectID        string     `json:"projectId"`
	ProjectTitle     string     `json:"projectTitle"`
	ProjectStatus    string     `json:"projectStatus"`
	RoleLabel        *string    `json:"roleLabel"`
	WorkPackageTitle *string    `json:"workPackageTitle"`
	AcceptanceStatus string     `json:"acceptanceStatus"`
	AssignmentStatus string     `json:"assignmentStatus"`
	StartedAt        *time.Time `json:"startedAt"`
	CompletedAt      *time.Time `json:"completedAt"`
	CreatedAt        time.Time  `json:"createdAt"`
}

type TalentDetail struct {
	Profile        *TalentProfile              `json:"profile"`
	Skills         []TalentSkillEntry          `json:"skills"`
	Penalties      []TalentPenaltyEntry        `json:"penalties"`
	ProjectHistory []TalentProjectHistoryEntry `json:"projectHistory"`
}

type UserStore struct {
	pool *pgxpool.Pool
}

func NewUserStore(pool *pgxpool.Pool) *UserStore {
	return &UserStore{pool: pool}
}

// GetUsersList returns paginated users with optional role/search filters.
func (s *UserStore) GetUsersList(ctx context.Context, f UserFilters) (*UserListResult, error) {
	offset := (f.Page - 1) * f.PageSize

	baseWhere := `WHERE deleted_at IS NULL`
	args := []any{}
	argIdx := 1

	if f.Role != "" {
		baseWhere += fmt.Sprintf(` AND role = $%d`, argIdx)
		args = append(args, f.Role)
		argIdx++
	}
	if f.Search != "" {
		pattern := "%" + f.Search + "%"
		baseWhere += fmt.Sprintf(` AND (name ILIKE $%d OR email ILIKE $%d)`, argIdx, argIdx)
		args = append(args, pattern)
		argIdx++
	}

	// Count query
	countQuery := `SELECT COUNT(*) FROM "user" ` + baseWhere
	var total int64
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}

	// Items query
	itemsQuery := fmt.Sprintf(
		`SELECT id, email, name, phone, role, avatar_url, is_verified, locale, created_at, updated_at
		 FROM "user" %s
		 ORDER BY created_at DESC
		 LIMIT $%d OFFSET $%d`,
		baseWhere, argIdx, argIdx+1)
	args = append(args, f.PageSize, offset)

	rows, err := s.pool.Query(ctx, itemsQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var items []User
	for rows.Next() {
		var u User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role,
			&u.AvatarURL, &u.IsVerified, &u.Locale,
			&u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		items = append(items, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []User{}
	}

	return &UserListResult{Items: items, Total: total}, nil
}

// GetUserByID returns a single user by ID, or nil if not found.
func (s *UserStore) GetUserByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, name, phone, role, avatar_url, is_verified, locale, created_at, updated_at
		 FROM "user"
		 WHERE id = $1 AND deleted_at IS NULL`, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role,
			&u.AvatarURL, &u.IsVerified, &u.Locale,
			&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get user: %w", err)
	}
	return &u, nil
}

// SuspendUser sets is_verified=false for the given user.
func (s *UserStore) SuspendUser(ctx context.Context, id string) (*User, error) {
	now := time.Now().UTC()
	var u User
	err := s.pool.QueryRow(ctx,
		`UPDATE "user" SET is_verified = false, updated_at = $1
		 WHERE id = $2
		 RETURNING id, email, name, phone, role, avatar_url, is_verified, locale, created_at, updated_at`,
		now, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role,
			&u.AvatarURL, &u.IsVerified, &u.Locale,
			&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("suspend user: %w", err)
	}
	return &u, nil
}

// UnsuspendUser sets is_verified=true for the given user.
func (s *UserStore) UnsuspendUser(ctx context.Context, id string) (*User, error) {
	now := time.Now().UTC()
	var u User
	err := s.pool.QueryRow(ctx,
		`UPDATE "user" SET is_verified = true, updated_at = $1
		 WHERE id = $2
		 RETURNING id, email, name, phone, role, avatar_url, is_verified, locale, created_at, updated_at`,
		now, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role,
			&u.AvatarURL, &u.IsVerified, &u.Locale,
			&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("unsuspend user: %w", err)
	}
	return &u, nil
}

// GetAuditLogs returns paginated audit logs.
func (s *UserStore) GetAuditLogs(ctx context.Context, page, pageSize int) (*AuditLogResult, error) {
	offset := (page - 1) * pageSize

	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM admin_audit_logs`).Scan(&total); err != nil {
		return nil, fmt.Errorf("count audit logs: %w", err)
	}

	rows, err := s.pool.Query(ctx,
		`SELECT a.id, a.admin_id, u.name, u.email, a.action, a.target_type, a.target_id, a.details, a.created_at
		 FROM admin_audit_logs a
		 LEFT JOIN "user" u ON u.id = a.admin_id
		 ORDER BY a.created_at DESC
		 LIMIT $1 OFFSET $2`, pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	var items []AuditLog
	for rows.Next() {
		var l AuditLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.AdminName, &l.AdminEmail, &l.Action, &l.TargetType, &l.TargetID, &l.Details, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan audit log: %w", err)
		}
		items = append(items, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []AuditLog{}
	}

	return &AuditLogResult{Items: items, Total: total}, nil
}

// CreateAuditLog inserts a new audit log entry.
func (s *UserStore) CreateAuditLog(ctx context.Context, id, adminID, action, targetType, targetID string, details json.RawMessage) (*AuditLog, error) {
	now := time.Now().UTC()
	var l AuditLog
	err := s.pool.QueryRow(ctx,
		`INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, admin_id, action, target_type, target_id, details, created_at`,
		id, adminID, action, targetType, targetID, details, now).
		Scan(&l.ID, &l.AdminID, &l.Action, &l.TargetType, &l.TargetID, &l.Details, &l.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create audit log: %w", err)
	}
	return &l, nil
}

// GetPlatformSettings returns all settings ordered by key.
func (s *UserStore) GetPlatformSettings(ctx context.Context) ([]PlatformSetting, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, key, value, description, updated_by, updated_at
		 FROM platform_settings
		 ORDER BY key`)
	if err != nil {
		return nil, fmt.Errorf("list settings: %w", err)
	}
	defer rows.Close()

	var items []PlatformSetting
	for rows.Next() {
		var ps PlatformSetting
		if err := rows.Scan(&ps.ID, &ps.Key, &ps.Value, &ps.Description, &ps.UpdatedBy, &ps.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan setting: %w", err)
		}
		items = append(items, ps)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []PlatformSetting{}
	}
	return items, nil
}

// GetPlatformSetting returns a single setting by key, or nil if not found.
func (s *UserStore) GetPlatformSetting(ctx context.Context, key string) (*PlatformSetting, error) {
	var ps PlatformSetting
	err := s.pool.QueryRow(ctx,
		`SELECT id, key, value, description, updated_by, updated_at
		 FROM platform_settings WHERE key = $1`, key).
		Scan(&ps.ID, &ps.Key, &ps.Value, &ps.Description, &ps.UpdatedBy, &ps.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get setting: %w", err)
	}
	return &ps, nil
}

// GetTalentDetail returns talent profile, skills, penalties, and project history.
// Returns nil profile (with empty slices) when user is not a talent.
func (s *UserStore) GetTalentDetail(ctx context.Context, userID string) (*TalentDetail, error) {
	detail := &TalentDetail{
		Skills:         []TalentSkillEntry{},
		Penalties:      []TalentPenaltyEntry{},
		ProjectHistory: []TalentProjectHistoryEntry{},
	}

	var p TalentProfile
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, bio, years_of_experience, tier,
		        education_university, education_major, education_year,
		        location, availability_status, verification_status,
		        portfolio_links, domain_expertise,
		        total_projects_completed, total_projects_active,
		        average_rating, pemerataan_penalty, created_at, updated_at
		   FROM talent_profiles
		  WHERE user_id = $1`, userID).
		Scan(&p.ID, &p.UserID, &p.Bio, &p.YearsOfExperience, &p.Tier,
			&p.EducationUniversity, &p.EducationMajor, &p.EducationYear,
			&p.Location, &p.AvailabilityStatus, &p.VerificationStatus,
			&p.PortfolioLinks, &p.DomainExpertise,
			&p.TotalProjectsCompleted, &p.TotalProjectsActive,
			&p.AverageRating, &p.PemerataanPenalty, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return detail, nil
		}
		return nil, fmt.Errorf("get talent profile: %w", err)
	}
	detail.Profile = &p

	skillRows, err := s.pool.Query(ctx,
		`SELECT s.id, s.name, s.category, ts.proficiency_level, ts.is_primary
		   FROM talent_skills ts
		   JOIN skills s ON s.id = ts.skill_id
		  WHERE ts.talent_id = $1
		  ORDER BY ts.is_primary DESC, s.name`, p.ID)
	if err != nil {
		return nil, fmt.Errorf("list talent skills: %w", err)
	}
	defer skillRows.Close()
	for skillRows.Next() {
		var e TalentSkillEntry
		if err := skillRows.Scan(&e.SkillID, &e.SkillName, &e.Category, &e.ProficiencyLevel, &e.IsPrimary); err != nil {
			return nil, fmt.Errorf("scan talent skill: %w", err)
		}
		detail.Skills = append(detail.Skills, e)
	}
	if err := skillRows.Err(); err != nil {
		return nil, err
	}

	penaltyRows, err := s.pool.Query(ctx,
		`SELECT tp.id, tp.type, tp.reason, tp.related_project_id,
		        tp.issued_by, u.name, tp.appeal_status, tp.appeal_note,
		        tp.expires_at, tp.created_at
		   FROM talent_penalties tp
		   LEFT JOIN "user" u ON u.id = tp.issued_by
		  WHERE tp.talent_id = $1
		  ORDER BY tp.created_at DESC`, p.ID)
	if err != nil {
		return nil, fmt.Errorf("list talent penalties: %w", err)
	}
	defer penaltyRows.Close()
	for penaltyRows.Next() {
		var e TalentPenaltyEntry
		if err := penaltyRows.Scan(&e.ID, &e.Type, &e.Reason, &e.RelatedProjectID,
			&e.IssuedByID, &e.IssuedByName, &e.AppealStatus, &e.AppealNote,
			&e.ExpiresAt, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan talent penalty: %w", err)
		}
		detail.Penalties = append(detail.Penalties, e)
	}
	if err := penaltyRows.Err(); err != nil {
		return nil, err
	}

	historyRows, err := s.pool.Query(ctx,
		`SELECT pa.id, pa.project_id, pr.title, pr.status,
		        pa.role_label, wp.title, pa.acceptance_status, pa.status,
		        pa.started_at, pa.completed_at, pa.created_at
		   FROM project_assignments pa
		   JOIN projects pr ON pr.id = pa.project_id
		   LEFT JOIN work_packages wp ON wp.id = pa.work_package_id
		  WHERE pa.talent_id = $1
		  ORDER BY pa.created_at DESC
		  LIMIT 50`, p.ID)
	if err != nil {
		return nil, fmt.Errorf("list talent project history: %w", err)
	}
	defer historyRows.Close()
	for historyRows.Next() {
		var e TalentProjectHistoryEntry
		if err := historyRows.Scan(&e.AssignmentID, &e.ProjectID, &e.ProjectTitle, &e.ProjectStatus,
			&e.RoleLabel, &e.WorkPackageTitle, &e.AcceptanceStatus, &e.AssignmentStatus,
			&e.StartedAt, &e.CompletedAt, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan talent project history: %w", err)
		}
		detail.ProjectHistory = append(detail.ProjectHistory, e)
	}
	if err := historyRows.Err(); err != nil {
		return nil, err
	}

	return detail, nil
}

// UpsertPlatformSetting creates or updates a platform setting.
func (s *UserStore) UpsertPlatformSetting(ctx context.Context, id, key string, value json.RawMessage, description *string, adminID string) (*PlatformSetting, error) {
	now := time.Now().UTC()
	var ps PlatformSetting
	err := s.pool.QueryRow(ctx,
		`INSERT INTO platform_settings (id, key, value, description, updated_by, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (key) DO UPDATE SET value = $3, description = COALESCE($4, platform_settings.description), updated_by = $5, updated_at = $6
		 RETURNING id, key, value, description, updated_by, updated_at`,
		id, key, value, description, adminID, now).
		Scan(&ps.ID, &ps.Key, &ps.Value, &ps.Description, &ps.UpdatedBy, &ps.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert setting: %w", err)
	}
	return &ps, nil
}

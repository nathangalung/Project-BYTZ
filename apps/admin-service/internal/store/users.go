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
		`SELECT id, admin_id, action, target_type, target_id, details, created_at
		 FROM admin_audit_logs
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	var items []AuditLog
	for rows.Next() {
		var l AuditLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.Action, &l.TargetType, &l.TargetID, &l.Details, &l.CreatedAt); err != nil {
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

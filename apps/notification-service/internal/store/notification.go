package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type NotificationType string

const (
	TypeProjectMatch      NotificationType = "project_match"
	TypeApplicationUpdate NotificationType = "application_update"
	TypeMilestoneUpdate   NotificationType = "milestone_update"
	TypePayment           NotificationType = "payment"
	TypeDispute           NotificationType = "dispute"
	TypeTeamFormation     NotificationType = "team_formation"
	TypeAssignmentOffer   NotificationType = "assignment_offer"
	TypeSystem            NotificationType = "system"
)

var validTypes = map[NotificationType]bool{
	TypeProjectMatch:      true,
	TypeApplicationUpdate: true,
	TypeMilestoneUpdate:   true,
	TypePayment:           true,
	TypeDispute:           true,
	TypeTeamFormation:     true,
	TypeAssignmentOffer:   true,
	TypeSystem:            true,
}

func IsValidType(t string) bool {
	return validTypes[NotificationType(t)]
}

type Notification struct {
	ID        string           `json:"id"`
	UserID    string           `json:"userId"`
	Type      NotificationType `json:"type"`
	Title     string           `json:"title"`
	Message   string           `json:"message"`
	Link      *string          `json:"link"`
	IsRead    bool             `json:"isRead"`
	CreatedAt time.Time        `json:"createdAt"`
}

type CreateInput struct {
	UserID  string
	Type    NotificationType
	Title   string
	Message string
	Link    *string
}

type PaginatedResult struct {
	Items    []Notification `json:"items"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Create(ctx context.Context, in CreateInput) (*Notification, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generate uuid: %w", err)
	}

	n := Notification{
		ID:        id.String(),
		UserID:    in.UserID,
		Type:      in.Type,
		Title:     in.Title,
		Message:   in.Message,
		Link:      in.Link,
		IsRead:    false,
		CreatedAt: time.Now().UTC(),
	}

	_, err = s.pool.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, message, link, is_read, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		n.ID, n.UserID, n.Type, n.Title, n.Message, n.Link, n.IsRead, n.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert notification: %w", err)
	}

	return &n, nil
}

func (s *Store) FindByUserID(ctx context.Context, userID string, page, pageSize int) (*PaginatedResult, error) {
	offset := (page - 1) * pageSize

	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, type, title, message, link, is_read, created_at
		 FROM notifications
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		userID, pageSize, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("query notifications: %w", err)
	}
	defer rows.Close()

	items, err := scanNotifications(rows)
	if err != nil {
		return nil, err
	}

	var total int
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1`,
		userID,
	).Scan(&total)
	if err != nil {
		return nil, fmt.Errorf("count notifications: %w", err)
	}

	return &PaginatedResult{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

func (s *Store) FindByID(ctx context.Context, id string, userID string) (*Notification, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, user_id, type, title, message, link, is_read, created_at
		 FROM notifications
		 WHERE id = $1 AND user_id = $2`,
		id, userID,
	)

	n, err := scanNotification(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find notification: %w", err)
	}

	return n, nil
}

func (s *Store) MarkAsRead(ctx context.Context, id string) (*Notification, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE notifications SET is_read = true WHERE id = $1
		 RETURNING id, user_id, type, title, message, link, is_read, created_at`,
		id,
	)

	n, err := scanNotification(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mark as read: %w", err)
	}

	return n, nil
}

func (s *Store) MarkAllAsRead(ctx context.Context, userID string) (int, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE notifications SET is_read = true
		 WHERE user_id = $1 AND is_read = false`,
		userID,
	)
	if err != nil {
		return 0, fmt.Errorf("mark all as read: %w", err)
	}

	return int(tag.RowsAffected()), nil
}

func (s *Store) CountUnread(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count unread: %w", err)
	}

	return count, nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanNotification(row scannable) (*Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Message, &n.Link, &n.IsRead, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func scanNotifications(rows pgx.Rows) ([]Notification, error) {
	var items []Notification
	for rows.Next() {
		var n Notification
		err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Message, &n.Link, &n.IsRead, &n.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan notification row: %w", err)
		}
		items = append(items, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}
	if items == nil {
		items = []Notification{}
	}
	return items, nil
}

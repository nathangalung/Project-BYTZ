package store

import "context"

// StoreInterface defines all public methods on Store.
type StoreInterface interface {
	Create(ctx context.Context, in CreateInput) (*Notification, error)
	FindByUserID(ctx context.Context, userID string, page, pageSize int, types []string) (*PaginatedResult, error)
	FindByID(ctx context.Context, id string, userID string) (*Notification, error)
	MarkAsRead(ctx context.Context, id string) (*Notification, error)
	MarkAllAsRead(ctx context.Context, userID string) (int, error)
	CountUnread(ctx context.Context, userID string) (int, error)
	RecordDeadLetter(ctx context.Context, in DeadLetterInput) error
}

// Compile-time check
var _ StoreInterface = (*Store)(nil)

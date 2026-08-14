package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolIface is the *pgxpool.Pool subset this package uses. Holding the
// interface rather than the concrete pool puts the queries within reach of a
// test; the constructor still takes *pgxpool.Pool, so no caller changes.
type PoolIface interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Compile-time check that *pgxpool.Pool satisfies PoolIface.
var _ PoolIface = (*pgxpool.Pool)(nil)

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

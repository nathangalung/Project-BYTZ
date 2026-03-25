package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolIface abstracts *pgxpool.Pool for testability.
type PoolIface interface {
	BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Compile-time check that *pgxpool.Pool satisfies PoolIface.
var _ PoolIface = (*pgxpool.Pool)(nil)

// TransactionStoreInterface defines all public methods on TransactionStore.
type TransactionStoreInterface interface {
	FindByIdempotencyKey(ctx context.Context, key string) (*Transaction, error)
	Create(ctx context.Context, in CreateTransactionInput) (*CreateResult, error)
	FindByID(ctx context.Context, id string) (*Transaction, error)
	FindByProjectID(ctx context.Context, projectID string) ([]Transaction, error)
	UpdateStatus(ctx context.Context, id, status string) (*Transaction, error)
	UpdateStatusTx(ctx context.Context, tx pgx.Tx, id, status string) (*Transaction, error)
	CreateEvent(ctx context.Context, in CreateTransactionEventInput) (*TransactionEvent, error)
	CreateEventTx(ctx context.Context, tx pgx.Tx, in CreateTransactionEventInput) (*TransactionEvent, error)
	GetEventsByTransaction(ctx context.Context, transactionID string) ([]TransactionEvent, error)
	FindByIdempotencyKeyForWebhook(ctx context.Context, orderID string) (*Transaction, error)
	UpdateWebhookTx(ctx context.Context, tx pgx.Tx, id, status string, paymentMethod, gatewayRef *string) (*Transaction, error)
	GetProjectOwnerID(ctx context.Context, projectID string) (string, error)
	ListByUser(ctx context.Context, userID string, txType string, page, pageSize int) ([]Transaction, int, error)
	GetSummaryByUser(ctx context.Context, userID string) (totalSpent, totalEarned, pending, thisMonth int64, err error)
	Pool() PoolIface
}

// LedgerStoreInterface defines all public methods on LedgerStore.
type LedgerStoreInterface interface {
	CreateAccount(ctx context.Context, in CreateAccountInput) (*Account, error)
	FindAccountByOwner(ctx context.Context, ownerType string, ownerID *string) (*Account, error)
	GetOrCreateAccount(ctx context.Context, in CreateAccountInput) (*Account, error)
	CreateLedgerEntries(ctx context.Context, entries []LedgerEntryInput) ([]LedgerEntry, error)
	GetEntriesByTransaction(ctx context.Context, transactionID string) ([]LedgerEntry, error)
	Pool() PoolIface
	FindAccountByOwnerTx(ctx context.Context, tx pgx.Tx, ownerType string, ownerID *string) (*Account, error)
	GetOrCreateAccountTx(ctx context.Context, tx pgx.Tx, in CreateAccountInput) (*Account, error)
	CreateLedgerEntriesTx(ctx context.Context, tx pgx.Tx, entries []LedgerEntryInput) ([]LedgerEntry, error)
	GetAccountBalance(ctx context.Context, accountID string) (int64, error)
}

// Compile-time checks
var _ TransactionStoreInterface = (*TransactionStore)(nil)
var _ LedgerStoreInterface = (*LedgerStore)(nil)

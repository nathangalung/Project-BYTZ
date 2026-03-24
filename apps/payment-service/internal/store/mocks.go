package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// MockPool implements PoolIface for testing.
type MockPool struct {
	BeginTxFn  func(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
	QueryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
	QueryFn    func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	ExecFn     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (p *MockPool) BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error) {
	if p.BeginTxFn != nil {
		return p.BeginTxFn(ctx, txOptions)
	}
	return nil, nil
}

func (p *MockPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if p.QueryRowFn != nil {
		return p.QueryRowFn(ctx, sql, args...)
	}
	return nil
}

func (p *MockPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if p.QueryFn != nil {
		return p.QueryFn(ctx, sql, args...)
	}
	return nil, nil
}

func (p *MockPool) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if p.ExecFn != nil {
		return p.ExecFn(ctx, sql, args...)
	}
	return pgconn.NewCommandTag(""), nil
}

// MockRow implements pgx.Row for testing.
type MockRow struct {
	ScanFn func(dest ...any) error
}

func (r *MockRow) Scan(dest ...any) error {
	if r.ScanFn != nil {
		return r.ScanFn(dest...)
	}
	return nil
}

// MockTx implements pgx.Tx for testing.
type MockTx struct {
	CommitFn   func(ctx context.Context) error
	RollbackFn func(ctx context.Context) error
	QueryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
	ExecFn     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (t *MockTx) Begin(_ context.Context) (pgx.Tx, error)    { return nil, nil }
func (t *MockTx) CopyFrom(_ context.Context, _ pgx.Identifier, _ []string, _ pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (t *MockTx) SendBatch(_ context.Context, _ *pgx.Batch) pgx.BatchResults { return nil }
func (t *MockTx) LargeObjects() pgx.LargeObjects                            { return pgx.LargeObjects{} }
func (t *MockTx) Prepare(_ context.Context, _ string, _ string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (t *MockTx) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return nil, nil }
func (t *MockTx) Conn() *pgx.Conn                                               { return nil }

func (t *MockTx) Commit(ctx context.Context) error {
	if t.CommitFn != nil {
		return t.CommitFn(ctx)
	}
	return nil
}

func (t *MockTx) Rollback(ctx context.Context) error {
	if t.RollbackFn != nil {
		return t.RollbackFn(ctx)
	}
	return nil
}

func (t *MockTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if t.QueryRowFn != nil {
		return t.QueryRowFn(ctx, sql, args...)
	}
	return &MockRow{}
}

func (t *MockTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if t.ExecFn != nil {
		return t.ExecFn(ctx, sql, args...)
	}
	return pgconn.NewCommandTag(""), nil
}

var _ PoolIface = (*MockPool)(nil)
var _ pgx.Tx = (*MockTx)(nil)

// MockTransactionStore implements TransactionStoreInterface for testing.
type MockTransactionStore struct {
	FindByIdempotencyKeyFn           func(ctx context.Context, key string) (*Transaction, error)
	CreateFn                         func(ctx context.Context, in CreateTransactionInput) (*CreateResult, error)
	FindByIDFn                       func(ctx context.Context, id string) (*Transaction, error)
	FindByProjectIDFn                func(ctx context.Context, projectID string) ([]Transaction, error)
	UpdateStatusFn                   func(ctx context.Context, id, status string) (*Transaction, error)
	UpdateStatusTxFn                 func(ctx context.Context, tx pgx.Tx, id, status string) (*Transaction, error)
	CreateEventFn                    func(ctx context.Context, in CreateTransactionEventInput) (*TransactionEvent, error)
	CreateEventTxFn                  func(ctx context.Context, tx pgx.Tx, in CreateTransactionEventInput) (*TransactionEvent, error)
	GetEventsByTransactionFn         func(ctx context.Context, transactionID string) ([]TransactionEvent, error)
	FindByIdempotencyKeyForWebhookFn func(ctx context.Context, orderID string) (*Transaction, error)
	UpdateWebhookTxFn                func(ctx context.Context, tx pgx.Tx, id, status string, paymentMethod, gatewayRef *string) (*Transaction, error)
	GetProjectOwnerIDFn              func(ctx context.Context, projectID string) (string, error)
	PoolFn                           func() PoolIface
}

func (m *MockTransactionStore) FindByIdempotencyKey(ctx context.Context, key string) (*Transaction, error) {
	if m.FindByIdempotencyKeyFn != nil {
		return m.FindByIdempotencyKeyFn(ctx, key)
	}
	return nil, nil
}

func (m *MockTransactionStore) Create(ctx context.Context, in CreateTransactionInput) (*CreateResult, error) {
	if m.CreateFn != nil {
		return m.CreateFn(ctx, in)
	}
	return nil, nil
}

func (m *MockTransactionStore) FindByID(ctx context.Context, id string) (*Transaction, error) {
	if m.FindByIDFn != nil {
		return m.FindByIDFn(ctx, id)
	}
	return nil, nil
}

func (m *MockTransactionStore) FindByProjectID(ctx context.Context, projectID string) ([]Transaction, error) {
	if m.FindByProjectIDFn != nil {
		return m.FindByProjectIDFn(ctx, projectID)
	}
	return nil, nil
}

func (m *MockTransactionStore) UpdateStatus(ctx context.Context, id, status string) (*Transaction, error) {
	if m.UpdateStatusFn != nil {
		return m.UpdateStatusFn(ctx, id, status)
	}
	return nil, nil
}

func (m *MockTransactionStore) UpdateStatusTx(ctx context.Context, tx pgx.Tx, id, status string) (*Transaction, error) {
	if m.UpdateStatusTxFn != nil {
		return m.UpdateStatusTxFn(ctx, tx, id, status)
	}
	return nil, nil
}

func (m *MockTransactionStore) CreateEvent(ctx context.Context, in CreateTransactionEventInput) (*TransactionEvent, error) {
	if m.CreateEventFn != nil {
		return m.CreateEventFn(ctx, in)
	}
	return nil, nil
}

func (m *MockTransactionStore) CreateEventTx(ctx context.Context, tx pgx.Tx, in CreateTransactionEventInput) (*TransactionEvent, error) {
	if m.CreateEventTxFn != nil {
		return m.CreateEventTxFn(ctx, tx, in)
	}
	return nil, nil
}

func (m *MockTransactionStore) GetEventsByTransaction(ctx context.Context, transactionID string) ([]TransactionEvent, error) {
	if m.GetEventsByTransactionFn != nil {
		return m.GetEventsByTransactionFn(ctx, transactionID)
	}
	return nil, nil
}

func (m *MockTransactionStore) FindByIdempotencyKeyForWebhook(ctx context.Context, orderID string) (*Transaction, error) {
	if m.FindByIdempotencyKeyForWebhookFn != nil {
		return m.FindByIdempotencyKeyForWebhookFn(ctx, orderID)
	}
	return nil, nil
}

func (m *MockTransactionStore) UpdateWebhookTx(ctx context.Context, tx pgx.Tx, id, status string, paymentMethod, gatewayRef *string) (*Transaction, error) {
	if m.UpdateWebhookTxFn != nil {
		return m.UpdateWebhookTxFn(ctx, tx, id, status, paymentMethod, gatewayRef)
	}
	return nil, nil
}

func (m *MockTransactionStore) GetProjectOwnerID(ctx context.Context, projectID string) (string, error) {
	if m.GetProjectOwnerIDFn != nil {
		return m.GetProjectOwnerIDFn(ctx, projectID)
	}
	return "", nil
}

func (m *MockTransactionStore) Pool() PoolIface {
	if m.PoolFn != nil {
		return m.PoolFn()
	}
	return nil
}

// MockLedgerStore implements LedgerStoreInterface for testing.
type MockLedgerStore struct {
	CreateAccountFn           func(ctx context.Context, in CreateAccountInput) (*Account, error)
	FindAccountByOwnerFn      func(ctx context.Context, ownerType string, ownerID *string) (*Account, error)
	GetOrCreateAccountFn      func(ctx context.Context, in CreateAccountInput) (*Account, error)
	CreateLedgerEntriesFn     func(ctx context.Context, entries []LedgerEntryInput) ([]LedgerEntry, error)
	GetEntriesByTransactionFn func(ctx context.Context, transactionID string) ([]LedgerEntry, error)
	PoolFn                    func() PoolIface
	FindAccountByOwnerTxFn    func(ctx context.Context, tx pgx.Tx, ownerType string, ownerID *string) (*Account, error)
	GetOrCreateAccountTxFn    func(ctx context.Context, tx pgx.Tx, in CreateAccountInput) (*Account, error)
	CreateLedgerEntriesTxFn   func(ctx context.Context, tx pgx.Tx, entries []LedgerEntryInput) ([]LedgerEntry, error)
	GetAccountBalanceFn       func(ctx context.Context, accountID string) (int64, error)
}

func (m *MockLedgerStore) CreateAccount(ctx context.Context, in CreateAccountInput) (*Account, error) {
	if m.CreateAccountFn != nil {
		return m.CreateAccountFn(ctx, in)
	}
	return nil, nil
}

func (m *MockLedgerStore) FindAccountByOwner(ctx context.Context, ownerType string, ownerID *string) (*Account, error) {
	if m.FindAccountByOwnerFn != nil {
		return m.FindAccountByOwnerFn(ctx, ownerType, ownerID)
	}
	return nil, nil
}

func (m *MockLedgerStore) GetOrCreateAccount(ctx context.Context, in CreateAccountInput) (*Account, error) {
	if m.GetOrCreateAccountFn != nil {
		return m.GetOrCreateAccountFn(ctx, in)
	}
	return nil, nil
}

func (m *MockLedgerStore) CreateLedgerEntries(ctx context.Context, entries []LedgerEntryInput) ([]LedgerEntry, error) {
	if m.CreateLedgerEntriesFn != nil {
		return m.CreateLedgerEntriesFn(ctx, entries)
	}
	return nil, nil
}

func (m *MockLedgerStore) GetEntriesByTransaction(ctx context.Context, transactionID string) ([]LedgerEntry, error) {
	if m.GetEntriesByTransactionFn != nil {
		return m.GetEntriesByTransactionFn(ctx, transactionID)
	}
	return nil, nil
}

func (m *MockLedgerStore) Pool() PoolIface {
	if m.PoolFn != nil {
		return m.PoolFn()
	}
	return nil
}

func (m *MockLedgerStore) FindAccountByOwnerTx(ctx context.Context, tx pgx.Tx, ownerType string, ownerID *string) (*Account, error) {
	if m.FindAccountByOwnerTxFn != nil {
		return m.FindAccountByOwnerTxFn(ctx, tx, ownerType, ownerID)
	}
	return nil, nil
}

func (m *MockLedgerStore) GetOrCreateAccountTx(ctx context.Context, tx pgx.Tx, in CreateAccountInput) (*Account, error) {
	if m.GetOrCreateAccountTxFn != nil {
		return m.GetOrCreateAccountTxFn(ctx, tx, in)
	}
	return nil, nil
}

func (m *MockLedgerStore) CreateLedgerEntriesTx(ctx context.Context, tx pgx.Tx, entries []LedgerEntryInput) ([]LedgerEntry, error) {
	if m.CreateLedgerEntriesTxFn != nil {
		return m.CreateLedgerEntriesTxFn(ctx, tx, entries)
	}
	return nil, nil
}

func (m *MockLedgerStore) GetAccountBalance(ctx context.Context, accountID string) (int64, error) {
	if m.GetAccountBalanceFn != nil {
		return m.GetAccountBalanceFn(ctx, accountID)
	}
	return 0, nil
}

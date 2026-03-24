package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Account owner types
const (
	OwnerPlatform = "platform"
	OwnerOwner    = "owner"
	OwnerTalent   = "talent"
	OwnerEscrow   = "escrow"
)

// Account types
const (
	AcctAsset     = "asset"
	AcctLiability = "liability"
	AcctRevenue   = "revenue"
	AcctExpense   = "expense"
)

// Ledger entry types
const (
	EntryDebit  = "debit"
	EntryCredit = "credit"
)

type Account struct {
	ID          string    `json:"id"`
	OwnerType   string    `json:"ownerType"`
	OwnerID     *string   `json:"ownerId"`
	AccountType string    `json:"accountType"`
	Name        string    `json:"name"`
	Balance     int64     `json:"balance"`
	Currency    string    `json:"currency"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type LedgerEntry struct {
	ID            string          `json:"id"`
	TransactionID string          `json:"transactionId"`
	AccountID     string          `json:"accountId"`
	EntryType     string          `json:"entryType"`
	Amount        int64           `json:"amount"`
	Description   *string         `json:"description"`
	Metadata      json.RawMessage `json:"metadata"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type LedgerEntryInput struct {
	TransactionID string
	AccountID     string
	EntryType     string
	Amount        int64
	Description   string
	Metadata      map[string]any
}

type CreateAccountInput struct {
	OwnerType   string
	OwnerID     *string
	AccountType string
	Name        string
	Currency    string
}

type LedgerStore struct {
	pool *pgxpool.Pool
}

func NewLedgerStore(pool *pgxpool.Pool) *LedgerStore {
	return &LedgerStore{pool: pool}
}

func (s *LedgerStore) CreateAccount(ctx context.Context, in CreateAccountInput) (*Account, error) {
	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()

	currency := in.Currency
	if currency == "" {
		currency = "IDR"
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
	`, id, in.OwnerType, in.OwnerID, in.AccountType, in.Name, 0, currency, now, now)

	return scanAccount(row)
}

func (s *LedgerStore) FindAccountByOwner(ctx context.Context, ownerType string, ownerID *string) (*Account, error) {
	var row pgx.Row
	if ownerID != nil {
		row = s.pool.QueryRow(ctx, `
			SELECT id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
			FROM accounts
			WHERE owner_type = $1 AND owner_id = $2
			LIMIT 1
		`, ownerType, *ownerID)
	} else {
		row = s.pool.QueryRow(ctx, `
			SELECT id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
			FROM accounts
			WHERE owner_type = $1 AND owner_id IS NULL
			LIMIT 1
		`, ownerType)
	}

	return scanAccount(row)
}

func (s *LedgerStore) GetOrCreateAccount(ctx context.Context, in CreateAccountInput) (*Account, error) {
	existing, err := s.FindAccountByOwner(ctx, in.OwnerType, in.OwnerID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	return s.CreateAccount(ctx, in)
}

// CreateLedgerEntries inserts ledger entries and updates account balances atomically.
// Enforces the double-entry invariant: sum(debits) == sum(credits).
func (s *LedgerStore) CreateLedgerEntries(ctx context.Context, entries []LedgerEntryInput) ([]LedgerEntry, error) {
	if len(entries) == 0 {
		return nil, fmt.Errorf("at least one ledger entry is required")
	}

	// Validate double-entry balance
	var totalDebit, totalCredit int64
	for _, e := range entries {
		if e.Amount <= 0 {
			return nil, fmt.Errorf("ledger entry amount must be positive, got %d", e.Amount)
		}
		switch e.EntryType {
		case EntryDebit:
			totalDebit += e.Amount
		case EntryCredit:
			totalCredit += e.Amount
		default:
			return nil, fmt.Errorf("invalid entry type: %s", e.EntryType)
		}
	}
	if totalDebit != totalCredit {
		return nil, fmt.Errorf("ledger entries must balance: debit=%d, credit=%d", totalDebit, totalCredit)
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var created []LedgerEntry
	for _, e := range entries {
		id := uuid.Must(uuid.NewV7()).String()
		now := time.Now().UTC()

		metaJSON, mErr := json.Marshal(e.Metadata)
		if mErr != nil {
			return nil, fmt.Errorf("marshal metadata: %w", mErr)
		}

		var descPtr *string
		if e.Description != "" {
			descPtr = &e.Description
		}

		var le LedgerEntry
		err = tx.QueryRow(ctx, `
			INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, description, metadata, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			RETURNING id, transaction_id, account_id, entry_type, amount, description, metadata, created_at
		`, id, e.TransactionID, e.AccountID, e.EntryType, e.Amount, descPtr, metaJSON, now).Scan(
			&le.ID, &le.TransactionID, &le.AccountID, &le.EntryType,
			&le.Amount, &le.Description, &le.Metadata, &le.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("insert ledger entry: %w", err)
		}
		created = append(created, le)

		// Update account balance: debit increases, credit decreases
		var balanceChange int64
		if e.EntryType == EntryDebit {
			balanceChange = e.Amount
		} else {
			balanceChange = -e.Amount
		}

		_, err = tx.Exec(ctx, `
			UPDATE accounts SET balance = balance + $1, updated_at = $2 WHERE id = $3
		`, balanceChange, now, e.AccountID)
		if err != nil {
			return nil, fmt.Errorf("update account balance: %w", err)
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit ledger tx: %w", err)
	}
	return created, nil
}

func (s *LedgerStore) GetEntriesByTransaction(ctx context.Context, transactionID string) ([]LedgerEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, transaction_id, account_id, entry_type, amount, description, metadata, created_at
		FROM ledger_entries
		WHERE transaction_id = $1
		ORDER BY created_at DESC
	`, transactionID)
	if err != nil {
		return nil, fmt.Errorf("query ledger entries: %w", err)
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var le LedgerEntry
		if err = rows.Scan(
			&le.ID, &le.TransactionID, &le.AccountID, &le.EntryType,
			&le.Amount, &le.Description, &le.Metadata, &le.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan ledger entry: %w", err)
		}
		entries = append(entries, le)
	}
	return entries, rows.Err()
}

// Pool exposes the underlying pool for use with BeginTx.
func (s *LedgerStore) Pool() PoolIface {
	return s.pool
}

// FindAccountByOwnerTx finds an account within an existing transaction.
func (s *LedgerStore) FindAccountByOwnerTx(ctx context.Context, tx pgx.Tx, ownerType string, ownerID *string) (*Account, error) {
	var row pgx.Row
	if ownerID != nil {
		row = tx.QueryRow(ctx, `
			SELECT id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
			FROM accounts
			WHERE owner_type = $1 AND owner_id = $2
			LIMIT 1
		`, ownerType, *ownerID)
	} else {
		row = tx.QueryRow(ctx, `
			SELECT id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
			FROM accounts
			WHERE owner_type = $1 AND owner_id IS NULL
			LIMIT 1
		`, ownerType)
	}
	return scanAccount(row)
}

// GetOrCreateAccountTx gets or creates an account within an existing transaction.
func (s *LedgerStore) GetOrCreateAccountTx(ctx context.Context, tx pgx.Tx, in CreateAccountInput) (*Account, error) {
	existing, err := s.FindAccountByOwnerTx(ctx, tx, in.OwnerType, in.OwnerID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()

	currency := in.Currency
	if currency == "" {
		currency = "IDR"
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
	`, id, in.OwnerType, in.OwnerID, in.AccountType, in.Name, 0, currency, now, now)

	return scanAccount(row)
}

// CreateLedgerEntriesTx inserts ledger entries and updates account balances within an existing transaction.
// Enforces the double-entry invariant: sum(debits) == sum(credits).
func (s *LedgerStore) CreateLedgerEntriesTx(ctx context.Context, tx pgx.Tx, entries []LedgerEntryInput) ([]LedgerEntry, error) {
	if len(entries) == 0 {
		return nil, fmt.Errorf("at least one ledger entry is required")
	}

	// Validate double-entry balance
	var totalDebit, totalCredit int64
	for _, e := range entries {
		if e.Amount <= 0 {
			return nil, fmt.Errorf("ledger entry amount must be positive, got %d", e.Amount)
		}
		switch e.EntryType {
		case EntryDebit:
			totalDebit += e.Amount
		case EntryCredit:
			totalCredit += e.Amount
		default:
			return nil, fmt.Errorf("invalid entry type: %s", e.EntryType)
		}
	}
	if totalDebit != totalCredit {
		return nil, fmt.Errorf("ledger entries must balance: debit=%d, credit=%d", totalDebit, totalCredit)
	}

	var created []LedgerEntry
	for _, e := range entries {
		id := uuid.Must(uuid.NewV7()).String()
		now := time.Now().UTC()

		metaJSON, mErr := json.Marshal(e.Metadata)
		if mErr != nil {
			return nil, fmt.Errorf("marshal metadata: %w", mErr)
		}

		var descPtr *string
		if e.Description != "" {
			descPtr = &e.Description
		}

		var le LedgerEntry
		err := tx.QueryRow(ctx, `
			INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, description, metadata, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			RETURNING id, transaction_id, account_id, entry_type, amount, description, metadata, created_at
		`, id, e.TransactionID, e.AccountID, e.EntryType, e.Amount, descPtr, metaJSON, now).Scan(
			&le.ID, &le.TransactionID, &le.AccountID, &le.EntryType,
			&le.Amount, &le.Description, &le.Metadata, &le.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("insert ledger entry: %w", err)
		}
		created = append(created, le)

		// Update account balance: debit increases, credit decreases
		var balanceChange int64
		if e.EntryType == EntryDebit {
			balanceChange = e.Amount
		} else {
			balanceChange = -e.Amount
		}

		_, err = tx.Exec(ctx, `
			UPDATE accounts SET balance = balance + $1, updated_at = $2 WHERE id = $3
		`, balanceChange, now, e.AccountID)
		if err != nil {
			return nil, fmt.Errorf("update account balance: %w", err)
		}
	}

	return created, nil
}

func (s *LedgerStore) GetAccountBalance(ctx context.Context, accountID string) (int64, error) {
	var balance int64
	err := s.pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1`, accountID).Scan(&balance)
	if err == pgx.ErrNoRows {
		return 0, fmt.Errorf("account not found: %s", accountID)
	}
	if err != nil {
		return 0, fmt.Errorf("query balance: %w", err)
	}
	return balance, nil
}

// --- scanner ---

func scanAccount(row pgx.Row) (*Account, error) {
	var a Account
	err := row.Scan(
		&a.ID, &a.OwnerType, &a.OwnerID, &a.AccountType,
		&a.Name, &a.Balance, &a.Currency, &a.CreatedAt, &a.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan account: %w", err)
	}
	return &a, nil
}

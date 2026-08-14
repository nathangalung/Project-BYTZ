package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// countingTx records every statement the store issues, so a test can assert
// that a rejected entry set wrote nothing rather than only that it returned an
// error.
type countingTx struct {
	MockTx
	// MockTx.Query is a fixed stub; escrow lookups inside a transaction need a
	// result set, so this type carries its own.
	QueryFn   func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	queryRows []capturedCall
	execs     []capturedCall
}

func (t *countingTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if t.QueryFn != nil {
		return t.QueryFn(ctx, sql, args...)
	}
	return t.MockTx.Query(ctx, sql, args...)
}

type capturedCall struct {
	sql  string
	args []any
}

func (t *countingTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	t.queryRows = append(t.queryRows, capturedCall{sql: sql, args: args})
	return t.MockTx.QueryRow(ctx, sql, args...)
}

func (t *countingTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.execs = append(t.execs, capturedCall{sql: sql, args: args})
	return t.MockTx.Exec(ctx, sql, args...)
}

func (t *countingTx) writes() int { return len(t.queryRows) + len(t.execs) }

// scanLedgerEntryInto fills the RETURNING targets of a ledger_entries insert
// with the values the caller sent, which is what a real round trip does.
func scanLedgerEntryInto(in LedgerEntryInput, id string, at time.Time) func(dest ...any) error {
	return func(dest ...any) error {
		if len(dest) != 8 {
			return fmt.Errorf("expected 8 scan targets, got %d", len(dest))
		}
		*(dest[0].(*string)) = id
		*(dest[1].(*string)) = in.TransactionID
		*(dest[2].(*string)) = in.AccountID
		*(dest[3].(*string)) = in.EntryType
		*(dest[4].(*int64)) = in.Amount
		*(dest[6].(*json.RawMessage)) = json.RawMessage(`{}`)
		*(dest[7].(*time.Time)) = at
		return nil
	}
}

/*
The invariant the ledger exists to enforce. Every rejection here is a set of
entries that would have left the books unbalanced, and each must be refused
before a single row is written: a partial insert followed by an error would
still have moved money, because CreateLedgerEntriesTx runs inside a caller's
transaction that the caller may go on to commit.
*/
func TestCreateLedgerEntriesTx_RejectsUnbalancedSets(t *testing.T) {
	tests := []struct {
		name    string
		entries []LedgerEntryInput
		wantErr string
	}{
		{
			name:    "no entries at all",
			entries: nil,
			wantErr: "at least one ledger entry is required",
		},
		{
			name: "debits exceed credits",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: EntryDebit, Amount: 10_000_000},
				{AccountID: "owner", EntryType: EntryCredit, Amount: 9_000_000},
			},
			wantErr: "ledger entries must balance: debit=10000000, credit=9000000",
		},
		{
			name: "credits exceed debits",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: EntryDebit, Amount: 7_150_000},
				{AccountID: "owner", EntryType: EntryCredit, Amount: 10_000_000},
			},
			wantErr: "ledger entries must balance: debit=7150000, credit=10000000",
		},
		{
			// The release split: gross out of escrow, talent share and platform
			// fee in. One rupiah of drift is still a rejection.
			name: "three-leg release off by one rupiah",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: EntryCredit, Amount: 10_000_000},
				{AccountID: "talent", EntryType: EntryDebit, Amount: 7_150_000},
				{AccountID: "platform", EntryType: EntryDebit, Amount: 2_849_999},
			},
			wantErr: "ledger entries must balance: debit=9999999, credit=10000000",
		},
		{
			name: "one leg only",
			entries: []LedgerEntryInput{
				{AccountID: "talent", EntryType: EntryDebit, Amount: 5_000_000},
			},
			wantErr: "ledger entries must balance: debit=5000000, credit=0",
		},
		{
			name: "zero amount",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: EntryDebit, Amount: 0},
				{AccountID: "owner", EntryType: EntryCredit, Amount: 0},
			},
			wantErr: "ledger entry amount must be positive, got 0",
		},
		{
			// A negative debit would otherwise net against a positive one and
			// pass the balance check while draining an account.
			name: "negative amount nets out to a balanced-looking set",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: EntryDebit, Amount: -1_000_000},
				{AccountID: "owner", EntryType: EntryCredit, Amount: -1_000_000},
			},
			wantErr: "ledger entry amount must be positive, got -1000000",
		},
		{
			name: "unknown entry type counts as neither side",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: "transfer", Amount: 1_000_000},
				{AccountID: "owner", EntryType: EntryCredit, Amount: 1_000_000},
			},
			wantErr: "invalid entry type: transfer",
		},
		{
			name: "empty entry type",
			entries: []LedgerEntryInput{
				{AccountID: "escrow", EntryType: "", Amount: 1_000_000},
			},
			wantErr: "invalid entry type: ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &LedgerStore{}
			tx := &countingTx{}

			created, err := s.CreateLedgerEntriesTx(context.Background(), tx, tt.entries)

			if err == nil {
				t.Fatalf("unbalanced set was accepted, returned %d entries", len(created))
			}
			if err.Error() != tt.wantErr {
				t.Errorf("error = %q, want %q", err.Error(), tt.wantErr)
			}
			if created != nil {
				t.Errorf("returned %d entries alongside the rejection", len(created))
			}
			if n := tx.writes(); n != 0 {
				t.Errorf("rejected set still issued %d statements; the books were touched", n)
			}
		})
	}
}

// The sign convention the whole ledger rests on: a debit raises the account
// balance and a credit lowers it. Inverting it silently reverses every escrow
// pool, so the direction is asserted per leg rather than in aggregate.
func TestCreateLedgerEntriesTx_PostsBalancedSetAndMovesBalances(t *testing.T) {
	entries := []LedgerEntryInput{
		{
			TransactionID: "txn-1", AccountID: "acct-escrow", EntryType: EntryCredit,
			Amount: 10_000_000, Description: "Escrow release for milestone m-1",
			Metadata: map[string]any{"milestoneId": "m-1"},
		},
		{
			TransactionID: "txn-1", AccountID: "acct-talent", EntryType: EntryDebit,
			Amount: 7_150_000, Description: "Milestone payment for milestone m-1",
		},
		{
			TransactionID: "txn-1", AccountID: "acct-platform", EntryType: EntryDebit,
			Amount: 2_850_000, Description: "Platform fee for milestone m-1",
		},
	}

	at := time.Date(2026, 7, 24, 3, 30, 0, 0, time.UTC)
	seen := 0
	tx := &countingTx{}
	tx.QueryRowFn = func(_ context.Context, _ string, _ ...any) pgx.Row {
		in := entries[seen]
		seen++
		return &MockRow{ScanFn: scanLedgerEntryInto(in, fmt.Sprintf("le-%d", seen), at)}
	}

	s := &LedgerStore{}
	created, err := s.CreateLedgerEntriesTx(context.Background(), tx, entries)
	if err != nil {
		t.Fatalf("balanced set rejected: %v", err)
	}
	if len(created) != 3 {
		t.Fatalf("created %d entries, want 3", len(created))
	}

	// One insert and one balance update per leg, in input order.
	if len(tx.queryRows) != 3 || len(tx.execs) != 3 {
		t.Fatalf("issued %d inserts and %d updates, want 3 and 3", len(tx.queryRows), len(tx.execs))
	}

	wantDelta := map[string]int64{
		"acct-escrow":   -10_000_000,
		"acct-talent":   7_150_000,
		"acct-platform": 2_850_000,
	}
	var netDelta int64
	for i, call := range tx.execs {
		if !strings.Contains(call.sql, "UPDATE accounts SET balance = balance + $1") {
			t.Errorf("leg %d did not update a balance: %s", i, call.sql)
			continue
		}
		delta, ok := call.args[0].(int64)
		if !ok {
			t.Fatalf("leg %d balance delta is %T, want int64", i, call.args[0])
		}
		accountID, ok := call.args[2].(string)
		if !ok {
			t.Fatalf("leg %d account id is %T, want string", i, call.args[2])
		}
		if want := wantDelta[accountID]; delta != want {
			t.Errorf("%s moved by %d, want %d", accountID, delta, want)
		}
		netDelta += delta
	}
	// A balanced set is conservative: what leaves one account arrives in others.
	if netDelta != 0 {
		t.Errorf("balances moved by a net %d; a balanced posting must conserve", netDelta)
	}

	// Descriptions are persisted, and an empty one is stored as NULL rather
	// than as the empty string.
	if got := tx.queryRows[0].args[5].(*string); got == nil || *got != "Escrow release for milestone m-1" {
		t.Errorf("description not passed through: %v", got)
	}
}

func TestCreateLedgerEntriesTx_OmitsEmptyDescription(t *testing.T) {
	tx := &countingTx{}
	tx.QueryRowFn = func(_ context.Context, _ string, _ ...any) pgx.Row {
		return &MockRow{}
	}
	s := &LedgerStore{}

	_, err := s.CreateLedgerEntriesTx(context.Background(), tx, []LedgerEntryInput{
		{AccountID: "a", EntryType: EntryDebit, Amount: 100},
		{AccountID: "b", EntryType: EntryCredit, Amount: 100},
	})
	if err != nil {
		t.Fatalf("CreateLedgerEntriesTx: %v", err)
	}
	if got := tx.queryRows[0].args[5]; got != (*string)(nil) {
		t.Errorf("empty description stored as %#v, want a nil *string", got)
	}
}

func TestCreateLedgerEntriesTx_SurfacesWriteFailures(t *testing.T) {
	balanced := []LedgerEntryInput{
		{AccountID: "a", EntryType: EntryDebit, Amount: 100},
		{AccountID: "b", EntryType: EntryCredit, Amount: 100},
	}
	insertErr := errors.New("duplicate key")
	updateErr := errors.New("deadlock detected")

	tests := []struct {
		name     string
		queryRow func(ctx context.Context, sql string, args ...any) pgx.Row
		exec     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
		entries  []LedgerEntryInput
		wantErr  string
	}{
		{
			name: "insert rejected",
			queryRow: func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: func(...any) error { return insertErr }}
			},
			entries: balanced,
			wantErr: "insert ledger entry: duplicate key",
		},
		{
			name:     "balance update rejected",
			queryRow: func(context.Context, string, ...any) pgx.Row { return &MockRow{} },
			exec: func(context.Context, string, ...any) (pgconn.CommandTag, error) {
				return pgconn.CommandTag{}, updateErr
			},
			entries: balanced,
			wantErr: "update account balance: deadlock detected",
		},
		{
			name:     "metadata that cannot be serialised",
			queryRow: func(context.Context, string, ...any) pgx.Row { return &MockRow{} },
			entries: []LedgerEntryInput{
				{AccountID: "a", EntryType: EntryDebit, Amount: 100, Metadata: map[string]any{"ch": make(chan int)}},
				{AccountID: "b", EntryType: EntryCredit, Amount: 100},
			},
			wantErr: "marshal metadata: json: unsupported type: chan int",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &countingTx{}
			tx.QueryRowFn = tt.queryRow
			tx.ExecFn = tt.exec
			s := &LedgerStore{}

			_, err := s.CreateLedgerEntriesTx(context.Background(), tx, tt.entries)
			if err == nil {
				t.Fatal("write failure was swallowed")
			}
			if err.Error() != tt.wantErr {
				t.Errorf("error = %q, want %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// CreateLedgerEntries is the pool-owned wrapper. It must commit only when the
// delegate succeeded; on rejection the deferred rollback is what keeps a
// half-written set out of the books.
func TestCreateLedgerEntries_CommitsOnlyBalancedSets(t *testing.T) {
	balanced := []LedgerEntryInput{
		{AccountID: "a", EntryType: EntryDebit, Amount: 100},
		{AccountID: "b", EntryType: EntryCredit, Amount: 100},
	}

	tests := []struct {
		name       string
		entries    []LedgerEntryInput
		beginErr   error
		commitErr  error
		wantErr    string
		wantCommit bool
	}{
		{name: "balanced set commits", entries: balanced, wantCommit: true},
		{
			name:    "unbalanced set never reaches commit",
			entries: []LedgerEntryInput{{AccountID: "a", EntryType: EntryDebit, Amount: 100}},
			wantErr: "ledger entries must balance: debit=100, credit=0",
		},
		{
			name:     "transaction could not be opened",
			entries:  balanced,
			beginErr: errors.New("pool exhausted"),
			wantErr:  "begin tx: pool exhausted",
		},
		{
			name:       "commit failure is reported, not swallowed",
			entries:    balanced,
			commitErr:  errors.New("serialization failure"),
			wantErr:    "commit ledger tx: serialization failure",
			wantCommit: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			committed, rolledBack := false, false
			tx := &countingTx{}
			tx.QueryRowFn = func(context.Context, string, ...any) pgx.Row { return &MockRow{} }
			tx.CommitFn = func(context.Context) error { committed = true; return tt.commitErr }
			tx.RollbackFn = func(context.Context) error { rolledBack = true; return nil }

			var gotOpts pgx.TxOptions
			s := &LedgerStore{pool: &MockPool{
				BeginTxFn: func(_ context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
					gotOpts = opts
					if tt.beginErr != nil {
						return nil, tt.beginErr
					}
					return tx, nil
				},
			}}

			_, err := s.CreateLedgerEntries(context.Background(), tt.entries)

			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
			} else if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}
			if committed != tt.wantCommit {
				t.Errorf("committed = %v, want %v", committed, tt.wantCommit)
			}
			if tt.beginErr == nil && !rolledBack {
				t.Error("the deferred rollback never ran")
			}
			// Money movement runs at the strictest isolation; anything weaker
			// lets two releases read the same escrow balance.
			if tt.beginErr == nil && gotOpts.IsoLevel != pgx.Serializable {
				t.Errorf("isolation level = %q, want serializable", gotOpts.IsoLevel)
			}
		})
	}
}

// The upsert arbiter has to match the partial unique index Postgres actually
// has, or the statement fails at runtime with "no unique or exclusion
// constraint matching the ON CONFLICT specification". A platform account has a
// NULL owner_id and needs the other index.
func TestGetOrCreateAccount_PicksArbiterMatchingTheOwner(t *testing.T) {
	ownerID := "user-1"

	tests := []struct {
		name        string
		in          CreateAccountInput
		wantSQL     string
		wantNotSQL  string
		wantCurrent string
	}{
		{
			name:        "owned account uses the owner_id arbiter",
			in:          CreateAccountInput{OwnerType: OwnerOwner, OwnerID: &ownerID, AccountType: AcctAsset},
			wantSQL:     "ON CONFLICT (owner_type, owner_id) WHERE owner_id IS NOT NULL",
			wantNotSQL:  "ON CONFLICT (owner_type) WHERE owner_id IS NULL",
			wantCurrent: "IDR",
		},
		{
			name:        "platform account uses the owner_id IS NULL arbiter",
			in:          CreateAccountInput{OwnerType: OwnerPlatform, AccountType: AcctRevenue, Currency: "USD"},
			wantSQL:     "ON CONFLICT (owner_type) WHERE owner_id IS NULL",
			wantNotSQL:  "ON CONFLICT (owner_type, owner_id) WHERE owner_id IS NOT NULL",
			wantCurrent: "USD",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var poolSQL, txSQL string
			var poolArgs []any
			pool := &MockPool{QueryRowFn: func(_ context.Context, sql string, args ...any) pgx.Row {
				poolSQL, poolArgs = sql, args
				return &MockRow{}
			}}
			tx := &countingTx{}
			tx.QueryRowFn = func(_ context.Context, sql string, _ ...any) pgx.Row {
				txSQL = sql
				return &MockRow{}
			}
			s := &LedgerStore{pool: pool}

			if _, err := s.GetOrCreateAccount(context.Background(), tt.in); err != nil {
				t.Fatalf("GetOrCreateAccount: %v", err)
			}
			if _, err := s.GetOrCreateAccountTx(context.Background(), tx, tt.in); err != nil {
				t.Fatalf("GetOrCreateAccountTx: %v", err)
			}

			for label, sql := range map[string]string{"pool": poolSQL, "tx": txSQL} {
				if !strings.Contains(sql, tt.wantSQL) {
					t.Errorf("%s upsert is missing the %q arbiter", label, tt.wantSQL)
				}
				if strings.Contains(sql, tt.wantNotSQL) {
					t.Errorf("%s upsert used the wrong arbiter %q", label, tt.wantNotSQL)
				}
			}
			// A new account opens at zero and defaults to Rupiah.
			if poolArgs[5] != 0 {
				t.Errorf("opening balance = %v, want 0", poolArgs[5])
			}
			if poolArgs[6] != tt.wantCurrent {
				t.Errorf("currency = %v, want %q", poolArgs[6], tt.wantCurrent)
			}
		})
	}
}

func TestCreateAccount_OpensAtZero(t *testing.T) {
	ownerID := "talent-9"
	var sql string
	var args []any
	s := &LedgerStore{pool: &MockPool{QueryRowFn: func(_ context.Context, q string, a ...any) pgx.Row {
		sql, args = q, a
		return &MockRow{ScanFn: func(dest ...any) error {
			*(dest[0].(*string)) = "acct-1"
			*(dest[5].(*int64)) = 0
			return nil
		}}
	}}}

	acct, err := s.CreateAccount(context.Background(), CreateAccountInput{
		OwnerType: OwnerTalent, OwnerID: &ownerID, AccountType: AcctAsset, Name: "Talent Payout - talent-9",
	})
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	if acct == nil || acct.ID != "acct-1" {
		t.Fatalf("account = %+v, want id acct-1", acct)
	}
	if !strings.Contains(sql, "INSERT INTO accounts") || strings.Contains(sql, "ON CONFLICT") {
		t.Errorf("CreateAccount must be a plain insert, got: %s", sql)
	}
	if args[5] != 0 {
		t.Errorf("opening balance = %v, want 0", args[5])
	}
}

// A nil owner id must select the IS NULL branch. Passing NULL as a parameter
// to `owner_id = $2` matches nothing, so the platform account would look
// missing and a second one would be opened on every settlement.
func TestFindAccountByOwner_NullOwnerUsesIsNullPredicate(t *testing.T) {
	ownerID := "user-1"

	tests := []struct {
		name     string
		ownerID  *string
		wantSQL  string
		wantArgs int
	}{
		{name: "owned", ownerID: &ownerID, wantSQL: "owner_id = $2", wantArgs: 2},
		{name: "platform", ownerID: nil, wantSQL: "owner_id IS NULL", wantArgs: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var poolSQL, txSQL string
			var poolArgs []any
			pool := &MockPool{QueryRowFn: func(_ context.Context, sql string, args ...any) pgx.Row {
				poolSQL, poolArgs = sql, args
				return &MockRow{ScanFn: func(...any) error { return pgx.ErrNoRows }}
			}}
			tx := &countingTx{}
			tx.QueryRowFn = func(_ context.Context, sql string, _ ...any) pgx.Row {
				txSQL = sql
				return &MockRow{ScanFn: func(...any) error { return pgx.ErrNoRows }}
			}
			s := &LedgerStore{pool: pool}

			got, err := s.FindAccountByOwner(context.Background(), OwnerEscrow, tt.ownerID)
			if err != nil || got != nil {
				t.Fatalf("missing account = (%v, %v), want (nil, nil)", got, err)
			}
			if _, err := s.FindAccountByOwnerTx(context.Background(), tx, OwnerEscrow, tt.ownerID); err != nil {
				t.Fatalf("FindAccountByOwnerTx: %v", err)
			}
			if !strings.Contains(poolSQL, tt.wantSQL) {
				t.Errorf("pool query missing %q: %s", tt.wantSQL, poolSQL)
			}
			if !strings.Contains(txSQL, tt.wantSQL) {
				t.Errorf("tx query missing %q: %s", tt.wantSQL, txSQL)
			}
			if len(poolArgs) != tt.wantArgs {
				t.Errorf("passed %d args, want %d", len(poolArgs), tt.wantArgs)
			}
		})
	}
}

func TestFindAccountByOwner_SurfacesScanErrors(t *testing.T) {
	s := &LedgerStore{pool: &MockPool{QueryRowFn: func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: func(...any) error { return errors.New("connection reset") }}
	}}}

	_, err := s.FindAccountByOwner(context.Background(), OwnerEscrow, nil)
	if err == nil || err.Error() != "scan account: connection reset" {
		t.Fatalf("error = %v, want scan account: connection reset", err)
	}
}

// A refund draws the fullest pool down first, so the ordering in the SQL is
// load-bearing rather than cosmetic.
func TestFindEscrowAccountsForProject_OrdersFullestFirst(t *testing.T) {
	rowFor := func(id string, balance int64) func(dest ...any) error {
		return func(dest ...any) error {
			*(dest[0].(*string)) = id
			*(dest[1].(*string)) = OwnerEscrow
			*(dest[5].(*int64)) = balance
			return nil
		}
	}

	for _, viaTx := range []bool{false, true} {
		name := "pool"
		if viaTx {
			name = "tx"
		}
		t.Run(name, func(t *testing.T) {
			var sql string
			query := func(_ context.Context, q string, args ...any) (pgx.Rows, error) {
				sql = q
				if len(args) != 1 || args[0] != "proj-1" {
					t.Errorf("args = %v, want [proj-1]", args)
				}
				return newFakeRows(rowFor("acct-big", 9_000_000), rowFor("acct-small", 1_000_000)), nil
			}

			s := &LedgerStore{pool: &MockPool{QueryFn: query}}
			tx := &countingTx{}
			tx.QueryFn = query

			var accounts []Account
			var err error
			if viaTx {
				accounts, err = s.FindEscrowAccountsForProjectTx(context.Background(), tx, "proj-1")
			} else {
				accounts, err = s.FindEscrowAccountsForProject(context.Background(), "proj-1")
			}
			if err != nil {
				t.Fatalf("find escrow accounts: %v", err)
			}
			if len(accounts) != 2 || accounts[0].ID != "acct-big" {
				t.Fatalf("accounts = %+v, want acct-big first", accounts)
			}
			if !strings.Contains(sql, "ORDER BY balance DESC") {
				t.Errorf("escrow accounts are not ordered fullest first: %s", sql)
			}
			// A project's money lives in one pool per work package plus a
			// project level pool; both must be reachable.
			if !strings.Contains(sql, "owner_id IN (SELECT id FROM work_packages WHERE project_id = $1)") {
				t.Errorf("work package pools are not included: %s", sql)
			}
		})
	}
}

func TestLedgerQueries_SurfaceFailures(t *testing.T) {
	queryErr := errors.New("relation does not exist")
	scanErr := errors.New("bad column type")

	tests := []struct {
		name    string
		call    func(s *LedgerStore, tx pgx.Tx) error
		queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
		wantErr string
	}{
		{
			name: "escrow accounts query fails",
			call: func(s *LedgerStore, _ pgx.Tx) error {
				_, e := s.FindEscrowAccountsForProject(context.Background(), "p")
				return e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, queryErr },
			wantErr: "query escrow accounts: relation does not exist",
		},
		{
			name: "escrow accounts query fails inside a tx",
			call: func(s *LedgerStore, tx pgx.Tx) error {
				_, e := s.FindEscrowAccountsForProjectTx(context.Background(), tx, "p")
				return e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, queryErr },
			wantErr: "query escrow accounts: relation does not exist",
		},
		{
			name: "account row cannot be scanned",
			call: func(s *LedgerStore, _ pgx.Tx) error {
				_, e := s.FindEscrowAccountsForProject(context.Background(), "p")
				return e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(func(...any) error { return scanErr }), nil
			},
			wantErr: "scan account: bad column type",
		},
		{
			name: "ledger entries query fails",
			call: func(s *LedgerStore, _ pgx.Tx) error {
				_, e := s.GetEntriesByTransaction(context.Background(), "t")
				return e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, queryErr },
			wantErr: "query ledger entries: relation does not exist",
		},
		{
			name: "ledger entries query fails inside a tx",
			call: func(s *LedgerStore, tx pgx.Tx) error {
				_, e := s.GetEntriesByTransactionTx(context.Background(), tx, "t")
				return e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, queryErr },
			wantErr: "query ledger entries: relation does not exist",
		},
		{
			name: "ledger entry row cannot be scanned",
			call: func(s *LedgerStore, _ pgx.Tx) error {
				_, e := s.GetEntriesByTransaction(context.Background(), "t")
				return e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(func(...any) error { return scanErr }), nil
			},
			wantErr: "scan ledger entry: bad column type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &LedgerStore{pool: &MockPool{QueryFn: tt.queryFn}}
			tx := &countingTx{}
			tx.QueryFn = tt.queryFn

			err := tt.call(s, tx)
			if err == nil {
				t.Fatal("query failure was swallowed")
			}
			if err.Error() != tt.wantErr {
				t.Errorf("error = %q, want %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// A reversal is written from what the funding actually booked, so the reader
// has to return the legs in both directions untouched.
func TestGetEntriesByTransaction_ReturnsBothDirections(t *testing.T) {
	entry := func(id, accountID, entryType string, amount int64) func(dest ...any) error {
		return func(dest ...any) error {
			*(dest[0].(*string)) = id
			*(dest[1].(*string)) = "txn-1"
			*(dest[2].(*string)) = accountID
			*(dest[3].(*string)) = entryType
			*(dest[4].(*int64)) = amount
			return nil
		}
	}
	rows := func(context.Context, string, ...any) (pgx.Rows, error) {
		return newFakeRows(
			entry("le-1", "acct-owner", EntryCredit, 10_000_000),
			entry("le-2", "acct-escrow", EntryDebit, 10_000_000),
		), nil
	}

	s := &LedgerStore{pool: &MockPool{QueryFn: rows}}
	tx := &countingTx{}
	tx.QueryFn = rows

	for _, viaTx := range []bool{false, true} {
		var got []LedgerEntry
		var err error
		if viaTx {
			got, err = s.GetEntriesByTransactionTx(context.Background(), tx, "txn-1")
		} else {
			got, err = s.GetEntriesByTransaction(context.Background(), "txn-1")
		}
		if err != nil {
			t.Fatalf("GetEntriesByTransaction(tx=%v): %v", viaTx, err)
		}
		if len(got) != 2 {
			t.Fatalf("got %d entries, want 2", len(got))
		}
		if got[0].EntryType != EntryCredit || got[1].EntryType != EntryDebit {
			t.Errorf("entry directions = %q, %q; want credit, debit", got[0].EntryType, got[1].EntryType)
		}
		var debits, credits int64
		for _, e := range got {
			if e.EntryType == EntryDebit {
				debits += e.Amount
			} else {
				credits += e.Amount
			}
		}
		if debits != credits {
			t.Errorf("stored posting is unbalanced: debit=%d credit=%d", debits, credits)
		}
	}
}

func TestGetAccountBalance(t *testing.T) {
	tests := []struct {
		name    string
		scanErr error
		balance int64
		want    int64
		wantErr string
	}{
		{name: "reads the stored balance", balance: 7_150_000, want: 7_150_000},
		{name: "negative balance is reported, not clamped", balance: -500, want: -500},
		{name: "unknown account", scanErr: pgx.ErrNoRows, wantErr: "account not found: acct-1"},
		{name: "query failure", scanErr: errors.New("timeout"), wantErr: "query balance: timeout"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &LedgerStore{pool: &MockPool{QueryRowFn: func(_ context.Context, _ string, args ...any) pgx.Row {
				if len(args) != 1 || args[0] != "acct-1" {
					t.Errorf("args = %v, want [acct-1]", args)
				}
				return &MockRow{ScanFn: func(dest ...any) error {
					if tt.scanErr != nil {
						return tt.scanErr
					}
					*(dest[0].(*int64)) = tt.balance
					return nil
				}}
			}}}

			got, err := s.GetAccountBalance(context.Background(), "acct-1")
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				if got != 0 {
					t.Errorf("balance = %d alongside an error, want 0", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetAccountBalance: %v", err)
			}
			if got != tt.want {
				t.Errorf("balance = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestLedgerStore_PoolExposesTheUnderlyingPool(t *testing.T) {
	pool := &MockPool{}
	s := &LedgerStore{pool: pool}
	if s.Pool() != pool {
		t.Error("Pool() did not return the pool the store was built with")
	}
}

func TestScanAccounts_PropagatesRowsErr(t *testing.T) {
	// rows.Err() is the only signal that a result set was cut short; dropping
	// it turns a truncated escrow listing into a silently smaller refund.
	rows := &erroringRows{err: errors.New("connection lost")}
	if _, err := scanAccounts(rows); err == nil || err.Error() != "connection lost" {
		t.Errorf("scanAccounts error = %v, want connection lost", err)
	}
	if _, err := scanLedgerEntries(&erroringRows{err: errors.New("connection lost")}); err == nil {
		t.Error("scanLedgerEntries dropped rows.Err()")
	}
}

// A pgx.Rows that yields nothing and reports a failure afterwards.
type erroringRows struct {
	fakeRows
	err error
}

func (r *erroringRows) Err() error { return r.err }

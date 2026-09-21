package pgintegration

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kerjacus/payment-service/internal/testsupport"
)

// int32Max is the ceiling the money columns used to have, about Rp 2,1 miliar.
// Everything up to it worked before the widening and must keep working after.
const int32Max = int64(2_147_483_647)

// moneyColumn names a column that stores an amount of money, and how to write
// one value into it.
type moneyColumn struct {
	name string
	// insert writes amount into the column and returns the database's answer.
	insert func(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, amount int64) error
}

// moneyColumns is the money columns the payment paths write: the escrow chain
// from the project's milestone through the transaction to the ledger. Each is
// `bigint` in packages/db/src/schema (payment.ts, project.ts) and in the
// migrated schema, since 0051_confused_ultimates.sql.
var moneyColumns = []moneyColumn{
	{
		name: "accounts.balance",
		insert: func(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, amount int64) error {
			_, err := pool.Exec(testsupport.Ctx(t), `
				INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency)
				VALUES ($1, 'escrow', $2, 'liability', 'Width Probe', $3, 'IDR')
			`, f.ID("account"), f.ID("escrow-owner"), amount)
			return err
		},
	},
	{
		name: "transactions.amount",
		insert: func(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, amount int64) error {
			_, err := pool.Exec(testsupport.Ctx(t), `
				INSERT INTO transactions (id, project_id, type, amount, status, idempotency_key)
				VALUES ($1, $2, 'escrow_in', $3, 'completed', $4)
			`, f.ID("transaction"), f.ProjectID, amount, f.ID("idem"))
			return err
		},
	},
	{
		name: "ledger_entries.amount",
		insert: func(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, amount int64) error {
			// Its own parents, sized inside the old width so the only value
			// under test is the entry's.
			transactionID := f.SeedTransaction(t, "escrow_in", 1_000_000)
			accountID := f.SeedAccount(t, "escrow", f.ID("escrow-owner"), "liability", 0)
			_, err := pool.Exec(testsupport.Ctx(t), `
				INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount)
				VALUES ($1, $2, $3, 'debit', $4)
			`, f.ID("entry"), transactionID, accountID, amount)
			return err
		},
	},
	{
		name: "milestones.amount",
		insert: func(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, amount int64) error {
			_, err := pool.Exec(testsupport.Ctx(t), `
				INSERT INTO milestones
					(id, project_id, title, description, milestone_type, order_index,
					 amount, status, due_date)
				VALUES ($1, $2, 'Width Probe', 'width probe', 'individual', 1, $3,
					'pending', now() + interval '30 days')
			`, f.ID("milestone"), f.ProjectID, amount)
			return err
		},
	},
}

// TestMoneyColumnsAreBigint guards the width against an accidental narrowing,
// stated against the catalogue rather than against behaviour.
//
// The behavioural test below is the one that says what a narrow column costs,
// but a write that succeeds proves only that this value fit. This one asks the
// schema what the column is, so a later migration that hands a money column
// back to `integer` fails here by name.
func TestMoneyColumnsAreBigint(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	const wantDataType = "bigint"

	for _, col := range moneyColumns {
		t.Run(col.name, func(t *testing.T) {
			table, column, ok := strings.Cut(col.name, ".")
			if !ok {
				t.Fatalf("money column %q is not table.column", col.name)
			}
			var dataType string
			err := pool.QueryRow(ctx, `
				SELECT data_type FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
			`, table, column).Scan(&dataType)
			if err != nil {
				t.Fatalf("read the declared type of %s: %v", col.name, err)
			}
			if dataType != wantDataType {
				t.Fatalf("%s is %s, not %s: a money column has been narrowed, which caps it at "+
					"Rp 2.147.483.647 and fails every larger write outright", col.name, dataType, wantDataType)
			}
		})
	}
}

// TestMoneyColumnsAcceptTheLargest32BitAmount is the floor: everything up to
// int32 max worked before the widening and still works after it.
func TestMoneyColumnsAcceptTheLargest32BitAmount(t *testing.T) {
	pool := testsupport.Pool(t)
	for _, col := range moneyColumns {
		t.Run(col.name, func(t *testing.T) {
			f := testsupport.NewFixture(t, pool)
			if err := col.insert(t, pool, f, int32Max); err != nil {
				t.Fatalf("%s rejected %d: %v", col.name, int32Max, err)
			}
		})
	}
}

// TestMoneyColumnsHoldAmountsAbove32Bit is the bigint migration's proof. It
// failed on every commit before 0051_confused_ultimates.sql, where an amount
// over Rp 2.147.483.647 was refused mid-transaction on a path no caller had a
// branch for.
func TestMoneyColumnsHoldAmountsAbove32Bit(t *testing.T) {
	pool := testsupport.Pool(t)
	// Rp 5 billion: above int32, well inside int64, and a plausible lifetime
	// escrow total for one enterprise project.
	const amount = int64(5_000_000_000)

	for _, col := range moneyColumns {
		t.Run(col.name, func(t *testing.T) {
			f := testsupport.NewFixture(t, pool)
			if err := col.insert(t, pool, f, amount); err != nil {
				t.Fatalf("%s cannot hold %d: %v", col.name, amount, err)
			}
		})
	}
}

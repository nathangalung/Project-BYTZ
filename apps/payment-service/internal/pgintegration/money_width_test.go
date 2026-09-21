package pgintegration

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kerjacus/payment-service/internal/testsupport"
)

// numericValueOutOfRange is SQLSTATE 22003, what an `integer` column raises for
// a value it cannot hold.
const numericValueOutOfRange = "22003"

// int32Max is the largest value the money columns accept today. In rupiah that
// is about Rp 2.1 billion, which a single enterprise project can exceed and a
// project's lifetime escrow throughput exceeds easily.
const int32Max = int64(2_147_483_647)

// moneyColumn names a column that stores an amount of money, and how to write
// one value into it.
type moneyColumn struct {
	name string
	// insert writes amount into the column and returns the database's answer.
	insert func(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, amount int64) error
}

// moneyColumns is every money column the payment paths write. Each is
// `integer` in packages/db/src/schema/payment.ts and in the migrated schema.
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
			// Its own parents, sized inside the current width so the only
			// value under test is the entry's.
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

// TestMoneyColumnsAreStillIntegerToday is the marker the bigint migration
// flips, stated against the catalogue rather than against behaviour.
//
// The behavioural tests below are the ones that say what goes wrong, but they
// read a failure shape that is partly pgx's (see isTooWideForColumn), so a
// library change could make them shout about a widening that has not happened.
// This one cannot: it asks the schema what the column is. One word per row
// changes when the columns widen.
func TestMoneyColumnsAreStillIntegerToday(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	const wantDataType = "integer" // -> "bigint" when the widening migration lands

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
				t.Fatalf("%s is %s, not %s: the money columns have been widened, so flip "+
					"wantDataType, delete TestMoneyColumnsRejectAmountsAbove32BitToday and "+
					"unskip TestMoneyColumnsHoldAmountsAbove32Bit", col.name, dataType, wantDataType)
			}
		})
	}
}

// TestMoneyColumnsAcceptTheLargest32BitAmount is the floor: everything up to
// int32 max works today and must keep working after the widening.
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

// TestMoneyColumnsRejectAmountsAbove32BitToday records what the schema does
// now, which is lose the money: anything over Rp 2,147,483,647 is refused
// outright with SQLSTATE 22003, mid-transaction, on a path the caller has no
// branch for.
//
// This test passes on main and is meant to. It is the marker for the bigint
// migration: when the money columns widen, this test starts failing, and the
// migration PR deletes it. Its opposite, immediately below, is already written
// and only needs its skip removed.
func TestMoneyColumnsRejectAmountsAbove32BitToday(t *testing.T) {
	pool := testsupport.Pool(t)
	for _, col := range moneyColumns {
		t.Run(col.name, func(t *testing.T) {
			f := testsupport.NewFixture(t, pool)
			err := col.insert(t, pool, f, int32Max+1)
			if !isTooWideForColumn(err) {
				t.Fatalf("%s accepted %d: the column appears to be wider than integer now, "+
					"so delete this test and unskip TestMoneyColumnsHoldAmountsAbove32Bit (got err=%v)",
					col.name, int32Max+1, err)
			}
		})
	}
}

// TestMoneyColumnsHoldAmountsAbove32Bit is the bigint migration's proof. It
// fails on main, so it is gated; the migration PR deletes the SkipUntilFixed
// line and deletes TestMoneyColumnsRejectAmountsAbove32BitToday.
func TestMoneyColumnsHoldAmountsAbove32Bit(t *testing.T) {
	testsupport.SkipUntilFixed(t, "the bigint money-column migration")

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

// isTooWideForColumn reports whether the write failed because the column
// cannot hold the value.
//
// There are two shapes, and which one appears is not the app's choice. pgx
// learns each parameter's type from the prepared statement description, so for
// an `integer` column it types the parameter int4 and refuses the value in its
// own encoder, client side, before the server is asked - which is what the
// production writers in internal/store get today, not a SQLSTATE. A cast or a
// literal reaches the server instead and comes back as 22003. Both are
// recognised, because both are the same schema fact; after the money columns
// widen to bigint neither occurs, the write succeeds, and every caller of this
// helper flips.
func isTooWideForColumn(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == numericValueOutOfRange
	}
	return strings.Contains(err.Error(), "greater than maximum value for int4")
}

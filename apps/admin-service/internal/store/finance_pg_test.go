package store

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The admin finance summary is the only place the platform's own revenue is
// added up, and it used to add it up from two sources at once: the platform fee
// legs in the ledger, and a CTE that counted document, revision and placement
// revenue straight off the transactions table. That second source existed
// because the payment webhook settled a brd, prd or revision payment without
// writing any ledger entry. It does write them now - and packages/db/src/seed.ts
// already did - so the two sources overlap and every document payment is
// counted twice in TotalRevenue.
//
// A mock pool cannot see that: it returns whatever row the test hands it, so an
// assertion about double counting against a mock is an assertion about the
// mock. This one runs the real query against the real schema.
//
// Gated on TEST_DATABASE_URL exactly like payment-service's integration tests,
// and it refuses any database whose name does not end in _test. A skip is the
// normal outcome on a laptop with no Postgres.

const financeQueryTimeout = 15 * time.Second

// financeDSN returns the integration database URL and whether it is usable.
func financeDSN() (string, bool) {
	dsn := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if dsn == "" {
		dsn = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if dsn == "" {
		return "", false
	}
	return dsn, databaseNameEndsInTest(dsn)
}

// databaseNameEndsInTest mirrors the guard in packages/db/src/testing.ts and in
// payment-service's internal/testsupport. This test writes rows, so pointing it
// at a development database is a mistake worth refusing rather than noticing
// afterwards.
func databaseNameEndsInTest(dsn string) bool {
	path := dsn
	if i := strings.Index(path, "://"); i >= 0 {
		path = path[i+3:]
	}
	i := strings.Index(path, "/")
	if i < 0 {
		return false
	}
	path = path[i+1:]
	if j := strings.IndexAny(path, "?#"); j >= 0 {
		path = path[:j]
	}
	return strings.HasSuffix(path, "_test")
}

func financePool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dsn, ok := financeDSN()
	if !ok {
		if dsn != "" {
			t.Skip("the integration database does not end in _test; refusing to write to it")
		}
		t.Skip("set TEST_DATABASE_URL to a migrated _test database to run the integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), financeQueryTimeout)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open integration pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// financeFixture is one test's slice of the shared database. Rows carry the
// fixture's prefix and cleanup deletes by it in foreign-key order; nothing is
// truncated, because a TRUNCATE would take out every other suite running
// against the same database.
type financeFixture struct {
	prefix    string
	userID    string
	projectID string
	pool      *pgxpool.Pool
}

func newFinanceFixture(t *testing.T, pool *pgxpool.Pool) *financeFixture {
	t.Helper()

	f := &financeFixture{prefix: "adminpgtest-" + uuid.Must(uuid.NewV7()).String(), pool: pool}
	f.userID = f.id("user")
	f.projectID = f.id("project")

	t.Cleanup(func() { f.cleanup(t) })

	f.exec(t, `
		INSERT INTO "user" (id, name, email, email_verified, role)
		VALUES ($1, 'Finance Fixture', $2, true, 'owner')
	`, f.userID, f.prefix+"@example.test")

	f.exec(t, `
		INSERT INTO projects
			(id, owner_id, title, description, category, status,
			 budget_min, budget_max, estimated_timeline_days)
		VALUES ($1, $2, 'Finance Fixture', 'seeded by finance_pg_test',
			'web_app', 'in_progress', 1000000, 5000000, 30)
	`, f.projectID, f.userID)

	return f
}

func (f *financeFixture) id(kind string) string {
	return fmt.Sprintf("%s-%s-%s", f.prefix, kind, uuid.Must(uuid.NewV7()).String())
}

func (f *financeFixture) ctx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), financeQueryTimeout)
	t.Cleanup(cancel)
	return ctx
}

func (f *financeFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx(t), sql, args...); err != nil {
		t.Fatalf("seed failed: %v\nsql: %s", err, strings.TrimSpace(sql))
	}
}

// account seeds one ledger account. The platform account is the NULL-owner_id
// singleton, so it is upserted rather than inserted: other fixtures share it.
func (f *financeFixture) platformAccount(t *testing.T) string {
	t.Helper()
	var id string
	err := f.pool.QueryRow(f.ctx(t), `
		INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency)
		VALUES ($1, 'platform', NULL, 'revenue', 'Platform Revenue', 0, 'IDR')
		ON CONFLICT (owner_type) WHERE owner_id IS NULL
		DO UPDATE SET updated_at = accounts.updated_at
		RETURNING id
	`, f.id("platform-account")).Scan(&id)
	if err != nil {
		t.Fatalf("seed platform account: %v", err)
	}
	return id
}

func (f *financeFixture) account(t *testing.T, ownerType, ownerID, accountType string) string {
	t.Helper()
	id := f.id("account")
	f.exec(t, `
		INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency)
		VALUES ($1, $2::account_owner_type, $3, $4::account_type, 'Finance Fixture Account', 0, 'IDR')
	`, id, ownerType, ownerID, accountType)
	return id
}

func (f *financeFixture) completedTransaction(t *testing.T, txType string, amount int64) string {
	t.Helper()
	id := f.id("transaction")
	f.exec(t, `
		INSERT INTO transactions (id, project_id, type, amount, status, idempotency_key)
		VALUES ($1, $2, $3::transaction_type, $4, 'completed', $5)
	`, id, f.projectID, txType, amount, f.id("idem"))
	return id
}

func (f *financeFixture) ledgerEntry(t *testing.T, transactionID, accountID, entryType string, amount int64) {
	t.Helper()
	f.exec(t, `
		INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, description, created_at)
		VALUES ($1, $2, $3, $4::ledger_entry_type, $5, 'seeded by finance_pg_test', now())
	`, f.id("ledger"), transactionID, accountID, entryType, amount)
}

var financeCleanupOrder = []string{
	`DELETE FROM ledger_entries WHERE transaction_id IN (
		SELECT id FROM transactions WHERE project_id LIKE $1)
	   OR account_id LIKE $1`,
	`DELETE FROM transactions WHERE project_id LIKE $1`,
	`DELETE FROM projects WHERE id LIKE $1`,
	`DELETE FROM accounts WHERE id LIKE $1 OR owner_id LIKE $1`,
	`DELETE FROM "user" WHERE id LIKE $1`,
}

func (f *financeFixture) cleanup(t *testing.T) {
	t.Helper()
	// Not the test's own context: on a timed-out test that one is already
	// cancelled and the rows would survive.
	ctx, cancel := context.WithTimeout(context.Background(), financeQueryTimeout)
	defer cancel()

	pattern := f.prefix + "%"
	for _, stmt := range financeCleanupOrder {
		if _, err := f.pool.Exec(ctx, stmt, pattern); err != nil {
			t.Logf("fixture cleanup %q: %v", stmt, err)
		}
	}
}

/*
TestGetSummary_DocumentRevenueIsCountedOnce is the assertion the mock suite
cannot make.

A brd payment now arrives in the ledger as debit-platform / credit-owner, the
pair the payment webhook books and the pair the seed writes. A release arrives
as a platform fee leg beside the talent's share. Counting document revenue off
transactions as well as off those legs adds the brd amount to TotalRevenue
twice.

Measured as deltas against a baseline taken before seeding: the summary is a
global aggregate over a database this test shares with every other suite, so
absolute figures would say more about the neighbours than about the query.
*/
func TestGetSummary_DocumentRevenueIsCountedOnce(t *testing.T) {
	pool := financePool(t)
	s := NewFinanceStore(pool)
	ctx := context.Background()

	before, err := s.GetSummary(ctx)
	if err != nil {
		t.Fatalf("baseline summary: %v", err)
	}

	f := newFinanceFixture(t, pool)

	const (
		brdPrice     = 250_000
		revisionFee  = 175_000
		releaseGross = 9_000_000
		releaseFee   = 1_000_000
		// Deliberately larger than the release, so the escrow-held assertion
		// below has a non-zero figure to be right or wrong about.
		depositAmount = 12_000_000
	)

	platformAcct := f.platformAccount(t)
	ownerAcct := f.account(t, "owner", f.userID, "asset")
	talentAcct := f.account(t, "talent", f.id("talent"), "asset")
	escrowAcct := f.account(t, "escrow", f.projectID, "liability")

	// A settled brd payment: the platform holds it, the owner paid it.
	brdTxn := f.completedTransaction(t, "brd_payment", brdPrice)
	f.ledgerEntry(t, brdTxn, platformAcct, "debit", brdPrice)
	f.ledgerEntry(t, brdTxn, ownerAcct, "credit", brdPrice)

	// A settled revision fee, booked the same way.
	revTxn := f.completedTransaction(t, "revision_fee", revisionFee)
	f.ledgerEntry(t, revTxn, platformAcct, "debit", revisionFee)
	f.ledgerEntry(t, revTxn, ownerAcct, "credit", revisionFee)

	// A released milestone: only the fee slice is the platform's.
	releaseTxn := f.completedTransaction(t, "escrow_release", releaseGross)
	f.ledgerEntry(t, releaseTxn, escrowAcct, "credit", releaseGross)
	f.ledgerEntry(t, releaseTxn, talentAcct, "debit", releaseGross-releaseFee)
	f.ledgerEntry(t, releaseTxn, platformAcct, "debit", releaseFee)

	// A funded deposit: a liability owed onward, never income.
	depositTxn := f.completedTransaction(t, "escrow_in", depositAmount)
	f.ledgerEntry(t, depositTxn, escrowAcct, "debit", depositAmount)
	f.ledgerEntry(t, depositTxn, ownerAcct, "credit", depositAmount)

	after, err := s.GetSummary(ctx)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}

	tests := []struct {
		name string
		got  int64
		want int64
	}{
		// The whole point: brdPrice once, not twice.
		{"total revenue", after.TotalRevenue - before.TotalRevenue, brdPrice + revisionFee + releaseFee},
		{"this month revenue", after.ThisMonthRevenue - before.ThisMonthRevenue, brdPrice + revisionFee + releaseFee},
		{"last month revenue", after.LastMonthRevenue - before.LastMonthRevenue, 0},
		{"brd revenue", after.BrdRevenue - before.BrdRevenue, brdPrice},
		{"prd revenue", after.PrdRevenue - before.PrdRevenue, 0},
		{"revision fee", after.RevisionFee - before.RevisionFee, revisionFee},
		// The margin is the fee slice, not the gross release.
		{"margin revenue", after.MarginRevenue - before.MarginRevenue, releaseFee},
		{"placement fee", after.PlacementFee - before.PlacementFee, 0},
		// The deposit is held, not earned: what came in, less what was
		// released out of it.
		{"escrow held", after.EscrowHeld - before.EscrowHeld, depositAmount - releaseGross},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.want {
				t.Errorf("%s moved by %d, want %d", tt.name, tt.got, tt.want)
			}
		})
	}
}

// Package testsupport gives the payment-service tests a real Postgres.
//
// Nothing outside a _test.go file imports this package. It lives beside the
// production code rather than in a _test.go file because several test packages
// share it, and Go has no way to export a helper from one package's test
// binary to another's.
//
// # Why this exists
//
// Every money test in this service ran against internal/store's mock pool, and
// a mock accepts pgx.TxOptions{IsoLevel: pgx.Serializable} and pgx.TxOptions{}
// identically. Isolation level, FOR UPDATE, unique and partial indexes, and the
// 32-bit width of the money columns are therefore properties no mock test can
// falsify: asserting them against a mock asserts something about the mock.
// The tests that use this package run against the schema the drizzle
// migrations in packages/db produce, which is the schema production runs.
//
// # Skip on missing env, not a build tag
//
// The integration tests are gated on TEST_DATABASE_URL being set rather than on
// a build tag, for two reasons. A build tag hides the files from the compiler,
// so a signature change in internal/store breaks them silently and the breakage
// only surfaces in whichever job remembers to pass -tags; a runtime skip keeps
// them in `go build ./...` and `go vet ./...` always. And the env var is
// already how CI hands a database to the TypeScript suites, so there is one
// convention rather than two.
package testsupport

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

// queryTimeout bounds every statement a fixture issues. The racing tests drive
// two transactions through hand-rolled barriers; a mis-sequenced barrier there
// is a lock wait that never returns, and an untimed one hangs CI for the job's
// whole budget instead of failing with a stack trace naming the line.
const queryTimeout = 15 * time.Second

// DSN returns the integration database URL and whether one is usable.
//
// TEST_DATABASE_URL wins over DATABASE_URL: on a developer machine the latter
// usually points at the database the dev stack is running against, and these
// tests write rows.
func DSN() (string, bool) {
	dsn := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if dsn == "" {
		dsn = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if dsn == "" {
		return "", false
	}
	if !databaseNameEndsInTest(dsn) {
		return dsn, false
	}
	return dsn, true
}

// databaseNameEndsInTest mirrors the guard in packages/db/src/testing.ts. These
// tests insert and delete rows, so pointing them at a development or production
// database is a mistake worth refusing rather than detecting afterwards.
func databaseNameEndsInTest(dsn string) bool {
	path := dsn
	if i := strings.Index(path, "://"); i >= 0 {
		path = path[i+3:]
	}
	if i := strings.Index(path, "/"); i >= 0 {
		path = path[i+1:]
	} else {
		return false
	}
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	return strings.HasSuffix(path, "_test")
}

// Pool opens a real pgxpool against the integration database, or skips the test
// when none is configured. A skip is the normal outcome on a laptop: it is what
// keeps `go test ./...` passing with no Postgres anywhere.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dsn, ok := DSN()
	if !ok {
		if dsn != "" {
			t.Skipf("integration database %q does not end in _test; refusing to write to it", redact(dsn))
		}
		t.Skip("set TEST_DATABASE_URL to a migrated _test database to run the integration tests")
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	// Each racing test holds two transactions open at once and a third
	// connection reads the result, with room to spare for cleanup.
	cfg.MaxConns = 8

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
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

// redact strips the credentials out of a DSN before it reaches a test log.
func redact(dsn string) string {
	i := strings.Index(dsn, "://")
	j := strings.LastIndex(dsn, "@")
	if i < 0 || j < 0 || j < i {
		return dsn
	}
	return dsn[:i+3] + "***" + dsn[j:]
}

// SkipUntilFixed marks a test that reproduces a known, unfixed defect.
//
// The test is written to fail today. It stays skipped so CI is green on a
// branch that changes no application logic, and `RUN_KNOWN_FAILING=1 go test`
// runs it, which is how you watch it fail now and how the fix PR watches it
// pass. Activating it permanently is deleting the one call to this function.
func SkipUntilFixed(t *testing.T, ref string) {
	t.Helper()
	if os.Getenv("RUN_KNOWN_FAILING") == "1" {
		t.Logf("RUN_KNOWN_FAILING=1: running a test expected to fail until %s lands", ref)
		return
	}
	t.Skipf("expected to fail until %s lands; run with RUN_KNOWN_FAILING=1 to see it fail", ref)
}

// Ctx returns a context bounded by queryTimeout, cancelled when the test ends.
func Ctx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	t.Cleanup(cancel)
	return ctx
}

// Fixture is one test's slice of the shared database.
//
// Rows are never truncated. Truncation cannot work here: the racing tests need
// two genuinely concurrent committed transactions, so they cannot run inside a
// wrapping transaction that gets rolled back, and a TRUNCATE would take out
// every other test running in parallel against the same database. Every row a
// fixture writes instead carries the fixture's own unique prefix, and cleanup
// deletes by that prefix in foreign-key order.
type Fixture struct {
	Prefix    string
	UserID    string
	ProjectID string

	pool *pgxpool.Pool
}

// NewFixture seeds one user and one project, the minimum the money tables
// reference, and registers the cleanup.
func NewFixture(t *testing.T, pool *pgxpool.Pool) *Fixture {
	t.Helper()

	f := &Fixture{Prefix: "gopgtest-" + uuid.Must(uuid.NewV7()).String(), pool: pool}
	f.UserID = f.ID("user")
	f.ProjectID = f.ID("project")

	// Registered before the inserts: a failure part way through still has rows
	// to remove.
	t.Cleanup(func() { f.cleanup(t) })

	ctx := Ctx(t)
	mustExec(t, pool, ctx, `
		INSERT INTO "user" (id, name, email, email_verified, role)
		VALUES ($1, 'Integration Fixture', $2, true, 'owner')
	`, f.UserID, f.Prefix+"@example.test")

	mustExec(t, pool, ctx, `
		INSERT INTO projects
			(id, owner_id, title, description, category, status,
			 budget_min, budget_max, estimated_timeline_days)
		VALUES ($1, $2, 'Integration Fixture', 'seeded by internal/testsupport',
			'web_app', 'in_progress', 1000000, 5000000, 30)
	`, f.ProjectID, f.UserID)

	return f
}

// ID builds a row id inside this fixture's namespace. The prefix is what
// cleanup matches on, so every id a test invents must come from here.
func (f *Fixture) ID(kind string) string {
	return fmt.Sprintf("%s-%s-%s", f.Prefix, kind, uuid.Must(uuid.NewV7()).String())
}

// SeedMilestone inserts a milestone on the fixture's project and returns its id.
func (f *Fixture) SeedMilestone(t *testing.T, orderIndex int, amount int64) string {
	t.Helper()
	id := f.ID("milestone")
	mustExec(t, f.pool, Ctx(t), `
		INSERT INTO milestones
			(id, project_id, title, description, milestone_type, order_index,
			 amount, status, due_date)
		VALUES ($1, $2, 'Integration Milestone', 'seeded by internal/testsupport',
			'individual', $3, $4, 'approved', now() + interval '30 days')
	`, id, f.ProjectID, orderIndex, amount)
	return id
}

// SeedTransaction inserts a completed transaction, which is what ledger_entries
// hangs off, and returns its id.
func (f *Fixture) SeedTransaction(t *testing.T, txType string, amount int64) string {
	t.Helper()
	id := f.ID("transaction")
	mustExec(t, f.pool, Ctx(t), `
		INSERT INTO transactions
			(id, project_id, type, amount, status, idempotency_key)
		VALUES ($1, $2, $3::transaction_type, $4, 'completed', $5)
	`, id, f.ProjectID, txType, amount, f.ID("idem"))
	return id
}

// SeedAccount inserts a ledger account with a starting balance.
//
// It writes the balance directly rather than posting ledger entries for it:
// these tests are about what concurrent access does to an account that already
// holds money, and funding it through the double-entry writer would only add a
// second, unrelated path that could fail.
func (f *Fixture) SeedAccount(t *testing.T, ownerType, ownerID, accountType string, balance int64) string {
	t.Helper()
	id := f.ID("account")
	mustExec(t, f.pool, Ctx(t), `
		INSERT INTO accounts
			(id, owner_type, owner_id, account_type, name, balance, currency)
		VALUES ($1, $2::account_owner_type, $3, $4::account_type, 'Integration Account', $5, 'IDR')
	`, id, ownerType, ownerID, accountType, balance)
	return id
}

// Balance reads an account's stored balance on the pool, outside any test
// transaction, which is the value a later request would see.
func (f *Fixture) Balance(t *testing.T, accountID string) int64 {
	t.Helper()
	var balance int64
	if err := f.pool.QueryRow(Ctx(t), `SELECT balance FROM accounts WHERE id = $1`, accountID).Scan(&balance); err != nil {
		t.Fatalf("read balance of %s: %v", accountID, err)
	}
	return balance
}

// cleanupOrder deletes children before parents. project_invoices and
// ledger_entries reference milestones, transactions and accounts; those
// reference projects; projects references "user".
//
// Rows a test wrote through the production writers carry a uuid primary key
// rather than the fixture prefix - LedgerStore.CreateLedgerEntriesTx mints its
// own - so the child tables are matched on their foreign keys, which do carry
// it, and not on id alone. Matching on id alone left orphans behind that then
// blocked every parent delete.
// A test that drives the production service rather than the store directly
// mints its rows through those writers too, so the transaction a refund creates
// and the owner account it opens both carry a uuid id and are reachable only
// through their fixture-prefixed project and owner. Hence the subqueries: they
// match what the fixture caused to exist, not only what it named.
var cleanupOrder = []string{
	`DELETE FROM project_invoices WHERE project_id LIKE $1`,
	`DELETE FROM outbox_events WHERE aggregate_id IN (
		SELECT id FROM transactions WHERE id LIKE $1 OR project_id LIKE $1)`,
	`DELETE FROM ledger_entries
	  WHERE transaction_id LIKE $1
	     OR account_id LIKE $1
	     OR transaction_id IN (SELECT id FROM transactions WHERE project_id LIKE $1)
	     OR account_id IN (SELECT id FROM accounts WHERE owner_id LIKE $1)`,
	`DELETE FROM transaction_events WHERE transaction_id IN (
		SELECT id FROM transactions WHERE id LIKE $1 OR project_id LIKE $1)`,
	`DELETE FROM transactions WHERE id LIKE $1 OR project_id LIKE $1`,
	`DELETE FROM milestones WHERE id LIKE $1 OR project_id LIKE $1`,
	`DELETE FROM projects WHERE id LIKE $1`,
	`DELETE FROM accounts WHERE id LIKE $1 OR owner_id LIKE $1`,
	`DELETE FROM "user" WHERE id LIKE $1`,
}

func (f *Fixture) cleanup(t *testing.T) {
	t.Helper()
	// Not the test's own context: that one is already cancelled by the time
	// cleanup runs on a timed-out test, and the rows would survive.
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	pattern := f.Prefix + "%"
	for _, stmt := range cleanupOrder {
		if _, err := f.pool.Exec(ctx, stmt, pattern); err != nil {
			// A leaked fixture is noise in a shared test database, not a
			// reason to fail a test that already reported its own result.
			t.Logf("fixture cleanup %q: %v", stmt, err)
		}
	}
}

func mustExec(t *testing.T, pool *pgxpool.Pool, ctx context.Context, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("seed failed: %v\nsql: %s", err, strings.TrimSpace(sql))
	}
}

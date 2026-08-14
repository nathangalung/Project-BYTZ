package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// recordingPool captures every statement and its arguments, so a test can
// assert what was actually asked of the database.
type recordingPool struct {
	MockPool
	calls []capturedCall
}

func (p *recordingPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	p.calls = append(p.calls, capturedCall{sql: sql, args: args})
	return p.MockPool.QueryRow(ctx, sql, args...)
}

func (p *recordingPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.calls = append(p.calls, capturedCall{sql: sql, args: args})
	return p.MockPool.Query(ctx, sql, args...)
}

func (p *recordingPool) last() capturedCall {
	if len(p.calls) == 0 {
		return capturedCall{}
	}
	return p.calls[len(p.calls)-1]
}

// fillTransaction populates the 14 columns every transaction select returns.
func fillTransaction(id, projectID, txType, status string, amount int64) func(dest ...any) error {
	return func(dest ...any) error {
		if len(dest) < 14 {
			return fmt.Errorf("expected at least 14 scan targets, got %d", len(dest))
		}
		*(dest[0].(*string)) = id
		*(dest[1].(*string)) = projectID
		*(dest[5].(*string)) = txType
		*(dest[6].(*int64)) = amount
		*(dest[7].(*string)) = status
		*(dest[10].(*string)) = "idem-" + id
		*(dest[11].(*time.Time)) = time.Now().UTC()
		*(dest[12].(*time.Time)) = time.Now().UTC()
		if len(dest) == 15 {
			*(dest[14].(*string)) = "Acme"
		}
		return nil
	}
}

func fillEvent(id, eventType, newStatus string) func(dest ...any) error {
	return func(dest ...any) error {
		if len(dest) != 9 {
			return fmt.Errorf("expected 9 scan targets, got %d", len(dest))
		}
		*(dest[0].(*string)) = id
		*(dest[1].(*string)) = "txn-1"
		*(dest[2].(*string)) = eventType
		*(dest[4].(*string)) = newStatus
		*(dest[7].(*string)) = "user-1"
		*(dest[8].(*time.Time)) = time.Now().UTC()
		return nil
	}
}

// The constructors still accept the concrete pool after the field was widened
// to the interface. A pool is created without dialling, so this needs no
// database.
func TestStoreConstructors_AcceptAPgxPool(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db")
	if err != nil {
		t.Fatalf("build pool: %v", err)
	}
	defer pool.Close()

	if got := NewTransactionStore(pool).Pool(); got != PoolIface(pool) {
		t.Error("NewTransactionStore did not keep the pool it was given")
	}
	if got := NewLedgerStore(pool).Pool(); got != PoolIface(pool) {
		t.Error("NewLedgerStore did not keep the pool it was given")
	}
}

/*
Create is the idempotency gate every money path leans on: the caller retries
with the same key and must get the original row back rather than a second
transaction. IsNew is what tells the caller which happened, and both callers
branch on it before writing ledger entries.
*/
func TestTransactionStore_CreateIsKeyedByIdempotencyKey(t *testing.T) {
	tests := []struct {
		name       string
		existing   func(dest ...any) error
		lookupErr  error
		insertErr  error
		wantIsNew  bool
		wantID     string
		wantErr    string
		wantInsert bool
	}{
		{
			name:       "an unused key inserts",
			existing:   func(...any) error { return pgx.ErrNoRows },
			wantIsNew:  true,
			wantID:     "txn-new",
			wantInsert: true,
		},
		{
			name:      "a used key returns the original untouched",
			existing:  fillTransaction("txn-old", "p-1", TxTypeEscrowIn, TxStatusCompleted, 10_000_000),
			wantIsNew: false,
			wantID:    "txn-old",
		},
		{
			name:      "a failed lookup does not fall through to an insert",
			lookupErr: errors.New("connection reset"),
			wantErr:   "idempotency check: scan transaction: connection reset",
		},
		{
			name:       "a failed insert is reported",
			existing:   func(...any) error { return pgx.ErrNoRows },
			insertErr:  errors.New("unique violation"),
			wantErr:    "insert transaction: scan transaction: unique violation",
			wantInsert: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			call := 0
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				call++
				if call == 1 {
					return &MockRow{ScanFn: func(dest ...any) error {
						if tt.lookupErr != nil {
							return tt.lookupErr
						}
						return tt.existing(dest...)
					}}
				}
				return &MockRow{ScanFn: func(dest ...any) error {
					if tt.insertErr != nil {
						return tt.insertErr
					}
					return fillTransaction("txn-new", "p-1", TxTypeEscrowIn, TxStatusPending, 10_000_000)(dest...)
				}}
			}
			s := &TransactionStore{pool: pool}

			got, err := s.Create(context.Background(), CreateTransactionInput{
				ProjectID: "p-1", Type: TxTypeEscrowIn, Amount: 10_000_000, IdempotencyKey: "k-1",
			})

			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Create: %v", err)
			}
			if got.IsNew != tt.wantIsNew {
				t.Errorf("IsNew = %v, want %v", got.IsNew, tt.wantIsNew)
			}
			if got.Transaction.ID != tt.wantID {
				t.Errorf("id = %q, want %q", got.Transaction.ID, tt.wantID)
			}
			insertIssued := len(pool.calls) == 2
			if insertIssued != tt.wantInsert {
				t.Errorf("insert issued = %v, want %v", insertIssued, tt.wantInsert)
			}
			if tt.wantInsert {
				// A new row always opens pending; the webhook is what moves it.
				if !strings.Contains(pool.calls[1].sql, "INSERT INTO transactions") {
					t.Errorf("second statement was not the insert: %s", pool.calls[1].sql)
				}
				if pool.calls[1].args[7] != TxStatusPending {
					t.Errorf("inserted status = %v, want pending", pool.calls[1].args[7])
				}
			}
		})
	}
}

/*
The checkout price is read from the database, never from the request, so the
table it reads has to match the thing being bought. Selling a BRD at the
project's escrow price would take millions for a document.
*/
func TestTransactionStore_GetCheckoutAmountReadsThePricedTable(t *testing.T) {
	tests := []struct {
		checkoutType string
		wantTable    string
		wantErr      string
	}{
		{checkoutType: CheckoutBRD, wantTable: "FROM brd_documents"},
		{checkoutType: CheckoutPRD, wantTable: "FROM prd_documents"},
		{checkoutType: CheckoutEscrow, wantTable: "FROM projects"},
		{checkoutType: CheckoutRevision, wantErr: `unknown checkout type "revision"`},
		{checkoutType: "subscription", wantErr: `unknown checkout type "subscription"`},
	}

	for _, tt := range tests {
		t.Run(tt.checkoutType, func(t *testing.T) {
			price := int64(500_000)
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: func(dest ...any) error {
					*(dest[0].(**int64)) = &price
					return nil
				}}
			}
			s := &TransactionStore{pool: pool}

			got, err := s.GetCheckoutAmount(context.Background(), "p-1", tt.checkoutType)
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				if len(pool.calls) != 0 {
					t.Error("an unknown checkout type still queried the database")
				}
				return
			}
			if err != nil {
				t.Fatalf("GetCheckoutAmount: %v", err)
			}
			if got != price {
				t.Errorf("amount = %d, want %d", got, price)
			}
			if !strings.Contains(pool.last().sql, tt.wantTable) {
				t.Errorf("read from the wrong table: %s", pool.last().sql)
			}
		})
	}
}

// An unpriced or missing row reads as zero, which is what CreateSnapToken
// turns into a refusal. Reporting an error instead would be indistinguishable
// from an outage.
func TestTransactionStore_UnpricedRowsReadAsZero(t *testing.T) {
	tests := []struct {
		name    string
		scanFn  func(dest ...any) error
		wantErr string
	}{
		{name: "no row", scanFn: func(...any) error { return pgx.ErrNoRows }},
		{name: "null price", scanFn: func(dest ...any) error { *(dest[0].(**int64)) = nil; return nil }},
		{name: "query failure", scanFn: func(...any) error { return errors.New("timeout") }, wantErr: "timeout"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: tt.scanFn}
			}
			s := &TransactionStore{pool: pool}

			for _, call := range []struct {
				label string
				run   func() (int64, error)
			}{
				{"checkout", func() (int64, error) { return s.GetCheckoutAmount(context.Background(), "p-1", CheckoutBRD) }},
				{"milestone", func() (int64, error) { return s.GetMilestoneAmount(context.Background(), "ms-1", "p-1") }},
			} {
				got, err := call.run()
				if tt.wantErr != "" {
					if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
						t.Errorf("%s error = %v, want %q", call.label, err, tt.wantErr)
					}
					continue
				}
				if err != nil {
					t.Errorf("%s: %v", call.label, err)
				}
				if got != 0 {
					t.Errorf("%s amount = %d, want 0", call.label, got)
				}
			}
		})
	}
}

/*
Every milestone read is scoped to the project as well as the milestone. Without
it a checkout could price off another project's milestone, and a release could
draw from another project's escrow pool.
*/
func TestTransactionStore_MilestoneReadsAreScopedToTheProject(t *testing.T) {
	tests := []struct {
		name string
		run  func(s *TransactionStore) error
	}{
		{name: "amount", run: func(s *TransactionStore) error {
			_, err := s.GetMilestoneAmount(context.Background(), "ms-1", "p-1")
			return err
		}},
		{name: "work package", run: func(s *TransactionStore) error {
			_, err := s.GetMilestoneWorkPackageID(context.Background(), "ms-1", "p-1")
			return err
		}},
		{name: "pricing", run: func(s *TransactionStore) error {
			_, err := s.GetMilestonePricing(context.Background(), "ms-1", "p-1")
			return err
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: func(...any) error { return pgx.ErrNoRows }}
			}
			s := &TransactionStore{pool: pool}

			if err := tt.run(s); err != nil {
				t.Fatalf("%s: %v", tt.name, err)
			}
			sql := pool.last().sql
			if !strings.Contains(sql, "project_id = $2") {
				t.Errorf("%s query is not scoped to the project: %s", tt.name, sql)
			}
			args := pool.last().args
			if len(args) != 2 || args[0] != "ms-1" || args[1] != "p-1" {
				t.Errorf("%s args = %v, want [ms-1 p-1]", tt.name, args)
			}
		})
	}
}

func TestTransactionStore_GetMilestoneWorkPackageID(t *testing.T) {
	wp := "wp-3"
	tests := []struct {
		name    string
		scanFn  func(dest ...any) error
		want    *string
		wantErr string
	}{
		{name: "milestone on a package", scanFn: func(dest ...any) error { *(dest[0].(**string)) = &wp; return nil }, want: &wp},
		{name: "integration milestone", scanFn: func(dest ...any) error { *(dest[0].(**string)) = nil; return nil }},
		{name: "unknown milestone", scanFn: func(...any) error { return pgx.ErrNoRows }},
		{name: "query failure", scanFn: func(...any) error { return errors.New("timeout") }, wantErr: "query milestone work package: timeout"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &TransactionStore{pool: &MockPool{QueryRowFn: func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: tt.scanFn}
			}}}

			got, err := s.GetMilestoneWorkPackageID(context.Background(), "ms-1", "p-1")
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetMilestoneWorkPackageID: %v", err)
			}
			if (got == nil) != (tt.want == nil) || (got != nil && *got != *tt.want) {
				t.Errorf("work package = %v, want %v", got, tt.want)
			}
		})
	}
}

// The four columns a milestone's platform fee is derived from. All are
// nullable, and the service branches on which are present.
func TestTransactionStore_GetMilestonePricing(t *testing.T) {
	pkgAmount, pkgPayout := int64(200_000), int64(163_000)
	price, payout := int64(1_000_000), int64(815_000)

	tests := []struct {
		name    string
		scanFn  func(dest ...any) error
		wantNil bool
		check   func(t *testing.T, p *MilestonePricing)
		wantErr string
	}{
		{
			name: "package and project split",
			scanFn: func(dest ...any) error {
				*(dest[0].(**int64)) = &pkgAmount
				*(dest[1].(**int64)) = &pkgPayout
				*(dest[2].(**int64)) = &price
				*(dest[3].(**int64)) = &payout
				return nil
			},
			check: func(t *testing.T, p *MilestonePricing) {
				if *p.PackageAmount != pkgAmount || *p.PackagePayout != pkgPayout {
					t.Errorf("package split = %v/%v", p.PackageAmount, p.PackagePayout)
				}
				if *p.ProjectPrice != price || *p.ProjectPayout != payout {
					t.Errorf("project split = %v/%v", p.ProjectPrice, p.ProjectPayout)
				}
			},
		},
		{
			name: "project not yet priced",
			scanFn: func(dest ...any) error {
				for i := range 4 {
					*(dest[i].(**int64)) = nil
				}
				return nil
			},
			check: func(t *testing.T, p *MilestonePricing) {
				if p.ProjectPrice != nil || p.PackageAmount != nil {
					t.Error("an unpriced project reported numbers")
				}
			},
		},
		{name: "no such milestone", scanFn: func(...any) error { return pgx.ErrNoRows }, wantNil: true},
		{name: "query failure", scanFn: func(...any) error { return errors.New("timeout") }, wantErr: "query milestone pricing: timeout"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &TransactionStore{pool: &MockPool{QueryRowFn: func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: tt.scanFn}
			}}}

			got, err := s.GetMilestonePricing(context.Background(), "ms-1", "p-1")
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetMilestonePricing: %v", err)
			}
			if tt.wantNil {
				if got != nil {
					t.Errorf("pricing = %+v, want nil", got)
				}
				return
			}
			tt.check(t, got)
		})
	}
}

func TestTransactionStore_GetProjectOwnerID(t *testing.T) {
	tests := []struct {
		name    string
		scanFn  func(dest ...any) error
		want    string
		wantErr string
	}{
		{name: "owner found", scanFn: func(dest ...any) error { *(dest[0].(*string)) = "user-9"; return nil }, want: "user-9"},
		{name: "deleted or missing project", scanFn: func(...any) error { return pgx.ErrNoRows }},
		{name: "query failure", scanFn: func(...any) error { return errors.New("timeout") }, wantErr: "query project owner: timeout"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: tt.scanFn}
			}
			s := &TransactionStore{pool: pool}

			got, err := s.GetProjectOwnerID(context.Background(), "p-1")
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetProjectOwnerID: %v", err)
			}
			if got != tt.want {
				t.Errorf("owner = %q, want %q", got, tt.want)
			}
			// A soft-deleted project has no owner for payment purposes.
			if !strings.Contains(pool.last().sql, "deleted_at IS NULL") {
				t.Errorf("owner lookup does not exclude deleted projects: %s", pool.last().sql)
			}
		})
	}
}

// Reads that return amounts, talent ids and ledger lines are gated on the
// caller being the project owner or the paid talent. A failed check must never
// read as permission.
func TestTransactionStore_AccessChecks(t *testing.T) {
	tests := []struct {
		name    string
		run     func(s *TransactionStore) (bool, error)
		wantSQL []string
		errWrap string
	}{
		{
			name: "single transaction",
			run: func(s *TransactionStore) (bool, error) {
				return s.UserMayViewTransaction(context.Background(), "txn-1", "user-1")
			},
			wantSQL: []string{"p.owner_id = $2", "talent_profiles WHERE user_id = $2"},
			errWrap: "check transaction access: timeout",
		},
		{
			name: "project transactions",
			run: func(s *TransactionStore) (bool, error) {
				return s.UserMayViewProjectTransactions(context.Background(), "p-1", "user-1")
			},
			wantSQL: []string{"owner_id = $2", "project_assignments"},
			errWrap: "check project transactions access: timeout",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, allowed := range []bool{true, false} {
				pool := &recordingPool{}
				pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
					return &MockRow{ScanFn: func(dest ...any) error { *(dest[0].(*bool)) = allowed; return nil }}
				}
				got, err := tt.run(&TransactionStore{pool: pool})
				if err != nil {
					t.Fatalf("access check: %v", err)
				}
				if got != allowed {
					t.Errorf("allowed = %v, want %v", got, allowed)
				}
				for _, want := range tt.wantSQL {
					if !strings.Contains(pool.last().sql, want) {
						t.Errorf("access query missing %q: %s", want, pool.last().sql)
					}
				}
			}

			failing := &TransactionStore{pool: &MockPool{QueryRowFn: func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: func(...any) error { return errors.New("timeout") }}
			}}}
			got, err := tt.run(failing)
			if err == nil || err.Error() != tt.errWrap {
				t.Fatalf("error = %v, want %q", err, tt.errWrap)
			}
			if got {
				t.Error("a failed access check granted access")
			}
		})
	}
}

// The lock is what serialises concurrent webhook deliveries for one order.
func TestTransactionStore_LockStatusTxTakesARowLock(t *testing.T) {
	tx := &countingTx{}
	tx.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: func(dest ...any) error { *(dest[0].(*string)) = TxStatusCompleted; return nil }}
	}
	s := &TransactionStore{}

	got, err := s.LockStatusTx(context.Background(), tx, "txn-1")
	if err != nil {
		t.Fatalf("LockStatusTx: %v", err)
	}
	if got != TxStatusCompleted {
		t.Errorf("status = %q, want completed", got)
	}
	if !strings.Contains(tx.queryRows[0].sql, "FOR UPDATE") {
		t.Errorf("the status read takes no lock: %s", tx.queryRows[0].sql)
	}

	failing := &countingTx{}
	failing.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: func(...any) error { return errors.New("deadlock") }}
	}
	if _, err := s.LockStatusTx(context.Background(), failing, "txn-1"); err == nil ||
		err.Error() != "lock transaction status: deadlock" {
		t.Fatalf("error = %v, want lock transaction status: deadlock", err)
	}
}

func TestTransactionStore_StatusUpdatesReturnTheUpdatedRow(t *testing.T) {
	pool := &recordingPool{}
	pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: fillTransaction("txn-1", "p-1", TxTypeEscrowRelease, TxStatusCompleted, 50_000)}
	}
	s := &TransactionStore{pool: pool}

	got, err := s.UpdateStatus(context.Background(), "txn-1", TxStatusCompleted)
	if err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}
	if got.Status != TxStatusCompleted {
		t.Errorf("status = %q, want completed", got.Status)
	}
	if !strings.Contains(pool.last().sql, "UPDATE transactions SET status") {
		t.Errorf("not an update: %s", pool.last().sql)
	}

	tx := &countingTx{}
	tx.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: fillTransaction("txn-1", "p-1", TxTypeEscrowRelease, TxStatusCompleted, 50_000)}
	}
	if _, err := s.UpdateStatusTx(context.Background(), tx, "txn-1", TxStatusCompleted); err != nil {
		t.Fatalf("UpdateStatusTx: %v", err)
	}
}

// COALESCE keeps a later notification that omits payment_type from wiping the
// method recorded by the first.
func TestTransactionStore_UpdateWebhookTxPreservesOmittedFields(t *testing.T) {
	tx := &countingTx{}
	tx.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: fillTransaction("txn-1", "p-1", TxTypeEscrowIn, TxStatusCompleted, 10_000_000)}
	}
	s := &TransactionStore{}

	method, ref := "bank_transfer", "mt-1"
	if _, err := s.UpdateWebhookTx(context.Background(), tx, "txn-1", TxStatusCompleted, &method, &ref); err != nil {
		t.Fatalf("UpdateWebhookTx: %v", err)
	}
	sql := tx.queryRows[0].sql
	for _, want := range []string{"COALESCE($2, payment_method)", "COALESCE($3, payment_gateway_ref)"} {
		if !strings.Contains(sql, want) {
			t.Errorf("webhook update is missing %q: %s", want, sql)
		}
	}
	if tx.queryRows[0].args[0] != TxStatusCompleted {
		t.Errorf("status arg = %v, want completed", tx.queryRows[0].args[0])
	}
}

func TestTransactionStore_FindsAndLists(t *testing.T) {
	tests := []struct {
		name    string
		run     func(s *TransactionStore) (int, error)
		queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
		rowFn   func(dest ...any) error
		want    int
		wantErr string
	}{
		{
			name: "find by id",
			run: func(s *TransactionStore) (int, error) {
				t, e := s.FindByID(context.Background(), "txn-1")
				return boolToInt(t != nil), e
			},
			rowFn: fillTransaction("txn-1", "p-1", TxTypeEscrowIn, TxStatusCompleted, 10_000_000),
			want:  1,
		},
		{
			name: "find by id, missing",
			run: func(s *TransactionStore) (int, error) {
				t, e := s.FindByID(context.Background(), "txn-1")
				return boolToInt(t != nil), e
			},
			rowFn: func(...any) error { return pgx.ErrNoRows },
			want:  0,
		},
		{
			name: "find by idempotency key",
			run: func(s *TransactionStore) (int, error) {
				t, e := s.FindByIdempotencyKeyForWebhook(context.Background(), "ORD-1")
				return boolToInt(t != nil), e
			},
			rowFn: fillTransaction("txn-1", "p-1", TxTypeEscrowIn, TxStatusCompleted, 10_000_000),
			want:  1,
		},
		{
			name: "list by project",
			run: func(s *TransactionStore) (int, error) {
				txns, e := s.FindByProjectID(context.Background(), "p-1")
				return len(txns), e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(
					fillTransaction("txn-1", "p-1", TxTypeEscrowIn, TxStatusCompleted, 10_000_000),
					fillTransaction("txn-2", "p-1", TxTypeEscrowRelease, TxStatusCompleted, 5_000_000),
				), nil
			},
			want: 2,
		},
		{
			name: "list by project, query fails",
			run: func(s *TransactionStore) (int, error) {
				txns, e := s.FindByProjectID(context.Background(), "p-1")
				return len(txns), e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, errors.New("timeout") },
			wantErr: "query by project: timeout",
		},
		{
			name: "list by project, row fails",
			run: func(s *TransactionStore) (int, error) {
				txns, e := s.FindByProjectID(context.Background(), "p-1")
				return len(txns), e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(func(...any) error { return errors.New("bad column") }), nil
			},
			wantErr: "scan transaction row: bad column",
		},
		{
			name: "transaction events",
			run: func(s *TransactionStore) (int, error) {
				evs, e := s.GetEventsByTransaction(context.Background(), "txn-1")
				return len(evs), e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(
					fillEvent("ev-1", EventEscrowCreated, TxStatusProcessing),
					fillEvent("ev-2", EventFundsReleased, TxStatusCompleted),
				), nil
			},
			want: 2,
		},
		{
			name: "transaction events, query fails",
			run: func(s *TransactionStore) (int, error) {
				evs, e := s.GetEventsByTransaction(context.Background(), "txn-1")
				return len(evs), e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, errors.New("timeout") },
			wantErr: "query events: timeout",
		},
		{
			name: "transaction events, row fails",
			run: func(s *TransactionStore) (int, error) {
				evs, e := s.GetEventsByTransaction(context.Background(), "txn-1")
				return len(evs), e
			},
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(func(...any) error { return errors.New("bad column") }), nil
			},
			wantErr: "scan transaction event row: bad column",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &TransactionStore{pool: &MockPool{
				QueryFn: tt.queryFn,
				QueryRowFn: func(context.Context, string, ...any) pgx.Row {
					return &MockRow{ScanFn: tt.rowFn}
				},
			}}

			got, err := tt.run(s)
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("%s: %v", tt.name, err)
			}
			if got != tt.want {
				t.Errorf("got %d rows, want %d", got, tt.want)
			}
		})
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestTransactionStore_CreateEvent(t *testing.T) {
	tests := []struct {
		name     string
		metadata map[string]any
		scanFn   func(dest ...any) error
		wantErr  string
	}{
		{name: "written", metadata: map[string]any{"source": "webhook"}, scanFn: fillEvent("ev-1", EventEscrowCreated, TxStatusCompleted)},
		{name: "no such transaction", scanFn: func(...any) error { return pgx.ErrNoRows }},
		{name: "insert fails", scanFn: func(...any) error { return errors.New("fk violation") }, wantErr: "scan transaction event: fk violation"},
		{name: "metadata cannot be serialised", metadata: map[string]any{"ch": make(chan int)}, wantErr: "marshal metadata: json: unsupported type: chan int"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := CreateTransactionEventInput{
				TransactionID: "txn-1", EventType: EventEscrowCreated,
				NewStatus: TxStatusCompleted, Metadata: tt.metadata, PerformedBy: "user-1",
			}
			row := func(context.Context, string, ...any) pgx.Row { return &MockRow{ScanFn: tt.scanFn} }
			s := &TransactionStore{pool: &MockPool{QueryRowFn: row}}
			tx := &countingTx{}
			tx.QueryRowFn = row

			_, err := s.CreateEvent(context.Background(), in)
			_, txErr := s.CreateEventTx(context.Background(), tx, in)

			for label, got := range map[string]error{"pool": err, "tx": txErr} {
				if tt.wantErr != "" {
					if got == nil || got.Error() != tt.wantErr {
						t.Errorf("%s error = %v, want %q", label, got, tt.wantErr)
					}
					continue
				}
				if got != nil {
					t.Errorf("%s: %v", label, got)
				}
			}
		})
	}
}

func TestTransactionStore_GetWorkPackageAmounts(t *testing.T) {
	tests := []struct {
		name    string
		queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
		want    []WorkPackage
		wantErr string
	}{
		{
			name: "in stable order",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(
					func(dest ...any) error { *(dest[0].(*string)) = "wp-1"; *(dest[1].(*int64)) = 6_000_000; return nil },
					func(dest ...any) error { *(dest[0].(*string)) = "wp-2"; *(dest[1].(*int64)) = 4_000_000; return nil },
				), nil
			},
			want: []WorkPackage{{ID: "wp-1", Amount: 6_000_000}, {ID: "wp-2", Amount: 4_000_000}},
		},
		{
			name:    "project with no packages",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return newFakeRows(), nil },
		},
		{
			name:    "query fails",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, errors.New("timeout") },
			wantErr: "query work packages: timeout",
		},
		{
			name: "row fails",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(func(...any) error { return errors.New("bad column") }), nil
			},
			wantErr: "scan work package: bad column",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := &recordingPool{}
			pool.QueryFn = tt.queryFn
			s := &TransactionStore{pool: pool}

			got, err := s.GetWorkPackageAmounts(context.Background(), "p-1")
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetWorkPackageAmounts: %v", err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("got %d packages, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("package %d = %+v, want %+v", i, got[i], tt.want[i])
				}
			}
			// Escrow shares are allocated by index, so the order has to be
			// deterministic across calls.
			if tt.wantErr == "" && !strings.Contains(pool.last().sql, "ORDER BY order_index, id") {
				t.Errorf("work packages are not read in a stable order: %s", pool.last().sql)
			}
		})
	}
}

// The type filter changes both the predicate and the placeholder numbering, so
// a mismatch would bind the page size as the filter.
func TestTransactionStore_ListByUserBindsItsArgumentsInOrder(t *testing.T) {
	tests := []struct {
		name     string
		txType   string
		page     int
		pageSize int
		wantArgs []any
	}{
		{name: "unfiltered first page", page: 1, pageSize: 50, wantArgs: []any{"user-1", 50, 0}},
		{name: "unfiltered third page", page: 3, pageSize: 20, wantArgs: []any{"user-1", 20, 40}},
		{name: "filtered by type", txType: TxTypeEscrowIn, page: 2, pageSize: 10, wantArgs: []any{"user-1", TxTypeEscrowIn, 10, 10}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: func(dest ...any) error { *(dest[0].(*int)) = 7; return nil }}
			}
			pool.QueryFn = func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(fillTransaction("txn-1", "p-1", TxTypeEscrowIn, TxStatusCompleted, 10_000_000)), nil
			}
			s := &TransactionStore{pool: pool}

			txns, total, err := s.ListByUser(context.Background(), "user-1", tt.txType, tt.page, tt.pageSize)
			if err != nil {
				t.Fatalf("ListByUser: %v", err)
			}
			if total != 7 || len(txns) != 1 {
				t.Errorf("got %d of %d, want 1 of 7", len(txns), total)
			}
			if len(pool.calls) != 2 {
				t.Fatalf("issued %d statements, want a count and a page", len(pool.calls))
			}
			// The count runs over the same predicate as the page, minus the
			// limit and offset.
			countArgs := pool.calls[0].args
			if len(countArgs) != len(tt.wantArgs)-2 {
				t.Errorf("count args = %v, want the filter args only", countArgs)
			}
			pageArgs := pool.calls[1].args
			if fmt.Sprint(pageArgs) != fmt.Sprint(tt.wantArgs) {
				t.Errorf("page args = %v, want %v", pageArgs, tt.wantArgs)
			}
			if tt.txType != "" && !strings.Contains(pool.calls[1].sql, "t.type = $2") {
				t.Errorf("type filter not bound as $2: %s", pool.calls[1].sql)
			}
		})
	}
}

func TestTransactionStore_ListByUserSurfacesFailures(t *testing.T) {
	tests := []struct {
		name       string
		countErr   error
		queryErr   error
		rowErr     error
		wantErr    string
		wantSecond bool
	}{
		{name: "count fails", countErr: errors.New("timeout"), wantErr: "count user transactions: timeout"},
		{name: "page query fails", queryErr: errors.New("timeout"), wantErr: "list user transactions: timeout", wantSecond: true},
		{name: "row fails", rowErr: errors.New("bad column"), wantErr: "scan transaction list row: bad column", wantSecond: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := &recordingPool{}
			pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
				return &MockRow{ScanFn: func(dest ...any) error {
					if tt.countErr != nil {
						return tt.countErr
					}
					*(dest[0].(*int)) = 1
					return nil
				}}
			}
			pool.QueryFn = func(context.Context, string, ...any) (pgx.Rows, error) {
				if tt.queryErr != nil {
					return nil, tt.queryErr
				}
				return newFakeRows(func(...any) error { return tt.rowErr }), nil
			}
			s := &TransactionStore{pool: pool}

			txns, total, err := s.ListByUser(context.Background(), "user-1", "", 1, 50)
			if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}
			if txns != nil || total != 0 {
				t.Errorf("returned %d of %d alongside the failure", len(txns), total)
			}
			if (len(pool.calls) == 2) != tt.wantSecond {
				t.Errorf("issued %d statements", len(pool.calls))
			}
		})
	}
}

/*
Earned is read from the talent's ledger account balance, which holds the net
the talent actually received. escrow_release.amount is the gross slice and
would overstate every talent's earnings by the platform fee.
*/
func TestTransactionStore_GetSummaryByUser(t *testing.T) {
	pool := &recordingPool{}
	pool.QueryRowFn = func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: func(dest ...any) error {
			*(dest[0].(*int64)) = 25_000_000
			*(dest[1].(*int64)) = 7_150_000
			*(dest[2].(*int64)) = 3_000_000
			*(dest[3].(*int64)) = 10_000_000
			return nil
		}}
	}
	s := &TransactionStore{pool: pool}

	spent, earned, pending, thisMonth, err := s.GetSummaryByUser(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("GetSummaryByUser: %v", err)
	}
	if spent != 25_000_000 || earned != 7_150_000 || pending != 3_000_000 || thisMonth != 10_000_000 {
		t.Errorf("summary = %d/%d/%d/%d", spent, earned, pending, thisMonth)
	}
	sql := pool.last().sql
	if !strings.Contains(sql, "FROM accounts a WHERE a.owner_type = 'talent'") {
		t.Errorf("earnings are not read from the talent ledger account: %s", sql)
	}
	if strings.Contains(sql, "'escrow_release'") {
		t.Error("earnings are summed from gross escrow_release amounts, which overstates them by the platform fee")
	}

	failing := &TransactionStore{pool: &MockPool{QueryRowFn: func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: func(...any) error { return errors.New("timeout") }}
	}}}
	spent, earned, pending, thisMonth, err = failing.GetSummaryByUser(context.Background(), "user-1")
	if err == nil || err.Error() != "get user summary: timeout" {
		t.Fatalf("error = %v, want get user summary: timeout", err)
	}
	if spent|earned|pending|thisMonth != 0 {
		t.Error("a failed summary returned non-zero totals")
	}
}

func TestScanners_PropagateRowsErr(t *testing.T) {
	s := &TransactionStore{pool: &MockPool{QueryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
		return &erroringRows{err: errors.New("connection lost")}, nil
	}}}

	if _, err := s.FindByProjectID(context.Background(), "p-1"); err == nil {
		t.Error("FindByProjectID dropped rows.Err()")
	}
	if _, err := s.GetEventsByTransaction(context.Background(), "txn-1"); err == nil {
		t.Error("GetEventsByTransaction dropped rows.Err()")
	}
	if _, err := s.GetWorkPackageAmounts(context.Background(), "p-1"); err == nil {
		t.Error("GetWorkPackageAmounts dropped rows.Err()")
	}
}

// The outbox row is what makes settlement delivery survivable, so its payload
// and trace context have to reach the insert intact.
func TestInsertOutboxEventTx(t *testing.T) {
	tests := []struct {
		name    string
		event   OutboxEvent
		execErr error
		wantErr string
	}{
		{
			name: "written",
			event: OutboxEvent{
				AggregateType: "payment", AggregateID: "txn-1", EventType: "payment.settled",
				Payload: map[string]any{"projectId": "p-1", "amount": 10_000_000},
			},
		},
		{
			name:    "payload cannot be serialised",
			event:   OutboxEvent{EventType: "payment.settled", Payload: map[string]any{"ch": make(chan int)}},
			wantErr: "marshal outbox payload: json: unsupported type: chan int",
		},
		{
			name:    "insert fails",
			event:   OutboxEvent{EventType: "payment.settled"},
			execErr: errors.New("relation does not exist"),
			wantErr: "insert outbox event: relation does not exist",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &countingTx{}
			tx.ExecFn = func(context.Context, string, ...any) (pgconn.CommandTag, error) {
				return pgconn.CommandTag{}, tt.execErr
			}

			err := InsertOutboxEventTx(context.Background(), tx, tt.event)
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("InsertOutboxEventTx: %v", err)
			}
			if len(tx.execs) != 1 {
				t.Fatalf("issued %d statements, want 1", len(tx.execs))
			}
			args := tx.execs[0].args
			if args[1] != tt.event.AggregateType || args[2] != tt.event.AggregateID || args[3] != tt.event.EventType {
				t.Errorf("outbox row = %v, want the aggregate and event type passed in", args[1:4])
			}
			if !strings.Contains(string(args[4].([]byte)), `"projectId":"p-1"`) {
				t.Errorf("payload not serialised into the row: %s", args[4])
			}
			// Unpublished and un-retried, so the worker picks it up.
			if !strings.Contains(tx.execs[0].sql, "false, 0, NOW()") {
				t.Errorf("outbox row is not inserted unpublished: %s", tx.execs[0].sql)
			}
		})
	}
}

// The revision fee prices off this figure, so the stored amount has to come
// back unchanged rather than through the nil and no-row branches above.
func TestTransactionStore_GetMilestoneAmountReturnsTheStoredAmount(t *testing.T) {
	amount := int64(2_500_000)
	s := &TransactionStore{pool: &MockPool{QueryRowFn: func(context.Context, string, ...any) pgx.Row {
		return &MockRow{ScanFn: func(dest ...any) error {
			*(dest[0].(**int64)) = &amount
			return nil
		}}
	}}}

	got, err := s.GetMilestoneAmount(context.Background(), "ms-1", "p-1")
	if err != nil {
		t.Fatalf("GetMilestoneAmount: %v", err)
	}
	if got != amount {
		t.Errorf("amount = %d, want %d", got, amount)
	}
}

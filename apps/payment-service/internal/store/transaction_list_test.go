package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Minimal pgx.Rows fake.
type fakeRows struct {
	scans []func(dest ...any) error
	idx   int
}

func newFakeRows(fns ...func(dest ...any) error) *fakeRows {
	return &fakeRows{scans: fns, idx: -1}
}

func (r *fakeRows) Next() bool {
	r.idx++
	return r.idx < len(r.scans)
}

func (r *fakeRows) Scan(dest ...any) error {
	return r.scans[r.idx](dest...)
}

func (r *fakeRows) Err() error                                   { return nil }
func (r *fakeRows) Close()                                       {}
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

func TestTransaction_ProjectTitleJSON(t *testing.T) {
	b, err := json.Marshal(Transaction{ID: "tx-1", ProjectTitle: "Acme Corp"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"projectTitle":"Acme Corp"`) {
		t.Errorf("projectTitle missing from JSON: %s", b)
	}
}

func TestScanTransactionListRow_MapsProjectTitle(t *testing.T) {
	now := time.Now().UTC()
	scanFn := func(dest ...any) error {
		if len(dest) != 15 {
			t.Fatalf("expected 15 scan targets, got %d", len(dest))
		}
		*(dest[0].(*string)) = "tx-1"
		*(dest[1].(*string)) = "proj-1"
		*(dest[5].(*string)) = "escrow_in"
		*(dest[6].(*int64)) = 100000
		*(dest[7].(*string)) = "completed"
		*(dest[10].(*string)) = "idem-1"
		*(dest[11].(*time.Time)) = now
		*(dest[12].(*time.Time)) = now
		*(dest[14].(*string)) = "Acme Corp"
		return nil
	}

	rows := newFakeRows(scanFn)
	if !rows.Next() {
		t.Fatal("expected a row")
	}
	tx, err := scanTransactionListRow(rows)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if tx.ProjectTitle != "Acme Corp" {
		t.Errorf("ProjectTitle = %q, want %q", tx.ProjectTitle, "Acme Corp")
	}
	if tx.ID != "tx-1" {
		t.Errorf("ID = %q, want %q", tx.ID, "tx-1")
	}
}

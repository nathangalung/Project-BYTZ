package store

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// stubRow feeds fixed values to Scan.
type stubRow struct {
	err    error
	values []any
}

func (r stubRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assign(dest, r.values)
}

// assign copies values into Scan destinations by pointer type.
func assign(dest []any, values []any) error {
	for i, d := range dest {
		if i >= len(values) {
			break
		}
		switch p := d.(type) {
		case *string:
			if v, ok := values[i].(string); ok {
				*p = v
			}
		case *int:
			if v, ok := values[i].(int); ok {
				*p = v
			}
		case *bool:
			if v, ok := values[i].(bool); ok {
				*p = v
			}
		case *time.Time:
			if v, ok := values[i].(time.Time); ok {
				*p = v
			}
		case **string:
			if v, ok := values[i].(*string); ok {
				*p = v
			}
		case *NotificationType:
			if v, ok := values[i].(string); ok {
				*p = NotificationType(v)
			}
		}
	}
	return nil
}

// stubRows replays queued rows.
type stubRows struct {
	rows    [][]any
	idx     int
	scanErr error
	iterErr error
	closed  bool
}

func (r *stubRows) Next() bool {
	if r.idx >= len(r.rows) {
		return false
	}
	r.idx++
	return true
}

func (r *stubRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	return assign(dest, r.rows[r.idx-1])
}

func (r *stubRows) Err() error                                   { return r.iterErr }
func (r *stubRows) Close()                                       { r.closed = true }
func (r *stubRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *stubRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *stubRows) Values() ([]any, error)                       { return nil, nil }
func (r *stubRows) RawValues() [][]byte                          { return nil }
func (r *stubRows) Conn() *pgx.Conn                              { return nil }

// stubPool answers each call from a queue, recording the SQL it saw.
type stubPool struct {
	mu sync.Mutex

	queryRows []pgx.Rows
	queryErr  error

	rowQueue []pgx.Row

	execTag pgconn.CommandTag
	execErr error

	sqlSeen  []string
	argsSeen [][]any
}

func (p *stubPool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sqlSeen = append(p.sqlSeen, sql)
	p.argsSeen = append(p.argsSeen, args)
	if len(p.rowQueue) == 0 {
		return stubRow{}
	}
	row := p.rowQueue[0]
	p.rowQueue = p.rowQueue[1:]
	return row
}

func (p *stubPool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sqlSeen = append(p.sqlSeen, sql)
	p.argsSeen = append(p.argsSeen, args)
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	if len(p.queryRows) == 0 {
		return &stubRows{}, nil
	}
	rows := p.queryRows[0]
	p.queryRows = p.queryRows[1:]
	return rows, nil
}

func (p *stubPool) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sqlSeen = append(p.sqlSeen, sql)
	p.argsSeen = append(p.argsSeen, args)
	return p.execTag, p.execErr
}

var _ PoolIface = (*stubPool)(nil)

func notificationRow(id, userID, typ, title, message string, link *string, isRead bool) []any {
	return []any{id, userID, typ, title, message, link, isRead, time.Now().UTC()}
}

// Create must generate a sortable UUID v7 and echo the input back.
func TestStoreCreate(t *testing.T) {
	link := "/projects/p-1"
	p := &stubPool{}
	s := &Store{pool: p}

	got, err := s.Create(context.Background(), CreateInput{
		UserID:  "u-1",
		Type:    TypePayment,
		Title:   "Payment released",
		Message: "Rp 500.000",
		Link:    &link,
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	if got.ID == "" {
		t.Fatal("ID is empty")
	}
	// UUID v7 keeps B-tree locality; v4 would not.
	if got.ID[14] != '7' {
		t.Errorf("ID = %q, want a v7 uuid (version nibble 7, not %c)", got.ID, got.ID[14])
	}
	if got.UserID != "u-1" || got.Type != TypePayment || got.Title != "Payment released" {
		t.Errorf("returned row = %+v, does not echo the input", got)
	}
	if got.IsRead {
		t.Error("IsRead = true on a new notification")
	}
	if got.Link == nil || *got.Link != link {
		t.Errorf("Link = %v, want %q", got.Link, link)
	}

	if len(p.sqlSeen) != 1 || !strings.Contains(p.sqlSeen[0], "INSERT INTO notifications") {
		t.Errorf("sql = %v, want an insert", p.sqlSeen)
	}
}

// Two rows in a row must not collide.
func TestStoreCreate_GeneratesDistinctIDs(t *testing.T) {
	s := &Store{pool: &stubPool{}}
	a, err := s.Create(context.Background(), CreateInput{UserID: "u-1", Type: TypeSystem})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	b, err := s.Create(context.Background(), CreateInput{UserID: "u-1", Type: TypeSystem})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if a.ID == b.ID {
		t.Errorf("two notifications share id %q", a.ID)
	}
}

func TestStoreCreate_InsertFailureWraps(t *testing.T) {
	sentinel := errors.New("fk violation")
	s := &Store{pool: &stubPool{execErr: sentinel}}

	_, err := s.Create(context.Background(), CreateInput{UserID: "u-1", Type: TypeSystem})
	if !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want it to wrap %v", err, sentinel)
	}
}

func TestStoreFindByUserID(t *testing.T) {
	link := "/x"
	p := &stubPool{
		queryRows: []pgx.Rows{&stubRows{rows: [][]any{
			notificationRow("n-1", "u-1", "payment", "t1", "m1", &link, false),
			notificationRow("n-2", "u-1", "system", "t2", "m2", nil, true),
		}}},
		rowQueue: []pgx.Row{stubRow{values: []any{7}}},
	}
	s := &Store{pool: p}

	got, err := s.FindByUserID(context.Background(), "u-1", 2, 20, nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(got.Items))
	}
	if got.Items[0].ID != "n-1" || got.Items[1].ID != "n-2" {
		t.Errorf("items = %v, want n-1 then n-2 in query order", got.Items)
	}
	if got.Total != 7 {
		t.Errorf("Total = %d, want 7 (the count query answer, not the page size)", got.Total)
	}
	if got.Page != 2 || got.PageSize != 20 {
		t.Errorf("page = %d, pageSize = %d, want 2 and 20", got.Page, got.PageSize)
	}

	// Page 2 of 20 must skip the first 20 rows.
	listArgs := p.argsSeen[0]
	offset := listArgs[len(listArgs)-1]
	if offset != 20 {
		t.Errorf("offset = %v, want 20 for page 2 of 20", offset)
	}
}

// An empty page must serialise as [] rather than null.
func TestStoreFindByUserID_EmptyPageIsNotNull(t *testing.T) {
	s := &Store{pool: &stubPool{
		queryRows: []pgx.Rows{&stubRows{}},
		rowQueue:  []pgx.Row{stubRow{values: []any{0}}},
	}}

	got, err := s.FindByUserID(context.Background(), "u-1", 1, 20, nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items == nil {
		t.Error("Items is nil; it would serialise as null and break a client expecting an array")
	}
	if len(got.Items) != 0 {
		t.Errorf("items = %d, want 0", len(got.Items))
	}
}

func TestStoreFindByUserID_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"list query fails", &stubPool{queryErr: sentinel}},
		{"row scan fails", &stubPool{
			queryRows: []pgx.Rows{&stubRows{rows: [][]any{{}}, scanErr: sentinel}},
		}},
		{"row iteration fails", &stubPool{
			queryRows: []pgx.Rows{&stubRows{iterErr: sentinel}},
		}},
		{"count query fails", &stubPool{
			queryRows: []pgx.Rows{&stubRows{}},
			rowQueue:  []pgx.Row{stubRow{err: sentinel}},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &Store{pool: tt.pool}
			_, err := s.FindByUserID(context.Background(), "u-1", 1, 20, nil)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want it to wrap %v", err, sentinel)
			}
		})
	}
}

// The type filter must reach the query as a text[] argument.
func TestStoreFindByUserID_TypeFilterIsPassedThrough(t *testing.T) {
	p := &stubPool{
		queryRows: []pgx.Rows{&stubRows{}},
		rowQueue:  []pgx.Row{stubRow{values: []any{0}}},
	}
	s := &Store{pool: p}

	types := []string{"payment", "dispute"}
	if _, err := s.FindByUserID(context.Background(), "u-1", 1, 20, types); err != nil {
		t.Fatalf("error = %v", err)
	}

	if !strings.Contains(p.sqlSeen[0], "type::text = ANY($2)") {
		t.Errorf("list sql lacks the type filter: %s", p.sqlSeen[0])
	}
	got, ok := p.argsSeen[0][1].([]string)
	if !ok || len(got) != 2 {
		t.Errorf("type arg = %v, want the []string filter", p.argsSeen[0][1])
	}
}

// A missing row is (nil, nil), not an error: the handler turns that into 404.
func TestStoreFindByID_MissingRowIsNotAnError(t *testing.T) {
	s := &Store{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}

	got, err := s.FindByID(context.Background(), "n-1", "u-1")
	if err != nil {
		t.Fatalf("error = %v, want nil so the handler can answer 404", err)
	}
	if got != nil {
		t.Errorf("notification = %v, want nil", got)
	}
}

func TestStoreFindByID_Found(t *testing.T) {
	p := &stubPool{rowQueue: []pgx.Row{
		stubRow{values: notificationRow("n-1", "u-1", "payment", "t", "m", nil, false)},
	}}
	s := &Store{pool: p}

	got, err := s.FindByID(context.Background(), "n-1", "u-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil || got.ID != "n-1" {
		t.Fatalf("notification = %v, want n-1", got)
	}

	// Scoping to the owner is what stops one user reading another's row.
	args := p.argsSeen[0]
	if len(args) != 2 || args[0] != "n-1" || args[1] != "u-1" {
		t.Errorf("args = %v, want [n-1 u-1]; dropping the user id would expose other users' notifications", args)
	}
	if !strings.Contains(p.sqlSeen[0], "user_id = $2") {
		t.Errorf("sql does not scope to the user: %s", p.sqlSeen[0])
	}
}

func TestStoreFindByID_QueryFailureWraps(t *testing.T) {
	sentinel := errors.New("db down")
	s := &Store{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}

	_, err := s.FindByID(context.Background(), "n-1", "u-1")
	if !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want it to wrap %v", err, sentinel)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		t.Error("a transient fault must not be reported as a missing row")
	}
}

func TestStoreMarkAsRead(t *testing.T) {
	t.Run("returns the updated row", func(t *testing.T) {
		p := &stubPool{rowQueue: []pgx.Row{
			stubRow{values: notificationRow("n-1", "u-1", "payment", "t", "m", nil, true)},
		}}
		s := &Store{pool: p}

		got, err := s.MarkAsRead(context.Background(), "n-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got == nil || !got.IsRead {
			t.Errorf("notification = %v, want IsRead true", got)
		}
		if !strings.Contains(p.sqlSeen[0], "RETURNING") {
			t.Errorf("sql does not return the updated row: %s", p.sqlSeen[0])
		}
	})

	t.Run("missing row is not an error", func(t *testing.T) {
		s := &Store{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
		got, err := s.MarkAsRead(context.Background(), "gone")
		if err != nil || got != nil {
			t.Errorf("got (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("update failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &Store{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		_, err := s.MarkAsRead(context.Background(), "n-1")
		if !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want it to wrap %v", err, sentinel)
		}
	})
}

func TestStoreMarkAllAsRead(t *testing.T) {
	t.Run("returns the affected count", func(t *testing.T) {
		p := &stubPool{execTag: pgconn.NewCommandTag("UPDATE 4")}
		s := &Store{pool: p}

		got, err := s.MarkAllAsRead(context.Background(), "u-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got != 4 {
			t.Errorf("count = %d, want 4", got)
		}
		// Rewriting already-read rows would inflate the count the UI shows.
		if !strings.Contains(p.sqlSeen[0], "is_read = false") {
			t.Errorf("sql updates rows that are already read: %s", p.sqlSeen[0])
		}
	})

	t.Run("update failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &Store{pool: &stubPool{execErr: sentinel}}
		got, err := s.MarkAllAsRead(context.Background(), "u-1")
		if !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want it to wrap %v", err, sentinel)
		}
		if got != 0 {
			t.Errorf("count = %d, want 0 on failure", got)
		}
	})
}

func TestStoreCountUnread(t *testing.T) {
	t.Run("returns the count", func(t *testing.T) {
		p := &stubPool{rowQueue: []pgx.Row{stubRow{values: []any{12}}}}
		s := &Store{pool: p}

		got, err := s.CountUnread(context.Background(), "u-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got != 12 {
			t.Errorf("count = %d, want 12", got)
		}
		if !strings.Contains(p.sqlSeen[0], "is_read = false") {
			t.Errorf("sql counts read rows too: %s", p.sqlSeen[0])
		}
	})

	t.Run("query failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &Store{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		got, err := s.CountUnread(context.Background(), "u-1")
		if !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want it to wrap %v", err, sentinel)
		}
		if got != 0 {
			t.Errorf("count = %d, want 0 on failure", got)
		}
	})
}

// A parked event must carry everything an admin needs to triage it.
func TestRecordDeadLetter(t *testing.T) {
	p := &stubPool{}
	s := &Store{pool: p}

	err := s.RecordDeadLetter(context.Background(), DeadLetterInput{
		OriginalEventID: "evt-1",
		EventType:       "payment.released",
		Payload:         []byte(`{"a":1}`),
		ConsumerService: "notification-service",
		ErrorMessage:    "insert failed",
		RetryCount:      3,
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	if len(p.sqlSeen) != 1 || !strings.Contains(p.sqlSeen[0], "INSERT INTO dead_letter_events") {
		t.Fatalf("sql = %v, want a dead_letter_events insert", p.sqlSeen)
	}

	args := p.argsSeen[0]
	if len(args) != 7 {
		t.Fatalf("args = %d, want 7", len(args))
	}
	if args[1] != "evt-1" || args[2] != "payment.released" {
		t.Errorf("args = %v, want the event id and type preserved", args[1:3])
	}
	if args[5] != "insert failed" {
		t.Errorf("error message = %v, want the cause preserved for triage", args[5])
	}
	if args[6] != 3 {
		t.Errorf("retry count = %v, want 3", args[6])
	}
	// The id is generated here, not by the caller.
	id, ok := args[0].(string)
	if !ok || id == "" {
		t.Errorf("id = %v, want a generated uuid", args[0])
	}
}

func TestRecordDeadLetter_InsertFailureWraps(t *testing.T) {
	sentinel := errors.New("table missing")
	s := &Store{pool: &stubPool{execErr: sentinel}}

	err := s.RecordDeadLetter(context.Background(), DeadLetterInput{OriginalEventID: "evt-1"})
	if !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want it to wrap %v", err, sentinel)
	}
}

// The list query must page rather than fetch everything.
func TestBuildListQueries_OrdersNewestFirst(t *testing.T) {
	listSQL, _, _, _ := buildListQueries("u-1", 20, 0, nil)
	if !strings.Contains(listSQL, "ORDER BY created_at DESC") {
		t.Errorf("list sql does not order newest first: %s", listSQL)
	}
	if !strings.Contains(listSQL, "LIMIT") || !strings.Contains(listSQL, "OFFSET") {
		t.Errorf("list sql is unpaged: %s", listSQL)
	}
}

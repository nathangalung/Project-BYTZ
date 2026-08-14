package store

import (
	"context"
	"encoding/json"
	"sync"
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

// assign copies values into Scan destinations by pointer type. Only the types
// the stores actually scan into are handled; an unhandled destination leaves
// its zero value, which shows up as a failed assertion rather than a panic.
func assign(dest []any, values []any) error {
	for i, d := range dest {
		if i >= len(values) {
			break
		}
		if values[i] == nil {
			continue
		}
		switch p := d.(type) {
		case *string:
			if v, ok := values[i].(string); ok {
				*p = v
			}
		case **string:
			if v, ok := values[i].(*string); ok {
				*p = v
			}
		case *int:
			if v, ok := values[i].(int); ok {
				*p = v
			}
		case **int:
			if v, ok := values[i].(*int); ok {
				*p = v
			}
		case *int64:
			switch v := values[i].(type) {
			case int64:
				*p = v
			case int:
				*p = int64(v)
			}
		case **int64:
			if v, ok := values[i].(*int64); ok {
				*p = v
			}
		case *float64:
			switch v := values[i].(type) {
			case float64:
				*p = v
			case int:
				*p = float64(v)
			}
		case **float64:
			if v, ok := values[i].(*float64); ok {
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
		case **time.Time:
			if v, ok := values[i].(*time.Time); ok {
				*p = v
			}
		case *[]byte:
			if v, ok := values[i].([]byte); ok {
				*p = v
			}
		case *json.RawMessage:
			switch v := values[i].(type) {
			case json.RawMessage:
				*p = v
			case []byte:
				*p = v
			case string:
				*p = json.RawMessage(v)
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

// stubPool answers Query and QueryRow from queues, in call order, and records
// the SQL and args it saw.
//
// It proves nothing about the SQL itself: the aggregation runs in Postgres, so
// these tests cover the Go-side arithmetic, scan wiring, and error paths only.
type stubPool struct {
	mu sync.Mutex

	queryQueue []queryResult
	rowQueue   []pgx.Row

	execTag pgconn.CommandTag
	execErr error

	sqlSeen  []string
	argsSeen [][]any
}

type queryResult struct {
	rows pgx.Rows
	err  error
}

func rowsResult(rows ...[]any) queryResult {
	return queryResult{rows: &stubRows{rows: rows}}
}

func errResult(err error) queryResult {
	return queryResult{err: err}
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
	if len(p.queryQueue) == 0 {
		return &stubRows{}, nil
	}
	res := p.queryQueue[0]
	p.queryQueue = p.queryQueue[1:]
	if res.err != nil {
		return nil, res.err
	}
	return res.rows, nil
}

func (p *stubPool) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sqlSeen = append(p.sqlSeen, sql)
	p.argsSeen = append(p.argsSeen, args)
	return p.execTag, p.execErr
}

func (p *stubPool) lastArgs() []any {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.argsSeen) == 0 {
		return nil
	}
	return p.argsSeen[len(p.argsSeen)-1]
}

var _ PoolIface = (*stubPool)(nil)

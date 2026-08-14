package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func dlqRow(id string, reprocessed bool) []any {
	return []any{
		id, "evt-1", "payment.released",
		json.RawMessage(`{"projectId":"p-1"}`), json.RawMessage(`{"traceparent":"00-x-y-01"}`),
		"notification-service", "insert failed", 3,
		reprocessed, nil, time.Now().UTC(),
	}
}

func TestNewDLQStore(t *testing.T) {
	if NewDLQStore(nil) == nil {
		t.Fatal("NewDLQStore returned nil")
	}
}

func TestGetDLQList(t *testing.T) {
	p := &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(17)}}},
		queryQueue: []queryResult{rowsResult(dlqRow("dl-1", false))},
	}
	s := &DLQStore{pool: p}

	got, err := s.GetDLQList(context.Background(), DLQFilters{Page: 2, PageSize: 5})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Total != 17 {
		t.Errorf("Total = %d, want 17", got.Total)
	}
	if len(got.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(got.Items))
	}
	e := got.Items[0]
	if e.ID != "dl-1" || e.OriginalEventID != "evt-1" || e.EventType != "payment.released" ||
		e.ConsumerService != "notification-service" || e.RetryCount != 3 {
		t.Errorf("event = %+v, columns are scanned out of order", e)
	}
	// The payload is what an admin replays, and the error is what they triage on.
	if string(e.Payload) != `{"projectId":"p-1"}` {
		t.Errorf("Payload = %s, want the original event body", e.Payload)
	}
	if e.ErrorMessage != "insert failed" {
		t.Errorf("ErrorMessage = %q, want the cause", e.ErrorMessage)
	}

	args := p.argsSeen[1]
	if args[0] != 5 || args[1] != 5 {
		t.Errorf("limit/offset = %v, want 5 and 5 for page 2 of 5", args)
	}
}

func TestGetDLQList_Filters(t *testing.T) {
	reprocessed := true
	notReprocessed := false

	tests := []struct {
		name      string
		filters   DLQFilters
		wantWhere []string
		wantArgs  int
	}{
		{"none", DLQFilters{Page: 1, PageSize: 20}, nil, 0},
		{"event type", DLQFilters{EventType: "payment.released", Page: 1, PageSize: 20},
			[]string{"event_type = $1"}, 1},
		{"consumer", DLQFilters{ConsumerService: "notification-service", Page: 1, PageSize: 20},
			[]string{"consumer_service = $1"}, 1},
		{"reprocessed true", DLQFilters{Reprocessed: &reprocessed, Page: 1, PageSize: 20},
			[]string{"reprocessed = $1"}, 1},
		// A false filter must still be applied; treating it as unset would show
		// already-replayed events in the outstanding list.
		{"reprocessed false", DLQFilters{Reprocessed: &notReprocessed, Page: 1, PageSize: 20},
			[]string{"reprocessed = $1"}, 1},
		{"all three", DLQFilters{EventType: "a.b", ConsumerService: "svc", Reprocessed: &notReprocessed, Page: 1, PageSize: 20},
			[]string{"event_type = $1", "consumer_service = $2", "reprocessed = $3"}, 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{
				rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
				queryQueue: []queryResult{rowsResult()},
			}
			s := &DLQStore{pool: p}

			if _, err := s.GetDLQList(context.Background(), tt.filters); err != nil {
				t.Fatalf("error = %v", err)
			}
			for _, want := range tt.wantWhere {
				if !strings.Contains(p.sqlSeen[0], want) {
					t.Errorf("count sql missing %q: %s", want, p.sqlSeen[0])
				}
				if !strings.Contains(p.sqlSeen[1], want) {
					t.Errorf("items sql missing %q: %s", want, p.sqlSeen[1])
				}
			}
			if got := len(p.argsSeen[0]); got != tt.wantArgs {
				t.Errorf("count args = %d, want %d", got, tt.wantArgs)
			}
		})
	}
}

// A false Reprocessed filter must reach the query as false, not be swallowed.
func TestGetDLQList_ReprocessedFalseIsBound(t *testing.T) {
	notReprocessed := false
	p := &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}
	s := &DLQStore{pool: p}

	if _, err := s.GetDLQList(context.Background(), DLQFilters{Reprocessed: &notReprocessed, Page: 1, PageSize: 20}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if p.argsSeen[0][0] != false {
		t.Errorf("arg = %v, want false", p.argsSeen[0][0])
	}
}

func TestGetDLQList_EmptyIsNotNil(t *testing.T) {
	s := &DLQStore{pool: &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}}
	got, err := s.GetDLQList(context.Background(), DLQFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items == nil {
		t.Error("Items is nil; it would serialise as null")
	}
}

func TestGetDLQList_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"count fails", &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}},
		{"items query fails", &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
			queryQueue: []queryResult{errResult(sentinel)},
		}},
		{"scan fails", &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
			queryQueue: []queryResult{{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}}},
		}},
		{"iteration fails", &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
			queryQueue: []queryResult{{rows: &stubRows{iterErr: sentinel}}},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DLQStore{pool: tt.pool}
			if _, err := s.GetDLQList(context.Background(), DLQFilters{Page: 1, PageSize: 20}); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetDLQByID(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		s := &DLQStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{values: dlqRow("dl-1", false)}}}}
		got, err := s.GetDLQByID(context.Background(), "dl-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got == nil || got.ID != "dl-1" {
			t.Fatalf("event = %v", got)
		}
		// The trace context is what links the failure back to the request.
		if string(got.TraceContext) != `{"traceparent":"00-x-y-01"}` {
			t.Errorf("TraceContext = %s, want it preserved", got.TraceContext)
		}
	})

	t.Run("missing is not an error", func(t *testing.T) {
		s := &DLQStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
		got, err := s.GetDLQByID(context.Background(), "gone")
		if err != nil || got != nil {
			t.Errorf("got (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &DLQStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		if _, err := s.GetDLQByID(context.Background(), "dl-1"); !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})
}

// Marking reprocessed must flip the flag and stamp when, or an event could be
// replayed repeatedly with no record.
func TestMarkReprocessed(t *testing.T) {
	now := time.Now().UTC()
	row := dlqRow("dl-1", true)
	row[9] = &now

	p := &stubPool{rowQueue: []pgx.Row{stubRow{values: row}}}
	s := &DLQStore{pool: p}

	got, err := s.MarkReprocessed(context.Background(), "dl-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil || !got.Reprocessed {
		t.Fatalf("event = %+v, want Reprocessed true", got)
	}
	if got.ReprocessedAt == nil {
		t.Error("ReprocessedAt is nil; there would be no record of when it was replayed")
	}
	if !strings.Contains(p.sqlSeen[0], "reprocessed = true") {
		t.Errorf("sql does not set the flag: %s", p.sqlSeen[0])
	}
	if !strings.Contains(p.sqlSeen[0], "RETURNING") {
		t.Errorf("sql does not return the updated row: %s", p.sqlSeen[0])
	}

	args := p.argsSeen[0]
	if _, ok := args[0].(time.Time); !ok {
		t.Errorf("first arg = %T, want the reprocessed_at timestamp", args[0])
	}
	if args[1] != "dl-1" {
		t.Errorf("id arg = %v, want dl-1", args[1])
	}
}

func TestMarkReprocessed_MissingAndFailure(t *testing.T) {
	t.Run("missing is not an error", func(t *testing.T) {
		s := &DLQStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
		got, err := s.MarkReprocessed(context.Background(), "gone")
		if err != nil || got != nil {
			t.Errorf("got (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &DLQStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		if _, err := s.MarkReprocessed(context.Background(), "dl-1"); !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})
}

func TestNewDisputeStore(t *testing.T) {
	if NewDisputeStore(nil) == nil {
		t.Fatal("NewDisputeStore returned nil")
	}
}

func disputeListRow(id, status string) []any {
	now := time.Now().UTC()
	wpID := "wp-1"
	wpTitle := "Backend API"
	initName := "Owner One"
	againstName := "Talent One"
	return []any{
		id, "p-1", "Marketplace",
		&wpID, &wpTitle,
		"u-owner", &initName, "owner",
		"u-talent", &againstName, "talent",
		"deliverable does not match the PRD", status,
		int64(15_000_000),
		nil, nil, now, now,
	}
}

func TestGetDisputesList(t *testing.T) {
	p := &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(4)}}},
		queryQueue: []queryResult{rowsResult(disputeListRow("d-1", "open"))},
	}
	s := &DisputeStore{pool: p}

	got, err := s.GetDisputesList(context.Background(), DisputeFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Total != 4 {
		t.Errorf("Total = %d, want 4", got.Total)
	}
	if len(got.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(got.Items))
	}
	r := got.Items[0]
	if r.ID != "d-1" || r.ProjectTitle != "Marketplace" || r.Status != "open" {
		t.Errorf("dispute = %+v, columns are scanned out of order", r)
	}
	// Who raised it against whom is what a mediator needs first.
	if r.InitiatedByRole != "owner" || r.AgainstUserRole != "talent" {
		t.Errorf("roles = %q against %q, want owner against talent", r.InitiatedByRole, r.AgainstUserRole)
	}
	// The amount at stake falls back to the project price when the dispute is
	// not scoped to one work package.
	if r.Amount != 15_000_000 {
		t.Errorf("Amount = %d, want 15000000", r.Amount)
	}
	if !strings.Contains(p.sqlSeen[1], "COALESCE(wp.amount, p.final_price, 0)") {
		t.Errorf("amount does not fall back to the project price: %s", p.sqlSeen[1])
	}
}

func TestGetDisputesList_StatusFilter(t *testing.T) {
	p := &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}
	s := &DisputeStore{pool: p}

	if _, err := s.GetDisputesList(context.Background(), DisputeFilters{Status: "mediation", Page: 1, PageSize: 20}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(p.sqlSeen[0], "d.status = $1") {
		t.Errorf("count sql missing the status filter: %s", p.sqlSeen[0])
	}
	if p.argsSeen[0][0] != "mediation" {
		t.Errorf("status arg = %v, want mediation", p.argsSeen[0][0])
	}
}

func TestGetDisputesList_EmptyIsNotNil(t *testing.T) {
	s := &DisputeStore{pool: &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}}
	got, err := s.GetDisputesList(context.Background(), DisputeFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items == nil {
		t.Error("Items is nil; it would serialise as null")
	}
}

func TestGetDisputesList_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"count fails", &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}},
		{"items query fails", &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
			queryQueue: []queryResult{errResult(sentinel)},
		}},
		{"scan fails", &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
			queryQueue: []queryResult{{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}}},
		}},
		{"iteration fails", &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
			queryQueue: []queryResult{{rows: &stubRows{iterErr: sentinel}}},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DisputeStore{pool: tt.pool}
			if _, err := s.GetDisputesList(context.Background(), DisputeFilters{Page: 1, PageSize: 20}); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// Every status is seeded at zero, so a status with no disputes still renders
// as a zero rather than vanishing from the summary.
func TestGetStatusCounts_SeedsEveryStatus(t *testing.T) {
	s := &DisputeStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"open", int64(3)},
		[]any{"resolved", int64(11)},
	)}}}

	got, err := s.GetStatusCounts(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got["open"] != 3 || got["resolved"] != 11 {
		t.Errorf("counts = %v, want the queried values", got)
	}
	for _, status := range []string{"under_review", "mediation", "escalated"} {
		v, ok := got[status]
		if !ok {
			t.Errorf("status %q is absent; the summary would omit it entirely", status)
		}
		if v != 0 {
			t.Errorf("status %q = %d, want 0", status, v)
		}
	}
	if len(got) != 5 {
		t.Errorf("counts = %v, want all five statuses", got)
	}
}

func TestGetStatusCounts_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"query fails", &stubPool{queryQueue: []queryResult{errResult(sentinel)}}},
		{"scan fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}},
		}}},
		{"iteration fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{iterErr: sentinel}},
		}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DisputeStore{pool: tt.pool}
			if _, err := s.GetStatusCounts(context.Background()); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func disputeDetailRow(evidence []byte) []any {
	row := disputeListRow("d-1", "mediation")
	resolution := "split 70-30"
	resolvedBy := "admin-1"
	return append(row, evidence, &resolution, &resolvedBy)
}

func TestGetDisputeByID(t *testing.T) {
	p := &stubPool{
		rowQueue: []pgx.Row{stubRow{values: disputeDetailRow(
			[]byte(`["https://s3/a.png","https://s3/b.pdf"]`))}},
		queryQueue: []queryResult{rowsResult(
			[]any{[]byte(`{"fromStatus":"open","toStatus":"under_review"}`), time.Now().UTC()},
			[]any{[]byte(`{"fromStatus":"under_review","toStatus":"mediation"}`), time.Now().UTC()},
		)},
	}
	s := &DisputeStore{pool: p}

	got, err := s.GetDisputeByID(context.Background(), "d-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Fatal("dispute is nil")
	}
	if got.Resolution == nil || *got.Resolution != "split 70-30" {
		t.Errorf("Resolution = %v, want the recorded decision", got.Resolution)
	}
	if len(got.EvidenceURLs) != 2 {
		t.Errorf("evidence = %v, want both urls parsed out of the jsonb column", got.EvidenceURLs)
	}
	if len(got.StatusHistory) != 2 {
		t.Fatalf("history = %d, want 2 transitions", len(got.StatusHistory))
	}
	if got.StatusHistory[0].FromStatus != "open" || got.StatusHistory[0].ToStatus != "under_review" {
		t.Errorf("first transition = %+v", got.StatusHistory[0])
	}
	// The timeline must read forward, since it is the escalation record.
	if !strings.Contains(p.sqlSeen[1], "ORDER BY created_at ASC") {
		t.Errorf("history is not oldest-first: %s", p.sqlSeen[1])
	}
}

// Evidence that is null or unparseable must give an empty list, not nil and
// not an error: a malformed column must not hide the whole dispute.
func TestGetDisputeByID_EvidenceEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		evidence []byte
		want     int
	}{
		{"null column", nil, 0},
		{"empty array", []byte(`[]`), 0},
		{"one url", []byte(`["https://s3/a.png"]`), 1},
		{"malformed json", []byte(`{not json`), 0},
		{"wrong shape", []byte(`{"a":1}`), 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DisputeStore{pool: &stubPool{
				rowQueue:   []pgx.Row{stubRow{values: disputeDetailRow(tt.evidence)}},
				queryQueue: []queryResult{rowsResult()},
			}}

			got, err := s.GetDisputeByID(context.Background(), "d-1")
			if err != nil {
				t.Fatalf("error = %v", err)
			}
			if got.EvidenceURLs == nil {
				t.Fatal("EvidenceURLs is nil; it would serialise as null")
			}
			if len(got.EvidenceURLs) != tt.want {
				t.Errorf("evidence = %v, want %d entries", got.EvidenceURLs, tt.want)
			}
		})
	}
}

func TestGetDisputeByID_MissingAndFailure(t *testing.T) {
	t.Run("missing is not an error", func(t *testing.T) {
		s := &DisputeStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
		got, err := s.GetDisputeByID(context.Background(), "gone")
		if err != nil || got != nil {
			t.Errorf("got (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("detail failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &DisputeStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		if _, err := s.GetDisputeByID(context.Background(), "d-1"); !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})

	t.Run("history failure propagates", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &DisputeStore{pool: &stubPool{
			rowQueue:   []pgx.Row{stubRow{values: disputeDetailRow(nil)}},
			queryQueue: []queryResult{errResult(sentinel)},
		}}
		if _, err := s.GetDisputeByID(context.Background(), "d-1"); !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})
}

// An outbox row whose payload will not parse is skipped, not fatal: one bad
// row must not hide the rest of the timeline.
func TestGetStatusHistory_SkipsUnparseablePayload(t *testing.T) {
	s := &DisputeStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{[]byte(`{not json`), time.Now().UTC()},
		[]any{[]byte(`{"fromStatus":"open","toStatus":"resolved"}`), time.Now().UTC()},
	)}}}

	got, err := s.getStatusHistory(context.Background(), "d-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("history = %d, want 1 (the parseable row survives)", len(got))
	}
	if got[0].ToStatus != "resolved" {
		t.Errorf("transition = %+v", got[0])
	}
}

func TestGetStatusHistory_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"query fails", &stubPool{queryQueue: []queryResult{errResult(sentinel)}}},
		{"scan fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}},
		}}},
		{"iteration fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{iterErr: sentinel}},
		}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DisputeStore{pool: tt.pool}
			if _, err := s.getStatusHistory(context.Background(), "d-1"); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetStatusHistory_EmptyIsNotNil(t *testing.T) {
	s := &DisputeStore{pool: &stubPool{queryQueue: []queryResult{rowsResult()}}}
	got, err := s.getStatusHistory(context.Background(), "d-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Error("history is nil; it would serialise as null")
	}
}

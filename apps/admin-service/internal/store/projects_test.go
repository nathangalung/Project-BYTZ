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

func TestNewProjectStore(t *testing.T) {
	if NewProjectStore(nil) == nil {
		t.Fatal("NewProjectStore returned nil")
	}
}

func projectListRow(id, title, status string, ownerName, ownerEmail *string) []any {
	finalPrice := 15_000_000
	platformFee := 5_025_000
	return []any{
		id, title, "u-owner", ownerName, ownerEmail,
		status, "web_app", 3,
		5_000_000, 20_000_000, &finalPrice, &platformFee,
		60, 42, time.Now().UTC(),
	}
}

func TestGetProjectsList(t *testing.T) {
	name := "Owner One"
	email := "owner@bytz.id"
	p := &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(31)}}},
		queryQueue: []queryResult{rowsResult(projectListRow("p-1", "Marketplace", "in_progress", &name, &email))},
	}
	s := &ProjectStore{pool: p}

	got, err := s.GetProjectsList(context.Background(), ProjectFilters{Page: 2, PageSize: 10})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Total != 31 {
		t.Errorf("Total = %d, want 31", got.Total)
	}
	if len(got.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(got.Items))
	}
	it := got.Items[0]
	if it.ID != "p-1" || it.Title != "Marketplace" || it.Status != "in_progress" ||
		it.Category != "web_app" || it.TeamSize != 3 || it.Progress != 42 {
		t.Errorf("project = %+v, columns are scanned out of order", it)
	}
	if it.OwnerName != "Owner One" || it.OwnerEmail != "owner@bytz.id" {
		t.Errorf("owner = %q/%q, want the joined values", it.OwnerName, it.OwnerEmail)
	}
	if it.FinalPrice == nil || *it.FinalPrice != 15_000_000 {
		t.Errorf("FinalPrice = %v, want 15000000", it.FinalPrice)
	}

	args := p.argsSeen[1]
	if args[0] != 10 || args[1] != 10 {
		t.Errorf("limit/offset = %v, want 10 and 10 for page 2 of 10", args)
	}
}

// The owner join is a LEFT JOIN, so a project whose owner row is gone must
// still list with empty strings rather than crash the page.
func TestGetProjectsList_NullOwnerBecomesEmptyString(t *testing.T) {
	s := &ProjectStore{pool: &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(1)}}},
		queryQueue: []queryResult{rowsResult(projectListRow("p-1", "Orphan", "draft", nil, nil))},
	}}

	got, err := s.GetProjectsList(context.Background(), ProjectFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items[0].OwnerName != "" || got.Items[0].OwnerEmail != "" {
		t.Errorf("owner = %q/%q, want empty strings", got.Items[0].OwnerName, got.Items[0].OwnerEmail)
	}
}

func TestGetProjectsList_Filters(t *testing.T) {
	tests := []struct {
		name      string
		filters   ProjectFilters
		wantWhere []string
		wantArgs  int
	}{
		{"none", ProjectFilters{Page: 1, PageSize: 20}, []string{"p.deleted_at IS NULL"}, 0},
		{"status", ProjectFilters{Status: "disputed", Page: 1, PageSize: 20}, []string{"p.status = $1"}, 1},
		{"search covers title, owner name and email", ProjectFilters{Search: "market", Page: 1, PageSize: 20},
			[]string{"p.title ILIKE $1", "u.name ILIKE $1", "u.email ILIKE $1"}, 1},
		{"both", ProjectFilters{Status: "disputed", Search: "market", Page: 1, PageSize: 20},
			[]string{"p.status = $1", "p.title ILIKE $2"}, 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{
				rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
				queryQueue: []queryResult{rowsResult()},
			}
			s := &ProjectStore{pool: p}

			if _, err := s.GetProjectsList(context.Background(), tt.filters); err != nil {
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

func TestGetProjectsList_EmptyIsNotNil(t *testing.T) {
	s := &ProjectStore{pool: &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}}
	got, err := s.GetProjectsList(context.Background(), ProjectFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items == nil {
		t.Error("Items is nil; it would serialise as null")
	}
}

func TestGetProjectsList_Failures(t *testing.T) {
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
			s := &ProjectStore{pool: tt.pool}
			if _, err := s.GetProjectsList(context.Background(), ProjectFilters{Page: 1, PageSize: 20}); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func projectDetailRow() []any {
	name := "Owner One"
	email := "owner@bytz.id"
	payout := 9_975_000
	row := projectListRow("p-1", "Marketplace", "in_progress", &name, &email)
	return append(row,
		"a marketplace", "company", nil, nil,
		"public_summary", 88, nil, nil,
		&payout, json.RawMessage(`{"min_experience":2}`), time.Now().UTC(),
	)
}

// A missing project is (nil, nil) so the handler can answer 404.
func TestGetProjectByID_MissingIsNotAnError(t *testing.T) {
	s := &ProjectStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
	got, err := s.GetProjectByID(context.Background(), "gone")
	if err != nil || got != nil {
		t.Errorf("got (%v, %v), want (nil, nil)", got, err)
	}
}

func TestGetProjectByID_AssemblesEverySection(t *testing.T) {
	wpID := "wp-1"
	wpTitle := "Backend API"
	talentName := "Budi"
	role := "Backend Developer"
	initName := "Owner One"
	againstName := "Budi"

	p := &stubPool{
		rowQueue: []pgx.Row{stubRow{values: projectDetailRow()}},
		queryQueue: []queryResult{
			// work packages
			rowsResult([]any{"wp-1", "Backend API", "build the api", 0,
				json.RawMessage(`["go","postgres"]`), 120.5, 10_000_000, 7_150_000, "assigned"}),
			// assignments
			rowsResult([]any{"pa-1", "tp-1", "u-talent", &talentName,
				&role, &wpID, &wpTitle, "accepted", "active", nil, nil, time.Now().UTC()}),
			// milestones
			rowsResult([]any{"m-1", &wpID, &wpTitle, &wpID, &talentName,
				"Deliver API", "endpoints", "individual", 0,
				5_000_000, "submitted", 1, time.Now().UTC(), nil, nil}),
			// transactions
			rowsResult([]any{"tx-1", &wpID, &wpID, &wpID, &talentName,
				"escrow_in", 10_000_000, "completed", nil, nil, time.Now().UTC()}),
			// disputes
			rowsResult([]any{"d-1", &wpID, "u-owner", &initName,
				"u-talent", &againstName, "late", "open", nil, nil, time.Now().UTC()}),
		},
	}
	s := &ProjectStore{pool: p}

	got, err := s.GetProjectByID(context.Background(), "p-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Fatal("project is nil")
	}
	if got.ID != "p-1" || got.Description != "a marketplace" || got.CompletenessScore != 88 {
		t.Errorf("detail = %+v, columns are scanned out of order", got.ProjectListItem)
	}
	if got.TalentPayout == nil || *got.TalentPayout != 9_975_000 {
		t.Errorf("TalentPayout = %v, want 9975000", got.TalentPayout)
	}

	if len(got.WorkPackages) != 1 || got.WorkPackages[0].Amount != 10_000_000 ||
		got.WorkPackages[0].TalentPayout != 7_150_000 {
		t.Errorf("work packages = %+v", got.WorkPackages)
	}
	if len(got.Workers) != 1 || got.Workers[0].TalentName != "Budi" {
		t.Errorf("workers = %+v", got.Workers)
	}
	if len(got.Milestones) != 1 || got.Milestones[0].Status != "submitted" ||
		got.Milestones[0].RevisionCount != 1 {
		t.Errorf("milestones = %+v", got.Milestones)
	}
	if len(got.Transactions) != 1 || got.Transactions[0].Type != "escrow_in" {
		t.Errorf("transactions = %+v", got.Transactions)
	}
	if len(got.Disputes) != 1 || got.Disputes[0].Status != "open" {
		t.Errorf("disputes = %+v", got.Disputes)
	}

	// Every child query keys on the project id.
	for i := 1; i < len(p.argsSeen); i++ {
		if p.argsSeen[i][0] != "p-1" {
			t.Errorf("child query %d keyed on %v, want p-1", i, p.argsSeen[i][0])
		}
	}
}

// A project with no children returns empty slices, not nils the UI must guard.
func TestGetProjectByID_EmptySectionsAreNotNil(t *testing.T) {
	s := &ProjectStore{pool: &stubPool{
		rowQueue: []pgx.Row{stubRow{values: projectDetailRow()}},
		queryQueue: []queryResult{
			rowsResult(), rowsResult(), rowsResult(), rowsResult(), rowsResult(),
		},
	}}

	got, err := s.GetProjectByID(context.Background(), "p-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.WorkPackages == nil || got.Workers == nil || got.Milestones == nil ||
		got.Transactions == nil || got.Disputes == nil {
		t.Error("a section is nil; it would serialise as null")
	}
}

func TestGetProjectByID_NullOwnerBecomesEmptyString(t *testing.T) {
	row := projectDetailRow()
	row[3] = nil // owner name
	row[4] = nil // owner email

	s := &ProjectStore{pool: &stubPool{
		rowQueue: []pgx.Row{stubRow{values: row}},
		queryQueue: []queryResult{
			rowsResult(), rowsResult(), rowsResult(), rowsResult(), rowsResult(),
		},
	}}

	got, err := s.GetProjectByID(context.Background(), "p-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.OwnerName != "" || got.OwnerEmail != "" {
		t.Errorf("owner = %q/%q, want empty strings", got.OwnerName, got.OwnerEmail)
	}
}

// Every section's query, scan, and iteration failure must reach the caller;
// a swallowed one would render a project detail missing its money.
func TestGetProjectByID_Failures(t *testing.T) {
	sentinel := errors.New("db down")
	detail := stubRow{values: projectDetailRow()}

	// Sections run in this order: work packages, assignments, milestones,
	// transactions, disputes.
	sections := []string{"work packages", "assignments", "milestones", "transactions", "disputes"}

	t.Run("detail query fails", func(t *testing.T) {
		s := &ProjectStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		if _, err := s.GetProjectByID(context.Background(), "p-1"); !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})

	for i, section := range sections {
		failures := map[string]queryResult{
			"query fails":     errResult(sentinel),
			"scan fails":      {rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}},
			"iteration fails": {rows: &stubRows{iterErr: sentinel}},
		}

		for mode, failing := range failures {
			t.Run(section+" "+mode, func(t *testing.T) {
				queue := make([]queryResult, 0, i+1)
				for j := 0; j < i; j++ {
					queue = append(queue, rowsResult())
				}
				queue = append(queue, failing)

				s := &ProjectStore{pool: &stubPool{
					rowQueue:   []pgx.Row{detail},
					queryQueue: queue,
				}}
				if _, err := s.GetProjectByID(context.Background(), "p-1"); !errors.Is(err, sentinel) {
					t.Errorf("error = %v, want %v", err, sentinel)
				}
			})
		}
	}
}

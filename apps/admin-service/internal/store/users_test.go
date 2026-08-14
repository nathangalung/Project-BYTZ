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

func userRow(id, email, name, role string, verified bool) []any {
	now := time.Now().UTC()
	return []any{id, email, name, nil, role, nil, verified, "id", now, now}
}

func TestNewUserStore(t *testing.T) {
	if NewUserStore(nil) == nil {
		t.Fatal("NewUserStore returned nil")
	}
}

// Filters must reach both the count and the items query, or the total would
// describe a different set than the page.
func TestGetUsersList_FiltersApplyToBothQueries(t *testing.T) {
	tests := []struct {
		name        string
		filters     UserFilters
		wantWhere   []string
		wantArgs    int // args on the count query
		wantPattern string
	}{
		{
			name:      "no filters",
			filters:   UserFilters{Page: 1, PageSize: 20},
			wantWhere: []string{"deleted_at IS NULL"},
			wantArgs:  0,
		},
		{
			name:      "role only",
			filters:   UserFilters{Role: "talent", Page: 1, PageSize: 20},
			wantWhere: []string{"role = $1"},
			wantArgs:  1,
		},
		{
			name:        "search only",
			filters:     UserFilters{Search: "budi", Page: 1, PageSize: 20},
			wantWhere:   []string{"name ILIKE $1", "email ILIKE $1"},
			wantArgs:    1,
			wantPattern: "%budi%",
		},
		{
			name:        "role and search",
			filters:     UserFilters{Role: "owner", Search: "budi", Page: 1, PageSize: 20},
			wantWhere:   []string{"role = $1", "name ILIKE $2", "email ILIKE $2"},
			wantArgs:    2,
			wantPattern: "%budi%",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{
				rowQueue:   []pgx.Row{stubRow{values: []any{int64(3)}}},
				queryQueue: []queryResult{rowsResult()},
			}
			s := &UserStore{pool: p}

			if _, err := s.GetUsersList(context.Background(), tt.filters); err != nil {
				t.Fatalf("error = %v", err)
			}

			countSQL, itemsSQL := p.sqlSeen[0], p.sqlSeen[1]
			for _, want := range tt.wantWhere {
				if !strings.Contains(countSQL, want) {
					t.Errorf("count sql missing %q: %s", want, countSQL)
				}
				if !strings.Contains(itemsSQL, want) {
					t.Errorf("items sql missing %q: %s", want, itemsSQL)
				}
			}
			if got := len(p.argsSeen[0]); got != tt.wantArgs {
				t.Errorf("count args = %d, want %d", got, tt.wantArgs)
			}
			// Items adds limit and offset on top of the filter args.
			if got := len(p.argsSeen[1]); got != tt.wantArgs+2 {
				t.Errorf("items args = %d, want %d", got, tt.wantArgs+2)
			}
			if tt.wantPattern != "" {
				found := false
				for _, a := range p.argsSeen[0] {
					if a == tt.wantPattern {
						found = true
					}
				}
				if !found {
					t.Errorf("args %v do not contain the wildcard pattern %q", p.argsSeen[0], tt.wantPattern)
				}
			}
		})
	}
}

func TestGetUsersList_PaginationOffset(t *testing.T) {
	p := &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(100)}}},
		queryQueue: []queryResult{rowsResult(userRow("u-1", "a@b.c", "A", "talent", true))},
	}
	s := &UserStore{pool: p}

	got, err := s.GetUsersList(context.Background(), UserFilters{Page: 3, PageSize: 25})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Total != 100 {
		t.Errorf("Total = %d, want 100 (the count query answer)", got.Total)
	}
	if len(got.Items) != 1 || got.Items[0].ID != "u-1" {
		t.Errorf("items = %v, want the scanned row", got.Items)
	}

	args := p.argsSeen[1]
	if args[len(args)-2] != 25 {
		t.Errorf("limit = %v, want 25", args[len(args)-2])
	}
	if args[len(args)-1] != 50 {
		t.Errorf("offset = %v, want 50 for page 3 of 25", args[len(args)-1])
	}
}

func TestGetUsersList_EmptyPageIsNotNil(t *testing.T) {
	s := &UserStore{pool: &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}}

	got, err := s.GetUsersList(context.Background(), UserFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items == nil {
		t.Error("Items is nil; it would serialise as null")
	}
}

func TestGetUsersList_Failures(t *testing.T) {
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
			s := &UserStore{pool: tt.pool}
			if _, err := s.GetUsersList(context.Background(), UserFilters{Page: 1, PageSize: 20}); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetUserByID(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		p := &stubPool{rowQueue: []pgx.Row{
			stubRow{values: userRow("u-1", "a@b.c", "Budi", "talent", true)},
		}}
		s := &UserStore{pool: p}

		got, err := s.GetUserByID(context.Background(), "u-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got == nil || got.ID != "u-1" || got.Email != "a@b.c" || got.Role != "talent" {
			t.Errorf("user = %+v, columns are scanned out of order", got)
		}
		// A soft-deleted user must not be resurrected by an id lookup.
		if !strings.Contains(p.sqlSeen[0], "deleted_at IS NULL") {
			t.Errorf("sql returns soft-deleted users: %s", p.sqlSeen[0])
		}
	})

	t.Run("missing row is not an error", func(t *testing.T) {
		s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
		got, err := s.GetUserByID(context.Background(), "gone")
		if err != nil || got != nil {
			t.Errorf("got (%v, %v), want (nil, nil) so the handler can answer 404", got, err)
		}
	})

	t.Run("query failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		_, err := s.GetUserByID(context.Background(), "u-1")
		if !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})
}

// Suspend and unsuspend must move is_verified in opposite directions. Swapping
// them would leave a suspended account able to work.
func TestSuspendAndUnsuspend_SetOppositeVerification(t *testing.T) {
	tests := []struct {
		name         string
		call         func(*UserStore) (*User, error)
		wantSQL      string
		wantVerentry bool
	}{
		{
			name:         "suspend clears verification",
			call:         func(s *UserStore) (*User, error) { return s.SuspendUser(context.Background(), "u-1") },
			wantSQL:      "is_verified = false",
			wantVerentry: false,
		},
		{
			name:         "unsuspend restores verification",
			call:         func(s *UserStore) (*User, error) { return s.UnsuspendUser(context.Background(), "u-1") },
			wantSQL:      "is_verified = true",
			wantVerentry: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{rowQueue: []pgx.Row{
				stubRow{values: userRow("u-1", "a@b.c", "Budi", "talent", tt.wantVerentry)},
			}}
			s := &UserStore{pool: p}

			got, err := tt.call(s)
			if err != nil {
				t.Fatalf("error = %v", err)
			}
			if got == nil {
				t.Fatal("returned nil user")
			}
			if got.IsVerified != tt.wantVerentry {
				t.Errorf("IsVerified = %v, want %v", got.IsVerified, tt.wantVerentry)
			}
			if !strings.Contains(p.sqlSeen[0], tt.wantSQL) {
				t.Errorf("sql = %s, want it to contain %q", p.sqlSeen[0], tt.wantSQL)
			}
			if !strings.Contains(p.sqlSeen[0], "RETURNING") {
				t.Errorf("sql does not return the updated row: %s", p.sqlSeen[0])
			}
			// updated_at must be stamped, not left at the old value.
			args := p.argsSeen[0]
			if _, ok := args[0].(time.Time); !ok {
				t.Errorf("first arg = %T, want the updated_at timestamp", args[0])
			}
			if args[1] != "u-1" {
				t.Errorf("id arg = %v, want u-1", args[1])
			}
		})
	}
}

func TestSuspendAndUnsuspend_MissingUser(t *testing.T) {
	calls := map[string]func(*UserStore) (*User, error){
		"suspend":   func(s *UserStore) (*User, error) { return s.SuspendUser(context.Background(), "gone") },
		"unsuspend": func(s *UserStore) (*User, error) { return s.UnsuspendUser(context.Background(), "gone") },
	}

	for name, call := range calls {
		t.Run(name+" missing is not an error", func(t *testing.T) {
			s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
			got, err := call(s)
			if err != nil || got != nil {
				t.Errorf("got (%v, %v), want (nil, nil)", got, err)
			}
		})

		t.Run(name+" failure wraps", func(t *testing.T) {
			sentinel := errors.New("db down")
			s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
			if _, err := call(s); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetAuditLogs(t *testing.T) {
	adminName := "Admin One"
	adminEmail := "admin@bytz.id"
	p := &stubPool{
		rowQueue: []pgx.Row{stubRow{values: []any{int64(42)}}},
		queryQueue: []queryResult{rowsResult(
			[]any{"log-1", "admin-1", &adminName, &adminEmail, "user.suspend", "user", "u-1",
				json.RawMessage(`{"before":true}`), time.Now().UTC()},
		)},
	}
	s := &UserStore{pool: p}

	got, err := s.GetAuditLogs(context.Background(), 2, 10)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Total != 42 {
		t.Errorf("Total = %d, want 42", got.Total)
	}
	if len(got.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(got.Items))
	}
	l := got.Items[0]
	if l.ID != "log-1" || l.AdminID != "admin-1" || l.Action != "user.suspend" ||
		l.TargetType != "user" || l.TargetID != "u-1" {
		t.Errorf("log = %+v, columns are scanned out of order", l)
	}
	if l.AdminName == nil || *l.AdminName != adminName {
		t.Errorf("AdminName = %v, want %q from the join", l.AdminName, adminName)
	}
	if string(l.Details) != `{"before":true}` {
		t.Errorf("Details = %s, want the raw json preserved", l.Details)
	}

	args := p.argsSeen[1]
	if args[0] != 10 || args[1] != 10 {
		t.Errorf("limit/offset = %v, want 10 and 10 for page 2 of 10", args)
	}
}

func TestGetAuditLogs_EmptyIsNotNil(t *testing.T) {
	s := &UserStore{pool: &stubPool{
		rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
		queryQueue: []queryResult{rowsResult()},
	}}
	got, err := s.GetAuditLogs(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Items == nil {
		t.Error("Items is nil; it would serialise as null")
	}
}

func TestGetAuditLogs_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"count fails", &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}},
		{"list fails", &stubPool{
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
			s := &UserStore{pool: tt.pool}
			if _, err := s.GetAuditLogs(context.Background(), 1, 10); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// An audit entry has to record who did what to which target, or the log is
// worthless for the compliance retention it exists for.
func TestCreateAuditLog_PersistsEveryField(t *testing.T) {
	details := json.RawMessage(`{"before":{"isVerified":true},"after":{"isVerified":false}}`)
	p := &stubPool{rowQueue: []pgx.Row{stubRow{values: []any{
		"log-1", "admin-1", "user.suspend", "user", "u-1", details, time.Now().UTC(),
	}}}}
	s := &UserStore{pool: p}

	got, err := s.CreateAuditLog(context.Background(), "log-1", "admin-1", "user.suspend", "user", "u-1", details)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.ID != "log-1" || got.AdminID != "admin-1" || got.Action != "user.suspend" {
		t.Errorf("log = %+v, does not echo the insert", got)
	}

	args := p.argsSeen[0]
	if len(args) != 7 {
		t.Fatalf("args = %d, want 7", len(args))
	}
	if args[0] != "log-1" || args[1] != "admin-1" || args[2] != "user.suspend" ||
		args[3] != "user" || args[4] != "u-1" {
		t.Errorf("args = %v, want the id, admin, action, target type and target id in order", args[:5])
	}
	if _, ok := args[6].(time.Time); !ok {
		t.Errorf("created_at = %T, want a timestamp", args[6])
	}
}

func TestCreateAuditLog_FailureWraps(t *testing.T) {
	sentinel := errors.New("db down")
	s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}

	if _, err := s.CreateAuditLog(context.Background(), "l", "a", "act", "user", "u", nil); !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want %v", err, sentinel)
	}
}

func TestGetPlatformSettings(t *testing.T) {
	desc := "Fee brackets"
	p := &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"s-1", "platform_fee_brackets", json.RawMessage(`[{"x":1}]`), &desc, nil, nil},
		[]any{"s-2", "auto_release_days", json.RawMessage(`14`), nil, nil, nil},
	)}}
	s := &UserStore{pool: p}

	got, err := s.GetPlatformSettings(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("settings = %d, want 2", len(got))
	}
	if got[0].Key != "platform_fee_brackets" || string(got[0].Value) != `[{"x":1}]` {
		t.Errorf("setting = %+v, columns are scanned out of order", got[0])
	}
	if got[0].Description == nil || *got[0].Description != desc {
		t.Errorf("Description = %v, want %q", got[0].Description, desc)
	}
	if got[1].Description != nil {
		t.Errorf("Description = %v, want nil for a setting with none", got[1].Description)
	}
	if !strings.Contains(p.sqlSeen[0], "ORDER BY key") {
		t.Errorf("sql is unordered, so the settings page would shuffle: %s", p.sqlSeen[0])
	}
}

func TestGetPlatformSettings_EmptyIsNotNil(t *testing.T) {
	s := &UserStore{pool: &stubPool{queryQueue: []queryResult{rowsResult()}}}
	got, err := s.GetPlatformSettings(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Error("settings is nil; it would serialise as null")
	}
}

func TestGetPlatformSettings_Failures(t *testing.T) {
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
			s := &UserStore{pool: tt.pool}
			if _, err := s.GetPlatformSettings(context.Background()); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetPlatformSetting(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		p := &stubPool{rowQueue: []pgx.Row{stubRow{values: []any{
			"s-1", "auto_release_days", json.RawMessage(`14`), nil, nil, nil,
		}}}}
		s := &UserStore{pool: p}

		got, err := s.GetPlatformSetting(context.Background(), "auto_release_days")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got == nil || got.Key != "auto_release_days" || string(got.Value) != "14" {
			t.Errorf("setting = %+v", got)
		}
		if p.argsSeen[0][0] != "auto_release_days" {
			t.Errorf("key arg = %v", p.argsSeen[0][0])
		}
	})

	t.Run("missing is not an error", func(t *testing.T) {
		s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}
		got, err := s.GetPlatformSetting(context.Background(), "nope")
		if err != nil || got != nil {
			t.Errorf("got (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("failure wraps", func(t *testing.T) {
		sentinel := errors.New("db down")
		s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}
		if _, err := s.GetPlatformSetting(context.Background(), "k"); !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want %v", err, sentinel)
		}
	})
}

func TestUpsertPlatformSetting(t *testing.T) {
	desc := "How long before auto release"
	value := json.RawMessage(`14`)
	p := &stubPool{rowQueue: []pgx.Row{stubRow{values: []any{
		"s-1", "auto_release_days", value, &desc, nil, nil,
	}}}}
	s := &UserStore{pool: p}

	got, err := s.UpsertPlatformSetting(context.Background(), "s-1", "auto_release_days", value, &desc, "admin-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Key != "auto_release_days" {
		t.Errorf("setting = %+v", got)
	}
	// An insert that is not an upsert would fail the second time a setting is
	// edited, since key is unique.
	if !strings.Contains(p.sqlSeen[0], "ON CONFLICT (key) DO UPDATE") {
		t.Errorf("sql is a plain insert, so editing a setting twice would conflict: %s", p.sqlSeen[0])
	}
	// A nil description must not blank an existing one.
	if !strings.Contains(p.sqlSeen[0], "COALESCE($4, platform_settings.description)") {
		t.Errorf("sql overwrites the description with null: %s", p.sqlSeen[0])
	}

	args := p.argsSeen[0]
	if args[0] != "s-1" || args[1] != "auto_release_days" || args[4] != "admin-1" {
		t.Errorf("args = %v, want the id, key and admin recorded", args)
	}
}

func TestUpsertPlatformSetting_FailureWraps(t *testing.T) {
	sentinel := errors.New("db down")
	s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}}

	if _, err := s.UpsertPlatformSetting(context.Background(), "s", "k", nil, nil, "a"); !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want %v", err, sentinel)
	}
}

// A user who is not a talent gets empty collections, not an error and not nil
// slices the admin UI would have to guard against.
func TestGetTalentDetail_NonTalentReturnsEmptyDetail(t *testing.T) {
	s := &UserStore{pool: &stubPool{rowQueue: []pgx.Row{stubRow{err: pgx.ErrNoRows}}}}

	got, err := s.GetTalentDetail(context.Background(), "owner-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Fatal("detail is nil")
	}
	if got.Profile != nil {
		t.Errorf("Profile = %v, want nil for a non-talent", got.Profile)
	}
	if got.Skills == nil || got.Penalties == nil || got.ProjectHistory == nil {
		t.Error("collections are nil; they would serialise as null")
	}
}

func talentProfileRow() []any {
	now := time.Now().UTC()
	rating := 4.5
	return []any{
		"tp-1", "u-1", nil, 5, "mid",
		nil, nil, nil,
		nil, "available", "verified",
		json.RawMessage(`[]`), json.RawMessage(`["fintech"]`),
		7, 2,
		&rating, 0.5, now, now,
	}
}

func TestGetTalentDetail_AssemblesEverySection(t *testing.T) {
	issuedBy := "Admin One"
	role := "Backend Developer"
	wpTitle := "Backend API"

	p := &stubPool{
		rowQueue: []pgx.Row{stubRow{values: talentProfileRow()}},
		queryQueue: []queryResult{
			rowsResult([]any{"sk-1", "Go", "backend", "advanced", true}),
			rowsResult([]any{"pen-1", "warning", "late delivery", nil, "admin-1", &issuedBy, "none", nil, nil, time.Now().UTC()}),
			rowsResult([]any{"pa-1", "p-1", "Marketplace", "in_progress", &role, &wpTitle, "accepted", "active", nil, nil, time.Now().UTC()}),
		},
	}
	s := &UserStore{pool: p}

	got, err := s.GetTalentDetail(context.Background(), "u-1")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Profile == nil {
		t.Fatal("Profile is nil")
	}
	if got.Profile.ID != "tp-1" || got.Profile.Tier != "mid" ||
		got.Profile.TotalProjectsCompleted != 7 || got.Profile.TotalProjectsActive != 2 {
		t.Errorf("profile = %+v, columns are scanned out of order", got.Profile)
	}
	if got.Profile.PemerataanPenalty != 0.5 {
		t.Errorf("PemerataanPenalty = %v, want 0.5 (it feeds the fairness score)", got.Profile.PemerataanPenalty)
	}

	if len(got.Skills) != 1 || got.Skills[0].SkillName != "Go" || !got.Skills[0].IsPrimary {
		t.Errorf("skills = %+v", got.Skills)
	}
	if len(got.Penalties) != 1 || got.Penalties[0].Type != "warning" {
		t.Errorf("penalties = %+v", got.Penalties)
	}
	if len(got.ProjectHistory) != 1 || got.ProjectHistory[0].ProjectTitle != "Marketplace" {
		t.Errorf("history = %+v", got.ProjectHistory)
	}

	// Every follow-up query keys on the profile id, not the user id.
	for i := 1; i < len(p.argsSeen); i++ {
		if p.argsSeen[i][0] != "tp-1" {
			t.Errorf("query %d keyed on %v, want the talent profile id tp-1", i, p.argsSeen[i][0])
		}
	}
}

func TestGetTalentDetail_Failures(t *testing.T) {
	sentinel := errors.New("db down")
	profile := stubRow{values: talentProfileRow()}

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"profile query fails", &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}},
		{"skills query fails", &stubPool{
			rowQueue:   []pgx.Row{profile},
			queryQueue: []queryResult{errResult(sentinel)},
		}},
		{"skills scan fails", &stubPool{
			rowQueue:   []pgx.Row{profile},
			queryQueue: []queryResult{{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}}},
		}},
		{"skills iteration fails", &stubPool{
			rowQueue:   []pgx.Row{profile},
			queryQueue: []queryResult{{rows: &stubRows{iterErr: sentinel}}},
		}},
		{"penalties query fails", &stubPool{
			rowQueue:   []pgx.Row{profile},
			queryQueue: []queryResult{rowsResult(), errResult(sentinel)},
		}},
		{"penalties scan fails", &stubPool{
			rowQueue: []pgx.Row{profile},
			queryQueue: []queryResult{rowsResult(),
				{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}}},
		}},
		{"penalties iteration fails", &stubPool{
			rowQueue:   []pgx.Row{profile},
			queryQueue: []queryResult{rowsResult(), {rows: &stubRows{iterErr: sentinel}}},
		}},
		{"history query fails", &stubPool{
			rowQueue:   []pgx.Row{profile},
			queryQueue: []queryResult{rowsResult(), rowsResult(), errResult(sentinel)},
		}},
		{"history scan fails", &stubPool{
			rowQueue: []pgx.Row{profile},
			queryQueue: []queryResult{rowsResult(), rowsResult(),
				{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}}},
		}},
		{"history iteration fails", &stubPool{
			rowQueue: []pgx.Row{profile},
			queryQueue: []queryResult{rowsResult(), rowsResult(),
				{rows: &stubRows{iterErr: sentinel}}},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &UserStore{pool: tt.pool}
			if _, err := s.GetTalentDetail(context.Background(), "u-1"); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

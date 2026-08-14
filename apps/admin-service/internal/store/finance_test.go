package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestNewFinanceStore(t *testing.T) {
	if NewFinanceStore(nil) == nil {
		t.Fatal("NewFinanceStore returned nil")
	}
}

func TestGetSummary(t *testing.T) {
	p := &stubPool{rowQueue: []pgx.Row{
		// total, this month, last month, brd, prd, margin, revision, placement
		stubRow{values: []any{
			int64(50_000_000), int64(8_000_000), int64(6_000_000),
			int64(1_500_000), int64(3_000_000), int64(44_000_000),
			int64(400_000), int64(1_100_000),
		}},
		stubRow{values: []any{int64(12_000_000)}},
	}}
	s := &FinanceStore{pool: p}

	got, err := s.GetSummary(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.TotalRevenue != 50_000_000 || got.ThisMonthRevenue != 8_000_000 ||
		got.LastMonthRevenue != 6_000_000 {
		t.Errorf("headline figures = %+v, columns are scanned out of order", got)
	}
	if got.BrdRevenue != 1_500_000 || got.PrdRevenue != 3_000_000 ||
		got.MarginRevenue != 44_000_000 || got.RevisionFee != 400_000 ||
		got.PlacementFee != 1_100_000 {
		t.Errorf("breakdown = %+v, columns are scanned out of order", got)
	}
	if got.EscrowHeld != 12_000_000 {
		t.Errorf("EscrowHeld = %d, want 12000000 from the second query", got.EscrowHeld)
	}

	// Margin comes from the platform fee ledger legs, not the gross release,
	// most of which belongs to the talent.
	if !strings.Contains(p.sqlSeen[0], "owner_type = 'platform'") ||
		!strings.Contains(p.sqlSeen[0], "entry_type = 'debit'") {
		t.Errorf("margin is not taken from the platform fee legs: %s", p.sqlSeen[0])
	}
	// Escrow deposits are a liability owed onward, not income.
	if strings.Contains(p.sqlSeen[0], "'escrow_in'") {
		t.Errorf("revenue counts escrow deposits as income: %s", p.sqlSeen[0])
	}
	// Escrow held is deposits minus releases.
	if !strings.Contains(p.sqlSeen[1], "escrow_in") || !strings.Contains(p.sqlSeen[1], "escrow_release") {
		t.Errorf("escrow held is not in minus out: %s", p.sqlSeen[1])
	}
}

func TestGetSummary_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"summary scan fails", &stubPool{rowQueue: []pgx.Row{stubRow{err: sentinel}}}},
		{"escrow held fails", &stubPool{rowQueue: []pgx.Row{
			stubRow{values: []any{int64(0), int64(0), int64(0), int64(0), int64(0), int64(0), int64(0), int64(0)}},
			stubRow{err: sentinel},
		}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &FinanceStore{pool: tt.pool}
			if _, err := s.GetSummary(context.Background()); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// Remaining is what is still owed to talents on that project, so it must be
// deposits minus releases, not either figure alone.
func TestGetEscrowByProject_RemainingIsInMinusOut(t *testing.T) {
	s := &FinanceStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"p-1", "Marketplace", "in_progress", int64(10_000_000), int64(4_000_000)},
		[]any{"p-2", "Landing", "review", int64(3_000_000), int64(0)},
	)}}}

	got, err := s.GetEscrowByProject(context.Background(), 20)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("rows = %d, want 2", len(got))
	}
	if got[0].TotalEscrow != 10_000_000 || got[0].Released != 4_000_000 || got[0].Remaining != 6_000_000 {
		t.Errorf("row = %+v, want remaining 6000000", got[0])
	}
	if got[1].Remaining != 3_000_000 {
		t.Errorf("remaining = %d, want the full deposit when nothing is released", got[1].Remaining)
	}
	if got[0].ProjectTitle != "Marketplace" || got[0].Status != "in_progress" {
		t.Errorf("row = %+v, columns are scanned out of order", got[0])
	}
}

// The limit is clamped, or a caller could ask for the whole table.
func TestGetEscrowByProject_LimitClamping(t *testing.T) {
	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{"zero falls back", 0, 20},
		{"negative falls back", -5, 20},
		{"above the cap falls back", 101, 20},
		{"at the cap is kept", 100, 100},
		{"in range is kept", 50, 50},
		{"one is kept", 1, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{queryQueue: []queryResult{rowsResult()}}
			s := &FinanceStore{pool: p}

			if _, err := s.GetEscrowByProject(context.Background(), tt.limit); err != nil {
				t.Fatalf("error = %v", err)
			}
			args := p.lastArgs()
			if args[1] != tt.want {
				t.Errorf("limit = %v, want %d", args[1], tt.want)
			}
		})
	}
}

// Only projects that can still hold escrow are scanned.
func TestGetEscrowByProject_RestrictedToActiveStatuses(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{rowsResult()}}
	s := &FinanceStore{pool: p}

	if _, err := s.GetEscrowByProject(context.Background(), 20); err != nil {
		t.Fatalf("error = %v", err)
	}

	statuses, ok := p.argsSeen[0][0].([]string)
	if !ok {
		t.Fatalf("first arg = %T, want the active status list", p.argsSeen[0][0])
	}
	for _, want := range []string{"matched", "in_progress", "partially_active", "review", "disputed", "on_hold"} {
		found := false
		for _, s := range statuses {
			if s == want {
				found = true
			}
		}
		if !found {
			t.Errorf("status %q is missing; escrow on those projects would be invisible", want)
		}
	}
	// A completed or cancelled project has settled, so it must not appear.
	for _, unwanted := range []string{"completed", "cancelled", "draft"} {
		for _, s := range statuses {
			if s == unwanted {
				t.Errorf("status %q is included but escrow there is already settled", unwanted)
			}
		}
	}
}

func TestGetEscrowByProject_EmptyIsNotNil(t *testing.T) {
	s := &FinanceStore{pool: &stubPool{queryQueue: []queryResult{rowsResult()}}}
	got, err := s.GetEscrowByProject(context.Background(), 20)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Error("rows is nil; it would serialise as null")
	}
}

func TestGetEscrowByProject_Failures(t *testing.T) {
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
			s := &FinanceStore{pool: tt.pool}
			if _, err := s.GetEscrowByProject(context.Background(), 20); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetTransactionsList(t *testing.T) {
	talentID := "tp-1"
	talentName := "Budi"
	method := "gopay"
	ref := "ORDER-1"

	p := &stubPool{
		rowQueue: []pgx.Row{stubRow{values: []any{int64(58)}}},
		queryQueue: []queryResult{rowsResult(
			[]any{"tx-1", "p-1", "Marketplace", &talentID, &talentName,
				"escrow_release", int64(7_150_000), "completed", &method, &ref, time.Now().UTC()},
		)},
	}
	s := &FinanceStore{pool: p}

	got, err := s.GetTransactionsList(context.Background(), TransactionFilters{Page: 2, PageSize: 25})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.Total != 58 {
		t.Errorf("Total = %d, want 58", got.Total)
	}
	if len(got.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(got.Items))
	}
	r := got.Items[0]
	if r.ID != "tx-1" || r.ProjectTitle != "Marketplace" || r.Type != "escrow_release" ||
		r.Amount != 7_150_000 || r.Status != "completed" {
		t.Errorf("row = %+v, columns are scanned out of order", r)
	}
	if r.TalentName == nil || *r.TalentName != "Budi" {
		t.Errorf("TalentName = %v, want the joined user name", r.TalentName)
	}

	args := p.argsSeen[1]
	if args[len(args)-2] != 25 || args[len(args)-1] != 25 {
		t.Errorf("limit/offset = %v, want 25 and 25 for page 2 of 25", args[len(args)-2:])
	}
}

// A transaction with no talent (a document payment) must still list.
func TestGetTransactionsList_NullTalentIsKept(t *testing.T) {
	s := &FinanceStore{pool: &stubPool{
		rowQueue: []pgx.Row{stubRow{values: []any{int64(1)}}},
		queryQueue: []queryResult{rowsResult(
			[]any{"tx-2", "p-1", "Marketplace", nil, nil,
				"brd_payment", int64(500_000), "completed", nil, nil, time.Now().UTC()},
		)},
	}}

	got, err := s.GetTransactionsList(context.Background(), TransactionFilters{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("items = %d, want 1 (a document payment has no talent)", len(got.Items))
	}
	if got.Items[0].TalentID != nil || got.Items[0].TalentName != nil {
		t.Errorf("talent = %v/%v, want both nil", got.Items[0].TalentID, got.Items[0].TalentName)
	}
}

func TestGetTransactionsList_Filters(t *testing.T) {
	tests := []struct {
		name      string
		filters   TransactionFilters
		wantWhere []string
		wantArgs  int
	}{
		{"none", TransactionFilters{Page: 1, PageSize: 20}, []string{"t.deleted_at IS NULL"}, 0},
		{"type", TransactionFilters{Type: "refund", Page: 1, PageSize: 20}, []string{"t.type = $1"}, 1},
		{"search", TransactionFilters{Search: "market", Page: 1, PageSize: 20},
			[]string{"p.title ILIKE $1", "u.name ILIKE $1"}, 1},
		{"both", TransactionFilters{Type: "refund", Search: "market", Page: 1, PageSize: 20},
			[]string{"t.type = $1", "p.title ILIKE $2"}, 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{
				rowQueue:   []pgx.Row{stubRow{values: []any{int64(0)}}},
				queryQueue: []queryResult{rowsResult()},
			}
			s := &FinanceStore{pool: p}

			if _, err := s.GetTransactionsList(context.Background(), tt.filters); err != nil {
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

func TestGetTransactionsList_Failures(t *testing.T) {
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
			s := &FinanceStore{pool: tt.pool}
			if _, err := s.GetTransactionsList(context.Background(), TransactionFilters{Page: 1, PageSize: 20}); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// Drift is stored minus ledger, and only drifted accounts are reported. A
// clean account appearing in the list would bury the one that matters.
func TestReconcileLedger_ReportsOnlyDrift(t *testing.T) {
	ownerID := "u-1"
	s := &FinanceStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(
		// Stored is 500 above the ledger.
		[]any{"acc-1", "escrow", nil, "Escrow - Project 1", int64(10_500), int64(10_000)},
		// Clean.
		[]any{"acc-2", "talent", &ownerID, "Talent Payout", int64(7_000), int64(7_000)},
		// Stored is 200 below the ledger.
		[]any{"acc-3", "platform", nil, "Platform Revenue", int64(2_800), int64(3_000)},
	)}}}

	got, err := s.ReconcileLedger(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.AccountsChecked != 3 {
		t.Errorf("AccountsChecked = %d, want 3 (every account is examined)", got.AccountsChecked)
	}
	if got.DriftedAccounts != 2 {
		t.Errorf("DriftedAccounts = %d, want 2", got.DriftedAccounts)
	}
	if len(got.Rows) != 2 {
		t.Fatalf("rows = %d, want only the drifted accounts", len(got.Rows))
	}
	if got.Rows[0].Drift != 500 {
		t.Errorf("drift = %d, want +500 (stored above ledger)", got.Rows[0].Drift)
	}
	if got.Rows[1].Drift != -200 {
		t.Errorf("drift = %d, want -200 (stored below ledger)", got.Rows[1].Drift)
	}
	// Opposite drifts must not be reported as a clean ledger, but the signed
	// total is what the code computes, so state it explicitly.
	if got.TotalDrift != 300 {
		t.Errorf("TotalDrift = %d, want 300 (the signed sum, 500 - 200)", got.TotalDrift)
	}
	for _, r := range got.Rows {
		if r.AccountID == "acc-2" {
			t.Error("a clean account was reported as drifted")
		}
	}
}

// A ledger that agrees everywhere reports an empty list, not nil.
func TestReconcileLedger_CleanLedger(t *testing.T) {
	s := &FinanceStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"acc-1", "escrow", nil, "Escrow", int64(1_000), int64(1_000)},
	)}}}

	got, err := s.ReconcileLedger(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.DriftedAccounts != 0 || got.TotalDrift != 0 {
		t.Errorf("reconciliation = %+v, want no drift", got)
	}
	if got.Rows == nil {
		t.Error("Rows is nil; it would serialise as null")
	}
	if len(got.Rows) != 0 {
		t.Errorf("rows = %d, want 0", len(got.Rows))
	}
}

// It reports and never corrects: the ledger is the audit record.
func TestReconcileLedger_DoesNotWrite(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"acc-1", "escrow", nil, "Escrow", int64(999), int64(1_000)},
	)}}
	s := &FinanceStore{pool: p}

	if _, err := s.ReconcileLedger(context.Background()); err != nil {
		t.Fatalf("error = %v", err)
	}
	for _, sql := range p.sqlSeen {
		upper := strings.ToUpper(sql)
		if strings.Contains(upper, "UPDATE ") || strings.Contains(upper, "INSERT ") {
			t.Errorf("reconciliation wrote to the ledger: %s", sql)
		}
	}
}

func TestReconcileLedger_Failures(t *testing.T) {
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
			s := &FinanceStore{pool: tt.pool}
			if _, err := s.ReconcileLedger(context.Background()); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

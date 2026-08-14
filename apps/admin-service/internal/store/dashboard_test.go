package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestNewDashboardStore(t *testing.T) {
	if NewDashboardStore(nil) == nil {
		t.Fatal("NewDashboardStore returned nil")
	}
}

func TestGetProjectStats(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"draft", int64(3)},
		[]any{"in_progress", int64(12)},
		[]any{"completed", int64(40)},
	)}}
	s := &DashboardStore{pool: p}

	got, err := s.GetProjectStats(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	want := map[string]int64{"draft": 3, "in_progress": 12, "completed": 40}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("stats[%q] = %d, want %d", k, got[k], v)
		}
	}
	if len(got) != len(want) {
		t.Errorf("stats = %v, want exactly %v", got, want)
	}
	// Soft-deleted projects would inflate every count on the dashboard.
	if !strings.Contains(p.sqlSeen[0], "deleted_at IS NULL") {
		t.Errorf("sql counts soft-deleted projects: %s", p.sqlSeen[0])
	}
}

func TestGetProjectStats_Failures(t *testing.T) {
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
			s := &DashboardStore{pool: tt.pool}
			_, err := s.GetProjectStats(context.Background())
			if !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// Revenue adds the revenue types, subtracts the refund types, and leaves
// anything else out of the total while still reporting it in the breakdown.
// Getting the sign wrong here is a wrong number in front of an operator.
func TestGetRevenueStats_RefundsSubtractAndUnknownTypesDoNotCount(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"escrow_in", int64(10_000_000), int64(2)},
		[]any{"brd_payment", int64(500_000), int64(5)},
		[]any{"prd_payment", int64(1_000_000), int64(3)},
		[]any{"revision_fee", int64(250_000), int64(4)},
		[]any{"talent_placement_fee", int64(2_000_000), int64(1)},
		[]any{"refund", int64(3_000_000), int64(1)},
		[]any{"partial_refund", int64(500_000), int64(2)},
		// Not revenue and not a refund: an internal movement.
		[]any{"escrow_release", int64(9_000_000), int64(6)},
	)}}
	s := &DashboardStore{pool: p}

	got, err := s.GetRevenueStats(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	const wantTotal = 10_000_000 + 500_000 + 1_000_000 + 250_000 + 2_000_000 - 3_000_000 - 500_000
	if got.TotalRevenue != wantTotal {
		t.Errorf("TotalRevenue = %d, want %d", got.TotalRevenue, wantTotal)
	}
	// escrow_release must be visible but must not move the total.
	if e, ok := got.Breakdown["escrow_release"]; !ok || e.Amount != 9_000_000 || e.Count != 6 {
		t.Errorf("breakdown[escrow_release] = %+v, want the row reported verbatim", e)
	}
	if len(got.Breakdown) != 8 {
		t.Errorf("breakdown has %d entries, want 8 (every row reported)", len(got.Breakdown))
	}
	if got.Breakdown["brd_payment"].Count != 5 {
		t.Errorf("brd_payment count = %d, want 5", got.Breakdown["brd_payment"].Count)
	}
}

// Refunds exceeding revenue must show negative rather than clamp, or a bad
// month would read as break-even.
func TestGetRevenueStats_CanGoNegative(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"brd_payment", int64(100_000), int64(1)},
		[]any{"refund", int64(500_000), int64(1)},
	)}}}

	got, err := s.GetRevenueStats(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.TotalRevenue != -400_000 {
		t.Errorf("TotalRevenue = %d, want -400000", got.TotalRevenue)
	}
}

func TestGetRevenueStats_NoRowsIsZeroNotNil(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{rowsResult()}}}

	got, err := s.GetRevenueStats(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.TotalRevenue != 0 {
		t.Errorf("TotalRevenue = %d, want 0", got.TotalRevenue)
	}
	if got.Breakdown == nil {
		t.Error("Breakdown is nil; it would serialise as null")
	}
}

// A date range must reach the query as two bound parameters, not be dropped.
func TestGetRevenueStats_DateRangeIsApplied(t *testing.T) {
	from := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)

	p := &stubPool{queryQueue: []queryResult{rowsResult()}}
	s := &DashboardStore{pool: p}

	if _, err := s.GetRevenueStats(context.Background(), &DateRange{From: from, To: to}); err != nil {
		t.Fatalf("error = %v", err)
	}

	sql := p.sqlSeen[0]
	if !strings.Contains(sql, "created_at >= $1") || !strings.Contains(sql, "created_at <= $2") {
		t.Errorf("sql does not bind the range: %s", sql)
	}
	args := p.lastArgs()
	if len(args) != 2 || args[0] != from || args[1] != to {
		t.Errorf("args = %v, want [%v %v]", args, from, to)
	}

	// Without a range the query must take no parameters at all.
	p2 := &stubPool{queryQueue: []queryResult{rowsResult()}}
	s2 := &DashboardStore{pool: p2}
	if _, err := s2.GetRevenueStats(context.Background(), nil); err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := p2.lastArgs(); len(got) != 0 {
		t.Errorf("args = %v, want none without a date range", got)
	}
	if strings.Contains(p2.sqlSeen[0], "created_at >=") {
		t.Errorf("sql binds a range that was not given: %s", p2.sqlSeen[0])
	}
}

func TestGetRevenueStats_Failures(t *testing.T) {
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
			s := &DashboardStore{pool: tt.pool}
			if _, err := s.GetRevenueStats(context.Background(), nil); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// Utilization is active/total truncated to two places, and the ratio must not
// divide by zero when there are no talents at all.
func TestGetTalentStats_UtilizationArithmetic(t *testing.T) {
	tests := []struct {
		name            string
		tiers           [][]any
		active          int64
		avgRating       float64
		wantTotal       int64
		wantUtilization float64
		wantRating      float64
	}{
		{
			name:            "one in three is truncated to 0.33",
			tiers:           [][]any{{"junior", int64(1)}, {"mid", int64(1)}, {"senior", int64(1)}},
			active:          1,
			avgRating:       4.666,
			wantTotal:       3,
			wantUtilization: 0.33, // 0.3333 truncates down, it does not round to 0.34
			wantRating:      4.66, // likewise
		},
		{
			name:            "two in three",
			tiers:           [][]any{{"junior", int64(2)}, {"mid", int64(1)}},
			active:          2,
			avgRating:       3.999,
			wantTotal:       3,
			wantUtilization: 0.66,
			wantRating:      3.99,
		},
		{
			name:            "fully utilised",
			tiers:           [][]any{{"senior", int64(4)}},
			active:          4,
			avgRating:       5,
			wantTotal:       4,
			wantUtilization: 1,
			wantRating:      5,
		},
		{
			name:            "no talents at all",
			tiers:           nil,
			active:          0,
			avgRating:       0,
			wantTotal:       0,
			wantUtilization: 0, // must not be NaN from a zero divisor
			wantRating:      0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{
				queryQueue: []queryResult{rowsResult(tt.tiers...)},
				rowQueue: []pgx.Row{
					stubRow{values: []any{tt.active}},
					stubRow{values: []any{tt.avgRating}},
				},
			}
			s := &DashboardStore{pool: p}

			got, err := s.GetTalentStats(context.Background())
			if err != nil {
				t.Fatalf("error = %v", err)
			}
			if got.TotalTalents != tt.wantTotal {
				t.Errorf("TotalTalents = %d, want %d", got.TotalTalents, tt.wantTotal)
			}
			if got.ActiveTalents != tt.active {
				t.Errorf("ActiveTalents = %d, want %d", got.ActiveTalents, tt.active)
			}
			if got.UtilizationRate != tt.wantUtilization {
				t.Errorf("UtilizationRate = %v, want %v", got.UtilizationRate, tt.wantUtilization)
			}
			if got.AverageRating != tt.wantRating {
				t.Errorf("AverageRating = %v, want %v", got.AverageRating, tt.wantRating)
			}
			if got.TotalTalents == 0 && got.UtilizationRate != got.UtilizationRate {
				t.Error("UtilizationRate is NaN")
			}
		})
	}
}

// The tier map is the distribution the admin panel charts.
func TestGetTalentStats_TierDistribution(t *testing.T) {
	p := &stubPool{
		queryQueue: []queryResult{rowsResult(
			[]any{"junior", int64(10)},
			[]any{"mid", int64(6)},
			[]any{"senior", int64(4)},
		)},
		rowQueue: []pgx.Row{
			stubRow{values: []any{int64(5)}},
			stubRow{values: []any{4.25}},
		},
	}
	s := &DashboardStore{pool: p}

	got, err := s.GetTalentStats(context.Background())
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	want := map[string]int64{"junior": 10, "mid": 6, "senior": 4}
	for tier, n := range want {
		if got.TierDistribution[tier] != n {
			t.Errorf("tier %q = %d, want %d", tier, got.TierDistribution[tier], n)
		}
	}
	// The total is the sum of the tiers, not a separate count.
	if got.TotalTalents != 20 {
		t.Errorf("TotalTalents = %d, want 20 (the sum of the tiers)", got.TotalTalents)
	}
	if got.UtilizationRate != 0.25 {
		t.Errorf("UtilizationRate = %v, want 0.25", got.UtilizationRate)
	}
}

func TestGetTalentStats_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"tier query fails", &stubPool{queryQueue: []queryResult{errResult(sentinel)}}},
		{"tier scan fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}},
		}}},
		{"tier iteration fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{iterErr: sentinel}},
		}}},
		{"active count fails", &stubPool{
			queryQueue: []queryResult{rowsResult([]any{"mid", int64(1)})},
			rowQueue:   []pgx.Row{stubRow{err: sentinel}},
		}},
		{"average rating fails", &stubPool{
			queryQueue: []queryResult{rowsResult([]any{"mid", int64(1)})},
			rowQueue: []pgx.Row{
				stubRow{values: []any{int64(1)}},
				stubRow{err: sentinel},
			},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DashboardStore{pool: tt.pool}
			if _, err := s.GetTalentStats(context.Background()); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

func TestGetDailyRevenue(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{rowsResult(
		[]any{"2026-07-01", int64(100), int64(200), int64(300), int64(50), int64(650)},
		[]any{"2026-07-02", int64(0), int64(0), int64(0), int64(0), int64(0)},
	)}}
	s := &DashboardStore{pool: p}

	got, err := s.GetDailyRevenue(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("points = %d, want 2", len(got))
	}
	if got[0].Date != "2026-07-01" {
		t.Errorf("date = %q, want the date-only form the chart axis expects", got[0].Date)
	}
	if got[0].BrdRevenue != 100 || got[0].PrdRevenue != 200 ||
		got[0].MarginRevenue != 300 || got[0].RevisionFee != 50 || got[0].TotalRevenue != 650 {
		t.Errorf("point = %+v, columns are scanned out of order", got[0])
	}
	// Zero days must be kept, or the chart joins sparse points into a slope
	// that was never there.
	if got[1].TotalRevenue != 0 || got[1].Date != "2026-07-02" {
		t.Errorf("zero day = %+v, want it preserved", got[1])
	}
}

// With no range the window defaults to the last 30 days.
func TestGetDailyRevenue_DefaultWindowIsThirtyDays(t *testing.T) {
	tests := []struct {
		name string
		dr   *DateRange
	}{
		{"nil range", nil},
		{"zero from", &DateRange{To: time.Now()}},
		{"zero to", &DateRange{From: time.Now()}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{queryQueue: []queryResult{rowsResult()}}
			s := &DashboardStore{pool: p}

			if _, err := s.GetDailyRevenue(context.Background(), tt.dr); err != nil {
				t.Fatalf("error = %v", err)
			}

			args := p.lastArgs()
			if len(args) != 2 {
				t.Fatalf("args = %v, want from and to", args)
			}
			from, ok := args[0].(time.Time)
			if !ok {
				t.Fatalf("from = %T, want time.Time", args[0])
			}
			to := args[1].(time.Time)
			days := to.Sub(from).Hours() / 24
			if days < 28 || days > 30 {
				t.Errorf("window = %.1f days, want ~29 (30 inclusive days)", days)
			}
		})
	}
}

func TestGetDailyRevenue_ExplicitRangeIsUsed(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)

	p := &stubPool{queryQueue: []queryResult{rowsResult()}}
	s := &DashboardStore{pool: p}

	if _, err := s.GetDailyRevenue(context.Background(), &DateRange{From: from, To: to}); err != nil {
		t.Fatalf("error = %v", err)
	}
	args := p.lastArgs()
	if args[0] != from || args[1] != to {
		t.Errorf("args = %v, want the supplied range", args)
	}
}

func TestGetDailyRevenue_EmptyResultIsNotNil(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{rowsResult()}}}
	got, err := s.GetDailyRevenue(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got == nil {
		t.Error("points is nil; it would serialise as null and break the chart")
	}
}

func TestGetDailyRevenue_Failures(t *testing.T) {
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
			s := &DashboardStore{pool: tt.pool}
			if _, err := s.GetDailyRevenue(context.Background(), nil); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

// Failed AI calls report zero tokens. Averaging over all calls instead of over
// successes would drag the figure toward zero and misreport model cost.
func TestGetAiUsage_AverageExcludesFailedCalls(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{
		// Daily series.
		rowsResult([]any{"2026-07-01", 0.5, int64(2), int64(1000)}),
		// Per-model: 2 requests, 1 success carrying all 1000 tokens.
		rowsResult([]any{"gemini-2.5-flash", int64(2), int64(600), int64(400), 0.5, int64(1000), int64(1)}),
	}}
	s := &DashboardStore{pool: p}

	got, err := s.GetAiUsage(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.AvgTokensPerSuccess != 1000 {
		t.Errorf("AvgTokensPerSuccess = %v, want 1000 (averaging over both calls would give 500)", got.AvgTokensPerSuccess)
	}
	if got.TotalRequests != 2 {
		t.Errorf("TotalRequests = %d, want 2 (failures still count as requests)", got.TotalRequests)
	}
	if got.TotalCostUsd != 0.5 {
		t.Errorf("TotalCostUsd = %v, want 0.5", got.TotalCostUsd)
	}
}

// No successful call at all must be zero, not a divide by zero.
func TestGetAiUsage_NoSuccessesIsZeroNotNaN(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{
		rowsResult(),
		rowsResult([]any{"gemini-2.5-flash", int64(3), int64(0), int64(0), 0.0, int64(0), int64(0)}),
	}}}

	got, err := s.GetAiUsage(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.AvgTokensPerSuccess != 0 {
		t.Errorf("AvgTokensPerSuccess = %v, want 0", got.AvgTokensPerSuccess)
	}
	if got.AvgTokensPerSuccess != got.AvgTokensPerSuccess {
		t.Error("AvgTokensPerSuccess is NaN")
	}
}

// The average truncates to two places like the other dashboard figures.
func TestGetAiUsage_AverageTruncatesToTwoPlaces(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{
		rowsResult(),
		// 1000 tokens over 3 successes = 333.333...
		rowsResult([]any{"m", int64(3), int64(0), int64(0), 0.0, int64(1000), int64(3)}),
	}}}

	got, err := s.GetAiUsage(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.AvgTokensPerSuccess != 333.33 {
		t.Errorf("AvgTokensPerSuccess = %v, want 333.33", got.AvgTokensPerSuccess)
	}
}

// Totals sum across every model, so a new model needs no code change.
func TestGetAiUsage_TotalsSumAcrossModels(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{
		rowsResult(
			[]any{"2026-07-01", 0.25, int64(4), int64(800)},
			[]any{"2026-07-02", 0.75, int64(6), int64(1200)},
		),
		rowsResult(
			[]any{"gemini-2.5-flash", int64(6), int64(600), int64(400), 0.6, int64(1000), int64(5)},
			[]any{"gemini-embedding-001", int64(4), int64(200), int64(0), 0.4, int64(200), int64(4)},
		),
	}}}

	got, err := s.GetAiUsage(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got.ByModel) != 2 {
		t.Fatalf("models = %d, want 2", len(got.ByModel))
	}
	if got.TotalRequests != 10 {
		t.Errorf("TotalRequests = %d, want 10", got.TotalRequests)
	}
	if got.TotalCostUsd < 0.999 || got.TotalCostUsd > 1.001 {
		t.Errorf("TotalCostUsd = %v, want ~1.0", got.TotalCostUsd)
	}
	// 1200 success tokens over 9 successes.
	if got.AvgTokensPerSuccess != 133.33 {
		t.Errorf("AvgTokensPerSuccess = %v, want 133.33", got.AvgTokensPerSuccess)
	}
	if len(got.DailyCost) != 2 {
		t.Errorf("daily points = %d, want 2", len(got.DailyCost))
	}
	if got.DailyCost[0].Tokens != 800 {
		t.Errorf("daily tokens = %d, want 800", got.DailyCost[0].Tokens)
	}
}

func TestGetAiUsage_DefaultWindowIsThirtyDays(t *testing.T) {
	p := &stubPool{queryQueue: []queryResult{rowsResult(), rowsResult()}}
	s := &DashboardStore{pool: p}

	if _, err := s.GetAiUsage(context.Background(), nil); err != nil {
		t.Fatalf("error = %v", err)
	}

	args := p.argsSeen[0]
	from := args[0].(time.Time)
	to := args[1].(time.Time)
	if days := to.Sub(from).Hours() / 24; days < 28 || days > 30 {
		t.Errorf("window = %.1f days, want ~29", days)
	}
	// Both queries must cover the same window, or the totals and the series
	// would describe different periods.
	if p.argsSeen[1][0] != args[0] || p.argsSeen[1][1] != args[1] {
		t.Errorf("the model query uses a different window: %v vs %v", p.argsSeen[1], args)
	}
}

func TestGetAiUsage_EmptyResultsAreNotNil(t *testing.T) {
	s := &DashboardStore{pool: &stubPool{queryQueue: []queryResult{rowsResult(), rowsResult()}}}

	got, err := s.GetAiUsage(context.Background(), nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got.DailyCost == nil || got.ByModel == nil {
		t.Error("empty slices are nil; they would serialise as null")
	}
}

func TestGetAiUsage_Failures(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name string
		pool *stubPool
	}{
		{"daily query fails", &stubPool{queryQueue: []queryResult{errResult(sentinel)}}},
		{"daily scan fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}},
		}}},
		{"daily iteration fails", &stubPool{queryQueue: []queryResult{
			{rows: &stubRows{iterErr: sentinel}},
		}}},
		{"model query fails", &stubPool{queryQueue: []queryResult{
			rowsResult(), errResult(sentinel),
		}}},
		{"model scan fails", &stubPool{queryQueue: []queryResult{
			rowsResult(),
			{rows: &stubRows{rows: [][]any{{}}, scanErr: sentinel}},
		}}},
		{"model iteration fails", &stubPool{queryQueue: []queryResult{
			rowsResult(),
			{rows: &stubRows{iterErr: sentinel}},
		}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &DashboardStore{pool: tt.pool}
			if _, err := s.GetAiUsage(context.Background(), nil); !errors.Is(err, sentinel) {
				t.Errorf("error = %v, want %v", err, sentinel)
			}
		})
	}
}

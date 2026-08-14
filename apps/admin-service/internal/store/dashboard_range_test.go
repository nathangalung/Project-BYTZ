package store

import (
	"context"
	"testing"
	"time"
)

// An explicit range must replace the default 30-day window, not sit alongside
// it. GetAiUsage always binds two parameters, so a dropped override is
// invisible in the SQL and shows up only as a chart that ignores the dates the
// admin picked.
func TestGetAiUsage_ExplicitRangeOverridesTheDefaultWindow(t *testing.T) {
	from := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC)

	p := &stubPool{queryQueue: []queryResult{rowsResult(), rowsResult()}}
	s := &DashboardStore{pool: p}

	if _, err := s.GetAiUsage(context.Background(), &DateRange{From: from, To: to}); err != nil {
		t.Fatalf("error = %v", err)
	}

	args := p.argsSeen[0]
	if len(args) != 2 {
		t.Fatalf("args = %v, want two bounds", args)
	}
	if args[0] != from || args[1] != to {
		t.Errorf("args = [%v %v], want [%v %v]; the requested range was discarded", args[0], args[1], from, to)
	}
}

// A partial range is not a range. Taking a zero From would query from year one
// and scan the whole table.
func TestGetAiUsage_PartialRangeFallsBackToTheDefaultWindow(t *testing.T) {
	tests := []struct {
		name string
		dr   *DateRange
	}{
		{"nil", nil},
		{"zero from", &DateRange{To: time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC)}},
		{"zero to", &DateRange{From: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &stubPool{queryQueue: []queryResult{rowsResult(), rowsResult()}}
			s := &DashboardStore{pool: p}

			if _, err := s.GetAiUsage(context.Background(), tt.dr); err != nil {
				t.Fatalf("error = %v", err)
			}

			args := p.argsSeen[0]
			if len(args) != 2 {
				t.Fatalf("args = %v, want two bounds", args)
			}
			from, ok := args[0].(time.Time)
			if !ok {
				t.Fatalf("first bound = %T, want time.Time", args[0])
			}
			if from.IsZero() {
				t.Fatal("fell back to the zero time, which scans the whole table")
			}
			if age := time.Since(from); age < 28*24*time.Hour || age > 31*24*time.Hour {
				t.Errorf("default window starts %v ago, want roughly 29 days", age)
			}
		})
	}
}

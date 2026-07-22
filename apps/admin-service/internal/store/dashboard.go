package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DateRange struct {
	From time.Time
	To   time.Time
}

type RevenueBreakdownEntry struct {
	Amount int64 `json:"amount"`
	Count  int64 `json:"count"`
}

type RevenueStats struct {
	TotalRevenue int64                            `json:"totalRevenue"`
	Breakdown    map[string]RevenueBreakdownEntry `json:"breakdown"`
}

type DailyRevenuePoint struct {
	Date          string `json:"date"`
	BrdRevenue    int64  `json:"brdRevenue"`
	PrdRevenue    int64  `json:"prdRevenue"`
	MarginRevenue int64  `json:"marginRevenue"`
	RevisionFee   int64  `json:"revisionFee"`
	TotalRevenue  int64  `json:"totalRevenue"`
}

type TalentStats struct {
	TotalTalents     int64            `json:"totalTalents"`
	TierDistribution map[string]int64 `json:"tierDistribution"`
	ActiveTalents    int64            `json:"activeTalents"`
	UtilizationRate  float64          `json:"utilizationRate"`
	AverageRating    float64          `json:"averageRating"`
}

type DashboardStore struct {
	pool *pgxpool.Pool
}

func NewDashboardStore(pool *pgxpool.Pool) *DashboardStore {
	return &DashboardStore{pool: pool}
}

// GetProjectStats returns project count grouped by status, excluding soft-deleted.
func (s *DashboardStore) GetProjectStats(ctx context.Context) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT status, COUNT(*) AS cnt
		 FROM projects
		 WHERE deleted_at IS NULL
		 GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make(map[string]int64)
	for rows.Next() {
		var status string
		var cnt int64
		if err := rows.Scan(&status, &cnt); err != nil {
			return nil, err
		}
		stats[status] = cnt
	}
	return stats, rows.Err()
}

// GetRevenueStats returns total revenue and per-type breakdown.
func (s *DashboardStore) GetRevenueStats(ctx context.Context, dr *DateRange) (*RevenueStats, error) {
	query := `SELECT type, COALESCE(SUM(amount), 0)::bigint AS total_amount, COUNT(*) AS cnt
		FROM transactions
		WHERE status = 'completed' AND deleted_at IS NULL`
	args := []any{}
	argIdx := 1

	if dr != nil {
		query += ` AND created_at >= $` + itoa(argIdx)
		args = append(args, dr.From)
		argIdx++
		query += ` AND created_at <= $` + itoa(argIdx)
		args = append(args, dr.To)
		argIdx++
	}
	_ = argIdx

	query += ` GROUP BY type`

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	revenueTypes := map[string]bool{
		"escrow_in":            true,
		"brd_payment":          true,
		"prd_payment":          true,
		"revision_fee":         true,
		"talent_placement_fee": true,
	}
	refundTypes := map[string]bool{
		"refund":         true,
		"partial_refund": true,
	}

	var totalRevenue int64
	breakdown := make(map[string]RevenueBreakdownEntry)

	for rows.Next() {
		var txType string
		var amount, cnt int64
		if err := rows.Scan(&txType, &amount, &cnt); err != nil {
			return nil, err
		}
		if revenueTypes[txType] {
			totalRevenue += amount
		}
		if refundTypes[txType] {
			totalRevenue -= amount
		}
		breakdown[txType] = RevenueBreakdownEntry{Amount: amount, Count: cnt}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &RevenueStats{TotalRevenue: totalRevenue, Breakdown: breakdown}, nil
}

// GetTalentStats returns talent distribution, utilization, and average rating.
func (s *DashboardStore) GetTalentStats(ctx context.Context) (*TalentStats, error) {
	// Tier distribution
	rows, err := s.pool.Query(ctx,
		`SELECT tier, COUNT(*) AS cnt FROM talent_profiles WHERE tier IS NOT NULL GROUP BY tier`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tierDist := make(map[string]int64)
	var totalTalents int64
	for rows.Next() {
		var tier string
		var cnt int64
		if err := rows.Scan(&tier, &cnt); err != nil {
			return nil, err
		}
		tierDist[tier] = cnt
		totalTalents += cnt
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Active talents (with active projects)
	var activeTalents int64
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM talent_profiles WHERE total_projects_active > 0`).
		Scan(&activeTalents)
	if err != nil {
		return nil, err
	}

	var utilizationRate float64
	if totalTalents > 0 {
		utilizationRate = float64(activeTalents) / float64(totalTalents)
		// Round to 2 decimal places
		utilizationRate = float64(int64(utilizationRate*100)) / 100
	}

	// Average rating
	var avgRating float64
	err = s.pool.QueryRow(ctx,
		`SELECT COALESCE(AVG(average_rating), 0)::float8 FROM talent_profiles WHERE average_rating IS NOT NULL`).
		Scan(&avgRating)
	if err != nil {
		return nil, err
	}
	avgRating = float64(int64(avgRating*100)) / 100

	return &TalentStats{
		TotalTalents:     totalTalents,
		TierDistribution: tierDist,
		ActiveTalents:    activeTalents,
		UtilizationRate:  utilizationRate,
		AverageRating:    avgRating,
	}, nil
}

// GetDailyRevenue returns a daily revenue time series aggregated live from
// transactions and projects.
//
// It used to read mv_revenue_daily, and its comment claimed a fallback to
// "direct transactions aggregation if the materialized view is empty" - no such
// fallback existed. mv_revenue_daily is also not a materialized view: Drizzle
// cannot express one, so migration 0000 created a plain TABLE with that name,
// nothing ever inserts into it, and REFRESH MATERIALIZED VIEW would error on a
// table. Every revenue figure on the admin dashboard was therefore zero.
//
// generate_series keeps the series continuous so a chart renders zero-days
// instead of joining sparse points into a misleading slope. The LATERAL
// subqueries each return exactly one aggregate row, so joining two of them
// cannot multiply days.
//
// project_margin_revenue reads projects.platform_fee, attributed to the day the
// project was created.
//
// generate_series returns timestamptz, not date, so day is cast explicitly
// everywhere: ::date::text yields "2026-07-19" rather than
// "2026-07-19 00:00:00+00", which is what the chart's date axis expects and
// what the previous mv_revenue_daily query returned.
func (s *DashboardStore) GetDailyRevenue(ctx context.Context, dr *DateRange) ([]DailyRevenuePoint, error) {
	from := time.Now().AddDate(0, 0, -29)
	to := time.Now()
	if dr != nil && !dr.From.IsZero() && !dr.To.IsZero() {
		from = dr.From
		to = dr.To
	}

	rows, err := s.pool.Query(ctx,
		`SELECT d.day::date::text,
		        tx.brd,
		        tx.prd,
		        pr.margin,
		        tx.revision,
		        tx.brd + tx.prd + pr.margin + tx.revision
		 FROM generate_series($1::date, $2::date, interval '1 day') AS d(day)
		 LEFT JOIN LATERAL (
		   SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'brd_payment'), 0)::bigint   AS brd,
		          COALESCE(SUM(amount) FILTER (WHERE type = 'prd_payment'), 0)::bigint   AS prd,
		          COALESCE(SUM(amount) FILTER (WHERE type = 'revision_fee'), 0)::bigint  AS revision
		   FROM transactions
		   WHERE created_at::date = d.day::date
		     AND status = 'completed'
		     AND deleted_at IS NULL
		 ) tx ON TRUE
		 LEFT JOIN LATERAL (
		   SELECT COALESCE(SUM(platform_fee), 0)::bigint AS margin
		   FROM projects
		   WHERE created_at::date = d.day::date
		     AND deleted_at IS NULL
		 ) pr ON TRUE
		 ORDER BY d.day ASC`,
		from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]DailyRevenuePoint, 0)
	for rows.Next() {
		var p DailyRevenuePoint
		if err := rows.Scan(&p.Date, &p.BrdRevenue, &p.PrdRevenue, &p.MarginRevenue, &p.RevisionFee, &p.TotalRevenue); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

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
	TotalRevenue int64                        `json:"totalRevenue"`
	Breakdown    map[string]RevenueBreakdownEntry `json:"breakdown"`
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

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

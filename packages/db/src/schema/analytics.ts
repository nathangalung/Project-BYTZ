import { date, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core'

// Materialized views defined as regular tables for schema reference
// Actual materialized views created via SQL migration with pg_cron refresh

export const mvProjectOverview = pgTable('mv_project_overview', {
  id: integer('id').primaryKey().default(1),
  totalProjectsByStatus: jsonb('total_projects_by_status'),
  conversionFunnel: jsonb('conversion_funnel'),
  avgCompletionDays: real('avg_completion_days'),
  totalRevenue: integer('total_revenue'),
  revenueThisMonth: integer('revenue_this_month'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

export const mvRevenueDaily = pgTable('mv_revenue_daily', {
  date: date('date').primaryKey(),
  brdRevenue: integer('brd_revenue').default(0),
  prdRevenue: integer('prd_revenue').default(0),
  projectMarginRevenue: integer('project_margin_revenue').default(0),
  revisionFeeRevenue: integer('revision_fee_revenue').default(0),
  totalRevenue: integer('total_revenue').default(0),
  projectCount: integer('project_count').default(0),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

export const mvWorkerStats = pgTable('mv_worker_stats', {
  id: integer('id').primaryKey().default(1),
  totalWorkers: integer('total_workers'),
  workersByTier: jsonb('workers_by_tier'),
  avgProjectsPerWorker: real('avg_projects_per_worker'),
  avgRating: real('avg_rating'),
  utilizationRate: real('utilization_rate'),
  distributionGini: real('distribution_gini'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

export const mvMatchingMetrics = pgTable('mv_matching_metrics', {
  id: integer('id').primaryKey().default(1),
  avgTimeToMatchHours: real('avg_time_to_match_hours'),
  matchSuccessRate: real('match_success_rate'),
  explorationRatio: real('exploration_ratio'),
  totalMatchesThisMonth: integer('total_matches_this_month'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

export const mvAiCost = pgTable('mv_ai_cost', {
  date: date('date').primaryKey(),
  model: text('model'),
  totalRequests: integer('total_requests'),
  totalTokens: integer('total_tokens'),
  totalCostUsd: real('total_cost_usd'),
  avgLatencyMs: integer('avg_latency_ms'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

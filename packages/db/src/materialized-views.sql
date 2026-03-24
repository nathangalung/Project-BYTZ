-- Materialized views for admin dashboard analytics
-- Refresh every 5 minutes via pg_cron

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_project_overview AS
SELECT
  jsonb_object_agg(status, cnt) AS total_projects_by_status,
  jsonb_build_object(
    'brd_generated', COALESCE(SUM(cnt) FILTER (WHERE status = 'brd_generated'), 0),
    'prd_generated', COALESCE(SUM(cnt) FILTER (WHERE status = 'prd_generated'), 0),
    'in_progress', COALESCE(SUM(cnt) FILTER (WHERE status = 'in_progress'), 0),
    'completed', COALESCE(SUM(cnt) FILTER (WHERE status = 'completed'), 0)
  ) AS conversion_funnel,
  (SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400) FROM projects WHERE status = 'completed' AND deleted_at IS NULL) AS avg_completion_days,
  (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND type IN ('brd_payment', 'prd_payment', 'escrow_release')) AS total_revenue,
  (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND type IN ('brd_payment', 'prd_payment', 'escrow_release') AND created_at >= date_trunc('month', CURRENT_DATE)) AS revenue_this_month,
  NOW() AS refreshed_at
FROM (SELECT status, COUNT(*) AS cnt FROM projects WHERE deleted_at IS NULL GROUP BY status) sub;

CREATE UNIQUE INDEX IF NOT EXISTS mv_project_overview_idx ON mv_project_overview (refreshed_at);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_revenue_daily AS
SELECT
  date_trunc('day', t.created_at)::date AS date,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'brd_payment'), 0) AS brd_revenue,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'prd_payment'), 0) AS prd_revenue,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'escrow_release'), 0) AS project_margin_revenue,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'revision_fee'), 0) AS revision_fee_revenue,
  COALESCE(SUM(t.amount), 0) AS total_revenue,
  COUNT(DISTINCT t.project_id) AS project_count,
  NOW() AS refreshed_at
FROM transactions t
WHERE t.status = 'completed'
AND t.type IN ('brd_payment', 'prd_payment', 'escrow_release', 'revision_fee')
GROUP BY date_trunc('day', t.created_at)::date;

CREATE UNIQUE INDEX IF NOT EXISTS mv_revenue_daily_idx ON mv_revenue_daily (date);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_talent_stats AS
SELECT
  COUNT(*) AS total_talents,
  jsonb_object_agg(COALESCE(tier, 'unset'), tier_cnt) AS talents_by_tier,
  AVG(total_projects_completed)::float AS avg_projects_per_talent,
  AVG(average_rating)::float AS avg_rating,
  (COUNT(*) FILTER (WHERE total_projects_active > 0))::float / GREATEST(COUNT(*), 1) AS utilization_rate,
  NOW() AS refreshed_at
FROM (
  SELECT tier, total_projects_completed, total_projects_active, average_rating,
    COUNT(*) OVER (PARTITION BY tier) AS tier_cnt
  FROM talent_profiles
) sub;

CREATE UNIQUE INDEX IF NOT EXISTS mv_talent_stats_idx ON mv_talent_stats (refreshed_at);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_matching_metrics AS
SELECT
  0::float AS avg_time_to_match_hours,
  0::float AS match_success_rate,
  0.30::float AS exploration_ratio,
  (SELECT COUNT(*) FROM project_assignments WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS total_matches_this_month,
  NOW() AS refreshed_at;

CREATE UNIQUE INDEX IF NOT EXISTS mv_matching_metrics_idx ON mv_matching_metrics (refreshed_at);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ai_cost AS
SELECT
  date_trunc('day', ai.created_at)::date AS date,
  ai.model,
  COUNT(*) AS total_requests,
  SUM(ai.prompt_tokens + ai.completion_tokens) AS total_tokens,
  SUM(ai.cost_usd::float) AS total_cost_usd,
  AVG(ai.latency_ms)::integer AS avg_latency_ms,
  NOW() AS refreshed_at
FROM ai_interactions ai
WHERE ai.status = 'success'
GROUP BY date_trunc('day', ai.created_at)::date, ai.model;

CREATE UNIQUE INDEX IF NOT EXISTS mv_ai_cost_idx ON mv_ai_cost (date, model);

-- pg_cron schedule (run this manually once pg_cron is enabled)
-- SELECT cron.schedule('refresh-mvs', '*/5 * * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_project_overview;
--     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_daily;
--     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_talent_stats;
--     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_matching_metrics;
--     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ai_cost;$$
-- );

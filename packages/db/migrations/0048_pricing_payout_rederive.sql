-- Re-derive stored project money from final_price under the CURRENT bracket table.
--
-- Migration 0047 shipped alongside the repricing in #62, which replaced the
-- bracket table in packages/shared/src/pricing.ts (talent shares 0.8725 down to
-- 0.5475 over eight bands) with the current one (0.92 down to 0.68 over nine).
-- The engines moved; the rows did not. Every project priced before that change
-- still carries the talent_payout the OLD table produced, and
-- ProjectPayoutMatchesBracket in payment-service re-checks the stored payout
-- against what the published table brackets final_price to:
--
--   talentPayout == ProjectTalentPayout(finalPrice)
--
-- so it now rejects the release of every milestone on every pre-#62 project,
-- and the hourly auto-release sweep fails on all of them. Nothing else
-- re-checks those numbers once a PRD has been priced, which is why the drift
-- surfaced as a settlement outage rather than as a pricing discrepancy.
--
-- This re-derives the money instead of patching the checker, because
-- final_price is the primitive the table keys on and the stored split is
-- derived data. The arithmetic below is projectTalentPayout: MARGINAL per band,
-- each slice of the price paid at the share of the band it falls in, the way
-- income tax brackets work. platform_fee is the difference rather than a second
-- bracket lookup, so final_price = talent_payout + platform_fee holds by
-- construction and projects_price_split (migration 0029) cannot be tripped.
--
-- Verified, not assumed: the expression below was run against
-- projectTalentPayout over 46,609 prices - every residue mod 100 inside each
-- band at eight magnitudes, which covers every rounding tie the two-decimal
-- shares can produce, plus both sides of each band edge and 40,000 random
-- prices up to 300 juta. Zero divergence. Exact `numeric` is what makes that
-- hold: only the final partial band contributes a fraction, because every whole
-- band contributes a round number of rupiah.
--
-- Both statements are guarded on the value actually changing, so re-running
-- this file touches nothing. It is written to be safe to replay by hand if a
-- restored snapshot predates it; drizzle itself applies it once.
SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
WITH repriced AS (
  SELECT
    p.id,
    round(
        0.92 * LEAST(GREATEST(p.final_price, 0), 3000000)
      + 0.89 * GREATEST(LEAST(p.final_price, 5000000) - 3000000, 0)
      + 0.86 * GREATEST(LEAST(p.final_price, 10000000) - 5000000, 0)
      + 0.83 * GREATEST(LEAST(p.final_price, 15000000) - 10000000, 0)
      + 0.80 * GREATEST(LEAST(p.final_price, 20000000) - 15000000, 0)
      + 0.77 * GREATEST(LEAST(p.final_price, 30000000) - 20000000, 0)
      + 0.74 * GREATEST(LEAST(p.final_price, 50000000) - 30000000, 0)
      + 0.71 * GREATEST(LEAST(p.final_price, 100000000) - 50000000, 0)
      + 0.68 * GREATEST(p.final_price - 100000000, 0)
    )::integer AS payout
  FROM "projects" p
  WHERE p.final_price IS NOT NULL
)
UPDATE "projects" p
SET talent_payout = r.payout,
    platform_fee = p.final_price - r.payout
FROM repriced r
WHERE r.id = p.id
  AND (
    p.talent_payout IS DISTINCT FROM r.payout
    OR p.platform_fee IS DISTINCT FROM p.final_price - r.payout
  );
--> statement-breakpoint
-- Re-allocate every work package to its share of the corrected project payout.
--
-- A package's payout is not bracketed on its own amount - the bracket keys on
-- the project total, or a 60 juta project split into four 15 juta packages
-- would pay the 15 juta rate. computeProjectPricing allocates pro rata at the
-- project's EFFECTIVE share (talent_payout / final_price, the marginal total
-- over the price, not any one band's rate) and hands the last priced package
-- the rounding remainder, so the packages sum to the project payout to the
-- rupiah. Milestone settlement divides by this per-package ratio and falls back
-- to the project one, so the two have to agree or a milestone settles at a rate
-- the project was never priced at.
--
-- The remainder goes on the last package only where sum(amount) = final_price,
-- which is the shape computeProjectPricing itself produces (it derives
-- finalPrice as the sum) and the shape every seeded project has. Where a
-- project's packages do not sum to its price there is no such remainder to
-- place - forcing one would push the whole difference onto a single package and
-- break the very ratio payment-service reads - so those packages take the plain
-- pro-rata share, which preserves it exactly.
--
-- The clamp keeps work_packages_payout_within_amount (migration 0029) true for
-- rows that predate it: an effective share is at most 0.92, so a package can
-- never be allocated more than it is worth.
WITH priced AS (
  SELECT p.id, p.final_price, p.talent_payout
  FROM "projects" p
  WHERE p.final_price IS NOT NULL AND p.final_price > 0 AND p.talent_payout IS NOT NULL
), allocated AS (
  SELECT
    w.id,
    w.project_id,
    w.amount,
    w.order_index,
    round(GREATEST(w.amount, 0)::numeric * pr.talent_payout / pr.final_price) AS base
  FROM "work_packages" w
  JOIN priced pr ON pr.id = w.project_id
), per_project AS (
  SELECT
    a.project_id,
    sum(a.base) AS base_total,
    sum(GREATEST(a.amount, 0)) AS gross,
    (array_agg(a.id ORDER BY a.order_index DESC, a.id DESC)
      FILTER (WHERE a.amount > 0))[1] AS last_priced_id
  FROM allocated a
  GROUP BY a.project_id
), rederived AS (
  SELECT
    a.id,
    LEAST(
      GREATEST(
        a.base + CASE
          WHEN a.id = g.last_priced_id AND g.gross = pr.final_price
          THEN pr.talent_payout - g.base_total
          ELSE 0
        END,
        0
      ),
      GREATEST(a.amount, 0)
    )::integer AS payout
  FROM allocated a
  JOIN per_project g ON g.project_id = a.project_id
  JOIN priced pr ON pr.id = a.project_id
)
UPDATE "work_packages" w
SET talent_payout = d.payout
FROM rederived d
WHERE d.id = w.id
  AND w.talent_payout IS DISTINCT FROM d.payout;

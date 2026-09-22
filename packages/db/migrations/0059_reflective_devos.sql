-- dispute_status: five values -> four. 'mediation' was 'under_review' twice.
--
-- A dispute sits at open, under_review, escalated or resolved. 'mediation' was
-- not a fifth place to stand: escrow was frozen the same way, the transition
-- was admin-only the same way, and the two exits were the same two. The whole
-- of its difference was that it sat between a case under review and a binding
-- decision, so reaching one took two admin clicks instead of one.
--
--   open         -> open
--   under_review -> under_review
--   mediation    -> under_review
--   escalated    -> escalated
--   resolved     -> resolved
--
-- The escalation edge moves with the literal: under_review now offers
-- 'escalated' directly, which is what keeps a binding decision reachable from
-- every row this collapses.
--
-- The three-phase Temporal workflow keeps its three phases and its three
-- `dispute.phase.*` events - the phase is a timer, the status is a position -
-- and phase 2 now writes the position phase 1 already wrote.
--
-- Hand-written. drizzle-kit renders a value-drop as a round trip through
-- `text` with a bare cast back, which fails on the first row holding
-- 'mediation'.
--
-- The CASE has no ELSE on purpose: the column is NOT NULL, so a value this
-- mapping does not name fails the migration instead of landing quietly in
-- 'open'.
--
-- `disputes` carries only its pkey - no index predicate and no CHECK names a
-- status literal - so nothing is dropped and recreated here. The default is of
-- the old type and blocks the swap, so it comes off first and goes back on
-- after the rename; 'open' is unaffected by the mapping.

ALTER TABLE "disputes" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

CREATE TYPE "public"."dispute_status_new" AS ENUM('open', 'under_review', 'resolved', 'escalated');--> statement-breakpoint

ALTER TABLE "disputes" ALTER COLUMN "status" SET DATA TYPE "public"."dispute_status_new" USING (CASE
  WHEN "status"::text = 'open' THEN 'open'
  WHEN "status"::text IN ('under_review', 'mediation') THEN 'under_review'
  WHEN "status"::text = 'escalated' THEN 'escalated'
  WHEN "status"::text = 'resolved' THEN 'resolved'
END)::"public"."dispute_status_new";--> statement-breakpoint

DROP TYPE "public"."dispute_status";--> statement-breakpoint
ALTER TYPE "public"."dispute_status_new" RENAME TO "dispute_status";--> statement-breakpoint

ALTER TABLE "disputes" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."dispute_status";

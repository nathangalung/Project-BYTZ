-- project_status: 18 values -> 9.
--
-- Hand-written. drizzle-kit renders a value-drop as a round trip through
-- `text` with a bare `::project_status` cast, which fails the moment a row
-- holds one of the nine dropped literals - which every production row at
-- brd_generated, matched, disputed and six others does. The mapping has to be
-- in the USING clause, and the disputed/on_hold rows have to be put back at
-- the position they were frozen at before the log table loses the literals
-- that say where that was. Order below is load-bearing.

--> statement-breakpoint
-- 1. The columns that take over from the dropped statuses.
ALTER TABLE "projects" ADD COLUMN "on_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "team_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prd_documents" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_status_logs" ADD COLUMN "from_status_legacy" text;--> statement-breakpoint
ALTER TABLE "project_status_logs" ADD COLUMN "to_status_legacy" text;--> statement-breakpoint

-- 2. Preserve the 18-value audit trail. Postgres cannot recover it after the
-- swap: brd_generated -> brd_approved collapses to brd_review -> brd_review.
UPDATE "project_status_logs" SET
  "from_status_legacy" = "from_status"::text,
  "to_status_legacy" = "to_status"::text;--> statement-breakpoint

-- 3. Put disputed and on_hold projects back at their real position. Reads the
-- from_status of the transition that froze them, so it must run while the log
-- still holds the old literals. Disputes first, then holds: a project put on
-- hold and then disputed resolves through both, in that order.
UPDATE "projects" p SET "status" = COALESCE((
  SELECT l."from_status"
  FROM "project_status_logs" l
  WHERE l."project_id" = p."id" AND l."to_status" = 'disputed'
  ORDER BY l."created_at" DESC
  LIMIT 1
), 'in_progress') WHERE p."status" = 'disputed';--> statement-breakpoint

UPDATE "projects" p SET
  "status" = COALESCE((
    SELECT l."from_status"
    FROM "project_status_logs" l
    WHERE l."project_id" = p."id" AND l."to_status" = 'on_hold'
    ORDER BY l."created_at" DESC
    LIMIT 1
  ), 'in_progress'),
  "on_hold_at" = now()
WHERE p."status" = 'on_hold';--> statement-breakpoint

-- A chain (on_hold -> disputed -> ...) can restore one frozen status from
-- another. Nothing outside the pair is reachable, so one sweep closes it.
UPDATE "projects" SET "status" = 'in_progress'
WHERE "status" IN ('disputed', 'on_hold');--> statement-breakpoint

-- 4. The two moments the collapse would otherwise erase, read from the log
-- while it still names them. matching/team_forming/matched become one status,
-- so "when the team completed" stops being derivable; prd_generated/approved/
-- purchased become one, so "when the owner approved the PRD" does too.
UPDATE "projects" p SET "team_completed_at" = (
  SELECT max(l."created_at")
  FROM "project_status_logs" l
  WHERE l."project_id" = p."id" AND l."to_status" = 'matched'
) WHERE EXISTS (
  SELECT 1 FROM "project_status_logs" l
  WHERE l."project_id" = p."id" AND l."to_status" = 'matched'
);--> statement-breakpoint

UPDATE "prd_documents" d SET "approved_at" = (
  SELECT max(l."created_at")
  FROM "project_status_logs" l
  WHERE l."project_id" = d."project_id" AND l."to_status" = 'prd_approved'
) WHERE EXISTS (
  SELECT 1 FROM "project_status_logs" l
  WHERE l."project_id" = d."project_id" AND l."to_status" = 'prd_approved'
);--> statement-breakpoint

-- Approval used to be recorded only as a project status. With the ladder
-- collapsed it lives on the document, so every project that got past the
-- approval gate needs its document to say so - otherwise the owner is asked
-- to approve a BRD they approved months ago.
UPDATE "brd_documents" d SET "status" = 'approved'
WHERE d."status" = 'review' AND EXISTS (
  SELECT 1 FROM "projects" p
  WHERE p."id" = d."project_id" AND p."status" IN (
    'brd_approved', 'brd_purchased', 'prd_generated', 'prd_approved',
    'prd_purchased', 'matching', 'team_forming', 'matched', 'in_progress',
    'partially_active', 'review', 'completed'
  )
);--> statement-breakpoint

UPDATE "prd_documents" d SET "status" = 'approved'
WHERE d."status" = 'review' AND EXISTS (
  SELECT 1 FROM "projects" p
  WHERE p."id" = d."project_id" AND p."status" IN (
    'prd_approved', 'prd_purchased', 'matching', 'team_forming', 'matched',
    'in_progress', 'partially_active', 'review', 'completed'
  )
);--> statement-breakpoint

-- 5. The partial index names status literals, so it cannot survive the swap.
DROP INDEX "idx_projects_browse";--> statement-breakpoint

-- 6. The swap itself.
CREATE TYPE "public"."project_status_new" AS ENUM('draft', 'scoping', 'brd_review', 'prd_review', 'matching', 'in_progress', 'final_review', 'completed', 'cancelled');--> statement-breakpoint

ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE "public"."project_status_new" USING (CASE "status"::text
  WHEN 'brd_generated' THEN 'brd_review'
  WHEN 'brd_approved' THEN 'brd_review'
  WHEN 'brd_purchased' THEN 'brd_review'
  WHEN 'prd_generated' THEN 'prd_review'
  WHEN 'prd_approved' THEN 'prd_review'
  WHEN 'prd_purchased' THEN 'prd_review'
  WHEN 'team_forming' THEN 'matching'
  WHEN 'matched' THEN 'matching'
  WHEN 'partially_active' THEN 'in_progress'
  WHEN 'review' THEN 'final_review'
  ELSE "status"::text
END)::"public"."project_status_new";--> statement-breakpoint

-- disputed and on_hold have no position of their own any more. No projects row
-- still holds one (step 3), but log rows do; they land on in_progress and
-- *_status_legacy keeps what they actually said.
ALTER TABLE "project_status_logs" ALTER COLUMN "from_status" SET DATA TYPE "public"."project_status_new" USING (CASE "from_status"::text
  WHEN 'brd_generated' THEN 'brd_review'
  WHEN 'brd_approved' THEN 'brd_review'
  WHEN 'brd_purchased' THEN 'brd_review'
  WHEN 'prd_generated' THEN 'prd_review'
  WHEN 'prd_approved' THEN 'prd_review'
  WHEN 'prd_purchased' THEN 'prd_review'
  WHEN 'team_forming' THEN 'matching'
  WHEN 'matched' THEN 'matching'
  WHEN 'partially_active' THEN 'in_progress'
  WHEN 'review' THEN 'final_review'
  WHEN 'disputed' THEN 'in_progress'
  WHEN 'on_hold' THEN 'in_progress'
  ELSE "from_status"::text
END)::"public"."project_status_new";--> statement-breakpoint

ALTER TABLE "project_status_logs" ALTER COLUMN "to_status" SET DATA TYPE "public"."project_status_new" USING (CASE "to_status"::text
  WHEN 'brd_generated' THEN 'brd_review'
  WHEN 'brd_approved' THEN 'brd_review'
  WHEN 'brd_purchased' THEN 'brd_review'
  WHEN 'prd_generated' THEN 'prd_review'
  WHEN 'prd_approved' THEN 'prd_review'
  WHEN 'prd_purchased' THEN 'prd_review'
  WHEN 'team_forming' THEN 'matching'
  WHEN 'matched' THEN 'matching'
  WHEN 'partially_active' THEN 'in_progress'
  WHEN 'review' THEN 'final_review'
  WHEN 'disputed' THEN 'in_progress'
  WHEN 'on_hold' THEN 'in_progress'
  ELSE "to_status"::text
END)::"public"."project_status_new";--> statement-breakpoint

DROP TYPE "public"."project_status";--> statement-breakpoint
ALTER TYPE "public"."project_status_new" RENAME TO "project_status";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."project_status";--> statement-breakpoint

-- 7. The browse index, with the hold guard the on_hold status used to give it.
-- The matching dispute guard lives in the browse queries: Postgres rejects a
-- subquery in an index predicate.
CREATE INDEX "idx_projects_browse" ON "projects" USING btree ("created_at" DESC NULLS LAST) WHERE deleted_at IS NULL
          AND visibility IN ('public_summary', 'public_detail')
          AND status IN ('matching', 'in_progress', 'final_review', 'completed')
          AND on_hold_at IS NULL;

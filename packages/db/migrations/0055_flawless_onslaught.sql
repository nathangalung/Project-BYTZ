-- milestone_status: 6 values -> 5. rejected and revision_requested were one
-- outcome under two names; both become changes_requested.
--
-- Hand-written. drizzle-kit renders a value-drop as a round trip through
-- `text` with a bare `::milestone_status` cast, which fails on the first row
-- holding one of the two dropped literals - and production holds both. The
-- mapping has to live in the USING clause.
--
-- milestones.status is the only column on this type, and
-- idx_milestones_project_status names no literal, so it rebuilds with the
-- column and needs no DROP/CREATE here.

--> statement-breakpoint
-- The default is of the old type, so it blocks the type change and is put back
-- after the rename. 'pending' survives the collapse; the dance is Postgres's,
-- not the value's.
ALTER TABLE "milestones" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

CREATE TYPE "public"."milestone_status_new" AS ENUM('pending', 'in_progress', 'submitted', 'changes_requested', 'approved');--> statement-breakpoint

ALTER TABLE "milestones" ALTER COLUMN "status" SET DATA TYPE "public"."milestone_status_new" USING (CASE "status"::text
  WHEN 'rejected' THEN 'changes_requested'
  WHEN 'revision_requested' THEN 'changes_requested'
  ELSE "status"::text
END)::"public"."milestone_status_new";--> statement-breakpoint

DROP TYPE "public"."milestone_status";--> statement-breakpoint
ALTER TYPE "public"."milestone_status_new" RENAME TO "milestone_status";--> statement-breakpoint
ALTER TABLE "milestones" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."milestone_status";

-- project_assignments: two status columns -> one.
--
-- `status` (active/completed/terminated/replaced) and `acceptance_status`
-- (pending/accepted/declined) made twelve combinations, of which three ever
-- occurred. The pair that carried real meaning was active+pending: an offer
-- the talent had not answered, which every predicate that read `status` alone
-- counted as live work. It becomes its own value.
--
--   (active,    pending)  -> offered
--   (active,    accepted) -> active
--   (completed, *)        -> completed
--   (terminated, *) | (*, declined) | replaced -> ended
--
-- Hand-written. drizzle-kit renders a value-drop as a round trip through
-- `text` with a bare cast, which fails on the first row holding 'terminated'
-- or 'replaced' - and it drops acceptance_status after the type swap, by which
-- point the column the mapping has to read is already gone. Both halves of the
-- pair must be live inside the USING clause, so the DROP COLUMN comes after it.
--
-- uq_project_assignments_wp_live names 'active' and 'completed' in its
-- predicate. Those two literals survive the collapse, but a partial index
-- cannot sit on a column whose type is being replaced, so it is dropped first
-- and rebuilt after - with 'offered' added, because an unanswered offer was
-- stored as 'active' and so already claimed the work package. Without it two
-- talents could hold a live offer on the same position.
--
-- idx_project_assignments_talent_status names no literal and rebuilds with the
-- column.

--> statement-breakpoint
-- The default is of the old type and blocks the swap; it is put back after the
-- rename. active+pending was the old composite default, so it becomes 'offered'.
ALTER TABLE "project_assignments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

DROP INDEX "uq_project_assignments_wp_live";--> statement-breakpoint

CREATE TYPE "public"."assignment_status_new" AS ENUM('offered', 'active', 'completed', 'ended');--> statement-breakpoint

ALTER TABLE "project_assignments" ALTER COLUMN "status" SET DATA TYPE "public"."assignment_status_new" USING (CASE
  WHEN "status"::text = 'completed' THEN 'completed'
  WHEN "status"::text IN ('terminated', 'replaced') THEN 'ended'
  WHEN "acceptance_status"::text = 'declined' THEN 'ended'
  WHEN "acceptance_status"::text = 'accepted' THEN 'active'
  ELSE 'offered'
END)::"public"."assignment_status_new";--> statement-breakpoint

ALTER TABLE "project_assignments" DROP COLUMN "acceptance_status";--> statement-breakpoint

DROP TYPE "public"."assignment_status";--> statement-breakpoint
DROP TYPE "public"."acceptance_status";--> statement-breakpoint
ALTER TYPE "public"."assignment_status_new" RENAME TO "assignment_status";--> statement-breakpoint

ALTER TABLE "project_assignments" ALTER COLUMN "status" SET DEFAULT 'offered'::"public"."assignment_status";--> statement-breakpoint

CREATE UNIQUE INDEX "uq_project_assignments_wp_live" ON "project_assignments" USING btree ("project_id","work_package_id") WHERE status IN ('offered', 'active', 'completed');

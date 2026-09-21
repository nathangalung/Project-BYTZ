-- work_packages.status: seven values -> five.
--
-- 'declined' and 'terminated' were not positions a package sits in, they named
-- the way the last talent stopped holding it. Where it then sat was the pool
-- the owner offers from, which is exactly what 'unassigned' meant - so three
-- literals described one state, and the read sets drifted apart around them:
-- matching offered from ('unassigned') while the apply path and the browse
-- feed picked from ('unassigned','declined'). One name, one pool.
--
--   unassigned | declined | terminated -> open
--   pending_acceptance                 -> offered
--   assigned                           -> staffed
--   in_progress                        -> in_progress
--   completed                          -> completed
--
-- Hand-written. drizzle-kit renders a value-drop as a round trip through
-- `text` with a bare cast, which fails on the first row holding 'unassigned',
-- 'pending_acceptance', 'assigned', 'declined' or 'terminated' - which is every
-- row that is not already in_progress or completed.
--
-- The CASE has no ELSE on purpose: the column is NOT NULL, so a value this
-- mapping does not name fails the migration instead of landing quietly in
-- 'open'.
--
-- idx_work_packages_project_status names no literal and rebuilds with the
-- column, so it is neither dropped nor recreated here. The default is of the
-- old type and blocks the swap, so it comes off first and goes back on after
-- the rename; 'unassigned' was the old default and 'open' is where it maps.

--> statement-breakpoint
ALTER TABLE "work_packages" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

CREATE TYPE "public"."work_package_status_new" AS ENUM('open', 'offered', 'staffed', 'in_progress', 'completed');--> statement-breakpoint

ALTER TABLE "work_packages" ALTER COLUMN "status" SET DATA TYPE "public"."work_package_status_new" USING (CASE
  WHEN "status"::text IN ('unassigned', 'declined', 'terminated') THEN 'open'
  WHEN "status"::text = 'pending_acceptance' THEN 'offered'
  WHEN "status"::text = 'assigned' THEN 'staffed'
  WHEN "status"::text = 'in_progress' THEN 'in_progress'
  WHEN "status"::text = 'completed' THEN 'completed'
END)::"public"."work_package_status_new";--> statement-breakpoint

DROP TYPE "public"."work_package_status";--> statement-breakpoint
ALTER TYPE "public"."work_package_status_new" RENAME TO "work_package_status";--> statement-breakpoint

ALTER TABLE "work_packages" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."work_package_status";

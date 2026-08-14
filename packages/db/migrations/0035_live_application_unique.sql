-- project_applications_unique was UNIQUE (project_id, talent_id) with no
-- status predicate, from migration 0000 and never made partial.
--
-- routes/applications.ts already narrows its own check to live statuses, and
-- says so: "Only a live application blocks another. Matching on the pair alone
-- made withdrawing irreversible." The handler was fixed and the index was not,
-- so the check passed and the insert then violated the constraint. A talent who
-- withdrew by mistake got a 500 on reapplying, and a rejected one could not
-- reapply after the scope changed, which is the behaviour the handler comment
-- promises is fixed.
--
-- Partial on the same statuses the handler treats as live. Relaxing, so a
-- deployed version writing under the old rule keeps working mid-rollout.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

DROP INDEX "project_applications_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "project_applications_unique" ON "project_applications" USING btree ("project_id","talent_id") WHERE status IN ('pending', 'accepted');

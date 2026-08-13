-- CREATE INDEX takes a SHARE lock for the whole build, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available here. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind or ahead of live writes fails fast and can
-- be retried in a window instead of holding the table.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
DROP INDEX "idx_projects_browse";--> statement-breakpoint
ALTER TABLE "talent_penalties" ADD CONSTRAINT "talent_penalties_related_project_id_projects_id_fk" FOREIGN KEY ("related_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_projects_browse" ON "projects" USING btree ("created_at" DESC NULLS LAST) WHERE deleted_at IS NULL
          AND visibility IN ('public_summary', 'public_detail')
          AND status IN ('matching', 'team_forming', 'matched', 'in_progress', 'review', 'completed');
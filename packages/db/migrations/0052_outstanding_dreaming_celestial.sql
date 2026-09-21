-- Additive only: six new indexes, nothing dropped, renamed or altered.
-- A plain CREATE INDEX takes a SHARE lock and blocks writes to the table for
-- the build. CONCURRENTLY would not, but drizzle wraps every migration file in
-- a transaction and CONCURRENTLY cannot run inside one. These tables are small
-- today, so the build is short; revisit if any of them grows past a few million
-- rows, at which point the index has to be created outside the migrator.
-- Bound the locks so a busy window fails fast rather than queueing behind writes.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE INDEX "idx_transactions_created" ON "transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_chat_participants_user" ON "chat_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_project_activities_project_created" ON "project_activities" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_project_applications_talent_created" ON "project_applications" USING btree ("talent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_project_status_logs_project_created" ON "project_status_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_projects_created" ON "projects" USING btree ("created_at");
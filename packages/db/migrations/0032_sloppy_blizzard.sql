-- CREATE INDEX takes a lock for the whole build, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available. These timeouts bound the lock so a migration that would queue
-- behind live writes fails fast and can be retried in a quiet window.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
CREATE UNIQUE INDEX "time_logs_one_running_per_task" ON "time_logs" USING btree ("task_id","talent_id") WHERE ended_at IS NULL;
-- CREATE INDEX takes a SHARE lock for the whole build, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available here. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind or ahead of live writes fails fast and can
-- be retried in a window instead of holding the table.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
CREATE INDEX "idx_ai_interactions_created" ON "ai_interactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_interactions_model_created" ON "ai_interactions" USING btree ("model","created_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_status_type_created" ON "transactions" USING btree ("status","type","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);
-- CREATE INDEX takes a SHARE lock for the whole build, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available here. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind or ahead of live writes fails fast and can
-- be retried in a window instead of holding the table.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
CREATE UNIQUE INDEX "revision_requests_fee_transaction_unique" ON "revision_requests" USING btree ("fee_transaction_id") WHERE fee_transaction_id is not null;--> statement-breakpoint
CREATE INDEX "idx_revision_requests_milestone" ON "revision_requests" USING btree ("milestone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_project_reviewer_reviewee_unique" ON "reviews" USING btree ("project_id","reviewer_id","reviewee_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_reviewee_type" ON "reviews" USING btree ("reviewee_id","type");
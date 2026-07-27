CREATE UNIQUE INDEX "revision_requests_fee_transaction_unique" ON "revision_requests" USING btree ("fee_transaction_id") WHERE fee_transaction_id is not null;--> statement-breakpoint
CREATE INDEX "idx_revision_requests_milestone" ON "revision_requests" USING btree ("milestone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_project_reviewer_reviewee_unique" ON "reviews" USING btree ("project_id","reviewer_id","reviewee_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_reviewee_type" ON "reviews" USING btree ("reviewee_id","type");
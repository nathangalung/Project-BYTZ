CREATE INDEX "idx_ai_interactions_created" ON "ai_interactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_interactions_model_created" ON "ai_interactions" USING btree ("model","created_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_status_type_created" ON "transactions" USING btree ("status","type","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);
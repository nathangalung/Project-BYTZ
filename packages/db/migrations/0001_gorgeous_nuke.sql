CREATE INDEX "idx_chat_messages_conv_created" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_milestones_project_status" ON "milestones" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_work_packages_project_status" ON "work_packages" USING btree ("project_id","status");
CREATE INDEX "idx_talent_profiles_eligible" ON "talent_profiles" USING btree ("verification_status","availability_status");--> statement-breakpoint
CREATE INDEX "idx_project_assignments_talent_status" ON "project_assignments" USING btree ("talent_id","status");--> statement-breakpoint
CREATE INDEX "idx_projects_browse" ON "projects" USING btree ("status","visibility","created_at" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_projects_owner" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_time_logs_talent_started" ON "time_logs" USING btree ("talent_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_time_logs_task" ON "time_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","is_read");
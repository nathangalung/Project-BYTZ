DROP INDEX "idx_projects_browse";--> statement-breakpoint
ALTER TABLE "talent_penalties" ADD CONSTRAINT "talent_penalties_related_project_id_projects_id_fk" FOREIGN KEY ("related_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_projects_browse" ON "projects" USING btree ("created_at" DESC NULLS LAST) WHERE deleted_at IS NULL
          AND visibility IN ('public_summary', 'public_detail')
          AND status IN ('matching', 'team_forming', 'matched', 'in_progress', 'review', 'completed');
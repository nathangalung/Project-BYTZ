-- Bound the FK-validation locks on the referenced tables so this migration
-- fails fast in a busy window rather than queueing behind writes.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TYPE "public"."disbursement_status" AS ENUM('pending', 'queued', 'processed', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text,
	"work_package_id" text,
	"talent_id" text NOT NULL,
	"transaction_id" text,
	"amount" integer NOT NULL,
	"beneficiary_provider" varchar(50) NOT NULL,
	"beneficiary_account" varchar(64) NOT NULL,
	"beneficiary_name" varchar(255) NOT NULL,
	"status" "disbursement_status" DEFAULT 'pending' NOT NULL,
	"iris_reference_no" varchar(255),
	"idempotency_key" varchar(255) NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disbursements_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_work_package_id_work_packages_id_fk" FOREIGN KEY ("work_package_id") REFERENCES "public"."work_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_talent_id_talent_profiles_id_fk" FOREIGN KEY ("talent_id") REFERENCES "public"."talent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_disbursements_status" ON "disbursements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_disbursements_talent" ON "disbursements" USING btree ("talent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_disbursements_transaction" ON "disbursements" USING btree ("transaction_id") WHERE transaction_id IS NOT NULL;
CREATE TABLE "talent_education" (
	"id" text PRIMARY KEY NOT NULL,
	"talent_id" text NOT NULL,
	"university" varchar(255) NOT NULL,
	"degree" varchar(100),
	"major" varchar(255),
	"gpa" varchar(20),
	"start_year" integer,
	"end_year" integer,
	"order_index" integer DEFAULT 0 NOT NULL,
	"pddikti_status" varchar(20),
	"pddikti_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"talent_id" text NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"tech_stack" jsonb,
	"url" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"link_status" varchar(20),
	"link_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent_education" ADD CONSTRAINT "talent_education_talent_id_talent_profiles_id_fk" FOREIGN KEY ("talent_id") REFERENCES "public"."talent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_projects" ADD CONSTRAINT "talent_projects_talent_id_talent_profiles_id_fk" FOREIGN KEY ("talent_id") REFERENCES "public"."talent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_talent_education_talent" ON "talent_education" USING btree ("talent_id");--> statement-breakpoint
CREATE INDEX "idx_talent_projects_talent" ON "talent_projects" USING btree ("talent_id");
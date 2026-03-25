-- Rename other_digital -> other in project_category enum
-- Step 1: Convert column to text to remove enum dependency
ALTER TABLE "projects" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
-- Step 2: Update existing data
UPDATE "projects" SET "category" = 'other' WHERE "category" = 'other_digital';--> statement-breakpoint
-- Step 3: Drop old enum and create new one
DROP TYPE "public"."project_category";--> statement-breakpoint
CREATE TYPE "public"."project_category" AS ENUM('web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other');--> statement-breakpoint
-- Step 4: Convert column back to enum
ALTER TABLE "projects" ALTER COLUMN "category" SET DATA TYPE "public"."project_category" USING "category"::"public"."project_category";

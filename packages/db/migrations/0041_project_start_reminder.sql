-- Mark that the owner has been told their matched project has not started.
--
-- The platform promises to cancel a project and return the escrow if work has
-- not begun 30 days after matched. No job does that, and building one means
-- moving an owner's money with no human in the loop, so the first step is
-- telling somebody. This column is what stops an hourly sweep from telling them
-- every hour for the rest of the month.
--
-- Additive and nullable: every reader selects explicit columns and none names
-- this one, so the deployed version keeps serving traffic.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS start_reminder_at timestamptz;

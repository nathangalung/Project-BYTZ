-- Mark that the owner has been told their approved PRD is waiting on a decision.
--
-- prd_approved leaves three futures open: fund the project and go to matching,
-- take the PRD and close out, or cancel. Nothing settles by itself, so a project
-- can sit there forever with a paid document and no next step, and nobody is
-- ever told. This is the owner-late-payment case before escrow exists, where the
-- start reminder cannot help because the project never reached matched.
--
-- Separate from start_reminder_at rather than shared: a project passes through
-- both stages, so one marker would let the earlier stage silence the later one.
--
-- Additive and nullable: every reader selects explicit columns and none names
-- this one, so the deployed version keeps serving traffic.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS decision_reminder_at timestamptz;

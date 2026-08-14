-- project_status_logs.changed_by carries a foreign key to "user", and a
-- transition nobody performed had no way to say so. The escrow settlement path
-- passed the literal 'system', which is not a user id, so the insert violated
-- the constraint and rolled the transition back. NULL is the honest value for
-- an actor that does not exist.
--
-- Dropping NOT NULL relaxes the column, so a deployed version still writing a
-- real user id keeps working and this is safe mid-rollout.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

ALTER TABLE "project_status_logs" ALTER COLUMN "changed_by" DROP NOT NULL;

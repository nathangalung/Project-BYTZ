-- Anchor the private owner-talent thread to the assignment it belongs to.
--
-- chat_conversations carried only project_id and type, so nothing could say
-- which talent an owner_talent thread belonged to, and nothing could create one
-- twice-safely. That is why no code ever created one: the only writer was a
-- route no frontend calls, and the deal itself produced no thread at all.
--
-- assignment_id gives the private thread the same anchor contracts already use,
-- so provisioning is idempotent against the database rather than against a
-- read-then-write. Nullable, because ai_scoping, team_group and admin_mediation
-- threads have no single assignment.
--
-- Additive: every reader selects explicit columns, and the one select-* is the
-- RETURNING on insert, which tolerates a new null column.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS assignment_id text REFERENCES project_assignments(id);

CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_assignment_unique
  ON chat_conversations (assignment_id)
  WHERE type = 'owner_talent';

CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_team_group_unique
  ON chat_conversations (project_id)
  WHERE type = 'team_group';

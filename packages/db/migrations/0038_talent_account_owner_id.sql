-- Repoint talent payout accounts at the talent_profile they belong to.
--
-- accounts.owner_id is polymorphic. For owner accounts it holds a user id and
-- for escrow accounts a project id, both of which the readers agree on. Talent
-- accounts were seeded with the user id while both readers use the profile id:
-- GetSummaryByUser joins accounts.owner_id to talent_profiles.id, and the
-- release path writes that same id through GetOrCreateAccountTx.
--
-- The effect was silent and total. Every talent saw "Total Earned Rp 0" no
-- matter what they had been paid, because the join never matched a row. On the
-- deployed database, five talent accounts held real balances and none of them
-- were reachable: one talent had Rp 9,000,000 from two completed releases and
-- was shown zero.
--
-- Idempotent by construction. A row already pointing at a talent_profile is
-- skipped, so a rerun and a fresh seed both land on the same state.
UPDATE accounts a
SET owner_id = tp.id,
    updated_at = now()
FROM talent_profiles tp
WHERE a.owner_type = 'talent'
  AND a.owner_id = tp.user_id
  AND NOT EXISTS (SELECT 1 FROM talent_profiles x WHERE x.id = a.owner_id);

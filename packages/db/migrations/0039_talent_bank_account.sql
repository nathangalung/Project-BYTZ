-- Payout destination for a talent.
--
-- Escrow release has been pure bookkeeping: ReleaseEscrow writes ledger rows
-- and no money leaves the platform, because there was nowhere to send it. No
-- column on talent_profiles held a bank account, so "payout released" meant a
-- balance moved between two rows in our own database while the cash sat in the
-- gateway settlement account waiting for someone to transfer it by hand.
--
-- bank_verified_at is the gate, not a timestamp for display. The gateway
-- confirms the account holder name matches the account number, and until it
-- has, a disbursement is a transfer to a number a stranger typed. Null means
-- never pay this out.
--
-- Additive and nullable, so the deployed version keeps serving traffic: it
-- selects explicit columns everywhere and never names these.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE talent_profiles
  ADD COLUMN IF NOT EXISTS bank_code varchar(20),
  ADD COLUMN IF NOT EXISTS bank_account_number varchar(34),
  ADD COLUMN IF NOT EXISTS bank_account_holder_name varchar(255),
  ADD COLUMN IF NOT EXISTS bank_verified_at timestamptz;

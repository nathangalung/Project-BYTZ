-- Payout destination for a talent.
--
-- Escrow release has been pure bookkeeping: ReleaseEscrow writes ledger rows
-- and no money leaves the platform, because there was nowhere to send it. No
-- column on talent_profiles held a payout destination, so "payout released"
-- meant a balance moved between two rows in our own database while the cash sat
-- in the gateway settlement account waiting for someone to transfer it by hand.
--
-- Not bank-only. Midtrans and Xendit both disburse to e-wallets under the same
-- shape as a bank -- a provider code plus an account identifier -- so the
-- columns carry that shape rather than a bank one. payout_channel says which
-- kind, because it decides how the account number is validated: a bank account
-- is digits, an e-wallet account is the registered phone number.
--
-- payout_verified_at is the gate, not a timestamp for display. The gateway
-- confirms the holder name matches the account, and until it has, a
-- disbursement is a transfer to a number a stranger typed. Null means never pay
-- this out.
--
-- Additive and nullable, so the deployed version keeps serving traffic: it
-- selects explicit columns everywhere and never names these.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE talent_profiles
  ADD COLUMN IF NOT EXISTS payout_channel varchar(10),
  ADD COLUMN IF NOT EXISTS payout_provider varchar(20),
  ADD COLUMN IF NOT EXISTS payout_account_number varchar(34),
  ADD COLUMN IF NOT EXISTS payout_account_holder_name varchar(255),
  ADD COLUMN IF NOT EXISTS payout_verified_at timestamptz;

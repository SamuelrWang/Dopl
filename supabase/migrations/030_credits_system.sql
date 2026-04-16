-- Credits system: usage-based billing with per-action costs
-- All features remain available; tiers differentiate by credit volume.

-- Append-only ledger of every credit transaction
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,           -- negative = deduction, positive = grant
  action TEXT NOT NULL,              -- mcp_search, chat_message, chat_tool_call, ingestion, monthly_grant, daily_bonus, upgrade_grant
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);

-- Materialized balance for fast reads (updated on every transaction)
CREATE TABLE IF NOT EXISTS user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 100,
  cycle_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  cycle_credits_granted INTEGER NOT NULL DEFAULT 100,
  last_daily_bonus TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: users can read their own credit data. Writes go through the service
-- role (supabaseAdmin), which bypasses RLS entirely. No permissive policies.
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_ledger_select ON credit_ledger
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_credits_select ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

-- Allow 'power' as a valid subscription tier (extends existing free|pro).
-- If a CHECK constraint exists, drop it and recreate with the expanded set.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'profiles'
    AND att.attname = 'subscription_tier'
    AND con.contype = 'c'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE profiles DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'pro', 'power'));

-- Backfill: create credit rows for all existing users. Start cycle from now()
-- rather than account creation so existing users don't immediately roll over.
INSERT INTO user_credits (user_id, balance, cycle_start, cycle_credits_granted)
SELECT id, 100, now(), 100
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

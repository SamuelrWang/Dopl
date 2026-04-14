-- Add subscription fields to profiles table
ALTER TABLE profiles
  ADD COLUMN subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN stripe_subscription_id TEXT,
  ADD COLUMN subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'past_due', 'canceled')),
  ADD COLUMN subscription_period_end TIMESTAMPTZ,
  ADD COLUMN ingestion_count INTEGER DEFAULT 0;

CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id);

-- Atomic increment for ingestion count (avoids race conditions)
CREATE OR REPLACE FUNCTION increment_ingestion_count(user_id_input UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET ingestion_count = ingestion_count + 1
  WHERE id = user_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

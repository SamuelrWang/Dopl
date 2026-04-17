-- Launch payment system: 24-hour free trial → $7.99/mo Pro.
-- Adds trial tracking to profiles. Existing subscription_tier /
-- subscription_status columns remain; their semantics are simplified to:
--   'trialing' — within 24h window
--   'active'   — paid Stripe subscription
--   'expired'  — trial ended, no paid sub (paywalled)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reactivation_email_sent_at TIMESTAMPTZ NULL;

-- Existing users pre-trial-system: stamp trial_started_at = created_at so
-- they already count as "started" and don't get another fresh 24h window
-- the next time they sign in. Their subscription_status stays as-is.
UPDATE profiles
   SET trial_started_at = COALESCE(created_at, now()),
       trial_expires_at = COALESCE(created_at, now()) + INTERVAL '24 hours'
 WHERE trial_started_at IS NULL;

-- Index for the hourly cron that scans for trials crossing expiry and
-- for the reactivation-email cron (48h after expiry).
CREATE INDEX IF NOT EXISTS profiles_trial_expires_at_idx
  ON profiles (trial_expires_at)
  WHERE subscription_status IN ('trialing', 'expired');

CREATE INDEX IF NOT EXISTS profiles_reactivation_pending_idx
  ON profiles (trial_expires_at)
  WHERE subscription_status = 'expired' AND reactivation_email_sent_at IS NULL;

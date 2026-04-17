-- Track when a user finished the /welcome onboarding flow.
-- Null = first-time user (will be routed through /welcome).
-- Set   = has already completed the flow (goes straight to /canvas).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ NULL;

-- Existing users already have canvases and shouldn't be re-onboarded.
-- Backfill with their profile creation time so they skip the new flow.
UPDATE profiles
   SET onboarded_at = COALESCE(created_at, now())
 WHERE onboarded_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_onboarded_at_null_idx
  ON profiles (id)
  WHERE onboarded_at IS NULL;

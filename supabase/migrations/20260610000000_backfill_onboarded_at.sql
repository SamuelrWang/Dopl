-- Repurpose profiles.onboarded_at as the gate for the new /onboarding
-- flow (survey + MCP connect). The April backfill
-- (20260416120000_add_profiles_onboarded_at.sql) covered users that
-- existed then, but the /welcome flow it served was removed (M-7) and
-- nothing has written the column since — every signup after 2026-04-16
-- has onboarded_at = NULL. Backfill them so only genuinely new signups
-- see the onboarding flow.
--
-- Deploy note: apply in the same deploy as the auth-callback onboarding
-- gate. If the gate ships first, existing users get funneled into
-- onboarding; the migration running early is harmless.

UPDATE profiles
   SET onboarded_at = COALESCE(created_at, now())
 WHERE onboarded_at IS NULL;

-- No index: every read is a primary-key lookup (eq id). The old partial
-- index was deliberately dropped in 20260504020000 — do not recreate.

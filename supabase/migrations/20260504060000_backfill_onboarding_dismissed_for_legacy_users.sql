-- Audit B4: M-7 stripped the `?fromWelcome=1` URL gate from the
-- onboarding-tour coach card. The `useOnboarding` hook now treats
-- "default state" (no localStorage + no user_preferences row) as
-- "tour active." For accounts that predate the welcome flow entirely,
-- this means they'll suddenly see a 3-step tour they never asked for.
--
-- Backfill: insert a `dismissed: true` onboarding preference for every
-- existing user that doesn't already have one. New signups going
-- forward get default state and see the tour as intended.
--
-- Idempotent via the LEFT JOIN ... WHERE p.id IS NULL guard —
-- re-running the migration is a no-op for any user who's already
-- got an onboarding pref (legacy backfill OR completed the tour).

INSERT INTO user_preferences (user_id, key, value, updated_at)
SELECT
  u.id,
  'onboarding',
  '{"currentStep": -1, "completedSteps": {}, "dismissed": true}'::jsonb,
  now()
FROM auth.users u
LEFT JOIN user_preferences p
  ON p.user_id = u.id AND p.key = 'onboarding'
WHERE p.id IS NULL;

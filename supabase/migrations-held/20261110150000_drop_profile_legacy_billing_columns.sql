-- DROP THE PER-USER BILLING/TRIAL COLUMNS ON profiles (db-cleanup audit, 2026-09-28).
--
-- ⚠ HELD — WRITTEN, NOT APPLIED. Samuel's ruling for the audit: "List + draft
-- drops, don't apply". Release per supabase/migrations-held/README.md.
--
-- Billing moved to workspace_billing + the credit wallets. These six profile
-- columns have NO reader and NO writer anywhere in src/, packages/, apps/,
-- dopl-desktop-app/ or scripts/ (only the generated types.ts), and
-- handle_new_user() no longer sets them:
--
--   subscription_tier            values in prod: free, pro (2 rows `pro`)
--   subscription_status          15 non-null rows (`active`, `inactive`)
--   subscription_period_end      2 non-null rows
--   trial_started_at             2 non-null rows (newest 2026-04-16)
--   trial_expires_at             2 non-null rows
--   reactivation_email_sent_at   0 non-null rows
--
-- plus the two partial indexes that exist only to serve the dead
-- trial/reactivation job (never scanned).
--
-- ⚠ ARCHIVE FIRST if the old per-user tier matters for any grandfathered user:
--
--   SELECT id, email, subscription_tier, subscription_status,
--          subscription_period_end, trial_started_at, trial_expires_at
--     FROM public.profiles
--    WHERE subscription_tier IS DISTINCT FROM 'free'
--       OR subscription_status IS NOT NULL
--       OR trial_started_at IS NOT NULL;
--
-- KEPT on purpose: stripe_customer_id / stripe_subscription_id (read by
-- billing/server/subscriptions.ts — grandfather mapping and account deletion)
-- and idx_profiles_stripe_customer, which serves that lookup.
--
-- After release: re-generate src/shared/supabase/types.ts.

DROP INDEX IF EXISTS public.profiles_reactivation_pending_idx;
DROP INDEX IF EXISTS public.profiles_trial_expires_at_idx;

ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS reactivation_email_sent_at;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS trial_expires_at;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS trial_started_at;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS subscription_period_end;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS subscription_tier;

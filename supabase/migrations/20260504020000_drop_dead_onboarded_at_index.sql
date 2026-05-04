-- Drop profiles_onboarded_at_null_idx — it was queried only by the
-- /welcome server component to gate first-time users into onboarding.
-- After M-7 ripped out /welcome, no caller reads onboarded_at, so
-- the partial index is dead.
--
-- The onboarded_at COLUMN is intentionally kept (cheap NULL on every
-- row) to avoid breaking generated Supabase types and to leave a
-- breadcrumb if we ever want a different first-run gate later.

DROP INDEX IF EXISTS public.profiles_onboarded_at_null_idx;

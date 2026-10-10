-- NOTIFICATION PREFERENCES — one on/off per (user, event, channel?) (2026-10-09, KB
-- dopl-development "Notifications Audit 2026-10-08" › Design: "per-user prefs event×channel
-- server-side").
--
-- ⚠ WRITTEN, NOT APPLIED. Applying this to prod is Samuel's call (asked 2026-10-09). Until it
-- lands the desktop keeps the record in its own store (`dopl-desktop-app/main/notification-prefs.js`)
-- and nothing reads this table. `src/app/api/user/notification-preferences/route.ts` answers 503
-- `NOT_AVAILABLE` while the table is missing, and no binding mounts the API-backed store yet.
--
-- ── SHAPE ──
-- A row is an OVERRIDE of the default, which is ON. No row = notify. `channel_id IS NULL` is the
-- user's global switch for that event; a non-null `channel_id` is a per-channel override (v1 UI
-- writes global rows only; the column is here so per-channel lands without a second migration).
-- `event_type` is CHECKed against the code registry (`src/features/notifications/registry.ts`);
-- a new event is a new CHECK value and a new registry row, on one clock.
--
-- ── WRITE POSTURE: SERVICE ROLE ONLY ── (the `knowledge_base_stars` precedent, 20260812130000)
-- Every read and write goes through the route on `supabaseAdmin()`, scoped to the caller's id.
-- The SELECT policy is defence in depth; client DML is revoked.
-- ⚠ A preference here can only SILENCE a banner, and the `approval` event is forced on in code,
-- so a forged row cannot make an approval unanswerable.
--
-- ── NOT PUBLISHED TO REALTIME (INVARIANTS §7) ── nothing subscribes.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.notification_preferences;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN ('mention', 'decision', 'direct_message', 'approval')),
  channel_id  UUID NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One global row per (user, event), one override per (user, event, channel). Two partial unique
-- indexes because NULLs never collide in a plain unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_global_key
  ON public.notification_preferences (user_id, event_type)
  WHERE channel_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_channel_key
  ON public.notification_preferences (user_id, event_type, channel_id)
  WHERE channel_id IS NOT NULL;
-- The channel FK cascades on delete: index its referencing column (INVARIANTS §12).
CREATE INDEX IF NOT EXISTS notification_preferences_channel_idx
  ON public.notification_preferences (channel_id)
  WHERE channel_id IS NOT NULL;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.notification_preferences FROM anon, authenticated;

DROP POLICY IF EXISTS notification_preferences_select_own ON public.notification_preferences;
CREATE POLICY notification_preferences_select_own ON public.notification_preferences
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ── VERIFICATION (after applying) ──
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_preferences'::regclass; -- t
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notification_preferences';      -- 1 row, SELECT
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--    WHERE table_name = 'notification_preferences' AND grantee IN ('anon', 'authenticated');  -- SELECT only

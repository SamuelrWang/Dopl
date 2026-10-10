-- NOTIFICATION PREFERENCES — one on/off per (user, event, channel?) (2026-10-09, KB
-- dopl-development "Notifications Audit 2026-10-08" › Design: "per-user prefs event×channel
-- server-side").
--
-- ⚠ WRITTEN, NOT APPLIED. Applying this to prod is Samuel's call (asked 2026-10-09).
--
-- ⚠ AND THE UI IS ALREADY MOUNTED ON IT (2026-10-09): the Notifications tab reads and writes
-- this table through `/api/user/notification-preferences`, and the desktop's banner gate reads
-- the same route. Until the table lands, that route answers 503 `NOT_AVAILABLE` and every
-- surface fails toward ON — the tab says it cannot load, no banner is silenced, nothing breaks
-- and nothing is stored. There is no local fallback copy anywhere.
--
-- ── SHAPE ──
-- A row is an OVERRIDE of the default, which is ON. No row = notify. `channel_id IS NULL` is the
-- user's global switch for that event; a non-null `channel_id` is a per-channel override (v1 UI
-- writes global rows only; the column is here so per-channel lands without a second migration).
-- ⚠ `event_type` CARRIES NO CHECK CONSTRAINT, ON PURPOSE (2026-10-09). An enumerated CHECK here
-- would be a CEILING: the registry names 4 events today and the surface map
-- (KB dopl-development "Notification Surface Map 2026-10-09") counts 39 banner-raising events
-- still to name, so every one of them would need a migration to add a value — and a row whose
-- event is not yet in the constraint fails the INSERT rather than being ignored. The list that
-- decides what is valid is CODE (`src/features/notifications/registry.ts` ›
-- `isNotificationEventId`), enforced at the only writer (`server/repository.ts`), which is also
-- the list the UI and the desktop gate read. One list, not two.
-- Nothing here depends on the column's domain: an unknown value can only sit in a row that no
-- reader maps to a switch (the read path drops it), so the blast radius of a bad value is a
-- dead row, never a wrong verdict — and the default stays ON.
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
  -- No enumerated CHECK: the registry in code is the list (see the header). NOT NULL and
  -- non-empty is the whole domain, so a new event never needs a migration.
  event_type  TEXT NOT NULL CHECK (length(event_type) > 0 AND length(event_type) <= 64),
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

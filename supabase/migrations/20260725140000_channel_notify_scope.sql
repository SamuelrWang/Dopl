-- Channels v1.1 — per-member notification scope.
--
-- A channel member chooses how loudly a channel notifies THEIR desktop
-- listener (the setting is per (channel, user), stored on their membership
-- row):
--   'all'       — consent prompts for messages addressed to them, plus
--                 silent FYI notifications for other members' foreign-user
--                 messages (default, current behavior).
--   'addressed' — only messages addressed to them prompt; no FYI noise.
--   'none'      — no notifications from this channel at all (still listed,
--                 still readable). An addressed consent prompt is the ONE
--                 thing 'none' does NOT silence — that gate lives in the
--                 desktop listener, not here; a request must never be
--                 silently dropped.
--
-- The column is a plain per-row preference: no RLS/grant changes (writes
-- still go exclusively through the service role, and the only mutator is
-- the caller updating their OWN row via PATCH /members). The last_read_at
-- bump trigger guard (channel_members_workspace_guard) fires only on
-- UPDATE OF workspace_id/channel_id, so a notify_scope UPDATE never trips it.

ALTER TABLE public.channel_members
  ADD COLUMN IF NOT EXISTS notify_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (notify_scope IN ('all', 'addressed', 'none'));

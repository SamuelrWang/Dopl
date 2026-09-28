-- ============================================================================
-- GLASSES — per-device, per-channel reply-mirror scope + cursors (2026-09-28)
-- ============================================================================
-- The per-device "linked channel" is retired as a user-facing concept
-- (docs/glasses-mcp.md › Reply mirror). Agent replies are mirrored to the
-- glasses from the device's CURRENT TARGET channel and from every channel the
-- device posted to (voice / Hey Even) in the last 24h. This table is that
-- scope's state: one row per (device, channel) the mirror has touched.
--   * `last_posted_at` — the device's last voice / Hey Even post into the
--     channel (NULL for a row created only because the channel was the target).
--   * `reply_cursor_seq` — the mirror's cursor in that channel; `cursor_at` is
--     when it was last confirmed. A cursor older than the mirror's staleness
--     window restarts at the channel's head, so a channel re-entering scope
--     never replays history.
-- ADDITIVE ONLY: one new table. `glasses_device_links.linked_channel_id` /
-- `linked_container_id` / `reply_cursor_seq` are left in place, no longer read
-- or written (dropping them is a follow-up, docs/db-cleanup-audit.md).
-- `channel_id` carries NO foreign key on purpose, like
-- `current_target_channel_id`: every pass re-validates membership + channel
-- state, and a dangling id is simply out of scope.
-- Service role only: RLS on, no policy.
-- Apply by name; replays cleanly.

CREATE TABLE IF NOT EXISTS public.glasses_device_channel_activity (
  device_id uuid NOT NULL REFERENCES public.glasses_device_links(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  last_posted_at timestamptz NULL,
  reply_cursor_seq bigint NOT NULL,
  cursor_at timestamptz NOT NULL,
  PRIMARY KEY (device_id, channel_id)
);

ALTER TABLE public.glasses_device_channel_activity ENABLE ROW LEVEL SECURITY;

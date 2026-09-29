-- ============================================================================
-- GLASSES — a device's CURRENT TARGET for voice / Hey Even (2026-09-27)
-- ============================================================================
-- The glasses menu (docs/glasses-mcp.md › Menu) lets the wearer pick where
-- their voice goes: a channel, or one agent in a channel. The pick is stored
-- per device; voice and Hey Even route to an explicit override, else this
-- target, else the device's linked channel.
--
-- ADDITIVE ONLY: three nullable columns on `glasses_device_links`.
--   * `current_target_channel_id` carries NO foreign key on purpose: a target
--     is a transient UI choice, re-validated (membership + channel state) on
--     every use, and a dangling id simply falls back to the linked channel. An
--     FK would add a fourth `ON DELETE` edge into `channels` for a value that
--     is never trusted anyway.
--   * `current_target_agent` is an agent id in Dopl's agent-id grammar
--     (`main/agent-id.js`: a letter then seven of [a-z0-9]).
-- Apply by name; replays cleanly.

ALTER TABLE public.glasses_device_links
  ADD COLUMN IF NOT EXISTS current_target_channel_id uuid NULL;

ALTER TABLE public.glasses_device_links
  ADD COLUMN IF NOT EXISTS current_target_agent text NULL;

ALTER TABLE public.glasses_device_links
  ADD COLUMN IF NOT EXISTS current_target_at timestamptz NULL;

ALTER TABLE public.glasses_device_links
  DROP CONSTRAINT IF EXISTS glasses_device_links_target_agent_shape_check;

ALTER TABLE public.glasses_device_links
  ADD CONSTRAINT glasses_device_links_target_agent_shape_check
  CHECK (current_target_agent IS NULL OR current_target_agent ~ '^[a-z][a-z0-9]{7}$');

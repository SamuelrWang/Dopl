-- ============================================================================
-- DEVICE-AWARE MESSAGES (2026-09-28) — docs/specs/device-aware-messages.md
-- ============================================================================
-- Three additive pieces:
--   * `desktop_devices.display_name` — the user's rename of a computer. NULL means
--     "use the detected name" (`name`, which every heartbeat keeps overwriting),
--     so clearing the override restores it.
--   * `glasses_messages.channel_message_id` — the channel message that mirrors an
--     agent-built glasses screen/ask as `metadata.display`. A SOFT link (no FK):
--     a deleted message just makes the next update touch nothing.
--   * `public.merge_channel_message_display(message, author, patch)` — merges
--     `patch` into `channel_messages.metadata.display` in ONE statement, so a
--     live update (`glasses_update`) and an answer cannot lose each other's
--     write. Fenced to the message's author account and to rows that already
--     carry a display. SECURITY INVOKER; EXECUTE is service_role ONLY.
-- ADDITIVE ONLY. Apply by name.

ALTER TABLE public.desktop_devices
  ADD COLUMN IF NOT EXISTS display_name text NULL;

ALTER TABLE public.desktop_devices
  DROP CONSTRAINT IF EXISTS desktop_devices_display_name_len;
ALTER TABLE public.desktop_devices
  ADD CONSTRAINT desktop_devices_display_name_len
  CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 64);

ALTER TABLE public.glasses_messages
  ADD COLUMN IF NOT EXISTS channel_message_id uuid NULL;

CREATE OR REPLACE FUNCTION public.merge_channel_message_display(
  p_message_id uuid,
  p_author_user_id uuid,
  p_patch jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH moved AS (
    UPDATE public.channel_messages
       SET metadata = jsonb_set(metadata, '{display}', (metadata -> 'display') || p_patch)
     WHERE id = p_message_id
       AND author_user_id = p_author_user_id
       AND jsonb_typeof(metadata -> 'display') = 'object'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved);
$$;

COMMENT ON FUNCTION public.merge_channel_message_display(uuid, uuid, jsonb) IS
  'Merges a patch into channel_messages.metadata.display (device-aware messages). EXECUTE is service_role ONLY.';

REVOKE ALL ON FUNCTION public.merge_channel_message_display(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_channel_message_display(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_channel_message_display(uuid, uuid, jsonb) TO service_role;

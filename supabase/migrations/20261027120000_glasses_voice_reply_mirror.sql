-- ============================================================================
-- GLASSES MCP PROTOTYPE — voice → channel, agent replies → glasses (2026-09-26)
-- ============================================================================
-- `src/features/glasses/voice-*.ts` + `reply-mirror.ts`. ADDITIVE ONLY and
-- confined to the glasses prototype's own tables:
--   * `glasses_devices` gets the reply-mirror cursor: which linked channel it
--     reads and the last `channel_messages.seq` already mirrored (both
--     NULLABLE; NULL = not started, so the first poll starts at the channel's
--     head instead of replaying history);
--   * a PARTIAL unique index makes the mirror idempotent: one glasses row per
--     (user, `reply-<channel message id>`), so two overlapping long-polls
--     cannot both insert the same reply.
-- Apply by name; replays cleanly.

ALTER TABLE public.glasses_devices
  ADD COLUMN IF NOT EXISTS reply_channel_id uuid NULL;

ALTER TABLE public.glasses_devices
  ADD COLUMN IF NOT EXISTS reply_cursor_seq bigint NULL;

CREATE UNIQUE INDEX IF NOT EXISTS glasses_messages_reply_card_uidx
  ON public.glasses_messages (user_id, card_id)
  WHERE card_id LIKE 'reply-%';

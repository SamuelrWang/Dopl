-- Channels v1.2 backend review — consent de-dupe key + presence status CHECK.
--
-- Both changes are ADDITIVE (one partial unique index, one CHECK constraint).
-- No column or row is altered. Both target tables were empty when this was
-- applied, so neither needs a backfill or a NOT VALID staging step.
--
-- ---------------------------------------------------------------------------
-- 1. channel_consent_requests — de-dupe a trigger in the DATABASE
-- ---------------------------------------------------------------------------
-- One trigger must map to exactly one decision. The service de-dupes on read
-- before inserting, but that is read-then-write: the desktop replays creates
-- on crash-recovery and races its own retries, so two concurrent POSTs can
-- both miss the read and both insert. The consequences are not cosmetic:
--   * inbound  — a trigger the human DENIED gets re-raised as a fresh pending
--                card, and if a trust rule was added meanwhile it auto-allows
--                work the human explicitly refused;
--   * outbound — two review rows for one drafted reply, and approving each
--                posts the agent's reply to the channel twice.
-- The key includes operator_user_id because every recipient of a message
-- raises their OWN request against the same (channel, seq); a channel-wide
-- key would collide across teammates. Partial on message_seq IS NOT NULL —
-- a request raised without a triggering seq has no trigger identity to
-- de-dupe on and stays unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS channel_consent_requests_trigger_key
  ON public.channel_consent_requests
     (operator_user_id, channel_id, kind, message_seq)
  WHERE message_seq IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 2. agent_presence.status — constrain the listener state
-- ---------------------------------------------------------------------------
-- `status` shipped as unconstrained TEXT written straight from the heartbeat
-- body. It is write-mostly today (the UI derives online/offline from
-- last_seen_at), which is exactly why an open column is a liability: it is a
-- caller-controlled string sitting in a table a later UI will render. The
-- heartbeat schema now validates the same closed set; this is the
-- defense-in-depth half, so the constraint holds for any writer.
ALTER TABLE public.agent_presence
  ADD CONSTRAINT agent_presence_status_check
  CHECK (status IN ('listening', 'busy', 'paused', 'offline'));

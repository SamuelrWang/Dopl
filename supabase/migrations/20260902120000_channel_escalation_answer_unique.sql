-- `channel_messages` — ONE ANSWER PER ESCALATION, enforced at rest.
-- Structured escalation cards (Samuel's ruling, 2026-08-31;
-- docs/specs/agent-direct-lane-and-escalations.plan.md §2.3).
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ── WHAT IT IS ─────────────────────────────────────────────────────────────
-- An agent may now post an ESCALATION: `kind='message'` carrying reserved,
-- server-stamped `metadata.escalation` (a short issue, bounded context, 2-6
-- options with consequences, and a recommendation). The channels transcript
-- renders it as a CARD with OPTION BUTTONS; pressing one posts an ordinary
-- message carrying reserved `metadata.escalationAnswer`, which is what routes
-- the choice back to the asking agent and wakes it.
--
-- This migration adds exactly one thing: the constraint that an escalation has
-- AT MOST ONE answer.
--
-- ── WHY AT REST, AND NOT A READ-THEN-WRITE CHECK IN THE SERVICE ────────────
-- Two operators pressing two different options within the same second is not a
-- hypothetical: a card is a notification, both of them get it, and the whole
-- design invites a fast answer. A `SELECT ... IF NOT EXISTS ... INSERT` is a
-- race with a friendlier error message and no guarantee behind it, and the
-- failure it lets through is the worst one available here — the asking agent is
-- woken TWICE with two contradictory answers to one question and has no way to
-- tell which its operator meant.
--
-- The index makes the second writer lose with a 23505, which
-- `service-writes.ts › postMessage` converts to `EscalationAlreadyAnsweredError`
-- -> 409 `CHANNEL_ESCALATION_ANSWERED`. ⚠ It is deliberately NOT converged onto
-- the first answer the way a `client_msg_id` collision is: an idempotency retry
-- is the SAME caller asking for the SAME thing, and reporting somebody else's
-- decision back as this caller's own is a different act entirely.
--
-- ── WHY AN EXPRESSION INDEX OVER JSONB, WHICH IS THE OBVIOUS OBJECTION ─────
-- The alternative is a column, and a column is wrong here on the model:
-- `escalationAnswer` is METADATA on an otherwise ordinary message, exactly like
-- `taskId` / `fanoutGroup` / `mentionedUserIds`, and `channel_messages` is a hot,
-- published table whose column set is deliberately small. A nullable column
-- carrying a foreign key into the same table would also make the transcript's
-- DTO grow a field every reader must then learn to ignore.
--
-- ⚠ THE PREDICATE IS WHAT KEEPS THE COST AT ZERO FOR EVERY OTHER MESSAGE.
-- `WHERE metadata ? 'escalationAnswer'` means the index holds one entry per
-- ANSWER — a handful of rows per channel, ever — rather than one per message.
-- Without it, every ordinary post would pay an index write to store a NULL.
--
-- ⚠ THE KEY IS THE ANSWERED ESCALATION'S ID, NOT THE ANSWER'S OWN. That is the
-- whole constraint: "this escalation already has an answer".
--
-- ── WHAT THIS MIGRATION IS *NOT* ───────────────────────────────────────────
-- ⚠ NOT A REALTIME CHANGE. It touches no SELECT policy, no column GRANT, no
-- replica identity and no publication membership. `channel_messages` is already
-- published and already at `REPLICA IDENTITY USING INDEX
-- channel_messages_replica_identity_idx` (`20260822130000`); nothing here goes
-- near either, and adding an ordinary partial index does not.
-- ⚠ NOT A `kind` CHANGE. An escalation rides `kind='message'`, deliberately and
-- permanently: `dopl-desktop-app/main/targeting.js › classify` returns `ignore`
-- for every `kind <> 'message'`, so a card on any other kind could never notify
-- the human it is asking. The six-value `channel_messages_kind_check` from
-- `20260725120000_channels.sql` is untouched.
-- ⚠ NO READ INDEX. The card finds its own answer inside the transcript page the
-- surface has already fetched; there is no query anywhere that looks an answer
-- up by escalation id, and an index with no statement behind it is exactly what
-- `20260805120000`'s rule forbids.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The index exists, is UNIQUE and is PARTIAL:
--   SELECT indexdef FROM pg_indexes
--    WHERE tablename = 'channel_messages'
--      AND indexname = 'channel_messages_escalation_answer_key';
--   -- expect CREATE UNIQUE INDEX ... ((metadata -> 'escalationAnswer' ->> 'escalationMessageId')) WHERE (metadata ? 'escalationAnswer')
--
--   -- 2. Replica identity and publication are UNCHANGED:
--   SELECT c.relreplident, i.relname FROM pg_index ix
--     JOIN pg_class c ON c.oid = ix.indrelid
--     JOIN pg_class i ON i.oid = ix.indexrelid
--    WHERE c.relname = 'channel_messages' AND ix.indisreplident;
--   -- expect 'i' and channel_messages_replica_identity_idx
--
--   -- 3. THE BEHAVIOUR, which the catalog cannot confirm: two answers naming one
--   --    escalation -> the second is 23505 -> 409 CHANNEL_ESCALATION_ANSWERED;
--   --    two answers naming DIFFERENT escalations both succeed; and an ordinary
--   --    message with no `escalationAnswer` key is unaffected however many are
--   --    posted.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   -- In a NEW migration. Safe in either order; this index is not the replica
--   -- identity and nothing depends on it existing:
--   --   DROP INDEX IF EXISTS public.channel_messages_escalation_answer_key;
--   -- ⚠ Dropping it does not corrupt anything already stored — it removes the
--   -- guarantee going forward, so an escalation can then collect two answers and
--   -- wake its agent twice. Prose rather than commented-out SQL, per
--   -- `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs`'s comment-blind
--   -- parser.

CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_escalation_answer_key
  ON public.channel_messages
     ((metadata -> 'escalationAnswer' ->> 'escalationMessageId'))
  WHERE metadata ? 'escalationAnswer';

COMMENT ON INDEX public.channel_messages_escalation_answer_key IS
  'One answer per structured escalation. A second answer 23505s and the service raises EscalationAlreadyAnsweredError (409 CHANNEL_ESCALATION_ANSWERED) rather than converging onto the first — reporting somebody else''s decision back as the caller''s own is a different act from an idempotency retry.';

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT indexdef INTO def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'channel_messages'
     AND indexname  = 'channel_messages_escalation_answer_key';

  IF def IS NULL THEN
    RAISE EXCEPTION
      'ABORT: channel_messages_escalation_answer_key was not created — an escalation could then collect two answers and wake its agent twice';
  END IF;

  IF def NOT LIKE '%UNIQUE%' THEN
    RAISE EXCEPTION
      'ABORT: channel_messages_escalation_answer_key is not UNIQUE — it would cost writes and guarantee nothing';
  END IF;

  -- ⚠ The PARTIAL predicate is the cost control, not a detail: without it every
  -- ordinary message pays an index write to store a NULL.
  IF def NOT LIKE '%WHERE%escalationAnswer%' THEN
    RAISE EXCEPTION
      'ABORT: channel_messages_escalation_answer_key is not partial — every message in the deployment would pay for it';
  END IF;

  -- The replica identity must be exactly where 20260822130000 left it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
     WHERE c.relname = 'channel_messages'
       AND ix.indisreplident
       AND i.relname = 'channel_messages_replica_identity_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages replica identity moved — this migration must not touch it, so something else did';
  END IF;

  RAISE NOTICE
    'channel_messages_escalation_answer_key created: UNIQUE, PARTIAL on metadata ? escalationAnswer. Not a realtime change — no policy, grant, publication or replica-identity edit.';
END
$$;

-- `channel_pings` — THE "NEEDS YOU" SIGNAL (2026-09-01, docs/specs/needs-you-ping.md).
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ── WHAT IT IS ─────────────────────────────────────────────────────────────
-- One row = one agent saying ONE of three things — it is `done`, it has a
-- `question`, it is `blocked` — to EXACTLY ONE recipient. The recipient is one of:
-- another member of the channel, the sender's own operator's external Desktop
-- Agent, or one named agent session on the sender's own operator's machine.
--
-- It exists because there was no out-of-band, one-recipient signal at all. An
-- agent that finishes has only the room: an UNADDRESSED agent-authored post starts
-- nobody (THE LOOP BRAKE, INVARIANTS §5), and an ADDRESSED one fans out to
-- everyone and triggers a machine. So "I am done, come look" had no instrument,
-- and escalation cards sat unread.
--
-- ── WHY IT IS NOT A `channel_messages` ROW ─────────────────────────────────
-- `escalate` rides `kind:'message'` metadata and that was right for it: an
-- escalation is PUBLIC in the transcript and its answer comes back as a message.
-- A ping is the opposite on every axis, and they are `20260903120000`'s axes:
--   1. **IT MUST NOT FAN OUT.** A `channel_messages` row is read by every channel
--      member and classified by every listener. "Targets one recipient" is not a
--      property that table can carry.
--   2. **IT MUST NOT END A CHANNEL `await`.** A signal that consumed the message
--      cursor would make an orchestrator's `await` return on housekeeping.
--   3. **IT NEEDS ITS OWN CURSOR.** `/api/pings/await?since=` is held by a session
--      that is NOT reading the channel. Sharing `channel_messages.seq` would let
--      one stream's progress silently skip the other's rows.
-- ⚠ The consequence, stated so nobody re-derives it as a bug: **a ping has no
-- `channel_messages.seq` and can never end a channel `await`.** Its own `seq`
-- below is a SEPARATE cursor space, read only by the ping routes.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--   seq               THE PING CURSOR. `channel_messages.seq`'s own idiom
--                     (`GENERATED ALWAYS AS IDENTITY`), and table-global rather
--                     than per-channel for the same reason the workspace await's
--                     cursor is: one held request covers every channel, so one
--                     monotonic number is what "since" can mean. It is GAPPY for
--                     any single reader (rows they cannot see still consume it),
--                     which is legal — a cursor is an ordering, not a count.
--   sender_user_id    ⚠ ALWAYS `ctx.userId`, never a request field.
--   sender_agent_id   ⚠ A CAPTION AND NOTHING ELSE, `channel_agent_directions`'
--                     column's rule verbatim: derived server-side from the
--                     `X-Dopl-Session-Id` tail, dropped unless it matches the
--                     charset, and **nothing may gate, route, filter or authorize
--                     on it**. It is what a UI prints beside the row.
--   recipient_kind    ⚠ member | agent | desktop — a CLOSED set, stamped by the
--                     service from WHICH argument the caller used, never sent. It
--                     is stored rather than derived because three readers (the
--                     await, the desktop mailbox, the card) would otherwise each
--                     re-derive "self + no agent means desktop" and one of them
--                     would drift.
--   recipient_user_id ⚠ WHOSE INBOX. For `agent` and `desktop` it is STAMPED
--                     `ctx.userId` and there is no argument that could say
--                     otherwise — that stamp IS the loop brake, `direct_agent`'s
--                     verbatim: **an agent can never ping another member's agent.**
--                     For `member` it is a member of THIS channel, resolved from
--                     `to=`, and the sender must be a member too.
--   recipient_agent_id ⚠ Set iff `recipient_kind='agent'`, and the charset is
--                     `main/agent-id.js › AGENT_ID_RE` — it is rendered into an MCP
--                     result, so it cannot be allowed to carry a newline.
--   kind              done | question | blocked. THREE WORDS, closed. A fourth is
--                     a schema change in three trees on purpose: this CHECK, the
--                     `closedEnum` in `schema-ping.ts`, and the desktop's own copy.
--   body              ONE LINE, 1..600. Deliberately far under a message's 16000:
--                     a ping is a signal, and the thread it points at is where the
--                     report lives. A cap that invited a report would produce
--                     pings nobody reads, which is the failure this table exists
--                     to fix.
--
-- ── WHAT IS DELIBERATELY ABSENT (v1, minimal-first) ────────────────────────
-- No `read_at` / ack, no expiry, no cron, no DELETE path. Rows are the record.
-- An ack column plus a PATCH route is the first extension and is purely additive.
--
-- ── REALTIME ───────────────────────────────────────────────────────────────
-- INSERT only. The desktop chains a binding onto its existing per-workspace socket
-- (`main/realtime-mailboxes.js`) exactly as it does for directions; there is no
-- UPDATE and no DELETE, so a doorbell for either would be a cost with no event.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- SELECT only, and it is BOTH fences at once: channel membership (so a ping cannot
-- outlive the reader's access to the room it is about) AND party (so a ping is not
-- published to the whole room, which is the property this table exists to have).
-- Writes are REVOKEd and there is no write policy — every insert goes through the
-- service on the admin client, where the sender and the two self-scoped recipients
-- are stamped from the authenticated context.
--
-- ── VERIFICATION (after applying) ──────────────────────────────────────────
--   select policyname, cmd from pg_policies where tablename = 'channel_pings';
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'channel_pings';
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Drop the table. It has no dependents: nothing references `channel_pings`, and
-- both readers (the ping routes, the desktop mailbox) fail closed on its absence.
-- The publication membership goes with the table.

CREATE TABLE IF NOT EXISTS public.channel_pings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- THE PING CURSOR. See the header: a separate cursor space from message `seq`.
  seq                 BIGINT GENERATED ALWAYS AS IDENTITY,
  -- Denormalized for the RLS fence + the realtime subscription filter, the same
  -- as every other channel child.
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id          UUID NOT NULL REFERENCES public.channels(id)   ON DELETE CASCADE,
  -- ⚠ SET NULL, not CASCADE, per `channel_agent_directions.task_id`: a thread
  -- deleted under a ping leaves the row standing and threadless.
  -- Wire/storage name `task` == domain name `thread`.
  task_id             UUID REFERENCES public.channel_tasks(id) ON DELETE SET NULL,
  -- ⚠ WHO SENT IT. Always the authenticated caller; never a request field.
  sender_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ⚠ A CAPTION. See the header for what it must never be used for.
  sender_agent_id     TEXT CHECK (sender_agent_id IS NULL OR sender_agent_id ~ '^[a-z][a-z0-9]{7}$'),
  recipient_kind      TEXT NOT NULL CHECK (recipient_kind IN ('member','agent','desktop')),
  -- ⚠ WHOSE INBOX. Stamped `ctx.userId` for 'agent' and 'desktop'.
  recipient_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_agent_id  TEXT CHECK (recipient_agent_id IS NULL OR recipient_agent_id ~ '^[a-z][a-z0-9]{7}$'),
  kind                TEXT NOT NULL CHECK (kind IN ('done','question','blocked')),
  body                TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 600),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⚠ THE RECIPIENT SHAPE IS ONE FACT, SO IT IS ONE CONSTRAINT. Without it a row
-- could claim `recipient_kind='agent'` with no agent to deliver to — a ping the
-- desktop would read, find undeliverable, and have nothing honest to say about —
-- or carry an agent id under 'member', which would address a stranger's machine.
-- Enforced at rest rather than trusted from the service, because it is the half of
-- the loop brake that a later edit could relax without noticing.
ALTER TABLE public.channel_pings
  ADD CONSTRAINT channel_pings_recipient_shape
  CHECK (
    (recipient_kind = 'agent') = (recipient_agent_id IS NOT NULL)
  );

-- ── INDEXES: one per named statement, and an FK cascade counts as one ──────
-- The rule is `20260805120000`'s: an index exists only if a statement uses it.

-- THE INBOX READ AND THE HELD AWAIT — "my pings after seq N", the only two
-- statements that read rows for a recipient. Both order by `seq`.
CREATE INDEX IF NOT EXISTS channel_pings_recipient_seq_idx
  ON public.channel_pings (recipient_user_id, seq);

-- FK cover: `channels(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS channel_pings_channel_idx
  ON public.channel_pings (channel_id);

-- FK cover: `channel_tasks(id) ON DELETE SET NULL`. It is the lint `20260802180000`
-- exists to keep at zero — without it a thread delete would scan the whole table.
CREATE INDEX IF NOT EXISTS channel_pings_task_idx
  ON public.channel_pings (task_id);

-- FK cover: `workspaces(id) ON DELETE CASCADE`. ⚠ ALSO the replica identity below,
-- which is why it is UNIQUE and leads with `workspace_id`.
CREATE UNIQUE INDEX IF NOT EXISTS channel_pings_replica_identity_idx
  ON public.channel_pings (workspace_id, id);

-- ⚠ NO INDEX ON `sender_user_id`, DELIBERATELY. No statement reads by sender: the
-- SELECT policy's sender arm exists so a sender can see what it sent through a read
-- that is already narrowed by channel, and `auth.users` cascades by primary key.

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the parent
-- channel's, keyed on NEW.channel_id) — the same trigger every channel child
-- carries, so a ping cannot name a channel in another workspace.
DROP TRIGGER IF EXISTS channel_pings_workspace_guard
  ON public.channel_pings;
CREATE TRIGGER channel_pings_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id
  ON public.channel_pings
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_pings
  REPLICA IDENTITY USING INDEX channel_pings_replica_identity_idx;

-- ⚠ INSERT only. A ping has no lifecycle — no claim, no ack, no delete — so an
-- UPDATE or DELETE doorbell would be a cost with no event behind it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'channel_pings'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.channel_pings;
  END IF;
END
$$;

ALTER TABLE public.channel_pings ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE
  ON public.channel_pings FROM authenticated, anon;

-- BOTH FENCES AT ONCE, and neither alone is the rule.
--   `is_channel_member` alone would publish every ping to the whole room — the one
--   property this table exists NOT to have.
--   The party clause alone would let a removed member keep reading pings about a
--   channel they no longer belong to.
CREATE POLICY channel_pings_party_select
  ON public.channel_pings
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND is_channel_member(channel_id)
    AND (
      recipient_user_id = (SELECT auth.uid())
      OR sender_user_id = (SELECT auth.uid())
    )
  );

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_pings'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_pings has a non-SELECT policy — every write must go through the service on the admin client, where sender_user_id and the two self-scoped recipients are stamped from the authenticated context';
  END IF;

  IF has_table_privilege('authenticated', 'public.channel_pings', 'INSERT')
     OR has_table_privilege('anon', 'public.channel_pings', 'INSERT') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon can INSERT channel_pings — a client could forge sender_user_id and ping another operator''s agent, which is the loop brake';
  END IF;

  -- ⚠ THE PARTY CLAUSE IS WHAT MAKES A PING ONE-RECIPIENT. If the SELECT policy
  -- ever became a plain channel-member read, every ping would be published to the
  -- whole room and the table would be a worse `channel_messages`. Asserted rather
  -- than trusted.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_pings'
       AND policyname = 'channel_pings_party_select'
       AND qual LIKE '%recipient_user_id%'
  ) THEN
    RAISE EXCEPTION
      'ABORT: the SELECT policy does not scope on recipient_user_id — a ping targets ONE recipient and must never be readable by the whole channel';
  END IF;

  RAISE NOTICE
    'channel_pings created: party-scoped SELECT inside channel membership, service-role writes, INSERT published, replica identity on (workspace_id, id). seq is a SEPARATE cursor space from channel_messages.seq. No ack, no expiry, no delete.';
END
$$;

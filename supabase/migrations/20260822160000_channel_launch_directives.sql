-- `channel_launch_directives` — LAUNCH-OVER-MCP (Samuel's ruling, 2026-08-22:
-- approved, with a LOCAL DESKTOP TOGGLE as the consent).
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ── WHAT IT IS ─────────────────────────────────────────────────────────────
-- One row = one REQUEST, from an operator's own external agent to that same
-- operator's own desktop: "start an agent in this channel". The desktop watches
-- the table over Realtime, decides, and writes back a terminal status. **The
-- server never starts anything** — it cannot; agents run in a desktop main
-- process the server cannot reach — so this table is a MAILBOX, not a command.
--
-- ── WHY IT IS NOT A `channel_messages` ROW, WHICH IS THE FIRST THING ANYONE
--    WILL ASK (INVARIANTS §5) ────────────────────────────────────────────────
-- A directive looks like a message: it has an author, a channel, a body-ish
-- `goal`, and a recipient who acts on it. It is deliberately NOT one, for two
-- reasons that are each independently sufficient.
--
--   1. **THE LOOP BRAKE.** §5's absolute rule is that an AGENT-authored message
--      addressed to a member TRIGGERS that member's listener. A launch directive
--      is agent-authored and its whole purpose is to start an agent — so as a
--      message it would be a self-feeding cycle with a channel post at every
--      hop: agent posts "start an agent", listener starts an agent, that agent
--      posts, and the operator pays a consent decision per turn of the loop. The
--      brake exists precisely to stop an agent waking another by talking, and a
--      launch request is the one payload that must not be able to route through
--      the same door. A separate table cannot trigger a listener, cannot be
--      awaited, and cannot fan out.
--   2. **TRANSCRIPT PURITY.** `channel_messages` is what BOTH members read, and
--      it is the record of what was said between two people. A directive is not
--      addressed to the counterparty, is not about the work, and is refused or
--      expired more often than not. Putting machine-to-machine plumbing in the
--      shared transcript makes every human reader scroll past it, makes
--      `op="read"` pages noisier for every agent, and — worse — leaks the
--      operator's ORCHESTRATION (how many agents they tried to start, on what
--      model, and how often their machine said no) into a room the counterparty
--      can read. This table is owner-only for that reason.
--
-- ⚠ The consequence, stated so nobody re-derives it as a bug: **a directive has
-- no `seq` and can never end an `await`.** The agent that created one either
-- holds on the row itself (bounded, `channel-ops-launch.ts`) or finds the result
-- in `read_sessions` later. That is the intended shape.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--   operator_user_id  ⚠ **ALWAYS `ctx.userId`, NEVER A PARAMETER.** There is no
--                     field in any request body for it and there must never be.
--                     A directive names the machine it will run on, and the only
--                     machine an agent may ask to start something is its own
--                     operator's. This is the entire authorization story, and it
--                     is enforced three times over: the service stamps it, the
--                     SELECT policy re-checks it against `auth.uid()`, and the
--                     claim/decide routes scope every UPDATE to it.
--   goal / model      what to do, on what. Both nullable — a directive with no
--                     goal starts an agent that waits, which is a legitimate ask.
--   status            pending → claimed → launched | refused, or expired.
--   refusal_reason    ⚠ ONE OF EXACTLY SIX WORDS (see the CHECK). A free-text
--                     reason would be desktop-authored prose rendered into an
--                     MCP result, and the readable sentence would then live on
--                     the machine that cannot be updated without a release.
--   agent_id          the instance the desktop actually started, on `launched`.
--                     It is what the requester types as `@<id>` to direct it.
--   expires_at        NOT NULL. See the lazy-expiry note.
--
-- ── LAZY EXPIRY: NO CRON, AND THE STATUS COLUMN NEVER SAYS 'expired' ───────
-- `expires_at` is enforced at READ time, in the service: any directive with
-- `now() > expires_at` and a non-terminal status REPORTS as 'expired'. Nothing
-- sweeps the table. ⚠ **So the stored `status` can disagree with the reported
-- one, and that is by design** — a cron to reconcile them would be a scheduled
-- job whose only output is cosmetic, and this repo has one standing lesson about
-- crons (they are an environment fact nothing in the repo can observe). The
-- 'expired' value stays in the CHECK because a future sweep, or a desktop that
-- declines by letting a claim lapse, may want to write it.
-- ⚠ THE CLAIM CAS IS WHAT MAKES THIS SAFE: a desktop can only move a row out of
-- 'pending', so an expired-but-pending row that gets claimed late is still a
-- single-winner transition. The service refuses to REPORT it as claimable.
--
-- ── REALTIME: INSERT **AND** UPDATE ────────────────────────────────────────
-- The desktop needs the INSERT (a new directive to decide) and the UPDATE frames
-- too: several of an operator's machines may be signed in, one claims, and the
-- others must see the row leave 'pending' rather than race a CAS they will lose.
-- The CAS is the correctness mechanism; the UPDATE frame is what keeps the other
-- machines from spending a round trip to discover they lost.
--
-- ⚠ REPLICA IDENTITY `USING INDEX (workspace_id, id)`, per the precedent in
-- `20260822130000_channel_messages_delete_doorbell.sql` — READ THAT FILE FIRST;
-- it carries the verified account of how the deployed `realtime.apply_rls`
-- evaluates a subscription filter against `old_columns`. Subscribers filter on
-- `workspace_id=eq.<id>`, and under DEFAULT replica identity an UPDATE frame's
-- `old_record` is PK-only, so the filter drops it. The pair costs +16 bytes of
-- WAL per UPDATE on a table that takes at most two UPDATEs per row, ever.
-- ⚠ LOUD FAILURE, unchanged from that precedent: `REPLICA IDENTITY USING INDEX`
-- REQUIRES the index to keep existing. Dropping it leaves the table at replica
-- identity NOTHING, and every UPDATE on a published table then FAILS outright —
-- which here means claim and decide both stop working. The name
-- `*_replica_identity_idx` is the warning. A future migration that must replace
-- it: set the table back to DEFAULT first, drop, recreate, re-point.
--
-- ── RLS: SELECT ONLY, OWNER-ONLY, NO WRITE POLICY AT ALL ──────────────────
-- The only policy is a SELECT for the operator themselves. There is deliberately
-- **no INSERT, UPDATE or DELETE policy**, and writes are REVOKEd from
-- `authenticated`/`anon`: every write goes through the service on the admin
-- client, which is where `operator_user_id = ctx.userId` is stamped and where the
-- claim CAS lives. A write policy would be a second, weaker statement of the same
-- fence — and the CAS cannot be expressed as one.
-- ⚠ The SELECT policy is NOT the peer-visibility question this table's siblings
-- have: a channel member has no business reading another member's launch
-- attempts (see TRANSCRIPT PURITY above). `is_current_workspace_member(…,
-- 'viewer')` is the outer fence and `operator_user_id = auth.uid()` is the real
-- one.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. Publication + replica identity:
--   SELECT c.relreplident, i.relname
--     FROM pg_index ix
--     JOIN pg_class c ON c.oid = ix.indrelid
--     JOIN pg_class i ON i.oid = ix.indexrelid
--    WHERE c.relname = 'channel_launch_directives' AND ix.indisreplident;
--   -- expect 'i' and channel_launch_directives_replica_identity_idx
--   SELECT * FROM pg_publication_tables
--    WHERE tablename = 'channel_launch_directives';
--
--   -- 2. Exactly one policy, and it is a SELECT:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'channel_launch_directives';
--
--   -- 3. THE BEHAVIOUR, which the catalog cannot confirm: an MCP
--   --    op="launch_agent" on a signed-in desktop produces an agent id inside
--   --    the hold; the same call with the desktop's toggle OFF comes back
--   --    refused with `no-bridge`; and another user's directive is invisible.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   -- In a NEW migration, and REPLICA IDENTITY DEFAULT must come BEFORE any
--   -- drop of the index:
--   --   ALTER TABLE public.channel_launch_directives REPLICA IDENTITY DEFAULT;
--   --   ALTER PUBLICATION supabase_realtime DROP TABLE public.channel_launch_directives;
--   --   DROP TABLE public.channel_launch_directives;
--   -- Written as prose rather than as commented-out SQL because
--   -- `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this
--   -- directory WITHOUT stripping comments, and a commented-out
--   -- `ALTER TABLE ... REPLICA IDENTITY DEFAULT` reads to that parser as a real
--   -- revert.

CREATE TABLE IF NOT EXISTS public.channel_launch_directives (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized for the RLS fence + the realtime subscription filter, the same
  -- as every other channel child.
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id        UUID NOT NULL REFERENCES public.channels(id)   ON DELETE CASCADE,
  -- ⚠ SET NULL, not CASCADE: a thread deleted under a pending directive should
  -- leave the directive standing and threadless (the agent can still start in
  -- the channel), exactly as `channel_sessions.task_id` does. Wire/storage name
  -- `task` == domain name `thread`.
  task_id           UUID REFERENCES public.channel_tasks(id) ON DELETE SET NULL,
  -- ⚠ WHOSE MACHINE. Always the authenticated caller; never a request field.
  operator_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal              TEXT,
  model             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','claimed','launched','refused','expired')),
  -- ⚠ EXACTLY SIX WORDS, and the closed set is the contract both trees code
  -- against. The desktop picks a word; the MCP result writes the sentence. A
  -- seventh reason is a schema change in both trees on purpose — a free-text
  -- column here would put agent-facing prose on the machine that is hardest to
  -- update, and would put desktop-authored text into a rendered result.
  refusal_reason    TEXT CHECK (
                      refusal_reason IS NULL OR refusal_reason IN (
                        'cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty'
                      )
                    ),
  -- The agent instance the desktop started, on `launched`. Charset matches
  -- `dopl-desktop-app/main/agent-id.js` (`^[a-z][a-z0-9]{7}$`) — it is rendered
  -- into an MCP result as `@<id>`, so it cannot be allowed to carry a newline.
  agent_id          TEXT CHECK (agent_id IS NULL OR agent_id ~ '^[a-z][a-z0-9]{7}$'),
  claimed_at        TIMESTAMPTZ,
  decided_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⚠ A REFUSAL CARRIES A REASON AND A LAUNCH CARRIES AN AGENT. Without this, a
-- desktop could write `status='refused'` with no reason and the MCP result would
-- have nothing honest to say — the one outcome an orchestrator most needs
-- worded. Enforced at rest rather than trusted from the route, because the route
-- is one of two writers and the desktop is the other.
ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_terminal_shape
  CHECK (
    (status <> 'refused' OR refusal_reason IS NOT NULL)
    AND (status <> 'launched' OR agent_id IS NOT NULL)
    AND (status NOT IN ('launched','refused') OR decided_at IS NOT NULL)
  );

-- ── INDEXES: one per named statement, and an FK cascade counts as one ──────
-- The rule is `20260805120000`'s: an index exists only if a statement uses it.

-- THE DESKTOP'S POLL/RECOVERY READ — "my pending directives", and the FK cover
-- for `auth.users`. A desktop that missed a realtime frame (asleep, reconnect)
-- reads exactly this.
CREATE INDEX IF NOT EXISTS channel_launch_directives_operator_pending_idx
  ON public.channel_launch_directives (operator_user_id, status, created_at DESC);

-- FK cover: `channels(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS channel_launch_directives_channel_idx
  ON public.channel_launch_directives (channel_id);

-- FK cover: `channel_tasks(id) ON DELETE SET NULL`. It is the lint
-- `20260802180000` exists to keep at zero — without it a thread delete would
-- scan the whole table to null out its directives.
CREATE INDEX IF NOT EXISTS channel_launch_directives_task_idx
  ON public.channel_launch_directives (task_id);

-- FK cover: `workspaces(id) ON DELETE CASCADE`. ⚠ ALSO the replica identity
-- below, which is why it is UNIQUE and leads with `workspace_id`.
CREATE UNIQUE INDEX IF NOT EXISTS channel_launch_directives_replica_identity_idx
  ON public.channel_launch_directives (workspace_id, id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the
-- parent channel's, keyed on NEW.channel_id) — the same trigger every channel
-- child carries, so a directive cannot name a channel in another workspace.
DROP TRIGGER IF EXISTS channel_launch_directives_workspace_guard
  ON public.channel_launch_directives;
CREATE TRIGGER channel_launch_directives_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id
  ON public.channel_launch_directives
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_launch_directives
  REPLICA IDENTITY USING INDEX channel_launch_directives_replica_identity_idx;

-- ⚠ INSERT and UPDATE only. There is no DELETE path — rows are kept as the
-- record of what was asked and what the machine said — so a DELETE doorbell
-- would be a cost with no event behind it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'channel_launch_directives'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.channel_launch_directives;
  END IF;
END
$$;

ALTER TABLE public.channel_launch_directives ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE
  ON public.channel_launch_directives FROM authenticated, anon;

-- OWNER-ONLY READ. ⚠ Not a channel-member read: a directive is the operator's
-- own orchestration and the counterparty has no business seeing how many agents
-- someone tried to start, on what model, or how often their machine refused.
CREATE POLICY channel_launch_directives_owner_select
  ON public.channel_launch_directives
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND operator_user_id = (SELECT auth.uid())
  );

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_launch_directives'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_launch_directives has a non-SELECT policy — every write must go through the service on the admin client, where operator_user_id is stamped from the authenticated context and the claim CAS lives';
  END IF;

  IF has_table_privilege('authenticated', 'public.channel_launch_directives', 'UPDATE')
     OR has_table_privilege('anon', 'public.channel_launch_directives', 'UPDATE') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon can UPDATE channel_launch_directives — the claim CAS would not be the only way a row leaves pending';
  END IF;

  RAISE NOTICE
    'channel_launch_directives created: owner-only SELECT, service-role writes, INSERT+UPDATE published, replica identity on (workspace_id, id). Expiry is LAZY — no cron.';
END
$$;

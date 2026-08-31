-- `channel_agent_directions` — THE PRIVATE DIRECT LANE (Samuel's ruling, 2026-08-31:
-- an operator's own external agent may DIRECT one of that operator's own running
-- agent sessions privately, instead of shouting at it through the main room).
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ── WHAT IT IS ─────────────────────────────────────────────────────────────
-- One row = one DIRECTION, from an operator's own external MCP session to that
-- same operator's own desktop: "say this, privately, to THAT agent". The desktop
-- watches the table over Realtime, claims a row, delivers the text into the named
-- session's existing PRIVATE TURN machinery, and writes that turn's final text
-- back as `reply`. **The server never talks to an agent** — it cannot; agents run
-- in a desktop main process the server cannot reach — so this table is a MAILBOX,
-- not a command, exactly as `channel_launch_directives` is.
--
-- ── WHY IT IS A SECOND TABLE AND NOT A KIND ON THE LAUNCH MAILBOX ──────────
-- The two look alike and are deliberately not merged:
--   1. `channel_launch_directives_terminal_shape` asserts `launched => agent_id`,
--      which is meaningless here (the agent id is an INPUT, not an outcome).
--   2. The refusal vocabularies answer different questions — a launch can be
--      capped or lack a runtime; a direction can only fail to find a live session.
--   3. A `reply` column on a launch row is a column that can only ever be null.
-- A kind-discriminated mailbox would make every constraint conditional on the
-- kind, which is the shape that lets a later edit relax one lane's guard for the
-- other's benefit.
--
-- ── WHY IT IS NOT A `channel_messages` ROW ─────────────────────────────────
-- Both of `20260822160000`'s reasons hold unchanged, and a third is stronger here.
--   1. **THE LOOP BRAKE.** An agent-authored message addressed to a member
--      triggers that member's listener. A direction's whole purpose is to reach an
--      agent, so as a message it would be the self-feeding cycle §5's brake exists
--      to stop. A separate table cannot trigger a listener, cannot be awaited, and
--      cannot fan out.
--   2. **TRANSCRIPT PURITY.** `channel_messages` is what BOTH members read. A
--      direction is not addressed to the counterparty and would leak the
--      operator's orchestration into a room the counterparty can read.
--   3. 🔒 **THE LANE IS PRIVATE BY DEFINITION.** Putting it in the shared
--      transcript is not a design trade — it is the feature's negation.
-- ⚠ The consequence, stated so nobody re-derives it as a bug: **a direction has no
-- `seq` and can never end an `await`.** The MCP op holds on the ROW, bounded.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--   operator_user_id  ⚠ **ALWAYS `ctx.userId`, NEVER A PARAMETER.** There is no
--                     field in any request body for it and there must never be.
--                     The only machine an agent may direct is its own operator's,
--                     and this is the entire authorization story — enforced three
--                     times: the service stamps it, the SELECT policy re-checks it
--                     against `auth.uid()`, and every UPDATE is scoped to it.
--   agent_id          ⚠ **REQUIRED, where a launch has none.** A direction with no
--                     addressee would be a broadcast into somebody's private lane,
--                     and "broadcast" is not a shape this product has (§5). There
--                     is deliberately NO oldest-agent fallback: every other op in
--                     the family has one, and for a lane that reaches a PRIVATE
--                     TURN it would steer a different agent than the orchestrator
--                     addressed, with nothing reporting the swap.
--   body              the direction itself. Capped at 4000 to match the desktop's
--                     own `MESSAGE_CAP` and the preload's `.slice(0, 4000)` — a
--                     cap here that exceeded the IPC one would truncate at the far
--                     end and narrate success.
--   status            pending -> claimed -> delivered | refused, or expired.
--   refusal_reason    ⚠ ONE OF EXACTLY FIVE WORDS (see the CHECK). Free text would
--                     be desktop-authored prose rendered into an MCP result — text
--                     nobody neutralized, on the machine hardest to update.
--   reply             THE DIRECTED TURN'S FINAL TEXT, and nothing else. See below.
--   expires_at        NOT NULL. Lazy expiry, exactly as the launch mailbox.
--
-- ── 🔒 THE REPLY COLUMN IS THE ONE PLACE PRIVATE TEXT LEAVES A MACHINE ─────
-- The private lane is otherwise machine-local by construction: the narration ring
-- is an `electron-store` key and reaches no server. This column is a DELIBERATE,
-- BOUNDED exception with one rule:
--
--   **A DIRECTION THAT ARRIVED FROM OFF-MACHINE GETS AN ANSWER THAT GOES BACK
--   OFF-MACHINE. NOTHING ELSE IN THE PRIVATE LANE EVER LEAVES, AND THIS RULE MAY
--   NOT BE GENERALISED INTO ONE THAT DOES.**
--
-- What is written back: the FINAL TEXT of the turn the direction opened, once, on
-- the `delivered` decide. What is NEVER written back: the narration ring, thinking
-- frames, tool calls and their arguments, any other turn, and anything the
-- OPERATOR typed into their own panel. The alternative — a fire-and-forget
-- direction — makes the orchestrator blind, which is what sends it back to the
-- noisy main-room post this feature exists to replace.
-- ⚠ `delivered` does NOT require a `reply`: a turn whose final text was empty, and
-- an older desktop that delivers without reporting, are both honest `delivered`s.
-- `reply IS NULL` means "not reported", never "the agent said nothing".
--
-- ── LAZY EXPIRY: NO CRON, AND THE STATUS COLUMN NEED NOT SAY 'expired' ─────
-- `expires_at` is enforced at READ time in the service: a non-terminal row past it
-- REPORTS as 'expired'. Nothing sweeps the table. ⚠ The stored `status` can
-- therefore disagree with the reported one, by design — the claim CAS is what makes
-- that safe, since a row can only leave 'pending' once.
--
-- ── REALTIME: INSERT **AND** UPDATE ────────────────────────────────────────
-- The desktop needs the INSERT (a new direction to act on) and the UPDATE frames
-- too: several of one operator's machines may be signed in, one claims, and the
-- others must SEE the row leave 'pending' rather than race a CAS they will lose.
-- ⚠ REPLICA IDENTITY `USING INDEX (workspace_id, id)`, per the precedent in
-- `20260822130000_channel_messages_delete_doorbell.sql` — READ THAT FILE FIRST.
-- Subscribers filter on `workspace_id=eq.<id>`, and under DEFAULT replica identity
-- an UPDATE frame's `old_record` is PK-only, so the filter drops it.
-- ⚠ LOUD FAILURE, unchanged from that precedent: `REPLICA IDENTITY USING INDEX`
-- REQUIRES the index to keep existing. Dropping it leaves the table at replica
-- identity NOTHING and every UPDATE on a published table then FAILS outright —
-- here that means claim and decide both stop working. A future migration that must
-- replace it: set the table back to DEFAULT first, drop, recreate, re-point.
--
-- ── RLS: SELECT ONLY, OWNER-ONLY, NO WRITE POLICY AT ALL ──────────────────
-- The only policy is a SELECT for the operator themselves. There is deliberately
-- **no INSERT, UPDATE or DELETE policy**, and writes are REVOKEd from
-- `authenticated`/`anon`: every write goes through the service on the admin client,
-- which is where `operator_user_id = ctx.userId` is stamped and where the claim CAS
-- lives. A write policy would be a second, weaker statement of the same fence — and
-- the CAS cannot be expressed as one.
-- 🔒 **THE `reply` COLUMN IS WHY THIS POLICY MATTERS MORE HERE THAN ON THE LAUNCH
-- MAILBOX**: it carries a private turn's answer, and a member-scoped read would put
-- one operator's private lane in front of their counterparty.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. Publication + replica identity:
--   SELECT c.relreplident, i.relname
--     FROM pg_index ix
--     JOIN pg_class c ON c.oid = ix.indrelid
--     JOIN pg_class i ON i.oid = ix.indexrelid
--    WHERE c.relname = 'channel_agent_directions' AND ix.indisreplident;
--   -- expect 'i' and channel_agent_directions_replica_identity_idx
--   SELECT * FROM pg_publication_tables
--    WHERE tablename = 'channel_agent_directions';
--
--   -- 2. Exactly one policy, and it is a SELECT:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'channel_agent_directions';
--
--   -- 3. THE BEHAVIOUR, which the catalog cannot confirm: an MCP
--   --    op="direct_agent" naming a live agent comes back with that turn's reply;
--   --    the same call with the desktop's direction toggle OFF lapses with no
--   --    server write at all; and another user's direction is invisible.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   -- In a NEW migration, and REPLICA IDENTITY DEFAULT must come BEFORE any
--   -- drop of the index:
--   --   ALTER TABLE public.channel_agent_directions REPLICA IDENTITY DEFAULT;
--   --   ALTER PUBLICATION supabase_realtime DROP TABLE public.channel_agent_directions;
--   --   DROP TABLE public.channel_agent_directions;
--   -- Written as prose rather than as commented-out SQL because
--   -- `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this
--   -- directory WITHOUT stripping comments, and a commented-out
--   -- `ALTER TABLE ... REPLICA IDENTITY DEFAULT` reads to that parser as a real
--   -- revert.

CREATE TABLE IF NOT EXISTS public.channel_agent_directions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized for the RLS fence + the realtime subscription filter, the same
  -- as every other channel child.
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id        UUID NOT NULL REFERENCES public.channels(id)   ON DELETE CASCADE,
  -- ⚠ SET NULL, not CASCADE, per `channel_launch_directives.task_id`: a thread
  -- deleted under a pending direction leaves the row standing and threadless.
  -- Wire/storage name `task` == domain name `thread`.
  task_id           UUID REFERENCES public.channel_tasks(id) ON DELETE SET NULL,
  -- ⚠ WHOSE MACHINE. Always the authenticated caller; never a request field.
  operator_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ⚠ WHICH AGENT. REQUIRED — see the header. Charset matches
  -- `dopl-desktop-app/main/agent-id.js` (`^[a-z][a-z0-9]{7}$`); it is rendered into
  -- an MCP result, so it cannot be allowed to carry a newline.
  agent_id          TEXT NOT NULL CHECK (agent_id ~ '^[a-z][a-z0-9]{7}$'),
  body              TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','claimed','delivered','refused','expired')),
  -- ⚠ EXACTLY FIVE WORDS, and the closed set is the contract both trees code
  -- against. The desktop picks a word; the MCP result writes the sentence. A sixth
  -- reason is a schema change in both trees on purpose.
  refusal_reason    TEXT CHECK (
                      refusal_reason IS NULL OR refusal_reason IN (
                        'no-session', 'auth-hold', 'busy', 'blocked', 'no-bridge'
                      )
                    ),
  -- THE DIRECTED TURN'S FINAL TEXT. See the header for the one rule governing it.
  reply             TEXT CHECK (reply IS NULL OR char_length(reply) <= 8000),
  claimed_at        TIMESTAMPTZ,
  decided_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⚠ A REFUSAL CARRIES A REASON, AND ANY TERMINAL CARRIES A TIMESTAMP. Without this
-- a desktop could write `status='refused'` with no reason and the MCP result would
-- have nothing honest to say — the one outcome an orchestrator most needs worded.
-- Enforced at rest rather than trusted from the route, because the route is one of
-- two writers and the desktop is the other.
-- ⚠ `delivered` DELIBERATELY DOES NOT REQUIRE A `reply` — see the header.
ALTER TABLE public.channel_agent_directions
  ADD CONSTRAINT channel_agent_directions_terminal_shape
  CHECK (
    (status <> 'refused' OR refusal_reason IS NOT NULL)
    AND (status NOT IN ('delivered','refused') OR decided_at IS NOT NULL)
  );

-- ── INDEXES: one per named statement, and an FK cascade counts as one ──────
-- The rule is `20260805120000`'s: an index exists only if a statement uses it.

-- THE DESKTOP'S POLL/RECOVERY READ — "my pending directions", and the FK cover for
-- `auth.users`. A desktop that missed a realtime frame reads exactly this.
CREATE INDEX IF NOT EXISTS channel_agent_directions_operator_pending_idx
  ON public.channel_agent_directions (operator_user_id, status, created_at DESC);

-- FK cover: `channels(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS channel_agent_directions_channel_idx
  ON public.channel_agent_directions (channel_id);

-- FK cover: `channel_tasks(id) ON DELETE SET NULL`. It is the lint `20260802180000`
-- exists to keep at zero — without it a thread delete would scan the whole table.
CREATE INDEX IF NOT EXISTS channel_agent_directions_task_idx
  ON public.channel_agent_directions (task_id);

-- FK cover: `workspaces(id) ON DELETE CASCADE`. ⚠ ALSO the replica identity below,
-- which is why it is UNIQUE and leads with `workspace_id`.
CREATE UNIQUE INDEX IF NOT EXISTS channel_agent_directions_replica_identity_idx
  ON public.channel_agent_directions (workspace_id, id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the parent
-- channel's, keyed on NEW.channel_id) — the same trigger every channel child
-- carries, so a direction cannot name a channel in another workspace.
DROP TRIGGER IF EXISTS channel_agent_directions_workspace_guard
  ON public.channel_agent_directions;
CREATE TRIGGER channel_agent_directions_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id
  ON public.channel_agent_directions
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_agent_directions
  REPLICA IDENTITY USING INDEX channel_agent_directions_replica_identity_idx;

-- ⚠ INSERT and UPDATE only. There is no DELETE path — rows are kept as the record
-- of what was asked and what the machine said — so a DELETE doorbell would be a
-- cost with no event behind it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'channel_agent_directions'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.channel_agent_directions;
  END IF;
END
$$;

ALTER TABLE public.channel_agent_directions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE
  ON public.channel_agent_directions FROM authenticated, anon;

-- OWNER-ONLY READ. ⚠ Not a channel-member read: a direction is the operator's own
-- private steering AND carries a private turn's answer in `reply`. A counterparty
-- has no business reading either.
CREATE POLICY channel_agent_directions_owner_select
  ON public.channel_agent_directions
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
       AND tablename = 'channel_agent_directions'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_agent_directions has a non-SELECT policy — every write must go through the service on the admin client, where operator_user_id is stamped from the authenticated context and the claim CAS lives';
  END IF;

  IF has_table_privilege('authenticated', 'public.channel_agent_directions', 'UPDATE')
     OR has_table_privilege('anon', 'public.channel_agent_directions', 'UPDATE') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon can UPDATE channel_agent_directions — the claim CAS would not be the only way a row leaves pending';
  END IF;

  -- ⚠ THE REPLY COLUMN IS THE PRIVATE LANE'S ONE EXIT. If the owner-only SELECT
  -- ever became a member read, a counterparty would read the operator's private
  -- turn. Asserted rather than trusted.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_agent_directions'
       AND policyname = 'channel_agent_directions_owner_select'
       AND qual LIKE '%operator_user_id%'
  ) THEN
    RAISE EXCEPTION
      'ABORT: the SELECT policy does not scope on operator_user_id — reply carries a private turn answer and must never be member-readable';
  END IF;

  RAISE NOTICE
    'channel_agent_directions created: owner-only SELECT, service-role writes, INSERT+UPDATE published, replica identity on (workspace_id, id). Expiry is LAZY — no cron. reply carries the directed turn final text ONLY.';
END
$$;

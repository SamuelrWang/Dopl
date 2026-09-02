-- `channel_launch_directives` + `channel_agent_directions` — **A RETRY MAY NOT
-- QUEUE A SECOND AGENT** (2026-09-02, MCP/architecture v2 slice A10, guardrail
-- G10).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED.** Docker is unavailable in the
-- environment this was authored in, so `supabase db reset` has NOT been run
-- against it and this file has executed NOWHERE. Do not read the absence of an
-- error as evidence that it works; the first run is still ahead.
-- ⚠ RE-DERIVE RATHER THAN TRUSTING THAT LINE, AND JOIN ON THE NAME:
-- `supabase migration list --linked` (or MCP `list_migrations`) prints VERSIONS
-- while every doc cites FILENAMES. INVARIANTS §12, F-304's re-stamp — a
-- precedent on this very table claimed "not applied" for a fortnight after it
-- was live.
--
-- ⚠ IT ORDERS AFTER `20260910120000_channel_launch_directives_posture.sql`,
-- which is itself unapplied at the time of writing. Nothing here depends on that
-- file's columns; the ordering is the wave's, not a data dependency.
--
-- ── THE DEFECT THIS CLOSES, AND WHY PROSE COULD NOT ────────────────────────
--
-- `op="launch_agent"` and `op="direct_agent"` hold ~15 s for the operator's
-- machine to answer and then return PENDING. The request is still filed and the
-- machine may still take it, so the surface told the caller in the strongest
-- words available (`channel-doctrine.ts` — "IF A WAIT TIMES OUT THE REQUEST IS
-- STILL PENDING: do NOT issue it again. A second launch starts a SECOND agent on
-- the same work and nothing can tell them apart afterwards"). **Nothing enforced
-- it.** A re-issue wrote a second row, the desktop claimed both, and two agents
-- worked one goal under two handles — the failure the sentence describes, one
-- retry away, with the model that must not retry being the only thing stopping
-- it.
--
-- ⚠ THE HAZARD IS NOT HYPOTHETICAL AND IS NOT THE CALLER BEING CARELESS. A
-- TIMEOUT IS INDISTINGUISHABLE FROM A LOST CALL from where the caller sits: the
-- transport can drop the response of a create that committed. "Do not retry" is
-- therefore an instruction to accept an unknown outcome, which is exactly the
-- situation an idempotency key exists to remove.
--
-- ── THE SHAPE, AND WHY IT IS THE ONE ALREADY IN THE TREE ───────────────────
--
-- `20260729032037_channel_tasks_client_msg_id.sql` (threads) and
-- `20260822120000_channel_messages_author_scoped_idempotency.sql` (messages) are
-- the precedents: a nullable `client_msg_id` plus a PARTIAL UNIQUE INDEX, with
-- the service short-circuiting on the matching read and repairing the race on
-- 23505. This file states the same rule for the two agent mailboxes and invents
-- nothing.
--
-- ⚠ **THE SCOPE IS (channel, SENDER, key) AND THE SENDER COLUMN IS
-- `operator_user_id`.** On both of these lanes the caller and the operator are
-- the same account by construction — no schema on either path has a field that
-- could name another person's machine, and the service stamps `ctx.userId`
-- (`service-launch.ts › createLaunchDirective`, `service-directions.ts ›
-- createAgentDirection`) — so the row's operator IS its sender. Author-scoping
-- rather than channel-scoping is the lesson of `20260822120000`, which widened
-- `channel_messages`' index for a measured attack: a channel-wide key lets one
-- member pre-claim another's key and silently swallow their write. It cannot be
-- reached on these two tables (the SELECT policy is owner-only and every
-- repository predicate is), but a mailbox whose idempotency contract is with the
-- room rather than with the retrying caller is one policy change away from being
-- the same bug, and the correct scope costs nothing today.
--
-- ⚠ **NOT SCOPED ON `kind`, AND THAT IS DELIBERATE.** One key is ONE GESTURE,
-- whatever verb it named: a caller that reuses a key across two different asks
-- gets the first row back, which is what "this key already happened" means
-- everywhere else in this tree. Adding `kind` would make one key mean four
-- different gestures and would silently permit exactly the double-launch this
-- file exists to stop (`launch` + `end` under one key is not a collision the
-- caller intended). Only `launch_agent` supplies a key on the directive table
-- today (`end` / `rename` / `set_agent_mode` send none), so cross-kind reuse is
-- not reachable from the MCP surface at all.
--
-- ⚠ **NULLABLE, AND ABSENT IS THE ORDINARY CASE.** A partial index treats NULLs
-- as absent rows, so every caller that sends no key behaves exactly as it does
-- today — this is additive in the strict sense, and no existing row is touched
-- or read differently. There is no backfill.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--
-- `DROP INDEX` then `DROP COLUMN` on a column nothing else reads. ⚠ Unlike
-- `20260822120000`'s widening, this cannot fail on data written in the meantime:
-- dropping a uniqueness rule never conflicts. The service tolerates the column
-- being gone only in the sense that the code must go with it — a create passing
-- `client_msg_id` to a table without the column is a PostgREST 400, so the code
-- revert and the DDL revert are ONE change, in that order.
--
-- ⚠ NO ROWS, POLICIES, GRANTS, TRIGGERS, CHECKS OR PUBLICATION MEMBERSHIP ARE
-- TOUCHED. The owner-only SELECT policy, the write REVOKE, the claim CAS, the
-- lazy expiry and the replica-identity index all continue to say what they said.
--
-- Verify after applying:
--   -- Both columns exist and are nullable text.
--   SELECT table_name, is_nullable, data_type
--     FROM information_schema.columns
--    WHERE column_name = 'client_msg_id'
--      AND table_name IN ('channel_launch_directives', 'channel_agent_directions');
--
--   -- One partial unique index per table, naming three columns in this order.
--   SELECT c.relname AS table_name, i.relname AS index_name, pg_get_indexdef(i.oid)
--     FROM pg_index ix
--     JOIN pg_class c ON c.oid = ix.indrelid
--     JOIN pg_class i ON i.oid = ix.indexrelid
--    WHERE c.relname IN ('channel_launch_directives', 'channel_agent_directions')
--      AND ix.indisunique;
--
--   -- THE ACTUAL BEHAVIOUR, which the catalog cannot confirm: one operator
--   -- filing two launches in one channel under the same key gets ONE row and the
--   -- SAME directive id back twice; two different keys get two rows.

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS client_msg_id TEXT;

COMMENT ON COLUMN public.channel_launch_directives.client_msg_id IS
  'Caller-minted idempotency key (A10/G10). A re-issue after a timeout returns the stored directive instead of queueing a SECOND agent. Unique per (channel_id, operator_user_id) where present; NULL is the ordinary case and dedupes nothing.';

ALTER TABLE public.channel_agent_directions
  ADD COLUMN IF NOT EXISTS client_msg_id TEXT;

COMMENT ON COLUMN public.channel_agent_directions.client_msg_id IS
  'Caller-minted idempotency key (A10/G10). A re-issue after a timeout returns the stored direction instead of saying the same thing to a live agent twice. Unique per (channel_id, operator_user_id) where present; NULL is the ordinary case and dedupes nothing.';

-- ⚠ `IF NOT EXISTS` ON BOTH HALVES, AND NOT AS A HABIT: INVARIANTS §12 requires
-- every migration in this tree to be replayable, and these two indexes are the
-- only new objects here. NOT `CONCURRENTLY` — Supabase runs a migration inside
-- one transaction and `CONCURRENTLY` cannot. Both tables are small by
-- construction (a row lives two minutes and is read by one machine), so the
-- brief lock is not a production event.
CREATE UNIQUE INDEX IF NOT EXISTS channel_launch_directives_client_msg_key
  ON public.channel_launch_directives (channel_id, operator_user_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS channel_agent_directions_client_msg_key
  ON public.channel_agent_directions (channel_id, operator_user_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

-- ── THE ASSERTIONS. A migration that silently did half its job is the failure
--    mode every file in this directory is written against. ────────────────────
DO $$
DECLARE
  t TEXT;
  idx TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['channel_launch_directives', 'channel_agent_directions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'client_msg_id'
    ) THEN
      RAISE EXCEPTION 'ABORT: %.client_msg_id was not created — a create passing the key would 400 and every retry would file a second row', t;
    END IF;

    -- ⚠ THE PREDICATE IS ASSERTED, NOT JUST THE INDEX. A unique index WITHOUT
    -- `WHERE client_msg_id IS NOT NULL` would be harmless in Postgres (NULLs are
    -- distinct) but would stop being harmless the day anybody set
    -- `NULLS NOT DISTINCT`, and the partial form is what the precedents ship.
    SELECT pg_get_indexdef(i.oid) INTO idx
      FROM pg_class c
      JOIN pg_index ix ON ix.indrelid = c.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
     WHERE c.relname = t AND i.relname = t || '_client_msg_key';

    IF idx IS NULL THEN
      RAISE EXCEPTION 'ABORT: %_client_msg_key is missing — nothing at rest would stop a retry queueing a second agent', t;
    END IF;
    IF position('UNIQUE' IN idx) = 0 THEN
      RAISE EXCEPTION 'ABORT: %_client_msg_key is not UNIQUE — the service race repair has no 23505 to catch and two concurrent retries both file', t;
    END IF;
    IF position('client_msg_id IS NOT NULL' IN idx) = 0 THEN
      RAISE EXCEPTION 'ABORT: %_client_msg_key is not partial — every keyless row would have to be unique on a NULL', t;
    END IF;
    IF position('operator_user_id' IN idx) = 0 THEN
      RAISE EXCEPTION 'ABORT: %_client_msg_key is not scoped to the sender — a room-wide idempotency contract lets one member pre-claim another''s key (20260822120000 is the precedent)', t;
    END IF;
  END LOOP;
END $$;

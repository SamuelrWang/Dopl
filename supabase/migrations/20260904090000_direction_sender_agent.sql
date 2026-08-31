-- ============================================================================
-- channel_agent_directions.sender_agent_id — WHICH of my agents said this
--
-- ⚠ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory). INVARIANTS
-- §12 carries the ledger; the replay is OWED, and this file's parent
-- (`20260903120000_channel_agent_directions.sql`) is owed with it.
--
-- ── WHY IT EXISTS NOW (F-376a) ───────────────────────────────────────────────
--
-- The private direct lane shipped 2026-08-31 with no sender column, because on
-- that day it had exactly one caller shape: the operator's EXTERNAL orchestrator.
-- "Your agent directed this" was the whole truth available and the operator's own
-- panel said so.
--
-- Samuel's same-owner ruling of the same day makes the operator's OWN DESKTOP
-- SESSIONS first-class `direct_agent` callers (`main/session-own-direct.js`). The
-- operator may now have six agents running in one room, any of which can direct
-- any other, and "your agent directed this" stops being a complete sentence: the
-- reader cannot tell the supervisor's correction from a peer worker's aside, and
-- the two mean different things about what to do next.
--
-- ── 🔒 IT IS A LABEL. IT IS NOT, AND MUST NEVER BECOME, A FENCE ──────────────
--
-- ⚠ **THE VALUE IS UNVERIFIED, AND THAT IS STATED HERE BECAUSE IT IS THE FIRST
-- THING A READER WILL GET WRONG.** The server derives it from the third segment of
-- `X-Dopl-Session-Id` (the desktop's slot key, `<channelId>:<taskId>:<agentId>`),
-- which is a documented NON-AUTHORIZATION signal: anything holding the operator's
-- device token can set that header, so it PROVES nothing about which process sent
-- the row. It is exactly as trustworthy as `metadata.session_id` beside it, and
-- for the same reason — INVARIANTS §10 already says nothing may be GRANTED on it.
--   • Nothing may gate, route, filter or authorize on this column.
--   • It is NOT a request field. There is no schema on this path that accepts an
--     identity, and this column does not create one: the service stamps it from
--     the transport context, exactly as it stamps `operator_user_id`. The
--     DIFFERENCE is that `operator_user_id` comes from the AUTHENTICATED token and
--     this comes from a header, which is precisely why one is the fence and the
--     other is a caption.
--
-- ── ⚠ THE DISCLOSURE CHECK, MADE RATHER THAN ASSUMED ────────────────────────
--
-- A sender id is a new fact ABOUT the operator's machine travelling on a row. It
-- discloses nothing new, because the row's audience has not changed and cannot:
-- `operator_user_id` is NOT NULL and every read and write in
-- `repository-directions.ts` predicates on it, the RLS SELECT policy requires
-- `operator_user_id = auth.uid()`, and there is no INSERT/UPDATE/DELETE policy at
-- all. **Sender and recipient are the SAME operator's agents by construction**, so
-- the only party who can ever read this value is the person who owns both ends. A
-- peer cannot see the row, cannot claim it, and cannot write one addressed here.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
--
-- NULLABLE, and null is the ordinary case rather than a defect: an EXTERNAL
-- orchestrator (Claude Desktop, Claude Code, any MCP client that is not a spawned
-- desktop session) sends no session stamp and has no agent id to send. Readers
-- render null as "your agent", which is what the surface said before this column
-- and is still the honest answer for that caller.
-- ⚠ SAME CHARSET CHECK AS `agent_id`, so the two columns cannot drift into
-- different ideas of what an agent id is, and so a forged header cannot park
-- free text in a column a renderer prints.
-- ============================================================================

ALTER TABLE public.channel_agent_directions
  ADD COLUMN IF NOT EXISTS sender_agent_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.channel_agent_directions'::regclass
      AND conname = 'channel_agent_directions_sender_agent_id_check'
  ) THEN
    ALTER TABLE public.channel_agent_directions
      ADD CONSTRAINT channel_agent_directions_sender_agent_id_check
      CHECK (sender_agent_id IS NULL OR sender_agent_id ~ '^[a-z][a-z0-9]{7}$');
  END IF;
END $$;

COMMENT ON COLUMN public.channel_agent_directions.sender_agent_id IS
  'UNVERIFIED attribution: which of the operator''s own agent sessions filed this direction, '
  'derived server-side from the third segment of X-Dopl-Session-Id. A LABEL for the operator''s '
  'own panel, never a fence — nothing may gate, route or authorize on it. NULL when the caller '
  'was an external orchestrator with no session stamp.';

-- ⚠ NO INDEX, DELIBERATELY. Nothing queries by sender: every read is already
-- narrowed by `operator_user_id` (+ optional channel / target agent) and returns
-- at most 50 or 100 rows, so a sender index would be an unused write cost on a
-- hot insert path. Add one when a reader exists, not before.

-- ⚠ NO REPLICA-IDENTITY OR PUBLICATION CHANGE. The table is published for INSERT
-- and UPDATE with `REPLICA IDENTITY USING INDEX
-- channel_agent_directions_replica_identity_idx`; adding a nullable column leaves
-- both alone, and the new column simply appears in the frames the desktop already
-- receives. ⚠ A desktop OLDER than this column reads the frame through
-- `agent-direction-wire.js › directionFrom`, a literal whitelist, and simply does
-- not see the field — which is why the wire's reader treats it as absent-means-
-- unknown rather than requiring it.

-- ── GUARD: the column must not have arrived with a policy or a grant ─────────
-- The table's whole authorization story is "admin client only, predicated on
-- operator_user_id" (see the parent migration's closing guard). This re-asserts
-- the half a new column could plausibly disturb.
DO $$
DECLARE
  bad_policy INT;
  bad_grant INT;
BEGIN
  SELECT count(*) INTO bad_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'channel_agent_directions'
    AND cmd <> 'SELECT';
  IF bad_policy > 0 THEN
    RAISE EXCEPTION 'channel_agent_directions gained a non-SELECT policy (%). Writes are admin-client only.', bad_policy;
  END IF;

  SELECT count(*) INTO bad_grant
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'channel_agent_directions'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF bad_grant > 0 THEN
    RAISE EXCEPTION 'channel_agent_directions granted a write to authenticated/anon (%).', bad_grant;
  END IF;
END $$;

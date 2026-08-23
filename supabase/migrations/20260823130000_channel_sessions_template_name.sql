-- `channel_sessions` — ONE NULLABLE COLUMN, `template_name`, and it is
-- OPERATOR-ONLY. The eighth private field on this table.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ⚠ READ `20260822150000_channel_sessions_telemetry.sql` FIRST. This file is a
-- ONE-COLUMN EXTENSION of that wave and repeats none of its reasoning: the
-- additive/nullable rule, the NULL-is-UNKNOWN rule, the `optional`-as-well-as-
-- `nullable` wire contract, the fence/belt split, and the whole column
-- classification table are stated there and still govern here.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- Agent templates (`20260822200000_agent_templates.sql`) give a session a named
-- IDENTITY to run as — "Code Auditor", "Acme Contract Reviewer". An operator
-- reading `read_sessions` for six live agents can tell them apart by handle and
-- by model, and cannot tell which of them is the one running the auditing
-- template. This column closes that, for the OPERATOR and for nobody else.
--
-- ── A DENORMALIZED SNAPSHOT, NOT A FOREIGN KEY, AND THAT IS THE WHOLE DESIGN
--    DECISION IN THIS FILE ────────────────────────────────────────────────────
-- The obvious shape is `template_id UUID REFERENCES agent_templates(id)`. It is
-- the wrong one, for the same reason `channel_sessions` keeps its OWN
-- `channel_name` and `thread_title` rather than joining for them:
--
--   1. **A SESSION REPORTS WHAT IT RAN AS.** Template content is resolved ONCE,
--      at spawn, and captured on the session object (spec §3d/E-1: "sessions
--      keep their spawn-time content. No live update, ever"). A session that
--      started under "Code Auditor" is still running that text after the
--      template is RENAMED to "Contract Auditor" and after it is DELETED — an
--      FK would rename the running agent under the operator, or (ON DELETE SET
--      NULL) erase the only record of what it is executing.
--   2. **AN FK WOULD BE A CROSS-VISIBILITY REFERENCE.** `agent_templates` is
--      hard-delete, no tombstone, and `private` rows are invisible to workspace
--      admins by design (INVARIANTS §5A). A joinable id on a row that peers can
--      SELECT the rest of is a shape somebody eventually joins.
--
-- So: TEXT, denormalized, and stale-by-design. ⚠ Nothing may add an FK on it
-- later "for integrity" — the staleness IS the integrity here.
--
-- ── THE COLUMN ─────────────────────────────────────────────────────────────
--   template_name  TEXT  PRIVATE. The name of the agent template this session
--                        was launched from, snapshotted at spawn. NULL = this
--                        session was not launched from a template, OR the
--                        desktop that reported it predates the field. ⚠ Those
--                        two are NOT distinguished here and do not need to be:
--                        both render as no template clause. (The DIRECTIVE lane
--                        does need to distinguish them — a nulled `template_id`
--                        beside a live `template_name` is a deletion, spec E-4 —
--                        and that is a different table.)
--
-- ⚠ NULLABLE, NO DEFAULT, and `optional` as well as `nullable` on the wire
-- (`schema-sessions.ts`). Every desktop shipped before Phase 1 sends no
-- `templateName` key at all; zod validates the ARRAY, so a required field here
-- would 400 that machine's WHOLE push, `retryable(400)` is false, and its
-- `read_sessions` would answer `[]` forever (INVARIANTS §11, §13). The schema
-- accepts the key AHEAD of any desktop sending it for the mirror-image reason:
-- an older SERVER must not 400 a newer desktop's push either.
--
-- ── WHY OPERATOR-ONLY (Samuel, OQ-5, confirming the telemetry precedent) ────
-- Two independent arguments, either sufficient:
--
--   1. **THE `detail` RULING, APPLIED.** `20260822150000` lets exactly one of
--      its eight columns cross to a peer, and states the condition three times:
--      *"PEER-VISIBLE — and peer-visible ONLY BECAUSE THE VOCABULARY IS
--      CLOSED… If this field ever becomes free-form, it becomes PRIVATE in the
--      same change."* A template name is operator-authored FREE TEXT, 120 chars,
--      arbitrary. It is the same class of fact as `model` — what an operator
--      configured their agent to BE — which that file classifies PRIVATE.
--   2. **A PRIVATE TEMPLATE'S NAME REACHING A PEER IS AN EXISTENCE ORACLE.**
--      `agent_templates` has NO name uniqueness precisely so that a conflict
--      error cannot leak the existence of somebody's private row across a
--      visibility boundary (INVARIANTS §5A), and template reads refuse
--      404-shaped rather than 403-shaped for the same reason. A peer seeing
--      `Acme Contract Auditor` on a colleague's session learns that row exists.
--      This argument does not depend on the telemetry ruling at all.
--
-- ⚠ **NO `has_template` BOOLEAN ON THE PEER PROJECTION.** It was considered and
-- refused (OQ-5): it is a smaller oracle, not none, and nobody asked for it.
--
-- ⚠ **THE GRANT BELOW IS THE BELT. THE FENCE IS `server/collab-dto.ts ›
-- mapPeerSessionStateRow`**, which CONSTRUCTS a narrow object rather than
-- deleting keys from a wide one — so this column reaches a peer only if somebody
-- types its name in that function. Every application read of this table runs on
-- `supabaseAdmin()` (service_role), which is not subject to RLS and keeps every
-- column grant, so neither the policy nor this GRANT can see the peer read at
-- all. `20260822150000`'s header makes this argument in full; it is restated in
-- one paragraph here only so that a reader who opens THIS file first does not
-- take the GRANT for the enforcement. The belt is for the other door: PostgREST,
-- where `channel_sessions_member_select` (20260820200000) lets any channel
-- member read any member's rows for that channel.
--
-- ⚠ **THE GRANT IS RESTATED IN FULL RATHER THAN LEFT IMPLICIT.** Strictly, a
-- newly added column carries NO column privilege, so `template_name` is already
-- unreadable by `anon`/`authenticated` the moment it exists — the REVOKE +
-- 13-column GRANT below changes nothing about the outcome. It is written anyway
-- because the PUBLIC COLUMN LIST OF THIS TABLE SHOULD BE READABLE IN ONE PLACE,
-- as a list somebody can compare against the peer mapper, and because a file
-- that adds a private column while saying nothing about grants reads as a file
-- that forgot to. `schema-sql.test.ts` asserts the LAST such statement, which is
-- this one.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The column exists, nullable, no default:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='channel_sessions'
--      and column_name='template_name';
--   -- Expect is_nullable='YES', column_default IS NULL.
--
--   -- 2. It is NOT readable by anon/authenticated, and the 13 public columns
--   --    still are:
--   select grantee, column_name
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='channel_sessions'
--      and privilege_type='SELECT' and grantee in ('anon','authenticated')
--    order by grantee, column_name;
--   -- Expect the 13 PUBLIC columns and NONE of the eight PRIVATE ones.
--
--   -- 3. THE APPLICATION, which the catalog cannot confirm: `read_sessions`
--   --    over MCP shows the caller's own template name; a PEER's session card
--   --    and a peer row in the Agents tab show a handle and a state, never a
--   --    template.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   -- Grants only (restores the status quo exactly):
--   GRANT SELECT ON public.channel_sessions TO anon, authenticated;
--   -- The column is additive and nullable, so nothing needs it dropped. If it
--   -- must go, drop it in a NEW migration and revert the writer first, or the
--   -- desktop's push starts 400ing on an unknown column.

-- ===========================================================================
-- 1. THE COLUMN. Additive, nullable, no default.
-- ===========================================================================
ALTER TABLE public.channel_sessions
  ADD COLUMN IF NOT EXISTS template_name TEXT;

-- ⚠ SHAPE ONLY, NEVER A REFERENCE. This deliberately does NOT check that the
-- name matches a live `agent_templates` row — see the header: the whole point is
-- that a session keeps reporting a renamed or deleted template.
--
-- The four clauses are exactly `agent_templates_name_charset_check`'s, at the
-- same length, and the mirror is load-bearing in the same way `channel_name`'s
-- 120 mirrors `channels.name`: a name that is legal on a template must never be
-- refusable into this projection, or a legitimate launch 400s the operator's
-- whole session push.
--
-- ⚠ It is bounded at all because it is OPERATOR-AUTHORED FREE TEXT spliced into
-- MCP narration (`channel-session-render.ts › telemetryClauses`). Operator-only
-- is not the same as trusted: a newline in your own result can forge a line in
-- your own result. `stripFenceTokens` and `inlineOr` are the render-side layers;
-- this is the at-rest one.
ALTER TABLE public.channel_sessions
  ADD CONSTRAINT channel_sessions_template_name_charset_check
  CHECK (
    template_name IS NULL OR (
      char_length(template_name) BETWEEN 1 AND 120
      AND template_name = btrim(template_name)
      AND template_name !~ '[[:cntrl:]]'
      AND template_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

COMMENT ON COLUMN public.channel_sessions.template_name IS
  'OPERATOR-ONLY. Name of the agent template this session was launched from, SNAPSHOTTED AT SPAWN — deliberately not an FK, so a session keeps reporting what it RAN AS after the template is renamed or deleted. NULL = no template, or a desktop older than the field.';

-- ===========================================================================
-- 2. THE BELT. The public column list of this table, restated in full.
--    ⚠ `template_name` is absent, and that absence is the point.
--    ⚠ The FENCE is collab-dto.ts › mapPeerSessionStateRow; see the header.
-- ===========================================================================
REVOKE SELECT ON public.channel_sessions FROM anon, authenticated;

GRANT SELECT (
  id,
  channel_id,
  workspace_id,
  user_id,
  session_key,
  task_id,
  name,
  state,
  detail,
  channel_name,
  thread_title,
  created_at,
  updated_at
) ON public.channel_sessions TO anon, authenticated;

-- ===========================================================================
-- 3. Assert the outcome instead of trusting it.
-- ===========================================================================
-- Same four failure shapes `20260822150000`'s block guards, re-run over the
-- EIGHT private columns rather than seven: a PUBLIC grant keeping a private
-- column readable underneath the REVOKE; a typo taking away a column the SELECT
-- POLICY itself evaluates; the REVOKE catching service_role and breaking every
-- server read; a DEFAULT or NOT NULL sneaking onto the new column and turning
-- "no template" into a claim.
DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'tool_label','model','context_used','context_window','tokens_spent',
    'started_at','last_activity_at','template_name'
  ] LOOP
    IF has_column_privilege('authenticated', 'public.channel_sessions', c, 'SELECT')
       OR has_column_privilege('anon', 'public.channel_sessions', c, 'SELECT') THEN
      RAISE EXCEPTION
        'ABORT: channel_sessions.% is STILL SELECT-able by anon/authenticated after the revoke — something else (PUBLIC, or another granted role) holds the privilege; find it before shipping this', c;
    END IF;
  END LOOP;

  IF NOT (
    has_column_privilege('authenticated', 'public.channel_sessions', 'channel_id',   'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_sessions', 'workspace_id', 'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_sessions', 'user_id',      'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_sessions', 'state',        'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_sessions', 'detail',       'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_sessions', 'updated_at',   'SELECT')
  ) THEN
    RAISE EXCEPTION
      'ABORT: authenticated lost SELECT on a load-bearing channel_sessions column — channel_id/workspace_id feed the SELECT policy itself, and user_id/state/detail/updated_at are the peer card';
  END IF;

  IF NOT has_column_privilege('service_role', 'public.channel_sessions', 'template_name', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role lost SELECT on channel_sessions.template_name — every repository select("*") would 42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_sessions'
       AND column_name = 'template_name'
       AND (column_default IS NOT NULL OR is_nullable = 'NO')
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_sessions.template_name carries a DEFAULT or NOT NULL — a session with no template must be able to say so as NULL';
  END IF;

  RAISE NOTICE
    'channel_sessions: template_name added (nullable, no default, denormalized snapshot). It is the EIGHTH operator-only column; the DTO split in collab-dto.ts is the fence, this grant is the belt.';
END
$$;

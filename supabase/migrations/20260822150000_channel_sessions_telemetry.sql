-- `channel_sessions` — EIGHT NULLABLE TELEMETRY COLUMNS, and a column-privilege
-- narrowing that is the BELT behind a DTO split.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- `read_sessions` answers "what is flint doing?" for an operator whose agents
-- are running on a machine the asker is NOT on. Until now the answer was one
-- word — working / idle / ended — which is enough to know an agent exists and
-- not enough to orchestrate one: an operator could not tell a session that has
-- been "working" for forty minutes on a full context window apart from one that
-- started thirty seconds ago, and had no way to ask.
--
-- Eight columns close that. They are ADDITIVE and every one is NULLABLE with NO
-- DEFAULT.
--
-- ── NULL IS **UNKNOWN**. IT IS NOT ZERO, AND THIS IS THE RULE THE WHOLE FILE
--    IS BUILT AROUND ─────────────────────────────────────────────────────────
-- A `DEFAULT 0` on `tokens_spent` would make every row from a desktop that does
-- not report tokens claim, in a rendered MCP result, that its agent has spent
-- none. That is a measurement nobody took, stated as fact, in the one surface an
-- orchestrator uses to decide whether to keep an agent alive. The same argument
-- holds for `context_used` (0 reads as "fresh context"), `context_window`
-- (0 divides), and both timestamps (any default is a lie about when work began).
-- ⚠ So: **no DEFAULT on any of the eight**, and no NOT NULL. The schema
-- (`schema-sessions.ts`), the upsert (`session-state-service.ts › toUpsert`),
-- the DTO (`collab-dto.ts › bigintOrNull`) and the MCP render each restate the
-- rule; this is the layer that makes the other four possible.
--
-- ── WHY `optional` AS WELL AS `nullable` ON THE WIRE ───────────────────────
-- Not a database concern, but the reason these columns can ship at all: a
-- desktop older than this wave sends none of these keys. The zod schema
-- validates the ARRAY, so one required field would 400 that machine's WHOLE
-- push, `retryable(400)` is false, and `read_sessions` would answer `[]` for it
-- forever (INVARIANTS §11, §13). An older desktop must degrade to "unknown",
-- which is exactly what a missing key + a nullable column produces.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--   detail            TEXT         WHICH OF SIX SITUATIONS it is in — the CLOSED
--                                  key vocabulary `main/session-detail.js ›
--                                  detailFor` derives (thinking / tool / posting
--                                  / permission / awaiting_peer /
--                                  awaiting_inbound). ⚠ PEER-VISIBLE — the only
--                                  one of the eight that is, and it is peer-
--                                  visible ONLY BECAUSE THE VOCABULARY IS
--                                  CLOSED. Six fixed coarse words say what CLASS
--                                  of work is happening; the Agents tab already
--                                  shows a peer that an agent is working.
--                                  ⚠ **FREE-FORM PROSE HERE WOULD BE OPERATOR-
--                                  ONLY MATERIAL ON A PEER-VISIBLE COLUMN.** The
--                                  CHECK below bounds the SHAPE (40 chars, one
--                                  token's worth) and `collab-dto.ts ›
--                                  narrowSessionDetail` bounds the VALUE on the
--                                  way out — anything off the closed list renders
--                                  as `null`. ⚠ The column is deliberately NOT
--                                  `CHECK (detail IN (…six…))`: zod validates the
--                                  push ARRAY, so a desktop shipping a SEVENTH
--                                  key must be able to STORE it and simply not
--                                  render, rather than 400 its whole push
--                                  unretryably (INVARIANTS §11, §13).
--   tool_label        TEXT         the tool running right now.
--   model             TEXT         model id/label the session runs on.
--   context_used      BIGINT       context tokens in use …
--   context_window    BIGINT       … and the window they are used against.
--   tokens_spent      BIGINT       total tokens billed to this session.
--   started_at        TIMESTAMPTZ  when the session started …
--   last_activity_at  TIMESTAMPTZ  … and when it last did anything.
--
-- ⚠ BIGINT, not INTEGER: a context window is already in the millions of tokens
-- for some models and a long session's cumulative spend is unbounded in
-- principle. INT4 overflows at ~2.1e9, which is a plausible number of tokens for
-- a week-long agent and an ugly failure (a 22003 that 500s the whole push).
--
-- ⚠ NO CHECK CONSTRAINTS ON THE FOUR TEXT/BIGINT SHAPES BEYOND WHAT IS BELOW,
-- deliberately — and NOT for the reason `channel_name` / `thread_title` carry
-- theirs. Those two are COUNTERPARTY-influenced (a peer types a channel name
-- that renders into your result); these eight are reported by the OPERATOR'S OWN
-- desktop about the OPERATOR'S OWN machine and are rendered back only to that
-- operator. `safeLabel` still bounds `detail` / `tool_label` / `model` on the way
-- in, because they are spliced into narration and a newline can forge a line
-- even in your own result — that is the write path's job and it does it. The
-- three counters get `>= 0` here because a negative count is a reporting bug
-- worth refusing at rest, and the constraint is free.
--
-- ── THE VISIBILITY SPLIT, AND WHICH HALF IS LOAD-BEARING ───────────────────
-- Samuel's ruling: telemetry is OPERATOR-ONLY; peers keep coarse. Seven of the
-- eight columns may reach only the member whose machine is running the session.
--
-- ⚠ **THE GRANT BELOW IS THE BELT. IT IS NOT THE FENCE, AND THIS FILE WILL NOT
-- PRETEND OTHERWISE.** Every read of this table in the application runs on
-- `supabaseAdmin()` (service_role) — `repository-sessions.ts` says so in its own
-- header, and it must, because the table REVOKEs writes from `authenticated` and
-- there is no other way to write it. **service_role is not subject to RLS and
-- keeps every column grant**, so neither the policy nor the GRANT can see the
-- peer read at all. What actually stops telemetry reaching a peer is
-- `server/collab-dto.ts › mapPeerSessionStateRow`, which CONSTRUCTS a narrow
-- object rather than deleting keys from a wide one — construction fails CLOSED
-- when a column is added, an omit-list fails OPEN — and the fact that it and
-- `mapOwnSessionStateRow` have different RETURN TYPES with no default audience
-- argument between them, so a peer surface assigning the rich shape does not
-- compile. `server/session-visibility.test.ts` pins it as a property over
-- `OPERATOR_ONLY_SESSION_FIELDS` rather than as a list of examples.
--
-- WHAT THE BELT IS THEN FOR, honestly: the OTHER two doors. `authenticated`
-- holds table-wide SELECT today and the `channel_sessions_member_select` policy
-- (20260820200000) lets any channel member read any member's rows for that
-- channel — so a raw `GET /rest/v1/channel_sessions?select=*` would return a
-- peer's model, tool and token spend even though no application code asks for
-- it. Nothing in `src/` makes that call (every `.from("channel_sessions")` is on
-- the admin client; the only browser-client `.from()` calls anywhere in `src/`
-- are `profiles` and the OAuth tables), and this narrowing keeps it that way by
-- construction rather than by grep. The precedent, the mechanism and the
-- failure-mode analysis are `20260810120000_channel_members_column_privileges.sql`
-- — READ IT FIRST; this file follows it and does not repeat it.
--
-- ⚠ **ONE THING IS SIMPLER HERE THAN IN THAT PRECEDENT, AND IT IS THE RISKY
-- HALF:** `channel_sessions` is NOT in the `supabase_realtime` publication
-- (20260805120000 says so in as many words, and 20260822130000 restates it), so
-- `realtime.apply_rls`'s per-column privilege loop — the part that migration
-- could not verify from inside the repo and had to carry as a stated risk —
-- **is not reached at all here**. There is no CDC consumer to take dark. The
-- only consumer of these grants is PostgREST, which is plain Postgres and
-- certain.
--
-- ⚠ `anon` IS GRANTED THE PUBLIC COLUMNS RATHER THAN LEFT BARE, for the reason
-- `20260810120000` records at length: a signed-out or expired-JWT subscriber
-- raising 42501 inside a shared code path has killed a whole project's pipeline
-- before (20260730052410). It still reads nothing — RLS resolves
-- `is_current_workspace_member` off `auth.uid()`, NULL for anon.
--
-- ── COLUMN CLASSIFICATION (the whole decision, in one table) ───────────────
--   id                PUBLIC   row identity.
--   channel_id        PUBLIC   ⚠ LOAD-BEARING — an input to this table's own
--                              SELECT policy (`is_channel_member(channel_id)`).
--   workspace_id      PUBLIC   ⚠ LOAD-BEARING — the policy's outer fence.
--   user_id           PUBLIC   whose machine. The peer card wears the avatar.
--   session_key       PUBLIC   `<channel>:<thread>:<agent>` — a routing key made
--                              of ids the reader already has. Not telemetry.
--   task_id           PUBLIC   which thread. Already on the peer card.
--   name              PUBLIC   the handle. Already on the peer card.
--   state             PUBLIC   working / idle / ended. The whole point of the
--                              peer card.
--   detail            PUBLIC   ⚠ JUDGMENT CALL, STATED, AND CONDITIONAL ON THE
--                              VOCABULARY STAYING CLOSED. Six fixed coarse
--                              words, same class of fact as `state`. If this
--                              field ever becomes free-form, it becomes PRIVATE
--                              in the same change — moving it is a one-line edit
--                              to the GRANT below AND a one-line edit to
--                              `mapPeerSessionStateRow`, and the second is the
--                              one that matters.
--   channel_name      PUBLIC   a name every member of the channel already sees.
--   thread_title      PUBLIC   likewise.
--   created_at        PUBLIC   row age.
--   updated_at        PUBLIC   ⚠ LOAD-BEARING for the READER, not for RLS: it is
--                              the read's ORDER BY and the input to the peer
--                              card's dim-when-stale rule and to `read_sessions`'
--                              staleness marker.
--   tool_label        PRIVATE  ─┐
--   model             PRIVATE   │ the seven Samuel's ruling names. What an
--   context_used      PRIVATE   │ agent is running, on what, at what cost.
--   context_window    PRIVATE   │ A peer learns THAT an agent is working;
--   tokens_spent      PRIVATE   │ never what it costs its operator.
--   started_at        PRIVATE   │
--   last_activity_at  PRIVATE  ─┘
--
-- ── VERIFICATION (BEFORE APPLYING — confirm who holds the grant) ───────────
--   select grantee, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'channel_sessions'
--      and privilege_type = 'SELECT'
--    order by grantee;
--   -- Expect anon / authenticated / service_role (+ owner). If PUBLIC appears,
--   -- the REVOKE below is not enough — the assertion block catches it and
--   -- aborts, and the fix is to add `REVOKE SELECT ... FROM PUBLIC`.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The columns exist, nullable, no defaults:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='channel_sessions'
--      and column_name in ('detail','tool_label','model','context_used',
--                          'context_window','tokens_spent','started_at',
--                          'last_activity_at')
--    order by column_name;
--   -- Expect is_nullable='YES' and column_default IS NULL for ALL EIGHT.
--
--   -- 2. Column privileges land as intended:
--   select grantee, column_name
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='channel_sessions'
--      and privilege_type='SELECT' and grantee in ('anon','authenticated')
--    order by grantee, column_name;
--   -- Expect the 13 PUBLIC columns above and NONE of the seven PRIVATE ones.
--
--   -- 3. PostgREST, as a real channel member. First must 42501, second must
--   --    return the coarse rows:
--   --   GET /rest/v1/channel_sessions?select=*&channel_id=eq.<uuid>
--   --   GET /rest/v1/channel_sessions?select=name,state,detail&channel_id=eq.<uuid>
--
--   -- 4. THE APPLICATION, which the catalog cannot confirm: `read_sessions`
--   --    over MCP shows the caller's own model/tokens/context; the Agents tab's
--   --    PEER card shows name/state/detail and no numbers.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   -- Grants only (restores the status quo exactly):
--   GRANT SELECT ON public.channel_sessions TO anon, authenticated;
--   -- Columns: they are additive and nullable, so nothing needs them dropped.
--   -- If they must go, drop them in a NEW migration and revert the writer
--   -- first, or the desktop's push starts 400ing on unknown columns.

-- ===========================================================================
-- 1. THE COLUMNS. Additive, nullable, no defaults.
-- ===========================================================================
ALTER TABLE public.channel_sessions
  ADD COLUMN IF NOT EXISTS detail           TEXT,
  ADD COLUMN IF NOT EXISTS tool_label       TEXT,
  ADD COLUMN IF NOT EXISTS model            TEXT,
  ADD COLUMN IF NOT EXISTS context_used     BIGINT,
  ADD COLUMN IF NOT EXISTS context_window   BIGINT,
  ADD COLUMN IF NOT EXISTS tokens_spent     BIGINT,
  ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Counters are counts. ⚠ NOT NULL is deliberately absent from all three; the
-- CHECK's own NULL branch is what keeps "unknown" legal.
ALTER TABLE public.channel_sessions
  ADD CONSTRAINT channel_sessions_counts_nonnegative
  CHECK (
    (context_used   IS NULL OR context_used   >= 0)
    AND (context_window IS NULL OR context_window >= 0)
    AND (tokens_spent   IS NULL OR tokens_spent   >= 0)
  );

-- ⚠ SHAPE ONLY, NEVER THE VALUE LIST. `detail` is one of six closed keys today,
-- but a NEWER desktop shipping a seventh must be able to store it: zod validates
-- the push ARRAY, so a value CHECK here would 400 that machine's entire report
-- unretryably. The closed-value test is on the READ side
-- (`collab-dto.ts › narrowSessionDetail`), where an unknown key renders as
-- nothing instead of poisoning a push. What IS enforced is that the field cannot
-- hold a sentence, a newline, or a bidi run — it is peer-visible and it is
-- spliced into MCP narration.
ALTER TABLE public.channel_sessions
  ADD CONSTRAINT channel_sessions_detail_is_a_key
  CHECK (
    detail IS NULL OR (
      char_length(detail) BETWEEN 1 AND 40
      AND detail = btrim(detail)
      AND detail !~ '[[:cntrl:]]'
      AND detail !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

COMMENT ON COLUMN public.channel_sessions.detail IS
  'Closed situation KEY (thinking/tool/posting/permission/awaiting_peer/awaiting_inbound). PEER-VISIBLE, and only because the vocabulary is closed — never free-form prose. NULL = no refinement reported.';
COMMENT ON COLUMN public.channel_sessions.tokens_spent IS
  'OPERATOR-ONLY. NULL means UNKNOWN, never zero — see 20260822150000.';

-- ===========================================================================
-- 2. THE BELT. Take the table-wide SELECT away, hand back the public columns.
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
-- Four ways this could land wrong and still look fine: a PUBLIC grant keeping a
-- private column readable underneath the REVOKE; a typo taking away a column the
-- SELECT POLICY itself evaluates (which would make the policy unevaluable rather
-- than merely hide a field); the REVOKE catching service_role and breaking every
-- server read; or a DEFAULT sneaking onto a counter and turning "unknown" into
-- "zero" for every existing row. Each aborts the transaction.
DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'tool_label','model','context_used','context_window','tokens_spent',
    'started_at','last_activity_at'
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
    AND has_column_privilege('authenticated', 'public.channel_sessions', 'updated_at',   'SELECT')
  ) THEN
    RAISE EXCEPTION
      'ABORT: authenticated lost SELECT on a load-bearing channel_sessions column — channel_id/workspace_id feed the SELECT policy itself, and user_id/state/updated_at are the peer card';
  END IF;

  IF NOT has_column_privilege('service_role', 'public.channel_sessions', 'tokens_spent', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role lost SELECT on channel_sessions.tokens_spent — every repository select("*") would 42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_sessions'
       AND column_name IN ('detail','tool_label','model','context_used',
                           'context_window','tokens_spent','started_at',
                           'last_activity_at')
       AND (column_default IS NOT NULL OR is_nullable = 'NO')
  ) THEN
    RAISE EXCEPTION
      'ABORT: a telemetry column on channel_sessions carries a DEFAULT or NOT NULL — NULL must stay reachable and must mean UNKNOWN, never zero';
  END IF;

  RAISE NOTICE
    'channel_sessions: 8 nullable telemetry columns added; 7 are service_role-only (detail stays peer-visible). The DTO split in collab-dto.ts is the fence — these grants are the belt.';
END
$$;

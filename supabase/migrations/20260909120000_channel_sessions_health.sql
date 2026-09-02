-- `channel_sessions` — SEVEN NULLABLE **HEALTH** COLUMNS, and a
-- column-privilege narrowing that is done ENTIRELY BY OMISSION.
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED.** Docker is unavailable in the
-- environment this was authored in, so `supabase db reset` has NOT been run
-- against it and this file has executed NOWHERE. Do not read the absence of an
-- error as evidence that it works; the first run is still ahead.
--
-- ⚠ RE-DERIVE RATHER THAN TRUSTING A HEADER LINE, AND JOIN ON THE NAME. Its
-- direct precedent, `20260822150000_channel_sessions_telemetry.sql`, claimed
-- "WRITTEN, NOT APPLIED" for a fortnight after it was live, and it applied under
-- a version that is NOT its filename prefix (INVARIANTS §12, F-304). The command
-- is `supabase migration list` / MCP `list_migrations`, or the catalog queries in
-- the AFTER-APPLYING block below; the ANSWER belongs to the deployment, not to
-- this file.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- `20260822150000` answered "what is this agent RUNNING ON and what does it
-- COST" — model, tool, context, tokens, start. That is enough to recognize an
-- agent and not enough to know whether it is GETTING ANYWHERE. The case that
-- forced these seven was observed: a windowless session at the `auto` tool floor
-- ran for sixteen minutes, reported `working` the whole time, spent tokens the
-- whole time, and every shell call it made was being DENIED. Nothing on the row
-- could say so, so `read_sessions` reported a healthy agent.
--
-- Seven columns close that. `dopl-desktop-app/main/session-health.js` derives all
-- seven and `main/session-telemetry.js` decides how coarse each may be on the
-- wire — **those two files are the authority on what each value MEANS**, and
-- this file does not restate their arguments.
--
-- ── NULL IS **UNKNOWN**. IT IS NOT ZERO ────────────────────────────────────
-- The rule `20260822150000` is built around, and it bites harder here because
-- six of these seven are COUNTS. `DEFAULT 0` on `denied_calls` would make every
-- row from a desktop that does not count denials assert, in a rendered MCP
-- result, that nothing has been refused to that agent — which is the exact
-- failure the column exists to report. `turns` defaulted to 0 would make a
-- running agent look like it had never taken a turn. `stale` defaulted to
-- `false` would state "this session is fine" on behalf of a machine that has
-- never evaluated the question.
-- ⚠ So: **no DEFAULT and no NOT NULL on any of the seven**, and section 3
-- ASSERTS that rather than trusting it.
--
-- ── WHY `optional` AS WELL AS `nullable` ON THE WIRE ───────────────────────
-- Unchanged from the precedent, and still the reason these can ship at all: a
-- desktop older than this wave sends none of these keys. zod validates the
-- ARRAY (`schema-sessions.ts`), so one required field would 400 that machine's
-- WHOLE push, `retryable(400)` is false, and `read_sessions` would answer `[]`
-- for it forever (INVARIANTS §11, §13). An older desktop must degrade to
-- "unknown", which is what a missing key plus a nullable column produces.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--   turns             INTEGER      turns this session has taken. The desktop
--                                  counts a `result` event as a turn
--                                  (`main/session-io.js › applyCoreEvents`) and
--                                  deliberately does NOT quantize it: the
--                                  difference between 1 turn and 4 IS the
--                                  signal.
--   tokens_delta      BIGINT       tokens burned SINCE THIS SESSION LAST POSTED
--                                  to its channel — not per turn, and not since
--                                  the last row push. ⚠ Read
--                                  `main/session-health.js`'s "SINCE LAST
--                                  REPORT" block before rendering it as
--                                  anything else: the push is churn, so a delta
--                                  against it would say "tokens spent in the
--                                  last few seconds", which no orchestrator can
--                                  act on. Quantized to `tokensSpent`'s own
--                                  10 000 bucket so the two move together.
--   stale             BOOLEAN      the machine's OWN wedged flag: `working` AND
--                                  silent past ten minutes AND still spending.
--                                  ⚠ **NOT the same fact as a quiet
--                                  `updated_at`** — see the collision note
--                                  below, which is the one thing in this file a
--                                  reader can get badly wrong.
--   denied_calls      INTEGER      tool calls this session has had REFUSED …
--   last_denied_tool  TEXT         … and the last tool that was
--                                  (`main/session-windowless.js › noteDenied`).
--   last_wake_seq     BIGINT       the message seq of the last WAKE this
--                                  machine enqueued for the session …
--   last_wake_at      TIMESTAMPTZ  … and when. ⚠ **A REPORT OF WHAT THE MACHINE
--                                  DID, NEVER A DELIVERY GUARANTEE.** It is
--                                  stamped in `main/session-gate.js › enqueue`,
--                                  which is the point at which a wake is QUEUED;
--                                  nothing here claims the agent read it, acted
--                                  on it, or is still alive.
--
-- ⚠ INTEGER vs BIGINT, and the split is deliberate rather than uniform.
-- `turns` and `denied_calls` are bounded by a session's lifetime in the low
-- thousands at the very most; INT4 is honest about that and half the width.
-- `tokens_delta` takes BIGINT for the reason `tokens_spent` did — a cumulative
-- spend is unbounded in principle and INT4 overflows at ~2.1e9 with a 22003 that
-- 500s the whole push. `last_wake_seq` takes BIGINT because it is a
-- `channel_messages.seq`, which is BIGINT at the source; narrowing a foreign
-- vocabulary's width here would be this file inventing a bound it does not own.
--
-- ⚠ **NO CHECK ON `last_denied_tool`, AND THAT IS THE PRECEDENT RATHER THAN AN
-- OMISSION.** `20260822150000` gave a shape CHECK to `detail` ALONE, and stated
-- the condition: `detail` is PEER-VISIBLE, so a newline in it can forge a line in
-- somebody else's result. `tool_label` — the same class of value, operator-only —
-- got none, and this column is `tool_label`'s twin. The write path bounds it
-- (`schema-sessions.ts`, `safeLabel("Last denied tool", 80)`, character for
-- character the desktop's own `TOOL_LABEL_MAX`), which is where a charset rule
-- belongs. The four counters DO get `>= 0` here, because a negative count is a
-- reporting bug worth refusing at rest and the constraint is free.
--
-- ── ⚠ THE `stale` COLLISION, STATED HERE BECAUSE THE COLUMN NAME CANNOT ────
-- **THERE ARE NOW TWO FACTS CALLED "STALE" IN THIS FEATURE AND THEY ARE NOT THE
-- SAME FACT.**
--   *this column* — the SESSION's health, derived on the machine: it is
--     `working`, it has said nothing for ten minutes, and it is still burning
--     tokens. A live process that is getting nowhere.
--   *`updated_at` age* — the ROW's freshness, derived on the server
--     (`packages/mcp-server/src/tools/channel-session-render.ts ›
--     sessionIsStale`, 90s): NOBODY HAS SAID ANYTHING, which includes the case
--     where the whole desktop died.
-- A live-but-quiet agent is the first without the second; a crashed machine is
-- the second without the first. A reader who conflates them reports a working
-- agent as dead, or a wedged one as fine. ⚠ **The wire name is the desktop's and
-- is NOT renamed on this side** — renaming a column to fix a reader is how the
-- two trees stop agreeing about what was reported. The render carries the
-- distinction instead, in `channel-session-health.ts`, which never uses the word
-- "stale" for this one.
--
-- ── VISIBILITY: OPERATOR-ONLY, AND THE NARROWING IS AN **ABSENCE** ─────────
-- All seven are OPERATOR-ONLY. Samuel's 2026-08-22 ruling ("telemetry is
-- operator-only; peers keep coarse") covers them on its own terms, and
-- `denied_calls` / `last_denied_tool` would be the sharpest leak of the set: a
-- peer reading them learns what an operator's tool policy REFUSES, which is a
-- map of that operator's machine.
--
-- ⚠ **THIS FILE ADDS NO GRANT AT ALL, AND THAT IS THE WHOLE MECHANISM.**
-- `20260822150000` did `REVOKE SELECT … FROM anon, authenticated` and then
-- `GRANT SELECT (<thirteen public columns>)`. A column-privilege grant is a
-- LIST, and a column added later by `ALTER TABLE` inherits NOTHING from it — so
-- each of these seven is service_role-only **the moment it exists**, with no
-- statement of ours involved.
--
-- ⚠ **AND AN ABSENCE IS WHAT SILENTLY STOPS BEING TRUE** (INVARIANTS §2, the
-- `favorited_at` precedent). Nothing in this file would fail if a later
-- migration handed the table back, or if somebody "restored" the grant list with
-- a `SELECT *`-shaped `GRANT SELECT ON public.channel_sessions`. So the second
-- edit is written as an ASSERTION: section 3 requires
-- `has_column_privilege('authenticated', …, 'SELECT')` to be FALSE for all seven
-- and RAISEs otherwise. The belt is checked even though nobody buckled it.
--
-- ⚠ **THE GRANT WAS NEVER THE FENCE AND IS NOT ONE HERE EITHER.** Every read of
-- this table runs on `supabaseAdmin()` (service_role), which is not subject to
-- RLS and keeps every column grant, so neither the policy nor the GRANT can see
-- the peer read at all. What stops these reaching a peer is
-- `src/features/channels/server/collab-dto.ts › mapPeerSessionStateRow`, which
-- CONSTRUCTS a narrow object rather than deleting keys from a wide one —
-- construction fails CLOSED when a column is added — plus the two mappers'
-- different return types. `server/session-visibility.test.ts` pins it as a
-- PROPERTY over `OPERATOR_ONLY_SESSION_FIELDS`, so registering these seven there
-- is what actually covers them.
--
-- ── WHAT THIS MIGRATION DOES **NOT** TOUCH, ASSERTED RATHER THAN PROMISED ──
-- `channel_sessions` is a PUBLISHED/SUBSCRIBED table in the sense that matters
-- to a reviewer's reflexes, so the three questions are answered explicitly:
--   SELECT POLICY      — UNTOUCHED. `channel_sessions_member_select`
--                        (20260820200000) is neither dropped nor recreated here.
--                        Section 3 asserts it still exists, because a column
--                        wave that silently took a channel's peer cards offline
--                        would look exactly like this file succeeding.
--   REPLICA IDENTITY   — UNTOUCHED. No `ALTER TABLE … REPLICA IDENTITY` appears
--                        below; adding nullable columns does not change it.
--   PUBLICATION        — UNTOUCHED, and the table is **NOT** in
--                        `supabase_realtime` (20260805120000 says so;
--                        20260822130000 and 20260822150000 restate it). That is
--                        load-bearing: it means `realtime.apply_rls`'s
--                        per-column privilege loop is not reached, so there is
--                        no CDC consumer to take dark on a column privilege.
--                        Section 3 asserts the non-membership, because the risk
--                        is not that this file adds it — it is that somebody
--                        else already did and this file's reasoning is stale.
--
-- ── NO INDEX, DELIBERATELY ────────────────────────────────────────────────
-- Nothing filters, sorts or joins on any of the seven. Every read of this table
-- reaches its rows through an existing fence — `(user_id, workspace_id)` for the
-- own-scoped read, `channel_id` for the peer read — and then renders whatever
-- the row carries. An index here would be write cost on a table whose whole
-- design is about write cost (`main/session-telemetry.js` exists to bound it),
-- bought for a query nobody makes.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The columns exist, nullable, no defaults:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='channel_sessions'
--      and column_name in ('turns','tokens_delta','stale','denied_calls',
--                          'last_denied_tool','last_wake_seq','last_wake_at')
--    order by column_name;
--   -- Expect is_nullable='YES' and column_default IS NULL for ALL SEVEN.
--
--   -- 2. NONE of the seven is column-granted to anon/authenticated:
--   select grantee, column_name
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='channel_sessions'
--      and privilege_type='SELECT' and grantee in ('anon','authenticated')
--    order by grantee, column_name;
--   -- Expect the SAME thirteen public columns 20260822150000 granted, and none
--   -- of these seven.
--
--   -- 3. PostgREST, as a real channel member — must 42501 rather than answer:
--   --   GET /rest/v1/channel_sessions?select=denied_calls&channel_id=eq.<uuid>
--
--   -- 4. THE APPLICATION, which the catalog cannot confirm: `read_sessions`
--   --    over MCP shows the caller's own denial count and wake ack; the Agents
--   --    tab's PEER card shows neither.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- There is nothing to un-grant, because nothing was granted — a rollback of the
-- privilege half is a no-op, which is the one pleasant consequence of narrowing
-- by omission.
-- The columns are ADDITIVE and NULLABLE, so nothing needs them dropped: an older
-- server simply ignores them and a `select("*")` keeps working. If they genuinely
-- must go, drop them in a NEW migration and REVERT THE WRITER FIRST — the
-- desktop's push names them by column, so dropping them under a live writer
-- starts 400ing every push for every operator on the new build, unretryably.
-- The four CHECK constraints below drop with
-- `ALTER TABLE public.channel_sessions DROP CONSTRAINT
--  channel_sessions_health_counts_nonnegative;` and are safe to drop alone.

-- ===========================================================================
-- 1. THE COLUMNS. Additive, nullable, no defaults, NO GRANT.
-- ===========================================================================
ALTER TABLE public.channel_sessions
  ADD COLUMN IF NOT EXISTS turns            INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_delta     BIGINT,
  ADD COLUMN IF NOT EXISTS stale            BOOLEAN,
  ADD COLUMN IF NOT EXISTS denied_calls     INTEGER,
  ADD COLUMN IF NOT EXISTS last_denied_tool TEXT,
  ADD COLUMN IF NOT EXISTS last_wake_seq    BIGINT,
  ADD COLUMN IF NOT EXISTS last_wake_at     TIMESTAMPTZ;

-- Counters are counts. ⚠ NOT NULL is deliberately absent from all four; each
-- CHECK's own `IS NULL` branch is what keeps "unknown" legal, exactly as
-- `channel_sessions_counts_nonnegative` does for the telemetry three.
-- ⚠ DROPPED FIRST. `ADD CONSTRAINT` is not idempotent — on a re-run against a
-- database that already carries it the file 42710s and every statement after
-- this one is skipped, which the `ADD COLUMN IF NOT EXISTS` above makes a
-- reachable path rather than a hypothetical.
ALTER TABLE public.channel_sessions
  DROP CONSTRAINT IF EXISTS channel_sessions_health_counts_nonnegative;
ALTER TABLE public.channel_sessions
  ADD CONSTRAINT channel_sessions_health_counts_nonnegative
  CHECK (
    (turns          IS NULL OR turns          >= 0)
    AND (tokens_delta   IS NULL OR tokens_delta   >= 0)
    AND (denied_calls   IS NULL OR denied_calls   >= 0)
    AND (last_wake_seq  IS NULL OR last_wake_seq  >= 0)
  );

COMMENT ON COLUMN public.channel_sessions.stale IS
  'OPERATOR-ONLY. The MACHINE''s own wedged flag: working AND silent past ten minutes AND still spending (main/session-health.js). ⚠ NOT the same fact as a quiet updated_at, which is about the ROW''s freshness — see 20260909120000.';
COMMENT ON COLUMN public.channel_sessions.tokens_delta IS
  'OPERATOR-ONLY. Tokens burned since this session last POSTED to its channel — not per turn, not since the last push. NULL means UNKNOWN, never zero.';
COMMENT ON COLUMN public.channel_sessions.denied_calls IS
  'OPERATOR-ONLY. Tool calls REFUSED to this session. NULL means nothing counted them — it is NOT a report that nothing was denied.';
COMMENT ON COLUMN public.channel_sessions.last_wake_at IS
  'OPERATOR-ONLY. When the machine last ENQUEUED a wake (main/session-gate.js). A report of what the machine did, never a delivery guarantee.';

-- ===========================================================================
-- 2. THE BELT — deliberately EMPTY.
-- ===========================================================================
-- No REVOKE (20260822150000 already took the table-wide SELECT away and nothing
-- has handed it back) and NO GRANT (a column added by ALTER TABLE inherits no
-- column privilege, so all seven are service_role-only from birth). ⚠ The second
-- edit is section 3, because THIS section is an absence and an absence is what
-- silently stops being true.

-- ===========================================================================
-- 3. Assert the outcome instead of trusting it.
-- ===========================================================================
-- Six ways this could land wrong and still look fine: one of the seven turning
-- out to be SELECT-able by anon/authenticated (a PUBLIC grant, another granted
-- role, or a later migration that "restored" a table-wide grant); service_role
-- LOSING the read, which would 42501 every `select("*")` in the repository; a
-- DEFAULT or NOT NULL sneaking on and turning "unknown" into a measurement; the
-- SELECT policy this table's peer cards ride on having gone missing; the table
-- having quietly joined `supabase_realtime`, which would put a CDC consumer
-- behind these privileges and invalidate this file's whole risk analysis; and a
-- column simply not being there because an earlier statement was edited out.
-- Each aborts the transaction.
DO $$
DECLARE
  c TEXT;
  health_columns TEXT[] := ARRAY[
    'turns','tokens_delta','stale','denied_calls',
    'last_denied_tool','last_wake_seq','last_wake_at'
  ];
BEGIN
  FOREACH c IN ARRAY health_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'channel_sessions'
         AND column_name = c
    ) THEN
      RAISE EXCEPTION
        'ABORT: channel_sessions.% was not created — the ALTER above is not doing what this file claims', c;
    END IF;

    -- ⚠ THE ABSENCE, ASSERTED. Nothing above grants these; this is what notices
    -- if something ELSE does.
    IF has_column_privilege('authenticated', 'public.channel_sessions', c, 'SELECT')
       OR has_column_privilege('anon', 'public.channel_sessions', c, 'SELECT') THEN
      RAISE EXCEPTION
        'ABORT: channel_sessions.% is SELECT-able by anon/authenticated and NOTHING IN THIS FILE GRANTED IT — a PUBLIC grant, another granted role, or a later table-wide GRANT holds the privilege; find it before shipping this', c;
    END IF;

    IF NOT has_column_privilege('service_role', 'public.channel_sessions', c, 'SELECT') THEN
      RAISE EXCEPTION
        'ABORT: service_role cannot SELECT channel_sessions.% — every repository select(''*'') would 42501', c;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_sessions'
       AND column_name = ANY (health_columns)
       AND (column_default IS NOT NULL OR is_nullable = 'NO')
  ) THEN
    RAISE EXCEPTION
      'ABORT: a health column on channel_sessions carries a DEFAULT or NOT NULL — NULL must stay reachable and must mean UNKNOWN. A 0 denial count nobody measured is the exact lie this column was added to prevent';
  END IF;

  -- ⚠ NOT TOUCHED BY THIS FILE, AND CHECKED FOR THAT REASON. If the peer cards'
  -- SELECT policy is gone, a column migration is the last change anybody would
  -- suspect.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'channel_sessions'
       AND policyname = 'channel_sessions_member_select'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_sessions_member_select is missing — this migration does not touch any policy, so something else dropped the one the Agents tab peer cards read through';
  END IF;

  -- ⚠ THE PUBLICATION CLAIM, RE-DERIVED. This file's risk analysis rests on
  -- there being no CDC consumer behind these column privileges; if the table has
  -- joined the publication since 20260822150000 wrote that sentence, the
  -- analysis is stale and `realtime.apply_rls`'s per-column loop is in play.
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = 'channel_sessions'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_sessions is in supabase_realtime — this migration adds operator-only columns on the stated assumption that it is NOT, so re-do the CDC analysis (see 20260810120000) before shipping';
  END IF;

  RAISE NOTICE
    'channel_sessions: 7 nullable health columns added (turns, tokens_delta, stale, denied_calls, last_denied_tool, last_wake_seq, last_wake_at). NO grant was issued, so all seven are service_role-only from birth; the DTO split in collab-dto.ts is the fence. No policy, replica identity or publication membership was touched.';
END
$$;

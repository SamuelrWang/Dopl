-- ============================================================================
-- THE max_rows SWEEP — EVERY HAULED TALLY THIS CODEBASE HAD, SUMMED BY POSTGRES
-- (Samuel #2935, the sweep after the /home credit histogram)
-- ============================================================================
--
-- ⚠ **WRITTEN, NOT APPLIED** — this directory's standing gate. Deploy state is a
-- MEASUREMENT (CLAUDE.md doc rule 4), so this header records no claim: re-derive
-- with `supabase migration list` / MCP `list_migrations`, JOINED ON THE NAME
-- (`max_rows_sweep_tally_rpcs`), never on this file's version prefix (F-304's
-- re-stamp means the history row's version is not necessarily this one).
-- 🔒 Apply BY NAME, BYTE-EXACT, never with `db push`.
--
-- ── WHY IT EXISTS ───────────────────────────────────────────────────────────
--
-- 🔒 **IT IS WRONG ANSWERS THIS FILE REMOVES, NOT SLOW ONES** — the same
-- distinction `20261008120000_artifact_spans_rpc.sql` draws and
-- `20261118120000_home_credit_usage_bins_rpc.sql` repeated one table over. This
-- is the rest of the sweep that second file opened: `supabase/config.toml ›
-- max_rows = 1000` clips EVERY PostgREST select server-side and **raises
-- nothing**, so a read asking 2,000 / 5,000 / 10,000 / 20,000 rows and folding
-- them in JS computes its total over whatever survived.
--
-- ⚠ **AND THE CLIP WAS SILENT AT FOUR MORE SITES, WHICH IS THE HALF THAT MADE
-- THEM GHOSTS.** Each had its own `clipped()`/`truncated` computing
-- `rows.length >= limit` against the ASKED limit, so `1000 >= 10000` was FALSE
-- and every one of those floors reported itself COMPLETE. `analytics/server/
-- health.ts` carried no `truncated` at all. Fixed on the TS side in the same
-- branch: `shared/supabase/max-rows.ts` now owns the ceiling and
-- `clippedAt()` measures against `min(asked, max_rows)`.
--
-- ⚠ **MEASURED, 2026-10-10, prod — AND THE MEASUREMENT RE-ORDERS THE WORK.**
-- The window each of these reads actually asks for, worst case per container:
--   `mcp_tool_calls`         31d  **6,476 rows against a 1,000-row answer**
--   `channel_messages`       31d     912  (at the edge; one busy week away)
--   `credit_usage_events`    31d      10  (workspace arm: `wallet IN (seat,workspace)`)
--   `workspace_token_spend`  31d      87
--   `system_events`          24h       1  (health severities), 0 (health categories)
--   `mcp_events`             24h       0  (`source = 'mcp'`)
-- So **the live defect is the workspace Overview's TOOL RAIL, not its credit
-- rail** — `wallet IN ('seat','workspace')` excludes `personal`, which is the
-- wallet /home's histogram burns on, and the workspace arm holds ten rows.
-- Every other site here is LATENT: correct today by data volume, wrong the
-- moment a container crosses 1,000 in the window. **A latent wrong answer is
-- still what this file removes** — one row per group puts the ceiling two or
-- three orders of magnitude from the data and it cannot be pushed back out by a
-- busy month.
--
-- ⚠ **NOT A BIGGER `max_rows`, AND NOT A PAGE LOOP** (F-712's wording, and it
-- holds verbatim for every function below): the first moves the number and keeps
-- the silence, the second hauls the same rows across the wire to do arithmetic
-- Postgres does once, indexed. ⚠ **A PAGE LOOP IS NEVERTHELESS THE RIGHT FIX
-- ONE FEATURE OVER, AND THAT IS NOT A CONTRADICTION**: `ontology/server`'s reads
-- are LISTS, not tallies — nothing is being summed, so there is no aggregate to
-- push down and `shared/supabase/max-rows.ts › readAllPages` walks them in
-- server-sized pages instead. No function here serves ontology.
--
-- ── TWO FENCE MODELS, AND A COPIED ASSERT BLOCK WOULD ABORT A CORRECT APPLY ──
--
-- 🔒 **EVERY FUNCTION BELOW IS `SECURITY INVOKER`, NOT DEFINER** — INVARIANTS §9,
-- and the argument `20261118120000` states in full rather than restating here:
-- invoker rights can never show a caller a row their own policies would not
-- admit, and DEFINER would be a second door into a ledger that never consults
-- RLS. Called by the repository it is the service role's full reach; reached over
-- `/rest/v1/rpc` — which the grants do not permit — it stays narrowed.
--
-- ⚠ **BUT THE TABLES DO NOT ALL CARRY THE SAME FENCE, measured 2026-10-10**, and
-- this is the trap `20261008120000` recorded, inverted:
--   • **POLICY-FENCED** (RLS on · one `FOR SELECT` policy · `SELECT` granted to
--     `anon` + `authenticated`): `credit_usage_events`, `channel_messages`,
--     `mcp_tool_calls`, `channels`, `workspace_members`.
--     → their assert blocks check **RLS is on and a `FOR SELECT` policy lives**,
--       and deliberately do NOT assert a table grant (that grant IS the model).
--   • **GRANT-FENCED** (RLS on · **ZERO** SELECT policies · `anon` and
--     `authenticated` hold **no** `SELECT` at all): `system_events`,
--     `mcp_events`, `workspace_token_spend`.
--     → their assert blocks check **the login roles still hold no `SELECT`**, and
--       must NOT assert a policy: there is none, and asserting one would RAISE on
--       a database that is perfectly correct.
-- ⚠ A future table moving between these two models is exactly the change that
-- makes one of these functions unfenced while every policy name still reads
-- right, which is why the check is stated per function instead of once.
--
-- ⚠ **NOT A REALTIME CHANGE, AND THIS FILE SAYS SO** (INVARIANTS §7): no SELECT
-- policy, no column GRANT, no publication membership, no replica identity. It
-- creates no table, column, policy or index.
--
-- ── NO NEW INDEX, DELIBERATELY ──────────────────────────────────────────────
--
-- ⚠ **EVERY PLAN BELOW WAS READ OFF `EXPLAIN` AGAINST PROD, 2026-10-10, not
-- assumed from the index list.** The workspace tool tally — the one live defect —
-- plans as `GroupAggregate` over an **`Index Scan using
-- mcp_tool_calls_workspace_created_idx`** with both columns in the Index Cond.
-- The alerts aggregate plans over `Index Scan using idx_system_events_created`.
-- The two spend aggregates are served by `workspace_token_spend_pkey
-- (workspace_id, user_id, session_key, started_at)` and
-- `workspace_token_spend_user_time_idx (user_id, started_at DESC)`, and the
-- message/member-load tallies by `channel_messages_workspace_created_idx`.
--
-- ⚠ **THE WORKSPACE CREDIT ARM IS INDEX-SERVED TOO, BY A `BitmapOr`, AND THAT IS
-- WORTH STATING BECAUSE IT LOOKS LIKE IT SHOULD NOT BE.** Its two container arms
-- plan as a bitmap union of `credit_usage_events_origin_period_idx` (the
-- `origin_workspace_id` equality; its second column is `period_start`, so the
-- window does not narrow that side) and `credit_usage_events_payer_wallet_channel_idx`
-- (the `wallet` + `channel_id` + `created_at` side, **scanned without its leading
-- `payer_user_id` column**). Neither is an ideal match and both were measured
-- doing the job.
-- ⚠ **ONE STATEMENT IS KNOWINGLY UNINDEXED AND GETS NO INDEX HERE**: `mcp_events`
-- has no `(source, created_at)`. Measured 2026-10-10 it holds **170 rows**, 0 in
-- the window. A scan is free, and an index with a speculative statement behind it
-- is what `20260805120000`'s rule forbids. Revisit if it passes ~100k rows — and
-- likewise re-plan the credit arm if `credit_usage_events` (6,677 rows today)
-- does, since a bitmap union of two half-matching indexes is not a plan to lean
-- on at scale.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
-- Drop each function listed in the manifest below, **AND NOTHING ELSE**: every
-- repository reader DEGRADES to the haul it replaced when its function is absent
-- (`PGRST202` / `42883`), now reporting `truncated` HONESTLY. So a rollback — and
-- the un-applied state this file ships in — costs accuracy on a busy window and
-- never a blank panel. Nothing in the schema depends on this file.
-- ⚠ **WHICH MEANS THE WEB DEPLOY IS SAFE WITHOUT THIS MIGRATION** and is
-- strictly better than today: the numbers are still floors, and they finally say
-- so.
--
-- ── THE MANIFEST (SEVEN FUNCTIONS, AND IT WAS NINE) ─────────────────────────
--
-- Workspace Overview (`features/workspaces/server`):
--   1. workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid)
--   2. workspace_credit_usage_tally(uuid, uuid[], timestamptz)
--   3. workspace_mcp_tool_tally(uuid, timestamptz)
--   4. workspace_message_channel_tally(uuid, timestamptz)
--   5. workspace_message_author_tally(uuid, timestamptz)
-- Admin health (`features/analytics/server`):
--   6. analytics_recent_alert_groups(timestamptz, integer, text[])
--   7. analytics_route_error_groups(timestamptz, text[])
--
-- ⚠ **TWO FUNCTIONS WERE WRITTEN FOR THIS SWEEP AND DELETED BEFORE IT SHIPPED,
-- which is worth recording so nobody re-adds them looking for symmetry:**
--   • `analytics_mcp_health` — **a COUNT needs no RPC.** `max_rows` bounds a
--     response BODY and never the `Content-Range` total, so `head: true` with
--     `count: "exact"` is already immune to this entire class of bug.
--     `getMcpHealth` counts `mcp_tool_calls` instead. One fewer `SECURITY
--     INVOKER` function to review is strictly better than one more.
--   • `analytics_external_api_health` — it grouped by a PROVIDER key over four
--     categories that hold **zero rows in 30 days** (measured), and nothing here
--     writes a provider. Un-clipping a read that returns nothing is not a fix.
--     Replaced by 7, which groups by what the rows actually carry: a route.
--
-- ⚠ **NOTHING HERE SERVES `channels` OR `ontology`, AND THAT IS NOT AN
-- OVERSIGHT.** Both of those sweep sites return LISTS rather than tallies —
-- `listTokenSpend`'s instants must reach a renderer that buckets by the
-- operator's LOCAL day, and an ontology graph IS its rows — so they walk in
-- server-sized pages (`shared/supabase/max-rows.ts › readAllPages`) and need no
-- aggregate. `channels/server/repository-account.ts` needed only an honest
-- ceiling derived from `max_rows`.
--
-- ROLLBACK, IN FULL:
--   DROP FUNCTION public.workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid);
--   DROP FUNCTION public.workspace_credit_usage_tally(uuid, uuid[], timestamptz);
--   DROP FUNCTION public.workspace_mcp_tool_tally(uuid, timestamptz);
--   DROP FUNCTION public.workspace_message_channel_tally(uuid, timestamptz);
--   DROP FUNCTION public.workspace_message_author_tally(uuid, timestamptz);
--   DROP FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]);
--   DROP FUNCTION public.analytics_route_error_groups(timestamptz, text[]);
-- ============================================================================


-- ####################### PART A · WORKSPACE OVERVIEW #######################

-- ============================================================================
-- WORKSPACE OVERVIEW — FIVE GROUP-BYS POSTGRES DOES, NOT FIVE HAULS POSTGREST
-- SILENTLY CLIPS (Samuel #2935, the sweep's workspaces half)
-- ============================================================================
--
-- 🔒 **IT IS WRONG ANSWERS THESE REMOVE, NOT SLOW ONES** — the distinction
-- `20261118120000_home_credit_usage_bins_rpc.sql` draws, now one feature over and
-- at FOUR reads instead of one. `workspaces/server/repository-usage.ts` asked for
-- `WORKSPACE_SCAN_LIMIT` (10,000) raw rows NEWEST FIRST and
-- `service-usage.ts` folded them in JS into the credit series and the three
-- Overview rails; `supabase/config.toml › max_rows = 1000` clips the response,
-- raises nothing, and every one of those folds then ran over the newest 1,000
-- rows of a calendar month. `service-overview.ts › MEMBER_LOAD_SCAN_LIMIT`
-- (10,000) is the fifth, and its `totalMessages` denominator is the figure that
-- read as a 30-day total while holding 1,000 messages.
--
-- ⚠ **AND THE CLIP WAS SILENT, WHICH IS THE HALF THAT MADE IT A GHOST.**
-- `repository-usage.ts`'s own `clipped()` computed
-- `truncated = rows.length >= limit`; with the server clipping at 1,000 and
-- `limit` asking 10,000, `1000 >= 10000` is FALSE, so the floor reported itself
-- COMPLETE and the surface's clip banner could never fire on the one read that
-- was actually a floor. Fixed on the TS side in the same commit (`clippedAt`
-- from `shared/supabase/max-rows.ts` bounds the comparison), so the reads that
-- still haul now say so.
--
-- ⚠ **THE CEILING MOVES ONTO SETS SOMETHING ELSE ALREADY BOUNDS**: one row per
-- UTC day bin (≤31), per channel, per member, per `(tool, op)` pair. Two orders
-- of magnitude inside the cap, and a busy day cannot push it back out.
--
-- ⚠ **NOT A BIGGER `max_rows`, AND NOT A PAGE LOOP** (F-712's wording, verbatim):
-- the first moves the number and keeps the silence, the second hauls the same
-- rows across the wire to do arithmetic Postgres does once.
--
-- ⚠ **NO NEW INDEX FOR THE LEDGER AGGREGATES, AND THE COMMENT SAYS SO RATHER
-- THAN ASSERTING A NEAR MISS.** `credit_usage_events` carries
-- `credit_usage_events_origin_period_idx` on `(origin_workspace_id,
-- period_start)` and `credit_usage_events_payer_wallet_channel_idx` on
-- `(payer_user_id, wallet, channel_id, created_at DESC)`. This statement's shape
-- is `wallet IN (…) AND (origin = ws OR channel = ANY(…)) AND created_at` — the
-- first index keys `period_start`, not `created_at`, and the second leads with a
-- payer. So these two group-bys SCAN, exactly as
-- `repository-overview.ts › countMessagesInWindow` records for its own counts:
-- slow, never wrong. A `DO $$` asserting one of those indexes would be
-- asserting a lie, and a new index with no statement shaped for it is what
-- `20260805120000`'s rule forbids. The message and MCP aggregates DO have their
-- index and assert it.
--
-- 🔒 **`SECURITY INVOKER`, NOT DEFINER, FOR ALL FIVE** — INVARIANTS §9 rules out
-- a `SECURITY DEFINER` binning RPC and the argument is unchanged here: every
-- table below is RLS-NARROWED for the login roles rather than grant-denied to
-- them, so invoker rights can never show a caller a row their own policies would
-- not admit. Called by the repository these run as the service role, which is
-- their full reach; reached over `/rest/v1/rpc` — which the grants below do not
-- permit — they would still be narrowed by those policies. DEFINER would be a
-- second door into the credit ledger and the message table that never consults
-- RLS, handing back per-channel SPEND and per-member MESSAGE COUNTS for
-- containers the caller cannot read.
--
-- 🔒 **`p_workspace_id` IS THE FENCE AND IT IS NEVER CALLER-SUPPLIED.** It comes
-- from `segment.ts › resolveApiWorkspace` (membership-resolved) exactly as the
-- scans it replaces did. `p_channel_ids` is that container's own channel list,
-- read by `repository-usage.ts › listWorkspaceChannelIds`; `p_channel_id` is the
-- one caller-supplied value and it can only ever HIDE rows the fence already
-- admitted — the route proves visibility first
-- (`service-overview.ts › isChannelVisibleTo`).
--
-- ⚠ **THE WALLET PREDICATE IS NOT SHORTCUT, IT IS PUSHED.** `wallet IN
-- ('seat','workspace')` over the union of the two container arms is
-- `service-usage.ts › isWorkspaceSeatBurn` in SQL — a `personal` row addressed at
-- this container is a HOME channel's agent reaching in (rule B arm 1) and is on
-- no workspace figure. **These functions return SUMS, so there are no rows left
-- for that TS predicate to re-filter: the "filtered twice on purpose" belt does
-- not reach this path**, which is why both arms are pinned TEXTUALLY by
-- `workspaces/server/usage-rails-row-cap.test.ts` and its two siblings. If this fence is ever loosened there
-- is no longer a second filter behind it.
--
-- ROLLBACK: drop the five functions named in the `COMMENT`s below.
-- ⚠ **AND NOTHING ELSE** — every reader DEGRADES to its old capped haul when the
-- function is absent (`PGRST202`/`42883`), reporting `truncated` honestly, so a
-- rollback costs accuracy on a busy month and never a blank panel. These create
-- no table, column, policy, index or publication membership (INVARIANTS §7); each
-- closing `DO $$` asserts the READ FENCE THE FUNCTION INHERITS is still there.
-- ⚠ **THEY DELIBERATELY DO NOT ASSERT A TABLE GRANT**, for the reason
-- `20261008120000` learned the hard way: these tables' login-role `SELECT` IS the
-- model and RLS narrows it, so a `has_table_privilege` abort would block a
-- correct apply.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. workspace_credit_usage_bins — the credit SERIES, one row per bin
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.workspace_credit_usage_bins(
  p_workspace_id uuid,
  p_channel_ids uuid[],
  p_since timestamptz,
  p_until timestamptz,
  p_bucket text,
  p_channel_id uuid
)
  RETURNS TABLE (bin_start timestamptz, credits bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    (
      date_trunc(
        -- ⚠ A CASE, not the parameter: `date_trunc` ERRORS on an unknown field,
        -- and this keeps the function LANGUAGE sql with no validation branch.
        CASE WHEN p_bucket = 'hour' THEN 'hour' ELSE 'day' END,
        -- ⚠ **TRUNCATED IN EXPLICIT UTC**, not in the session's `TimeZone`:
        -- `date_trunc(text, timestamptz)` is session-dependent, the bins are UTC
        -- (`overview-series/windows.ts › overviewWindows`), and a server whose
        -- `TimeZone` drifted would silently shift every bar by hours.
        e.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )                                   AS bin_start,
    sum(coalesce(e.amount, 0))::bigint  AS credits
  FROM public.credit_usage_events e
  WHERE
    -- 🔒 isWorkspaceSeatBurn, in SQL. The wallet filter is an AND over the union
    -- of the two container arms, NEVER a third arm.
    e.wallet = ANY (ARRAY['seat', 'workspace'])
    AND (
      -- Rule B arm 3: the channel-less call ("Desktop agent") and every legacy
      -- pooled row.
      e.origin_workspace_id = p_workspace_id
      -- Rule B arm 2: a workspace-channel agent charges the caller's SEAT here
      -- whatever it touches, so its `origin_workspace_id` is often NOT this
      -- container and the channel is the only column that says the bill is.
      OR e.channel_id = ANY (coalesce(p_channel_ids, '{}'::uuid[]))
    )
    -- ⚠ BOUNDED AT BOTH ENDS. The haul this replaces was newest-first and capped,
    -- so an unbounded window anchored in a PAST month returned this month's rows
    -- and plotted zeroes with no clip reported.
    AND e.created_at >= p_since
    AND e.created_at <  p_until
    -- ⚠ A NARROWING INSIDE THE FENCE ABOVE, never a fence of its own.
    AND (p_channel_id IS NULL OR e.channel_id = p_channel_id)
  GROUP BY 1;
$function$;

COMMENT ON FUNCTION public.workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid) IS
  'Credits SUMMED per UTC hour/day bin out of THIS workspace''s seat wallets — the workspace Overview histogram. Replaces a newest-first haul of raw ledger rows that PostgREST silently clipped at max_rows=1000, so a busy day hid the rest of the month (Samuel #2935). SECURITY INVOKER, service_role-only; p_workspace_id is the fence, p_channel_id only narrows. See features/workspaces/server/repository-usage.ts.';

-- 🔒 THE GRANT CONVENTION OF THIS DIRECTORY, STATED IN FULL rather than relying
-- on a default: `20260619040000_security_hardening_rpc_grants.sql` exists because
-- the default PUBLIC EXECUTE had quietly published three RPCs. A new function
-- revokes in the file that creates it, or it ships a standing advisor WARN.
REVOKE ALL ON FUNCTION public.workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, uuid) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'workspace_credit_usage_bins';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.workspace_credit_usage_bins does not exist after this migration — the workspace histogram would answer PGRST202 and fall back to the clipped haul this file exists to remove';
  END IF;

  -- ⚠ THE ONE PROPERTY A NAME CHECK CANNOT SEE. A later CREATE OR REPLACE that
  -- flips this to DEFINER keeps the name, the signature and the grants, and
  -- opens a second door into the credit ledger that never consults RLS.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: workspace_credit_usage_bins is SECURITY DEFINER — it must run with the CALLER''s privileges (service role), never bypass RLS on credit_usage_events (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE workspace_credit_usage_bins — something else (PUBLIC, or another granted role) holds it; find it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE workspace_credit_usage_bins — every workspace histogram read would 42501';
  END IF;

  -- ⚠ NOT A WIDENING, ASSERTED — AND ASSERTED AGAINST THIS TABLE'S ACTUAL MODEL.
  -- `credit_usage_events` GRANTS SELECT to the login roles and fences the ROWS
  -- with RLS, so a grant check here would abort a correct apply. What an
  -- invoker-rights aggregate actually inherits is ROW SECURITY.
  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'credit_usage_events'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on credit_usage_events — its SELECT policy is inert and this invoker-rights aggregate would inherit an unfenced ledger';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'credit_usage_events'
       AND cmd        = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: credit_usage_events carries no FOR SELECT policy — RLS is on with nothing admitting a row, so either the read fence was dropped or the table model moved; find out which before shipping this';
  END IF;

  RAISE NOTICE 'workspace_credit_usage_bins: created, SECURITY INVOKER, service_role-only EXECUTE; credit_usage_events read fence intact (RLS on, SELECT policy live); grouping SCANS by design — see this file''s index note';
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. workspace_credit_usage_tally — the by-channel AND by-person rails, ONE scan
-- ────────────────────────────────────────────────────────────────────────────
--
-- ⚠ **GROUPING SETS, NOT TWO FUNCTIONS AND NOT ONE `(channel, person)` GRID.**
-- Two functions would scan the ledger twice for one panel; a grid keyed on both
-- columns has `channels × members` rows and could be pushed back THROUGH the
-- 1,000-row ceiling by a busy container, which is the bug this file removes.
-- Two single-column grouping sets are bounded by `channels + members`.
-- ⚠ `events` is the SHARES' DENOMINATOR (`WorkspaceUsageBreakdown.scanned`),
-- exact now rather than "however many rows survived the clip". Either grouping
-- set covers every matching row, so summing one dimension's `events` is the
-- window's true total.

CREATE OR REPLACE FUNCTION public.workspace_credit_usage_tally(
  p_workspace_id uuid,
  p_channel_ids uuid[],
  p_since timestamptz
)
  RETURNS TABLE (dimension text, tally_key uuid, credits bigint, events bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    CASE WHEN GROUPING(e.channel_id) = 0 THEN 'channel' ELSE 'person' END AS dimension,
    CASE WHEN GROUPING(e.channel_id) = 0 THEN e.channel_id ELSE e.user_id END AS tally_key,
    sum(coalesce(e.amount, 0))::bigint AS credits,
    count(*)::bigint                   AS events
  FROM public.credit_usage_events e
  WHERE
    -- 🔒 THE SAME FENCE AS §1, WORD FOR WORD. Two spellings of one predicate is
    -- how the rails and the plot above them start disagreeing.
    e.wallet = ANY (ARRAY['seat', 'workspace'])
    AND (
      e.origin_workspace_id = p_workspace_id
      OR e.channel_id = ANY (coalesce(p_channel_ids, '{}'::uuid[]))
    )
    -- ⚠ NO `p_until`, ON PURPOSE: the rails' window is the CREDIT PERIOD (the
    -- current calendar month) and no control moves it, so the scan they replace
    -- took a `since` and nothing else. An `until` here would be a second window
    -- nobody asked for.
    AND e.created_at >= p_since
  GROUP BY GROUPING SETS ((e.channel_id), (e.user_id));
$function$;

COMMENT ON FUNCTION public.workspace_credit_usage_tally(uuid, uuid[], timestamptz) IS
  'Credits and event counts GROUPED per channel and per member in one pass (GROUPING SETS) out of THIS workspace''s seat wallets — the workspace Overview by-channel and by-person rails. Replaces a 10,000-row haul PostgREST clipped at max_rows=1000, which made both rails and their `scanned` denominator wrong (Samuel #2935). SECURITY INVOKER, service_role-only; p_workspace_id is the fence. See features/workspaces/server/repository-usage.ts.';

REVOKE ALL ON FUNCTION public.workspace_credit_usage_tally(uuid, uuid[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_credit_usage_tally(uuid, uuid[], timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_credit_usage_tally(uuid, uuid[], timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_credit_usage_tally(uuid, uuid[], timestamptz) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'workspace_credit_usage_tally';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.workspace_credit_usage_tally does not exist after this migration — both Overview credit rails would fall back to the clipped haul this file exists to remove';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: workspace_credit_usage_tally is SECURITY DEFINER — it must run with the CALLER''s privileges, never bypass RLS on credit_usage_events (INVARIANTS §9); DEFINER here hands back per-member spend for containers the caller cannot read';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE workspace_credit_usage_tally — find what holds it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE workspace_credit_usage_tally — every rail read would 42501';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'credit_usage_events'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on credit_usage_events — this invoker-rights aggregate would inherit an unfenced ledger';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'credit_usage_events'
       AND cmd        = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: credit_usage_events carries no FOR SELECT policy — the read fence this aggregate inherits is gone';
  END IF;

  RAISE NOTICE 'workspace_credit_usage_tally: created, SECURITY INVOKER, service_role-only EXECUTE; one pass over credit_usage_events via GROUPING SETS; read fence intact (RLS on, SELECT policy live)';
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. workspace_mcp_tool_tally — the by-tool rail
-- ────────────────────────────────────────────────────────────────────────────
--
-- ⚠ **OUT-PARAM NAMES ARE PREFIXED (`tool_name`, `op_name`) BECAUSE `tool` AND
-- `op` ARE COLUMNS ON THE TABLE THIS READS.** In a LANGUAGE sql body an OUT
-- parameter shares scope with the FROM list, and a name collision is an
-- "ambiguous column reference" at CREATE time, not at call time.

CREATE OR REPLACE FUNCTION public.workspace_mcp_tool_tally(
  p_workspace_id uuid,
  p_since timestamptz
)
  RETURNS TABLE (tool_name text, op_name text, calls bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    c.tool           AS tool_name,
    c.op             AS op_name,
    count(*)::bigint AS calls
  FROM public.mcp_tool_calls c
  WHERE
    c.workspace_id = p_workspace_id
    AND c.created_at >= p_since
    -- 🔒 `EXCLUDE_AWAIT_POLLING`, UN-DE-MORGANED. The TS pushdown spells this
    -- `tool.neq.channel,op.not.like.await*` inside a PostgREST `.or()` because
    -- that API has no NOT(AND); here the original sentence survives intact:
    -- NOT (tool = 'channel' AND op LIKE 'await%'). `dopl_channel`'s await ops
    -- POLL — a row per tick — and unfiltered they dominate every tool rail.
    AND NOT (c.tool = 'channel' AND c.op LIKE 'await%')
    -- 🔒 `MCP_CALL_ROWS` (`analytics/server/mcp-tool-calls.ts`), whose PostgREST
    -- spelling is `mcp:*`: the per-charged-call tally rows, excluded so a call is
    -- not counted once as a loopback request and again as a charge.
    AND c.tool NOT LIKE 'mcp:%'
  GROUP BY 1, 2;
$function$;

COMMENT ON FUNCTION public.workspace_mcp_tool_tally(uuid, timestamptz) IS
  'MCP calls COUNTED per (tool, op) pair in one workspace — the workspace Overview by-tool rail. Replaces a 10,000-row haul PostgREST clipped at max_rows=1000, so the rail described the newest 1,000 calls while labelled as the month (Samuel #2935). Keeps both pushdown filters: NOT(tool=channel AND op LIKE await%) and tool NOT LIKE mcp:%. SECURITY INVOKER, service_role-only. See features/workspaces/server/repository-usage.ts.';

REVOKE ALL ON FUNCTION public.workspace_mcp_tool_tally(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_mcp_tool_tally(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_mcp_tool_tally(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_mcp_tool_tally(uuid, timestamptz) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'workspace_mcp_tool_tally';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.workspace_mcp_tool_tally does not exist after this migration — the by-tool rail would fall back to the clipped haul this file exists to remove';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: workspace_mcp_tool_tally is SECURITY DEFINER — it must run with the CALLER''s privileges, never bypass RLS on mcp_tool_calls (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE workspace_mcp_tool_tally — find what holds it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE workspace_mcp_tool_tally — every by-tool rail read would 42501';
  END IF;

  -- The statement above is the shape of this index. Without it the month's
  -- grouping seq-scans every MCP call ever logged.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'mcp_tool_calls'
       AND indexname  = 'mcp_tool_calls_workspace_created_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: mcp_tool_calls_workspace_created_idx is missing — 20260716120000 has not run, and this grouping would scan every MCP call row';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'mcp_tool_calls'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on mcp_tool_calls — its admin SELECT policy is inert and this invoker-rights aggregate would inherit an unfenced table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mcp_tool_calls'
       AND cmd        = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: mcp_tool_calls carries no FOR SELECT policy — RLS is on with nothing admitting a row, so either the read fence was dropped or the table model moved';
  END IF;

  RAISE NOTICE 'workspace_mcp_tool_tally: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by mcp_tool_calls_workspace_created_idx; mcp_tool_calls read fence intact (RLS on, SELECT policy live)';
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. workspace_message_channel_tally — the by-channel rail's MESSAGE figure
-- ────────────────────────────────────────────────────────────────────────────
--
-- ⚠ Out-param `billed_channel_id` is prefixed for §3's reason: `channel_id` is a
-- column on `channel_messages`.

CREATE OR REPLACE FUNCTION public.workspace_message_channel_tally(
  p_workspace_id uuid,
  p_since timestamptz
)
  RETURNS TABLE (billed_channel_id uuid, messages bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    m.channel_id     AS billed_channel_id,
    count(*)::bigint AS messages
  FROM public.channel_messages m
  WHERE
    -- 🔒 THE SAME THREE PREDICATES THE SCAN CARRIED, AND NO FOURTH. `kind` keeps
    -- the lifecycle rows (`task_started`, `task_progress`, …) out of a figure
    -- labelled "messages".
    m.workspace_id = p_workspace_id
    AND m.kind = 'message'
    AND m.created_at >= p_since
  GROUP BY 1;
$function$;

COMMENT ON FUNCTION public.workspace_message_channel_tally(uuid, timestamptz) IS
  'Messages COUNTED per channel in one workspace — the message figure on the workspace Overview by-channel rail. Replaces a 10,000-row single-column haul PostgREST clipped at max_rows=1000 (Samuel #2935). SECURITY INVOKER, service_role-only; the caller viewer-filters which channels get a NAME. See features/workspaces/server/repository-usage.ts.';

REVOKE ALL ON FUNCTION public.workspace_message_channel_tally(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_message_channel_tally(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_message_channel_tally(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_message_channel_tally(uuid, timestamptz) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'workspace_message_channel_tally';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.workspace_message_channel_tally does not exist after this migration — the by-channel rail''s message figure would fall back to the clipped haul this file exists to remove';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: workspace_message_channel_tally is SECURITY DEFINER — it must run with the CALLER''s privileges, never bypass RLS on channel_messages (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE workspace_message_channel_tally — find what holds it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE workspace_message_channel_tally — every by-channel rail read would 42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'channel_messages'
       AND indexname  = 'channel_messages_workspace_created_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages_workspace_created_idx is missing — 20260822170000_overview_time_range_indexes.sql has not run, and this grouping would scan every message in the table';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'channel_messages'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on channel_messages — its member SELECT policy is inert and this invoker-rights aggregate would inherit an unfenced transcript';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'channel_messages'
       AND cmd        = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages carries no FOR SELECT policy — RLS is on with nothing admitting a row, so either the read fence was dropped or the table model moved';
  END IF;

  RAISE NOTICE 'workspace_message_channel_tally: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by channel_messages_workspace_created_idx; channel_messages read fence intact (RLS on, SELECT policy live)';
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. workspace_message_author_tally — the MEMBER-LOAD card
-- ────────────────────────────────────────────────────────────────────────────
--
-- ⚠ **THE DENOMINATOR IS THE WHOLE REASON THIS ONE EXISTS.**
-- `service-overview.ts › tallyMemberLoad` reported `totalMessages` beside its
-- percentages, and the haul it summed asked for 10,000 rows and received 1,000 —
-- so a busy container printed "1000 messages" under a 30-DAY label, with every
-- share computed against that wrong total. The old comment argued a clip was
-- honest here because the ratios stay true against the denominator the card
-- shows; that argument only ever held while the denominator was HONEST, and
-- `truncated` was false.
-- ⚠ Out-param `author_id` is prefixed for §3's reason.

CREATE OR REPLACE FUNCTION public.workspace_message_author_tally(
  p_workspace_id uuid,
  p_since timestamptz
)
  RETURNS TABLE (author_id uuid, messages bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    m.author_user_id AS author_id,
    count(*)::bigint AS messages
  FROM public.channel_messages m
  WHERE
    -- 🔒 THE SCAN'S FENCE, UNCHANGED AND COMPLETE. `author_kind = 'user'` is what
    -- makes this a MEMBER-load card rather than an agent-traffic one, and the NOT
    -- NULL keeps a deleted account (`ON DELETE SET NULL`) out of the denominator
    -- instead of bucketing it as a person.
    m.workspace_id = p_workspace_id
    AND m.kind = 'message'
    AND m.author_kind = 'user'
    AND m.created_at >= p_since
    AND m.author_user_id IS NOT NULL
  GROUP BY 1;
$function$;

COMMENT ON FUNCTION public.workspace_message_author_tally(uuid, timestamptz) IS
  'User-authored messages COUNTED per author over the member-load window — the workspace Overview member-load card and its totalMessages denominator. Replaces a 10,000-row haul of author ids PostgREST clipped at max_rows=1000, which printed the newest 1,000 as a 30-day total (Samuel #2935). SECURITY INVOKER, service_role-only. See features/workspaces/server/repository-overview.ts.';

REVOKE ALL ON FUNCTION public.workspace_message_author_tally(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_message_author_tally(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_message_author_tally(uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_message_author_tally(uuid, timestamptz) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'workspace_message_author_tally';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.workspace_message_author_tally does not exist after this migration — the member-load card would fall back to the clipped haul whose denominator this file exists to fix';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: workspace_message_author_tally is SECURITY DEFINER — it must run with the CALLER''s privileges, never bypass RLS on channel_messages (INVARIANTS §9); DEFINER here hands back per-member message counts for containers the caller cannot read';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE workspace_message_author_tally — find what holds it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE workspace_message_author_tally — every member-load read would 42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'channel_messages'
       AND indexname  = 'channel_messages_workspace_created_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages_workspace_created_idx is missing — 20260822170000_overview_time_range_indexes.sql has not run, and this grouping would scan every message in the table';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'channel_messages'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on channel_messages — this invoker-rights aggregate would inherit an unfenced transcript';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'channel_messages'
       AND cmd        = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages carries no FOR SELECT policy — the read fence this aggregate inherits is gone';
  END IF;

  RAISE NOTICE 'workspace_message_author_tally: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by channel_messages_workspace_created_idx; channel_messages read fence intact (RLS on, SELECT policy live)';
END $$;


-- ######################### PART B · ADMIN HEALTH ###########################

-- ── 1/2 · analytics_recent_alert_groups ─────────────────────────────────────
--
-- 🔒 **IT IS A WRONG ANSWER THIS FUNCTION REMOVES, NOT A SLOW ONE** — the
-- distinction `20261118120000_home_credit_usage_bins_rpc.sql` draws, now at the
-- admin health dashboard. `analytics/server/health.ts › getRecentAlerts` asked
-- for 5,000 `system_events` rows NEWEST FIRST and grouped them by `fingerprint`
-- in JS. **The ask was 5,000 and PostgREST is not**: `supabase/config.toml ›
-- max_rows = 1000` clips the response, raises nothing, and every figure the fold
-- then produced was computed over whatever survived.
--
-- ⚠ **AND THAT FILE CARRIED NO CLIP MARKER OF ANY KIND** — not a lying one, as
-- `clipped()` was next door, but NONE. So `×N` on an alert card was a count of
-- surviving rows (`×1,000`-ish for the loudest fingerprint on a noisy day, `×1`
-- for everything older than the cut), and `first_seen` was not the first
-- sighting, it was the oldest row that made it through.
--
-- ⚠ **THE CEILING MOVES ONTO A SET THE CALLER ALREADY BOUNDS.** One row per
-- FINGERPRINT, ordered worst-first and cut to `p_limit` (the page asks 50) — two
-- orders of magnitude inside the cap, and no busy day can push it back out.
--
-- ⚠ **NOT A BIGGER `max_rows`, AND NOT A PAGE LOOP** (F-712's wording, verbatim
-- here): the first moves the number and keeps the silence, the second hauls the
-- same rows across the wire to do arithmetic Postgres does once, indexed.
--
-- ⚠ **THE THREE NEWEST-ROW FIELDS ARE NEWEST-ROW BY CONSTRUCTION, NOT BY LUCK.**
-- `category`, `source` and `sample_message` are taken from the first row of each
-- group in the JS grouper and never revised, which is only "the newest row's"
-- because the haul was `ORDER BY created_at DESC`. Here they are stated as
-- `array_agg(… ORDER BY created_at DESC)[1]`, so the property survives even
-- though an aggregate has no row order to inherit.
-- ⚠ **`severity` IS A `max()` OVER THE SAME LADDER `SEVERITY_RANK` SPELLS IN TS**
-- ({info,warn,error,critical} = 0..3) and is mapped back by name, so a new
-- severity value added to the CHECK constraint ranks 0 here and in TS alike
-- rather than sorting alphabetically.
-- ⚠ **`fingerprint` IS THE FINAL TIE-BREAK AND IT IS LOAD-BEARING.** Without it
-- two groups sharing a severity and a `last_seen` come back in physical order
-- from Postgres and in Map-insertion order from the degrade, and the two paths
-- would render a different list from identical data.
--
-- 🔒 **`SECURITY INVOKER`, NOT DEFINER, AND THIS TABLE'S FENCE IS THE OTHER
-- MODEL.** INVARIANTS §9 rules out a `SECURITY DEFINER` grouping RPC. Unlike
-- `credit_usage_events`/`channel_messages` (RLS-narrowed, SELECT granted to the
-- login roles), `system_events` is **GRANT-DENIED to anon/authenticated**
-- (`20260619040000_security_hardening_rpc_grants.sql` §4) on top of RLS with no
-- SELECT policy at all — deny-all. Called by the dashboard it is the service
-- role's full reach; reached over `/rest/v1/rpc` — which the grants below do not
-- permit — invoker rights would still find nothing. DEFINER would be a second
-- door into the server event log, messages and all, that consults neither.
--
-- ROLLBACK: `DROP FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]);`
-- ⚠ **AND NOTHING ELSE** — `getRecentAlerts` DEGRADES to the old hauling scan
-- when this function is absent (`PGRST202`/`42883`), now reporting `truncated`
-- honestly, so a rollback costs accuracy and never an empty dashboard.
--
-- ⚠ **NOT A REALTIME CHANGE** (INVARIANTS §7): no SELECT policy, no column
-- GRANT, no publication membership, no replica identity. The closing `DO $$`
-- asserts the READ FENCE THIS FUNCTION INHERITS is still there — and asserts it
-- against THIS table's actual model, which is why it checks the ABSENCE of a
-- login-role SELECT grant where `20261118120000` had to check RLS instead.
-- ⚠ **IT DELIBERATELY DOES NOT ASSERT A `FOR SELECT` POLICY**, for the mirror of
-- the reason `20261008120000` learned: `system_events` has none, by design, so
-- that check would abort a correct apply.

CREATE OR REPLACE FUNCTION public.analytics_recent_alert_groups(
  p_since timestamptz,
  p_limit integer,
  p_severities text[]
)
  RETURNS TABLE (
    fingerprint    text,
    severity       text,
    category       text,
    source         text,
    sample_message text,
    event_count    bigint,
    first_seen     timestamptz,
    last_seen      timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    e.fingerprint,
    -- ⚠ The ladder, rolled up and mapped BACK BY NAME. An unknown severity
    -- ranks 0, exactly as `SEVERITY_RANK[…] ?? 0` does in TS.
    CASE max(
           CASE e.severity
             WHEN 'critical' THEN 3
             WHEN 'error'    THEN 2
             WHEN 'warn'     THEN 1
             ELSE 0
           END
         )
      WHEN 3 THEN 'critical'
      WHEN 2 THEN 'error'
      WHEN 1 THEN 'warn'
      ELSE 'info'
    END                                                        AS severity,
    -- ⚠ THE NEWEST ROW'S, stated. See the header.
    (array_agg(e.category ORDER BY e.created_at DESC))[1]      AS category,
    (array_agg(e.source   ORDER BY e.created_at DESC))[1]      AS source,
    (array_agg(e.message  ORDER BY e.created_at DESC))[1]      AS sample_message,
    count(*)::bigint                                           AS event_count,
    min(e.created_at)                                          AS first_seen,
    max(e.created_at)                                          AS last_seen
  FROM public.system_events e
  WHERE e.created_at >= p_since
    AND e.severity = ANY (p_severities)
  GROUP BY e.fingerprint
  -- ⚠ THE SAME COMPARATOR `sortAlertGroups` APPLIES, including the tie-break.
  ORDER BY
    max(
      CASE e.severity
        WHEN 'critical' THEN 3
        WHEN 'error'    THEN 2
        WHEN 'warn'     THEN 1
        ELSE 0
      END
    ) DESC,
    max(e.created_at) DESC,
    e.fingerprint ASC
  -- ⚠ A TOP-N ON THE GROUP LIST, NEVER A CLIP ON THE COUNTS: every event in the
  -- window is counted before this cuts the list. The caller clamps `p_limit` to
  -- `max_rows` so this response can never itself be clipped.
  LIMIT greatest(p_limit, 0);
$function$;

COMMENT ON FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]) IS
  'system_events GROUPED BY fingerprint — count, first/last seen, worst severity, newest sample — for /admin/health. Replaces a newest-first haul of 5,000 raw rows that PostgREST silently clipped at max_rows=1000, so every alert count was a count of survivors (Samuel #2935). p_limit is a top-N on the GROUP list, not on the counted events. SECURITY INVOKER, service_role-only. See features/analytics/server/health.ts.';

-- 🔒 THE GRANT CONVENTION OF THIS DIRECTORY, STATED IN FULL rather than relying
-- on a default: `20260619040000_security_hardening_rpc_grants.sql` exists because
-- the default PUBLIC EXECUTE had quietly published three RPCs, and
-- `20260720220000_revoke_public_on_new_trigger_fns.sql` exists because the next
-- two functions inherited it again.
REVOKE ALL ON FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_recent_alert_groups(timestamptz, integer, text[]) TO service_role;

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'analytics_recent_alert_groups';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.analytics_recent_alert_groups does not exist after this migration — the alert list would answer PGRST202 and fall back to the clipped haul this file exists to remove';
  END IF;

  -- ⚠ THE ONE PROPERTY A NAME CHECK CANNOT SEE. A later CREATE OR REPLACE that
  -- flips this to DEFINER keeps the name, the signature and the grants, and
  -- opens a second door into system_events that never consults its fence.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: analytics_recent_alert_groups is SECURITY DEFINER — it must run with the CALLER''s privileges (service role), never bypass the read fence on system_events (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE analytics_recent_alert_groups — something else (PUBLIC, or another granted role) holds it; find it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE analytics_recent_alert_groups — every alert read would 42501';
  END IF;

  -- The statement above groups a 24h slice of system_events and of nothing else.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'system_events'
       AND indexname  = 'idx_system_events_created'
  ) THEN
    RAISE EXCEPTION
      'ABORT: idx_system_events_created is missing — the baseline schema has not run, and this grouping would scan the whole event log';
  END IF;

  -- ⚠ NOT A WIDENING, ASSERTED — AND ASSERTED AGAINST THIS TABLE'S ACTUAL
  -- MODEL. `system_events` is DENY-ALL: RLS on, no SELECT policy, and the
  -- login-role table grants revoked (20260619040000 §4). So what an
  -- invoker-rights aggregate inherits here is the GRANT, and a restored default
  -- `SELECT` to anon/authenticated is the thing that would quietly re-open the
  -- event log — including every `message` this function hands back as
  -- `sample_message`. A policy check would abort a correct apply instead: there
  -- is deliberately no policy to find.
  IF has_table_privilege('anon', 'public.system_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.system_events', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated hold SELECT on system_events — the deny-all read fence 20260619040000 established is gone, and this invoker-rights aggregate would inherit an open event log';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'system_events'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on system_events — the second half of its deny-all fence is off; find out why before shipping this';
  END IF;

  RAISE NOTICE 'analytics_recent_alert_groups: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by idx_system_events_created; system_events deny-all fence intact (RLS on, no login-role SELECT)';
END $$;

-- ── 2/2 · analytics_route_error_groups ──────────────────────────────────────
--
-- 🔒 **IT REPLACES `analytics_external_api_health`, WHICH WAS WRITTEN FOR THIS
-- SWEEP AND THEN DELETED BEFORE IT SHIPPED.** That function grouped
-- `system_events` by a PROVIDER key — a leading dotted segment, documented as
-- `anthropic.messages` — over `category IN ('external_api','quota','auth','perf')`.
-- ⚠ **MEASURED 2026-10-10: THOSE FOUR CATEGORIES HOLD ZERO ROWS OVER 30 DAYS,
-- AND NOTHING IN THIS CODEBASE WRITES A PROVIDER.** `system_events.source` is an
-- HTTP route string (`POST /api/channels/sessions`), so the panel was
-- structurally blank and would have keyed whole routes as "providers" if it had
-- ever drawn a row. Fixing the clip on a read that returns nothing is not a fix,
-- so the read was renamed to what the rows actually are (Samuel, 2026-10-10).
--
-- ⚠ **IT FILTERS ON SEVERITY AND DELIBERATELY NOT ON `category`.** Every error
-- the logger writes today lands in `category = 'other'` (426 rows / 30 days,
-- measured), so pinning to `'other'` would be correct today and blank again the
-- moment somebody categorises properly. **A category filter is the exact
-- fragility that made the old panel blank**, so this statement has none; "server
-- errors" is a claim about severity. `analytics/server/health.ts ›
-- ERROR_SEVERITIES` is the caller's half of that ruling and its suite asserts
-- that NO `category` clause is sent.
--
-- 🔒 **THE GROUP KEY IS THE ROUTE TEMPLATE, IDS NORMALISED OUT, AND THE TS
-- MIRRORS THIS PATTERN CHARACTER FOR CHARACTER** (`health.ts › UUID_IN_PATH` /
-- `routeOf`, with `_fake-health-db.ts › sqlRoute` spelling the SQL side out
-- again so a drift between them is what fails). ⚠ Measured 2026-10-10: 30 days
-- of errors key as **35 raw sources but only 15 templates**, because the same
-- `/api/channels/:id/await` route under different channel ids was thirteen of
-- the top twenty. Grouping on the raw string makes a handful of real failures
-- read as thirty-five one-off blips.
-- ⚠ **THE `'g'` FLAG IS LOAD-BEARING**: a path can carry two ids
-- (`/api/a/<uuid>/b/<uuid>`), and without it only the first collapses. Pinned by
-- a case on both sides.
--
-- ⚠ **THE CEILING MOVES ONTO THE ROUTE VOCABULARY** — one row per route
-- template, which is a function of how many endpoints exist and not of traffic.
-- No `LIMIT` here on purpose: a top-N would silently DROP a failing route, which
-- is worse than the row count being large, and the group count cannot approach
-- `max_rows` without somebody minting a thousand endpoints.
--
-- 🔒 **`SECURITY INVOKER`, AND `system_events` IS GRANT-FENCED, NOT
-- POLICY-FENCED** — measured 2026-10-10: RLS on, **no `FOR SELECT` policy at
-- all**, and `anon`/`authenticated` hold no `SELECT`. So the assert block below
-- checks THE GRANT and must NOT check for a policy: there is none, and asserting
-- one would RAISE on a database that is perfectly correct. That is the lesson
-- `20261008120000` records, inverted — the same trap from the other side.
--
-- ROLLBACK: `DROP FUNCTION public.analytics_route_error_groups(timestamptz, text[]);`
-- ⚠ AND NOTHING ELSE — `getServerErrorsByRoute` degrades to the capped haul and
-- reports `truncated`.

CREATE OR REPLACE FUNCTION public.analytics_route_error_groups(
  p_since timestamptz,
  p_severities text[]
)
  RETURNS TABLE (
    route text,
    errors_24h bigint,
    criticals_24h bigint,
    last_error_message text,
    last_error_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    regexp_replace(
      coalesce(nullif(e.source, ''), 'unknown'),
      -- ⚠ Any UUID in any path segment. Mirrored by `health.ts › UUID_IN_PATH`.
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
      ':id',
      'g'
    )                                                            AS route,
    count(*)::bigint                                             AS errors_24h,
    (count(*) FILTER (WHERE e.severity = 'critical'))::bigint     AS criticals_24h,
    -- ⚠ THE NEWEST ROW'S message, as the JS roll-up picks it. Every row in this
    -- group is already error-or-critical (the WHERE says so), so there is no
    -- "newest ERROR among other severities" subtlety here — unlike the panel
    -- this replaced, which folded `warn` rows in and then had to re-filter.
    (array_agg(e.message    ORDER BY e.created_at DESC))[1]      AS last_error_message,
    (array_agg(e.created_at ORDER BY e.created_at DESC))[1]      AS last_error_at
  FROM public.system_events e
  WHERE e.created_at >= p_since
    AND e.severity = ANY (p_severities)
  GROUP BY 1;
$function$;

COMMENT ON FUNCTION public.analytics_route_error_groups(timestamptz, text[]) IS
  'Server errors GROUPED BY ROUTE TEMPLATE (ids normalised to :id) for /admin/health. Replaces analytics_external_api_health, whose provider key and category filter matched nothing the logger writes (measured 2026-10-10: zero rows in 30 days). Filters on severity and deliberately not on category. SECURITY INVOKER, service_role-only. See features/analytics/server/health.ts.';

-- 🔒 THE GRANT CONVENTION OF THIS DIRECTORY, STATED IN FULL rather than relying
-- on a default: `20260619040000_security_hardening_rpc_grants.sql` exists
-- because the default PUBLIC EXECUTE had quietly published three RPCs.
REVOKE ALL ON FUNCTION public.analytics_route_error_groups(timestamptz, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_route_error_groups(timestamptz, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.analytics_route_error_groups(timestamptz, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_route_error_groups(timestamptz, text[]) TO service_role;

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'analytics_route_error_groups';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.analytics_route_error_groups does not exist after this migration — /admin/health would answer PGRST202 and fall back to the clipped haul this file exists to remove';
  END IF;

  -- ⚠ THE ONE PROPERTY A NAME CHECK CANNOT SEE. A later CREATE OR REPLACE that
  -- flips this to DEFINER keeps the name, the signature and the grants, and
  -- opens a second door into the event log that never consults RLS.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: analytics_route_error_groups is SECURITY DEFINER — it must run with the CALLER''s privileges (service role), never bypass RLS on system_events (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE analytics_route_error_groups — something else (PUBLIC, or another granted role) holds it; find it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE analytics_route_error_groups — every /admin/health read would 42501';
  END IF;

  -- The statement above is the shape of this index. Without it, 24h of grouping
  -- seq-scans the whole event log. Verified by EXPLAIN 2026-10-10: GroupAggregate
  -- over an Index Scan using this index.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'system_events'
       AND indexname  = 'idx_system_events_created'
  ) THEN
    RAISE EXCEPTION
      'ABORT: idx_system_events_created is missing — this grouping would scan system_events';
  END IF;

  -- ⚠ **THE FENCE THIS INVOKER-RIGHTS AGGREGATE INHERITS, AND IT IS A GRANT,
  -- NOT A POLICY.** `system_events` carries RLS with NO `FOR SELECT` policy and
  -- denies `SELECT` to both login roles (measured 2026-10-10), so asserting a
  -- policy here would abort a correct apply — the `20261008120000` lesson from
  -- the other side. What must hold is that the login roles still cannot read it:
  -- if someone granted them `SELECT`, this function would hand any caller who
  -- reached it a grouped map of every server error.
  IF has_table_privilege('anon', 'public.system_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.system_events', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated hold SELECT on system_events — its deny-all fence is gone, and this invoker-rights aggregate would inherit an unfenced event log';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'system_events'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on system_events — the deny-all fence rests on the grant alone, so a future SELECT policy would silently publish it';
  END IF;

  RAISE NOTICE 'analytics_route_error_groups: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by idx_system_events_created; system_events deny-all fence intact (RLS on, no login-role SELECT)';
END $$;

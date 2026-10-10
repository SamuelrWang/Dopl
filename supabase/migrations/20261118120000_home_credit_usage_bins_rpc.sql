-- ============================================================================
-- HOME CREDIT HISTOGRAM — ONE ROW PER BIN, SUMMED BY POSTGRES (Samuel #2935)
-- ============================================================================
--
-- ⚠ **WRITTEN, NOT APPLIED** — this directory's standing gate. Deploy state is a
-- MEASUREMENT (CLAUDE.md doc rule 4), so this header records no claim: re-derive
-- with `supabase migration list` / MCP `list_migrations`, JOINED ON THE NAME
-- (`home_credit_usage_bins_rpc`), never on this file's version prefix (F-304's
-- re-stamp means the history row's version is not necessarily `20261118120000`).
-- 🔒 Apply BY NAME, BYTE-EXACT, never with `db push`.
--
-- ── WHY IT EXISTS ───────────────────────────────────────────────────────────
--
-- 🔒 **IT IS A WRONG ANSWER THIS FILE REMOVES, NOT A SLOW ONE** — the same
-- distinction `20261008120000_artifact_spans_rpc.sql` draws, and the same root
-- cause one table over. `home/server/repository-overview.ts › scanCreditEvents`
-- asked for `HOME_SCAN_LIMIT` (20,000) raw ledger rows, NEWEST FIRST, and
-- `overview-tally.ts › binCredits` folded them into day bins in JS. **The ask was
-- 20,000 and PostgREST is not**: `supabase/config.toml › max_rows = 1000` clips
-- the response, raises nothing, and the fold then ran over whatever survived.
--
-- ⚠ **MEASURED, 2026-10-10, prod, Samuel's own personal wallet.** October's
-- ledger holds 4,288 credits across Oct 1-10 (Oct 1: 422 · Oct 2: 977 · Oct 4:
-- 337 · Oct 5: 28 · Oct 7: 6 · Oct 8: 319 · Oct 9: 24 · Oct 10: 2,175). **Oct 10
-- alone exceeds the cap**, so a newest-first clip at 1,000 never reached Oct 1-9:
-- the graph drew ~1,000 credits, all of them today, under a spend card reading
-- the full month. One surface, two numbers — the 2026-09-12 two-counter bug
-- again, by a different mechanism.
--
-- ⚠ **AND THE CLIP WAS SILENT, WHICH IS THE HALF THAT MADE IT A GHOST.**
-- `clipped()` computed `truncated = rows.length >= limit`; with the server
-- clipping at 1,000 and `limit` asking 20,000, `1000 >= 20000` is FALSE. The
-- surface's own "these numbers are a floor" banner could never fire on the one
-- read that was actually a floor. Fixed on the TS side in the same commit —
-- `POSTGREST_MAX_ROWS` now bounds the comparison — so a future hauling read
-- reports its clip even where no RPC replaces it.
--
-- ⚠ **THE CEILING MOVES ONTO A SET THE CALENDAR ALREADY BOUNDS.** One row per
-- bin is at most 31 rows for a month and 24 for `24h` — two orders of magnitude
-- inside the cap, and it cannot be pushed back out by a busy day.
--
-- ⚠ **NOT A BIGGER `max_rows`, AND NOT A PAGE LOOP** (F-712's wording, and it
-- holds verbatim here): the first moves the number and keeps the silence, the
-- second hauls the same rows across the wire to do arithmetic Postgres does once,
-- indexed.
--
-- ⚠ **THE BINS STAY IN JS, DELIBERATELY, AND THAT IS WHY THIS GROUPS BY
-- `date_trunc` AND NOT BY A BIN INDEX.** `overview-series/windows.ts ›
-- overviewWindows` owns the calendar — UTC hour for `24h`, UTC day for every
-- other range, a partial trailing bin on a rolling range, a whole calendar month
-- (28..31 bins) for `month`. Those bins are CONTIGUOUS and UTC-aligned, so a
-- `date_trunc` key maps onto exactly one of them and the service can zero-fill
-- against the array it already built. Re-deriving the window arithmetic in SQL
-- would be a SECOND calendar to keep in step, and `binByWindow`'s tests pin the
-- first one.
-- ⚠ **TRUNCATED IN EXPLICIT UTC**, not in the session's `TimeZone`:
-- `date_trunc(text, timestamptz)` is session-dependent, the bins are UTC, and a
-- server whose `TimeZone` drifted would silently shift every bar by hours.
--
-- ⚠ **NO NEW INDEX, DELIBERATELY.** Arm 1 — the whole of October's ledger — is
-- served by `credit_usage_events_payer_wallet_channel_idx` on `(payer_user_id,
-- wallet, channel_id, created_at DESC)` (`20261003120000_credit_events_channel.sql`),
-- which is this statement's shape including the optional channel narrowing; the
-- legacy arm rides `credit_usage_events_origin_period_idx`. The `DO $$` block
-- RAISEs if the first is missing rather than trusting it. An index with no
-- statement behind it is what `20260805120000`'s rule forbids.
--
-- ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
--
-- 🔒 **`SECURITY INVOKER`, NOT DEFINER, AND THAT IS THE FENCE ARGUMENT** —
-- INVARIANTS §9 rules out a `SECURITY DEFINER` binning RPC, and
-- `repository-overview.ts › scanMcpCalls` records that ruling. `credit_usage_events`
-- is **RLS-NARROWED for the login roles, not grant-denied to them** (measured
-- 2026-10-10: `relrowsecurity` on, one live `FOR SELECT` policy, `SELECT` granted
-- to `anon` and `authenticated`) — the same model as `channel_messages`, so the
-- same argument applies without restating it: invoker rights can never show a
-- caller a row their own policies would not admit. Called by the repository it is
-- the service role's full reach; reached over `/rest/v1/rpc` — which the grants
-- below do not permit — it would still be narrowed by that policy. DEFINER would
-- be a second door into the ledger that never consults RLS, handing back a
-- per-day SPEND CURVE for wallets the caller cannot read.
-- ⚠ **AND IT IS NOT A SHORTCUT PAST THE WALLET PREDICATE.** The two arms below
-- are `overview-tally.ts › isPersonalWalletBurn` pushed into SQL, exactly as the
-- superseded `.or()` pushdown was; the TS predicate still re-filters nothing here
-- because this function returns SUMS, not rows — which is why the `DO $$` block
-- and `home-credit-bins-schema.test.ts` pin both arms textually. **If this
-- statement's fence is ever loosened there is no longer a second filter behind
-- it**, so that test is the belt and this comment is the warning.
--
-- 🔒 **`p_payer_user_id` IS THE FENCE, NOT A NARROWING**, and `p_channel_id` is
-- the reverse. The wallet fence is a PERSON (Samuel, 2026-09-12) and the caller
-- derives it from the session, never from a request param; the channel scope is
-- caller-supplied (`overview-series-params.ts › parseUsageScope`) and needs no
-- ownership check precisely because it can only ever HIDE rows the fence already
-- admitted. ⚠ `p_channel_scope = 'unattributed'` is `channel_id IS NULL` — the
-- Desktop-agent bucket — and `'all'`/`'channel'`/`'unattributed'` PARTITION the
-- wallet's rows exactly (rule B, 2026-09-13).
--
-- ROLLBACK: `DROP FUNCTION public.home_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, text, uuid);`
-- ⚠ **AND NOTHING ELSE** — the repository DEGRADES to the old hauling scan when
-- this function is absent (`PGRST202`/`42883`), reporting `truncated` honestly, so
-- a rollback costs accuracy on a busy month and never a blank graph. Nothing in
-- the schema depends on this file; it creates no table, column, policy or index.
--
-- ⚠ **NOT A REALTIME CHANGE, AND THIS FILE SAYS SO** (INVARIANTS §7): no SELECT
-- policy, no column GRANT, no publication membership, no replica identity. The
-- closing `DO $$` asserts the READ FENCE THIS FUNCTION INHERITS is still there.
-- ⚠ **IT DELIBERATELY DOES NOT ASSERT A TABLE GRANT**, for the reason
-- `20261008120000` learned the hard way: this table's login-role `SELECT` IS the
-- model and RLS narrows it, so a `has_table_privilege` abort would block a
-- correct apply.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.home_credit_usage_bins(
  p_payer_user_id uuid,
  p_owned_container_ids uuid[],
  p_since timestamptz,
  p_until timestamptz,
  p_bucket text,
  p_channel_scope text,
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
        e.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )                                   AS bin_start,
    sum(coalesce(e.amount, 0))::bigint  AS credits
  FROM public.credit_usage_events e
  WHERE
    -- 🔒 isPersonalWalletBurn, in SQL. Arm 1: every v2.1 row. Arm 2: a LEGACY
    -- `wallet='workspace'` row with no payer, attributed through the origin
    -- container's owner exactly as backfill-credit-wallets-v2.sql does.
    (
      (e.payer_user_id = p_payer_user_id AND e.wallet = 'personal')
      OR (
        e.wallet = 'workspace'
        AND e.origin_workspace_id = ANY (coalesce(p_owned_container_ids, '{}'::uuid[]))
      )
    )
    AND e.created_at >= p_since
    AND e.created_at <  p_until
    AND (
      p_channel_scope = 'all'
      OR (p_channel_scope = 'unattributed' AND e.channel_id IS NULL)
      OR (p_channel_scope = 'channel'      AND e.channel_id = p_channel_id)
    )
  GROUP BY 1;
$function$;

COMMENT ON FUNCTION public.home_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, text, uuid) IS
  'Credits SUMMED per UTC hour/day bin out of the reader''s OWN personal wallet — the /home Overview histogram. Replaces a newest-first haul of raw ledger rows that PostgREST silently clipped at max_rows=1000, so a busy day hid the rest of the month (Samuel #2935). SECURITY INVOKER, service_role-only; p_payer_user_id is the fence, p_channel_scope only narrows. See features/home/server/repository-overview.ts.';

-- 🔒 THE GRANT CONVENTION OF THIS DIRECTORY, STATED IN FULL rather than relying
-- on a default: `20260619040000_security_hardening_rpc_grants.sql` exists because
-- the default PUBLIC EXECUTE had quietly published three RPCs, and
-- `20260720220000_revoke_public_on_new_trigger_fns.sql` exists because the next
-- two functions inherited it again. A new function revokes in the file that
-- creates it, or it ships a standing Supabase advisor WARN.
REVOKE ALL ON FUNCTION public.home_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.home_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.home_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.home_credit_usage_bins(uuid, uuid[], timestamptz, timestamptz, text, text, uuid) TO service_role;

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
     AND p.proname = 'home_credit_usage_bins';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.home_credit_usage_bins does not exist after this migration — the histogram would answer PGRST202 and fall back to the clipped haul this file exists to remove';
  END IF;

  -- ⚠ THE ONE PROPERTY A NAME CHECK CANNOT SEE. A later CREATE OR REPLACE that
  -- flips this to DEFINER keeps the name, the signature and the grants, and
  -- opens a second door into the credit ledger that never consults RLS.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: home_credit_usage_bins is SECURITY DEFINER — it must run with the CALLER''s privileges (service role), never bypass RLS on credit_usage_events (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE home_credit_usage_bins — something else (PUBLIC, or another granted role) holds it; find it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE home_credit_usage_bins — every histogram read would 42501';
  END IF;

  -- The statement above is the shape of this index and of nothing else. Without
  -- it, a month's grouping seq-scans the whole ledger.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'credit_usage_events'
       AND indexname  = 'credit_usage_events_payer_wallet_channel_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: credit_usage_events_payer_wallet_channel_idx is missing — 20261003120000_credit_events_channel.sql has not run, and this grouping would scan the ledger';
  END IF;

  -- ⚠ NOT A WIDENING, ASSERTED — AND ASSERTED AGAINST THIS TABLE'S ACTUAL
  -- MODEL. `credit_usage_events` GRANTS SELECT to the login roles and fences the
  -- ROWS with RLS, so a grant check here would abort a correct apply (the lesson
  -- 20261008120000 records). What an invoker-rights aggregate actually inherits
  -- is ROW SECURITY: if it were disabled, or if the last `FOR SELECT` policy
  -- were gone, every policy name on the table would still read as a fence while
  -- this function summed spend for anybody who reached it.
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

  RAISE NOTICE 'home_credit_usage_bins: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by credit_usage_events_payer_wallet_channel_idx; credit_usage_events read fence intact (RLS on, SELECT policy live)';
END $$;

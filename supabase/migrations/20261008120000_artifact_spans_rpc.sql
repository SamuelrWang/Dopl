-- ============================================================================
-- ARTIFACT SPANS — ONE ROW PER ARTIFACT, COUNTED BY POSTGRES (F-712)
-- ============================================================================
--
-- ⚠ **WRITTEN, NOT APPLIED — apply by name, byte-exact** (`artifact_spans_rpc`),
-- this directory's standing gate (INVARIANTS §12). Replay is OWED and recorded
-- rather than glossed: Docker is unavailable on this machine, so
-- `supabase db reset` cannot start.
-- 🔒 **APPLY IT BY NAME, NEVER BY FILENAME VERSION, AND NEVER WITH `db push`**
-- — F-304's re-stamp means the history row's version is NOT this file's
-- `20261008120000` prefix, and nothing here records what it is. Deploy state is
-- a MEASUREMENT (CLAUDE.md doc rule 4): re-derive with `supabase migration list`
-- / MCP `list_migrations` and JOIN ON THE NAME.
--
-- ── WHY IT EXISTS ───────────────────────────────────────────────────────────
--
-- 🔒 **IT IS A WRONG ANSWER THIS FILE REMOVES, NOT A SLOW ONE** — the one
-- distinction that makes this migration a CORRECTNESS DEPENDENCY where
-- `20261007120000_search_fulltext_indexes.sql` was deliberately not one.
-- `repository-artifacts.ts › artifactSpans` used to derive `count` / `first_seq`
-- / `last_seq` by SELECTing the member rows themselves (`select("artifact_id,
-- seq")` over `channel_messages`) and folding them in JS. **The select was
-- unbounded and PostgREST is not**: `supabase/config.toml › max_rows = 1000`
-- clips the response, raises nothing, and every number the fold then produced
-- was computed over whatever survived the clip. A card's whole value is "which
-- box does #1119 live in", so a clipped `last_seq` points a reader at the WRONG
-- artifact and a clipped `count` under-reports it — silently, and differently
-- each time the page moves.
--
-- ⚠ **THE CEILING MOVES ONTO A SET THE CALLER ALREADY BOUNDS.** The Artifacts
-- face asks for up to `CHANNEL_ARTIFACT_LIST_LIMIT` (50) artifacts at once, so
-- the 1000-row cap used to land at ~20 folded messages per artifact — inside the
-- range a real room reaches. One row per artifact puts the cap two orders of
-- magnitude away from the data.
--
-- ⚠ **NOT A BIGGER `max_rows`, AND NOT A PAGE LOOP** (F-712 says this in as many
-- words): the first moves the number and keeps the silence, the second pulls the
-- same rows across the wire to do arithmetic Postgres does once, indexed.
--
-- ⚠ **NO NEW INDEX, DELIBERATELY.** The grouping is served by
-- `channel_messages_artifact_idx` on `(artifact_id, seq) WHERE artifact_id IS
-- NOT NULL` (`20260926120000_channel_artifacts.sql`), which is exactly this
-- statement's shape; the `DO $$` block below RAISEs if it is not there, rather
-- than trusting it. An index with no statement behind it is what
-- `20260805120000`'s rule forbids, and a second one here would be that.
--
-- ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
--
-- 🔒 **`SECURITY INVOKER`, NOT DEFINER, AND THAT IS THE FENCE ARGUMENT.** This
-- function does arithmetic over `channel_messages` — a table that is
-- **RLS-NARROWED for the login roles, not grant-denied to them**: `SELECT` is
-- granted to `authenticated`, `20260725130000_channels_rls_hardening.sql` revokes
-- only `INSERT`/`UPDATE`/`DELETE` ("the three `*_member_select` policies are
-- intentionally left in place — they carry the direct-read model for Realtime and
-- RLS reads"), and `channel_messages_member_select`
-- (`20260826120000_guest_channel_realtime_rls.sql`) is what decides WHICH rows.
-- **The service role is the WRITER**; row security is the read fence.
-- ⚠ **THAT IS EXACTLY WHY INVOKER IS RIGHT HERE, AND IT IS THE WHOLE ARGUMENT.**
-- Invoker keeps the privileges of whoever calls it, so this function can never
-- show a caller a row that caller's own policies would not admit: called by the
-- repository it is the service role's full reach, and called over
-- `/rest/v1/rpc` — which the grants below do not permit — it would still be
-- narrowed by `channel_messages_member_select`. `SECURITY DEFINER` is the
-- opposite: a second door into the table that never consults RLS at all, with
-- the aggregate handing back a `count` and a seq SPAN for rooms the caller
-- cannot read. `20260823150000_home_link_channels.sql › consume_channel_link` is
-- the same INVOKER + service_role-only pairing, for the same reason.
--
-- 🔒 **THE `p_channel_id` ARGUMENT IS THE FENCE, NOT A NARROWING**, and it is
-- why this signature carries two arguments where F-712's sketch carried one.
-- The read it replaces was `.eq("channel_id", …).in("artifact_id", …)`, and its
-- docblock states that the channel predicate is the whole authorization: the
-- caller has been proved able to read THIS channel, so a member row that somehow
-- carried a foreign artifact id still cannot be counted out of another room.
-- Dropping it because the ids "are already fenced upstream" would move a fence
-- into a caller's habits. Same argument, verbatim, as
-- `repository-artifacts.ts › findArtifactByChannelAndId`.
--
-- ROLLBACK: `DROP FUNCTION public.channel_artifact_spans(uuid, uuid[]);` — and
-- revert the repository with it, or `artifactSpans` answers `PGRST202` on every
-- transcript read that folds anything. Nothing else in the schema depends on
-- this file; it creates no table, no column, no policy and no index.
--
-- ⚠ **NOT A REALTIME CHANGE, AND THIS FILE SAYS SO** (INVARIANTS §7): no SELECT
-- policy, no column GRANT, no publication membership and no replica identity is
-- touched. The closing `DO $$` asserts that the READ FENCE IS STILL THE ONE THIS
-- FUNCTION INHERITS — row security ENABLED on `channel_messages` and at least one
-- live `FOR SELECT` policy on it — so "this migration did not widen anything" is
-- checked rather than claimed.
-- ⚠ **IT DELIBERATELY DOES NOT ASSERT A TABLE GRANT.** An earlier draft aborted
-- the apply on `has_table_privilege('authenticated', …, 'SELECT')`, which read
-- this table as `channel_artifacts`-shaped (deny-by-default, service-role only).
-- **It is not**, and the database was right: the grant is the realtime read
-- model, and RLS is what narrows it. An assertion that names the wrong model
-- blocks a correct apply, which is worse than not asserting.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.channel_artifact_spans(
  p_channel_id uuid,
  p_artifact_ids uuid[]
)
  RETURNS TABLE (artifact_id uuid, count bigint, first_seq bigint, last_seq bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT m.artifact_id,
         count(*)      AS count,
         min(m.seq)    AS first_seq,
         max(m.seq)    AS last_seq
  FROM public.channel_messages m
  WHERE m.channel_id = p_channel_id
    AND m.artifact_id = ANY (p_artifact_ids)
  GROUP BY m.artifact_id;
$function$;

COMMENT ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) IS
  'COUNT and seq SPAN per artifact, over the WHOLE artifact — the numbers a folded card carries. Replaces a client-side fold over an unbounded select that PostgREST silently clipped at max_rows (F-712). SECURITY INVOKER, service_role-only; p_channel_id is the fence. See features/channels/server/repository-artifacts.ts.';

-- 🔒 THE GRANT CONVENTION OF THIS DIRECTORY, STATED IN FULL rather than relying
-- on a default: `20260619040000_security_hardening_rpc_grants.sql` exists
-- because the default PUBLIC EXECUTE had quietly published three RPCs, and
-- `20260720220000_revoke_public_on_new_trigger_fns.sql` exists because the next
-- two functions inherited it again. A new function revokes in the same file that
-- creates it, or it ships a standing Supabase advisor WARN.
REVOKE ALL ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) TO service_role;

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
     AND p.proname = 'channel_artifact_spans';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.channel_artifact_spans does not exist after this migration — every artifact card read would answer PGRST202';
  END IF;

  -- ⚠ THE ONE PROPERTY A NAME CHECK CANNOT SEE. A later CREATE OR REPLACE that
  -- flips this to DEFINER keeps the name, the signature and the grants, and
  -- opens a second door into channel_messages that never consults RLS.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: channel_artifact_spans is SECURITY DEFINER — it must run with the CALLER''s privileges (service role), never bypass RLS on channel_messages';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE channel_artifact_spans — something else (PUBLIC, or another granted role) holds it; find it before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE channel_artifact_spans — every artifact card read would 42501';
  END IF;

  -- The statement above is the shape of this index and of nothing else. If it
  -- were gone, the grouping would seq-scan every message in the channel.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'channel_messages'
       AND indexname = 'channel_messages_artifact_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages_artifact_idx is missing — 20260926120000_channel_artifacts.sql has not run, and this grouping would scan the room';
  END IF;

  -- ⚠ NOT A WIDENING, ASSERTED — AND ASSERTED AGAINST THIS TABLE'S ACTUAL
  -- MODEL. `channel_messages` GRANTS SELECT to the login roles on purpose (the
  -- direct-read model Realtime uses) and fences the ROWS with RLS, so a grant
  -- check here would abort a correct apply. What an invoker-rights aggregate
  -- actually inherits is ROW SECURITY: if it were disabled, or if the last
  -- `FOR SELECT` policy were gone, every policy name on the table would still
  -- read as a fence while this function counted rows for anybody who reached it.
  IF NOT (
    SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'channel_messages'
  ) THEN
    RAISE EXCEPTION
      'ABORT: ROW LEVEL SECURITY is not enabled on channel_messages — its SELECT policies are inert and this invoker-rights aggregate would inherit an unfenced table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_messages'
       AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_messages carries no FOR SELECT policy — RLS is on with nothing admitting a row, so either the read fence was dropped or the table model moved; find out which before shipping this';
  END IF;

  RAISE NOTICE 'channel_artifact_spans: created, SECURITY INVOKER, service_role-only EXECUTE; grouping served by channel_messages_artifact_idx; channel_messages read fence intact (RLS on, SELECT policy live)';
END $$;

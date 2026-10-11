-- ============================================================================
-- channel_member_tally — MEMBER COUNTS PER CHANNEL, COUNTED BY POSTGRES
-- (Release Review 2026-10-11 › Deferred #2; cleanup C13, branch
-- cleanup/c13-tally, NOT FOR MERGE until Samuel says go)
-- ============================================================================
--
-- ⚠ **WRITTEN, NOT APPLIED** — this directory's standing gate. Deploy state is a
-- MEASUREMENT, so this header records no claim: re-derive with
-- `supabase migration list` / MCP `list_migrations`, joined on the NAME
-- (`channel_member_tally_rpc`). 🔒 Apply BY NAME, BYTE-EXACT, never `db push`.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- `repository-members.ts › memberCounts` hauls every `channel_members` row of
-- the listed channels and counts them in JS, walking pages up to a 10,000-row
-- hard cap. Past the cap every count is short and the read says so
-- (`truncated`), but the number is still wrong. One row per channel puts the
-- ceiling at the channel count, not the membership count. Same shape and the
-- same argument as `20261119120000_max_rows_sweep_tally_rpcs.sql`.
--
-- ⚠ **THE CALLER DEGRADES WHEN THIS FUNCTION IS ABSENT** (PGRST202 / 42883):
-- code deployed before this file is applied falls back to the paged walk with
-- `truncated` carried. So the deploy order is free, but the exact count only
-- arrives once this is applied.
--
-- ── FENCE ───────────────────────────────────────────────────────────────────
--
-- 🔒 **SECURITY INVOKER, NOT DEFINER** (INVARIANTS §9). The only caller is the
-- service role (`supabaseAdmin()`), which is what reads `channel_members` today;
-- an INVOKER function adds no door. `p_channel_ids` is the whole fence, as the
-- `.in("channel_id", …)` it replaces was: the caller passes only channel ids it
-- already resolved for this user. EXECUTE is revoked from PUBLIC, anon and
-- authenticated in this file (`20260619040000_security_hardening_rpc_grants.sql`).
--
-- ⚠ A channel with no members returns NO row (not a 0), matching the walk it
-- replaces: the caller's `Map.get` answers `undefined` for both.

CREATE OR REPLACE FUNCTION public.channel_member_tally(p_channel_ids uuid[])
  RETURNS TABLE (channel_id uuid, member_count bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT m.channel_id, count(*)::bigint AS member_count
  FROM public.channel_members m
  WHERE m.channel_id = ANY (coalesce(p_channel_ids, '{}'::uuid[]))
  GROUP BY m.channel_id;
$function$;

COMMENT ON FUNCTION public.channel_member_tally(uuid[]) IS
  'Member rows COUNTED per channel for the given ids — the channel list''s memberCount. Replaces a paged haul of channel_members capped at 10,000 rows. SECURITY INVOKER, service_role-only; p_channel_ids is the fence. See features/channels/server/repository-members.ts › memberCounts.';

REVOKE ALL ON FUNCTION public.channel_member_tally(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_member_tally(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.channel_member_tally(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.channel_member_tally(uuid[]) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'channel_member_tally';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'ABORT: public.channel_member_tally does not exist after this migration — memberCounts would keep degrading to the capped walk';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION
      'ABORT: channel_member_tally is SECURITY DEFINER — it must run with the caller''s privileges (INVARIANTS §9)';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: anon/authenticated can still EXECUTE channel_member_tally — find the grant before shipping this';
  END IF;

  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot EXECUTE channel_member_tally — every channel list read would fall back to the walk';
  END IF;
END
$$;

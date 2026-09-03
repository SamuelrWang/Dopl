-- ═══════════════════════════════════════════════════════════════════════════
-- `channel_resource_grants` BECOMES READ-ONLY TO EVERY API ROLE (F-581)
-- Wave B, batch-2 review. 2026-09-02.
--
-- ═══ WHAT WAS WRONG ═════════════════════════════════════════════════════════
--
-- `20260828120000` left `channel_resource_grants_admin_write` as `FOR ALL` at an
-- `admin` floor, which was correct while that table WAS the grant table.
-- `20260914120000` moved the truth to `resource_grants` and turned this one into
-- a COMPATIBILITY MIRROR written only by `mirror_channel_resource_grant()` — but
-- the write policy survived the move, and one reader did too:
-- `knowledge/server/repository-audience.ts › listGrantedBaseIdsForChannels`, the
-- agent's reachable-base set.
--
-- 🔒 So the mirror was a SECOND DOOR onto the audience answer. A workspace admin
-- with their own JWT could `INSERT INTO channel_resource_grants` through
-- PostgREST and have that row counted as a grant, having never met
-- `enforce_resource_grant()` — the trigger that decides whether the grantor may
-- reach BOTH containers, and the one this wave strengthened (`20260914120000`).
-- The service-role path was never the exposure; PostgREST is, which is the same
-- sentence `20260828120000` was written to answer and the same one that had to
-- be answered again here.
--
-- ═══ WHAT THIS DOES ═════════════════════════════════════════════════════════
--
-- 1. DROPS the write policy outright rather than re-creating it `FOR SELECT`.
--    `channel_resource_grants_member_select` already carries an `admin` arm that
--    reads every row, so a second admin-SELECT policy would be a permissive
--    duplicate of an arm that exists — the read stays exactly as wide, and the
--    table stops accepting writes from `anon`/`authenticated` entirely.
-- 2. Makes `drop_channel_resource_grants_for_kb()` SECURITY DEFINER. With no
--    write policy, a DELETE from a user client matches no row and REMOVES
--    NOTHING — silently, because RLS filters rather than raises. That would
--    leave a purged knowledge base's grants standing in the mirror. The sibling
--    writer, `mirror_channel_resource_grant()`, is SECURITY DEFINER in
--    `20260914120000` for the same reason and says so at its own definition.
--
-- ⚠ NEITHER FUNCTION DECIDES ANYTHING. Both write values derived from a row that
-- already passed its own table's validity trigger, and
-- `enforce_channel_resource_grant()` still fires underneath the mirror's INSERT.
-- `REVOKE EXECUTE … FROM anon, authenticated` is re-asserted below (advisor
-- 0028/0029) because it does not survive a `CREATE OR REPLACE`.
--
-- ═══ APPLY / VERIFY / REPLAY ════════════════════════════════════════════════
--
-- Idempotent: `DROP POLICY IF EXISTS` and `CREATE OR REPLACE FUNCTION`.
-- The commands, not their answers (CLAUDE.md doc rule 4):
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='channel_resource_grants';
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('drop_channel_resource_grants_for_kb',
--                      'mirror_channel_resource_grant');
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS OWED, NOT RUN: Docker is
-- unavailable on this machine, as it has been for all of wave A and wave B.
--
-- ROLLBACK (prose). Re-create the policy with the body
-- `20260828120000` §1 carries, and drop `SECURITY DEFINER` from the function.
-- Doing so re-opens the second door; no data is touched either way.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The mirror accepts no writes from an API role ────────────────────────
DROP POLICY IF EXISTS channel_resource_grants_admin_write ON public.channel_resource_grants;

-- ── 2. The GC writer keeps working without one ──────────────────────────────
CREATE OR REPLACE FUNCTION public.drop_channel_resource_grants_for_kb() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM channel_resource_grants
   WHERE resource_type = 'knowledge_base' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE EXECUTE ON FUNCTION public.drop_channel_resource_grants_for_kb() FROM anon, authenticated;

-- ── 3. Assert the outcome instead of trusting it (INVARIANTS §12) ───────────
DO $$
DECLARE
  v_write int;
  v_defer boolean;
BEGIN
  SELECT count(*) INTO v_write FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'channel_resource_grants'
     AND cmd <> 'SELECT';
  IF v_write <> 0 THEN
    RAISE EXCEPTION 'channel_resource_grants still carries % non-SELECT policies', v_write;
  END IF;

  SELECT prosecdef INTO v_defer FROM pg_proc
   WHERE proname = 'drop_channel_resource_grants_for_kb';
  IF v_defer IS NOT TRUE THEN
    RAISE EXCEPTION 'drop_channel_resource_grants_for_kb is not SECURITY DEFINER';
  END IF;
END $$;

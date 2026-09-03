-- DROP `channel_resource_grants` — the compatibility mirror, once its last
-- reader moved (F-460). Wave B batch 3, integration.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ═══ WHY THIS FILE EXISTS AND WHY IT COULD NOT BE `20260914120000` ══════════
--
-- `20260914120000_resource_grants.sql` folded three grant tables into one and
-- then deliberately did NOT drop this one, because a reader outside that
-- slice's file ownership still selected from it:
-- `knowledge/server/repository-audience.ts › listGrantedBaseIdsForChannels`,
-- the agent AUDIENCE CEILING's reachable-base set. Its header names this file's
-- work in as many words: *"BATCH 3 DELETES THIS, together with
-- `channel_resource_grants` and its two triggers, once that last reader
-- moves."*
--
-- 🔒 **THE READER MOVED FIRST, AND THAT ORDER IS THE WHOLE SAFETY ARGUMENT.**
-- The statement now reads `resource_grants` with `scope_type = 'channel'`
-- beside its existing `resource_type = 'knowledge_base'` term — BOTH halves,
-- for the reason `repository-channel-grants.ts › CHANNEL_KNOWLEDGE_GRANT`
-- states: without the scope term a team's grants would be counted as a
-- channel's and the ceiling would widen. Code lands before the migration runs
-- (the standing rule for this directory), so between the two there is a window
-- in which the mirror is written and read by nobody, which is exactly the
-- window an expand/contract wants.
--
-- ═══ NO DATA MOVES, AND THAT IS CHECKED RATHER THAN ASSERTED ════════════════
--
-- Every row in `channel_resource_grants` is a COPY of one in `resource_grants`:
-- `20260914120000` §6 backfilled the table in that direction and
-- `mirror_channel_resource_grant()` has kept it exact IN THE SAME TRANSACTION
-- as every write since. So this is a `DROP`, not a migration — but a mirror
-- that had silently stopped tracking would take real grants with it, so step 0
-- RAISEs on any channel/knowledge_base row that is in the old table and not in
-- the new one. **A drop that cannot lose anything is worth proving before it
-- runs, not after.**
--
-- ═══ WHAT GOES, IN DEPENDENCY ORDER ═════════════════════════════════════════
--
--   1. `resource_grants_channel_mirror` + `mirror_channel_resource_grant()`
--      — the writer. It goes FIRST: while the table still exists, a mirror
--      whose target has been dropped would abort every legal `resource_grants`
--      write, and this file must never be able to leave the tree in that state
--      halfway through.
--   2. `channel_resource_grants_kb_cleanup` (on `knowledge_bases`) +
--      `drop_channel_resource_grants_for_kb()` — the hard-delete GC.
--      `resource_grants_cleanup` (`20260914120000` §5) already does this job
--      for the surviving table, so nothing is left ungarbaged.
--   3. `channel_resource_grant_workspace_check` +
--      `enforce_channel_resource_grant()` — the validity trigger.
--      `enforce_resource_grant()` is its successor and is strictly wider
--      (`20260921140000` repaired its grantor arm).
--   4. the TABLE, which takes with it
--      `channel_resource_grants_member_select` — the one policy
--      `20260921130000` left standing when it made this table read-only. That
--      file was a correction to a LIVE table; this one removes the table, so
--      the policy has nothing left to guard. **Neither file restates the
--      other's work**: `20260921130000` still applies cleanly before this one
--      and its own verification block still passes at the moment it runs.
--
-- ⚠ THE TRIGGERS ON `channel_resource_grants` ITSELF (1's target and 3's) would
-- fall with `DROP TABLE` anyway. They are dropped by name first so that the
-- FUNCTIONS can be dropped without `CASCADE` — a `DROP FUNCTION … CASCADE`
-- here would silently take any other dependant with it, and there must not be
-- one.
--
-- ═══ IDEMPOTENT, AND REVERSIBLE ONLY BY RESTORING THREE FILES ═══════════════
--
-- Every statement is `IF EXISTS`. **THERE IS NO ROLLBACK BLOCK, deliberately.**
-- Re-creating the table would mean re-stating `20260827120000` §§2-5 and
-- `20260914120000` §7 verbatim — two copies of a definition this wave spent
-- three migrations removing. The revert is: revert this file's commit, which
-- restores the code reader, and re-run `20260827120000`, `20260828120000`,
-- `20260921130000` and `20260914120000`'s mirror section from the tree.
--
-- ⚠ VERIFICATION IS A MEASUREMENT (CLAUDE.md doc rule 4). After apply:
--   SELECT to_regclass('public.channel_resource_grants');            -- NULL
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('mirror_channel_resource_grant',
--                      'enforce_channel_resource_grant',
--                      'drop_channel_resource_grants_for_kb');       -- 0 rows

-- ── 0. The mirror is exact, or this file refuses to run ──────────────────────
DO $$
DECLARE
  v_orphans BIGINT;
BEGIN
  IF to_regclass('public.channel_resource_grants') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $q$
    SELECT count(*)
      FROM public.channel_resource_grants o
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.resource_grants g
        WHERE g.scope_type    = 'channel'
          AND g.scope_id      = o.channel_id
          AND g.resource_type = o.resource_type
          AND g.resource_id   = o.resource_id
     )
  $q$ INTO v_orphans;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'channel_resource_grants holds % row(s) absent from resource_grants — the mirror is not exact and dropping it would lose grants',
      v_orphans;
  END IF;
END $$;

-- ── 1. The writer ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS resource_grants_channel_mirror ON public.resource_grants;
DROP FUNCTION IF EXISTS public.mirror_channel_resource_grant();

-- ── 2. The hard-delete GC ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS channel_resource_grants_kb_cleanup ON public.knowledge_bases;
DROP FUNCTION IF EXISTS public.drop_channel_resource_grants_for_kb();

-- ── 3. The validity trigger ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS channel_resource_grant_workspace_check
  ON public.channel_resource_grants;
DROP FUNCTION IF EXISTS public.enforce_channel_resource_grant();

-- ── 4. The table, and `channel_resource_grants_member_select` with it ────────
DROP POLICY IF EXISTS channel_resource_grants_member_select
  ON public.channel_resource_grants;
DROP TABLE IF EXISTS public.channel_resource_grants;

-- ── 5. Verification (INVARIANTS §12) ─────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.channel_resource_grants') IS NOT NULL THEN
    RAISE EXCEPTION 'channel_resource_grants survived its own drop';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('mirror_channel_resource_grant',
                       'enforce_channel_resource_grant',
                       'drop_channel_resource_grants_for_kb')
  ) THEN
    RAISE EXCEPTION 'a channel_resource_grants function outlived its table';
  END IF;
END $$;

-- ============================================================================
-- DROP `channel_personal_arming` — THE ARMING SWITCH IS GONE (Samuel's R-48)
-- ============================================================================
--
-- ⚠️ **WRITTEN, NOT APPLIED (this directory's standing gate).** The file records
-- the COMMAND; deploy state is a measurement taken elsewhere (CLAUDE.md doc
-- rule 4). ⚠ Apply BY NAME, byte-exact, never `db push`, never by the filename
-- version — F-304's re-stamp means a history row's version is not this file's
-- `20261012120000` prefix. Join `supabase migration list` on the NAME
-- (`drop_channel_personal_arming`).
--
-- ── WHAT THIS REMOVES, AND WHY IT IS ALREADY DEAD ───────────────────────────
--
-- `20260925120000_channel_personal_arming.sql` created the per-(room, owner)
-- switch behind task 11 (design #1077): an agent session in a SHARED room could
-- reach its operator's personal shelf only from a room that owner had armed.
--
-- 🔴 **SAMUEL REVERSED TASK 11 ON 2026-09-06 AND THE CODE HALF LEFT ON
-- 2026-09-07.** `src/shared/tenancy/personal-reach.ts` decides reach DEFAULT-ON
-- and no longer probes this table; the arming route, its service module, the
-- SPA control and the personal-reach notice were all deleted. Since that commit
-- the table has had **NOTHING LEFT THAT WRITES IT AND NOTHING THAT READS IT** —
-- it survived only because a drop is not free to write. R-48 (Samuel,
-- 2026-09-17) closes that: **delete, don't disarm.**
--
-- ⚠ **A SURVIVING ROW GRANTS NOTHING AND REFUSES NOTHING.** Reach is decided
-- without asking, so the rows are inert in both directions — this drop cannot
-- widen or narrow anybody's access. What it does remove is THREE live SELECT/
-- INSERT/DELETE policies from the RLS surface, which is the cost of keeping an
-- epitaph fenced.
--
-- ⚠ **MEASURE FIRST; NO COUNT IS WRITTEN HERE** (CLAUDE.md doc rule 1). The rows
-- are lost for good and no reader can reconstruct who armed what:
--
--   SELECT count(*) AS rows, count(DISTINCT owner_id) AS owners
--     FROM public.channel_personal_arming;
--
-- Only rows written between the table shipping (applied to prod 2026-09-05) and
-- the reversal can exist at all. Tell Samuel the number before applying if it is
-- not zero — not because anything depends on it, but because "who armed a room"
-- stops having an answer the moment this runs.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
-- ⚠ **THE DDL REVERSES; THE ROWS DO NOT.** Re-apply
-- `20260925120000_channel_personal_arming.sql` verbatim — table, owner index,
-- table comment and all three policies — and the schema is back exactly as it
-- was, EMPTY. Snapshot before applying if the rows are wanted:
--
--   CREATE TABLE public._rb_20261012120000 AS
--     SELECT * FROM public.channel_personal_arming;
--
-- ⚠ **A ROLLBACK RESTORES NO BEHAVIOUR.** The TS half has been gone since
-- 2026-09-07, so the re-created table would be as inert as the one this drops.
-- Re-growing the narrowing means restoring the fence in `personal-reach.ts`
-- FIRST — §5A, the two halves of one rule move together or neither does.
-- ============================================================================

-- ── 1. The three policies ───────────────────────────────────────────────────
-- Explicitly, and before the table: a policy is a dependency of the table it
-- names, and letting `DROP TABLE` take them silently is how a policy that was
-- never accounted for leaves no trace of having existed.
DROP POLICY IF EXISTS channel_personal_arming_select_own
  ON public.channel_personal_arming;
DROP POLICY IF EXISTS channel_personal_arming_insert_own
  ON public.channel_personal_arming;
DROP POLICY IF EXISTS channel_personal_arming_delete_own
  ON public.channel_personal_arming;

-- ── 2. The table ────────────────────────────────────────────────────────────
-- No `CASCADE`: nothing depends on it. It is a CASCADE *child* of `channels`
-- (`channel_id`) and of `auth.users` (`owner_id`), and `channel_personal_arming_owner_idx`
-- plus the primary key go with the table. A `CASCADE` here would mean something
-- unaccounted for was hanging off it, which is the thing to find out, not hide.
DROP TABLE IF EXISTS public.channel_personal_arming;

-- ── 3. Assert the outcome instead of trusting it (INVARIANTS §12) ───────────
--   SELECT to_regclass('public.channel_personal_arming');
--   SELECT policyname FROM pg_policies WHERE tablename = 'channel_personal_arming';
DO $$
BEGIN
  IF to_regclass('public.channel_personal_arming') IS NOT NULL THEN
    RAISE EXCEPTION 'channel_personal_arming survived its own drop';
  END IF;
  -- ⚠ Policy rows are keyed to the table's oid, so this cannot outlive it —
  -- which is exactly why it is asserted: if it ever DOES, the name was reused.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_personal_arming'
  ) THEN
    RAISE EXCEPTION 'channel_personal_arming policies outlived the table';
  END IF;
END $$;

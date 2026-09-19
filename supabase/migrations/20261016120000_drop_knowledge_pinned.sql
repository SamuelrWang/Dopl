-- ⚠ **RE-STAMPED FROM `20261014120000` AT THE 2026-09-19 MERGE** — three
-- branches of this wave each claimed that timestamp. The NAME is unchanged,
-- and this directory is applied BY NAME (F-304, INVARIANTS §12), so the
-- re-stamp is a re-ordering and nothing else. Apply order in the wave:
-- `knowledge_client_write_id` (20261014120000), THIS, then
-- `backfill_entity_escaped_knowledge_titles` (20261016120000).
-- ============================================================================
-- DROP knowledge_bases.pinned / knowledge_entries.pinned — PINNED STARTUP
-- CONTEXT (T81) IS DELETED (Samuel's ruling, 2026-09-18).
--
-- THE RULING, VERBATIM: *"For pinning, i dont knwo where the pinning happens.
-- but yeah let's remove pinning for now, remove the code for pinning stuff.
-- lioke kbs. ill reimplement it down the line."*
--
-- ⚠ **DELETE, NOT DISARM** (the standing purge ruling). The whole feature goes
-- in the same change as these two columns: `service-pins.ts`,
-- `repository-pins.ts`, `service-startup-context.ts`, the three REST routes
-- (`PUT|DELETE .../bases/{id}/pin`, `PUT|DELETE .../entries/{id}/pin`,
-- `GET /api/knowledge/startup-context`), the `pinnedBaseIds` sibling key on the
-- base list, `dopl_kb(op="pin"|"unpin")` and its ceiling, the three SDK methods
-- and the `StartupContext` types, and the desktop's launch-time fetch and
-- prompt fold. A column left behind with nothing reading it is how a feature
-- comes back half-built.
--
-- ⚠ **`chats.pinned` IS A DIFFERENT COLUMN AND IS NOT TOUCHED HERE.** It is the
-- chat-list pin behind `dopl_chats(op="update", pinned=…)` — a per-row ordering
-- flag on an archive, not a launch-context force-feed. Same word, unrelated
-- feature, and the ruling above names knowledge bases.
--
-- ── WHAT WAS MEASURED BEFORE WRITING THIS (2026-09-18, prod) ────────────────
-- Deploy state is a measurement, not a claim, and BOTH halves of this one were
-- read off the live catalog rather than off the repo:
--
--   1. **THE COLUMNS EXIST IN PROD**, `boolean NOT NULL DEFAULT false` on both
--      tables. ⚠ `docs/INVARIANTS.md` §12 recorded the adding migration
--      (`knowledge_pinned_startup_context`) as **WRITTEN AND NOT APPLIED** and
--      that claim was STALE — the columns are there. The INVARIANTS bullet is
--      corrected in this same change. Re-derive rather than trusting either
--      line: `supabase migration list --linked`, joined on the NAME.
--   2. **NOT ONE ROW IS PINNED.** `SELECT count(*) … WHERE pinned = true` is
--      ZERO on both tables. So this drop destroys no curation, and no agent
--      session's prompt changes by one byte: a startup-context read over a
--      workspace that has pinned nothing already returned an empty payload,
--      which the desktop already rendered as no lines at all.
--
-- ⚠ **NOTHING DEPENDS ON THESE COLUMNS**, also measured rather than assumed:
-- no index mentions `pinned` on either table (the adding migration deliberately
-- created none — a boolean has two distinct values and the planner would
-- decline it), no RLS policy's `USING` or `WITH CHECK` mentions it (it leaned on
-- the existing `*_member_select` pair and wrote no policy of its own), no
-- function body mentions it alongside either table, and no view or matview
-- projects it. So `DROP COLUMN` here takes nothing with it — there is no
-- `CASCADE` in this file and none is needed.
--
-- ⚠ **REALTIME NEEDS NO STEP.** Both tables are in `supabase_realtime` for ALL
-- columns, so the column simply stops appearing in the UPDATE frames it used to
-- ride. Replica identity is `USING INDEX` on the primary key and never involved
-- `pinned`; this file does not touch it, and the verification block below
-- asserts that rather than trusting it.
--
-- ⚠ **NO GRANT AND NO REVOKE.** The adding migration issued none — the column
-- inherited the table-wide grant — so there is nothing to hand back.
--
-- ⚠ **IDEMPOTENT.** `DROP COLUMN IF EXISTS` twice, safe to replay against a
-- database that never got the adding migration (a fresh `supabase db reset`
-- replays both files in order and lands in the same place either way).
--
-- ⚠ **ADDITIVE ONLY — it edits no applied migration.**
-- `20260908120000_knowledge_pinned_startup_context.sql` STAYS ON DISK, unedited.
-- The history is the record of what was true; rewriting it would make a replay
-- of an older checkout disagree with a replay of this one.
--
-- ── ROLLBACK (prose, per §12) ───────────────────────────────────────────────
--   ALTER TABLE knowledge_bases   ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
--   ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
-- Safe in either order and it fails CLOSED: re-adding the columns restores two
-- all-`false` booleans that nothing reads, because the CODE is gone — the
-- rollback is the schema half only, and it widens nothing.
-- ⚠ **THE ONE REAL COST IS ZERO TODAY AND WOULD NOT BE LATER.** Which rows an
-- operator chose lives nowhere else in the schema, so a drop destroys the
-- curation permanently. Today that set is EMPTY (measured above), so nothing is
-- lost. Run the count again before replaying this file anywhere that has been
-- live longer than this one.
-- ============================================================================

ALTER TABLE knowledge_bases   DROP COLUMN IF EXISTS pinned;
ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS pinned;

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- A partially-applied file must RAISE here rather than leave half the feature
-- standing. Each condition names the CONSEQUENCE, because "something is wrong
-- with pinned" is not a message anybody can act on.
--
-- The last two checks assert what this migration did NOT do — an absence is
-- what silently stops being true. Losing the replica-identity index stops every
-- UPDATE frame reaching a subscriber, and a SELECT policy that vanished would
-- mean this drop had taken an authorization rule with it.
DO $$
DECLARE
  tbl      TEXT;
  leftover TEXT;
  identity "char";
  sel_pol  INT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['knowledge_bases', 'knowledge_entries'] LOOP
    SELECT column_name INTO leftover
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'pinned';

    IF leftover IS NOT NULL THEN
      RAISE EXCEPTION 'drop_knowledge_pinned: %.pinned still exists — the code that read it is deleted, so the column is now unreachable state that a future reader would mistake for a live feature', tbl;
    END IF;

    SELECT relreplident INTO identity FROM pg_class
     WHERE oid = ('public.' || tbl)::regclass;
    IF identity <> 'i' THEN
      RAISE EXCEPTION 'drop_knowledge_pinned: % replica identity is %, expected i (USING INDEX, 20260807150000) — this migration does not touch it, and losing it stops every UPDATE frame reaching a subscriber', tbl, identity;
    END IF;

    SELECT count(*) INTO sel_pol
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = tbl AND cmd = 'SELECT';
    IF sel_pol <> 1 THEN
      RAISE EXCEPTION 'drop_knowledge_pinned: % carries % SELECT policies, expected exactly one (%_member_select) — this file drops a column and must not have changed who can read the row', tbl, sel_pol, tbl;
    END IF;
  END LOOP;

  -- ⚠ THE NEIGHBOUR THAT KEEPS ITS PIN. Asserted positively so a future
  -- "remove pinning" sweep that reads this filename cannot take it by mistake.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'chats' AND column_name = 'pinned'
  ) THEN
    RAISE EXCEPTION 'drop_knowledge_pinned: chats.pinned is gone — this file drops the KNOWLEDGE pins only, and the chat-list pin behind dopl_chats(op="update") is a different feature that was not ruled on';
  END IF;
END $$;

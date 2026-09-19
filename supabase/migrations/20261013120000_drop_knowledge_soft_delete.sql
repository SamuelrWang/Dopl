-- ============================================================================
-- DROP KNOWLEDGE SOFT-DELETE — A KB DELETE IS JUST GONE (Samuel's ruling)
-- ============================================================================
--
-- ⚠ **WRITTEN, NOT APPLIED** — this directory's standing gate; replay is OWED
-- and recorded rather than glossed (Docker is unavailable on this machine, so
-- `supabase db reset` cannot start; CI's `rls-redteam` job is the replay).
--
-- 🔒 **APPLY IT BY NAME (`drop_knowledge_soft_delete`), NEVER BY FILENAME
-- VERSION** — F-304's re-stamp (INVARIANTS §12). Deploy state is a MEASUREMENT
-- (CLAUDE.md doc rule 4): re-derive with `supabase migration list` / MCP
-- `list_migrations`, JOINED ON THE NAME.
--
-- **APPLY ORDER: after `drop_channel_personal_arming` (`20261012120000`)**, the
-- highest filename version in this directory at write time. It depends on
-- nothing and nothing depends on it — every object below is dropped, none is
-- created, and no surviving object references any of them.
--
-- ── SAMUEL'S RULING, VERBATIM (2026-09-18) ──────────────────────────────────
--
--   "for deleting the KB software, we don't have that anymore. When a user
--    deletes a KB, it's just gone. There's no soft deletion, so please address
--    and fix that as well."
--
-- The standing permanent-deletes ruling from the launch waves, applied to the
-- relics the switch left behind.
--
-- ── 🔴 THE LIVE DEFECT: A TRIGGER THAT CALLS A TABLE THAT IS NOT THERE ──────
--
-- `kb_soft_delete_cascade_attachments` (AFTER UPDATE ON `knowledge_bases`) runs
-- `cascade_kb_soft_delete_to_attachments()`, whose whole body is
--
--     IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
--       DELETE FROM workflow_knowledge_bases WHERE knowledge_base_id = NEW.id;
--     END IF;
--
-- and `workflow_knowledge_bases` HAS NOT EXISTED SINCE 2026-08-11. Prove it,
-- do not take it on trust — both come back NULL:
--
--   SELECT to_regclass('public.workflow_knowledge_bases'),
--          to_regclass('public.workflow_skills');
--
-- 🔒 **ROOT CAUSE, NAMED SO IT IS NOT RE-LEARNED.**
-- `20260811120000_drop_workflows_and_clusters.sql` dropped the five workflow
-- tables and then dropped five functions BY HAND, and its own header says why it
-- thought that was the whole set: *"DROP TABLE removes the tables' own
-- triggers"*. True — and these two triggers are not the tables' own. They sit on
-- `knowledge_bases` and on `skills`, which SURVIVED, so `DROP TABLE` never saw
-- them and the hand list did not name them. **A trigger on a surviving table
-- that writes a dropped one is invisible to a drop-by-table sweep.**
--
-- ⚠ **LATENT, NOT FIRING — AND THE DISTINCTION IS THE WHOLE RISK PROFILE.** The
-- guard is `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL`, and NOTHING
-- IN THE APPLICATION WRITES `deleted_at` ANY MORE (re-derive: `grep -rn
-- --include='*.ts' --include='*.tsx' 'deleted_at' src packages apps` — every hit
-- is a read filter, a projection column, or a `deletedAt: null` fixture). So the
-- branch is never taken and ordinary base updates pass through the trigger
-- untouched. What the drop removes is a **LOADED GUN**: the first UPDATE that
-- ever stamps `deleted_at` — a console fix, a script, a reintroduced soft
-- delete — fails at `42P01` inside an AFTER trigger, i.e. the whole statement
-- rolls back and the caller gets an undefined-table error about a feature that
-- was deleted a month earlier.
--
-- ── ALSO DROPPED: THE FOUR KNOWLEDGE SOFT-DELETE / RESTORE RPCs ─────────────
--
-- `cascade_soft_delete_base`, `cascade_soft_delete_folder`,
-- `cascade_restore_base`, `cascade_restore_folder`
-- (`20260501040000_knowledge_soft_delete_cascade.sql`) are the trash-and-restore
-- machinery itself: every one of them exists only to STAMP or CLEAR
-- `deleted_at`. They are exactly what the ruling says the product does not have.
--
-- ⚠ **NOTHING CALLS THEM, AND THE ONE APPARENT REFERENCE IS NOT A CALLER.** Each
-- name appears exactly once in the tree, in `src/shared/supabase/types.ts` — the
-- file GENERATED FROM THE DEPLOYED DATABASE. It is a mirror of what exists, not
-- a use of it, and it regenerates from prod, so it is correct today and will be
-- correct after the apply. Re-derive:
--
--   grep -rn --include='*.ts' --include='*.tsx' cascade_soft_delete_base src packages apps
--
-- The live delete path takes none of them: `knowledge/server/service-base-writes.ts
-- › deleteBase` → `repository-bases.ts › hardDeleteBase` is a plain `DELETE`,
-- and `service-folders.ts › deleteFolder` → `hardDeleteFolder` calls
-- `cascade_hard_delete_folder` (`20260807140000`), which this file does not
-- touch and which stays.
--
-- ── ⚠ WHAT THIS FILE DELIBERATELY DOES **NOT** DROP ─────────────────────────
--
-- 1. **THE `deleted_at` COLUMNS AND THEIR INDEXES — F-730.** Zero rows carry a
--    non-null `deleted_at` on any of the eight tables that have the column
--    (measured 2026-09-18; the count is a measurement, so re-derive it), and the
--    app-side filters are inert. But removing the columns is NOT MECHANICAL and
--    that is the bar this directory sets: three of the indexes are PARTIAL
--    UNIQUE constraints (`knowledge_bases_workspace_slug_active_unique`,
--    `knowledge_entries_unique_active`, `knowledge_folders_unique_active`) that
--    would have to be REBUILT as total uniques — a real constraint change, on
--    live tables, in a file whose subject is removing dead weight — and
--    `knowledge_entries_search_tsv_idx` is a partial GIN over a GENERATED STORED
--    column. The TS side is load-bearing too: `deletedAt` is on the
--    `@dopl/client` mirror that `scripts/check-knowledge-type-drift.ts` pins
--    field-for-field, so the column cannot leave the database without a
--    published-SDK change in the same commit. **F-730 carries the exact
--    remaining work.** Leaving them costs nothing: a column nothing writes is
--    not a soft delete, it is a column.
--
-- 2. **THE ONTOLOGY CLUSTER SOFT-DELETE RPCs** — `cascade_soft_delete_cluster`,
--    `cascade_restore_cluster`, `cascade_purge_cluster`
--    (`20260718000040` / `20260718000060`). Same shape, same deadness (one
--    generated-types reference each, no caller), but a DIFFERENT FEATURE than
--    the one the ruling names. They are recorded in F-730 rather than swept in
--    here, because a migration whose header says "knowledge" must not quietly
--    change ontology.
--
-- 3. **`revisions` ROWS FOR DELETED RESOURCES — BY DESIGN, NOT A LEAK.**
--    `revisions.resource_id` has no FK and no cascade ON PURPOSE:
--    `service-base-writes.ts › deleteBase` writes a `op='delete'` revision
--    IMMEDIATELY AFTER the hard delete, so a trigger that cleared history on
--    delete would erase the very row the delete path had just filed.
--    `20261002120000_revisions.sql`'s header states the trade in as many words
--    ("A REVISION OF A DELETED RESOURCE READS AS INVISIBLE — THE FAIL-CLOSED
--    DIRECTION"), and `dopl_revision_readable` already answers FALSE for them.
--    **An append-only audit log surviving its subject is the feature.**
--
-- ── EVERY CHILD OF A DELETED BASE ALREADY GOES WITH IT ──────────────────────
--
-- Nothing below adds a cascade, because none is missing. `hardDeleteBase`'s one
-- statement clears the subtree through five `ON DELETE CASCADE` FKs
-- (`knowledge_entries`, `knowledge_folders`, `knowledge_entry_chunks`,
-- `knowledge_base_stars`, `agent_template_knowledge_bases`) plus the AFTER
-- DELETE trigger `resource_grants_cleanup`. Re-derive:
--
--   SELECT conname, conrelid::regclass, confdeltype FROM pg_constraint
--    WHERE contype = 'f' AND confrelid = 'public.knowledge_bases'::regclass;
--
-- Pinned in TypeScript by `src/features/knowledge/soft-delete-retired.test.ts`,
-- which replays this directory in filename order.
--
-- ── ROLLBACK — PROSE, NOT COMMENTED-OUT SQL ────────────────────────────────
--
-- (`dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this
-- directory WITHOUT stripping comments, so a commented-out DDL block is read as
-- if it were live.)
--
-- Purely subtractive: six functions and two triggers, no table, column, index,
-- policy or grant touched, and no data. To revert, re-run from the tree, in this
-- order — the triggers reference the functions, so functions go back first:
--
--   1. `20260501040000_knowledge_soft_delete_cascade.sql` §§ for
--      `cascade_soft_delete_base` / `_folder` and `cascade_restore_base` /
--      `_folder`. ⚠ **DO NOT re-run that file's closing backfill `DO $$ block`**,
--      which walks every `deleted_at IS NOT NULL` row — it is a no-op today and
--      re-running it is a write against live tables for nothing.
--   2. `20260502110000_cluster_attachment_safeguards.sql` §§ for the two
--      `cascade_*_soft_delete_to_attachments` functions AND their triggers, then
--      `20260502110100_lock_trigger_search_path.sql`'s two `ALTER FUNCTION …
--      SET search_path` lines, or the restored functions come back UNPINNED.
--
-- 🔴 **AND THAT REVERT PUTS THE DEFECT BACK, KNOWINGLY.** The two restored
-- trigger functions still name `workflow_knowledge_bases` / `workflow_skills`,
-- which no revert of this file re-creates. Reverting is therefore only ever
-- correct as part of reverting the permanent-deletes ruling itself — at which
-- point those two bodies must be rewritten, not restored.

-- ── 1. The two triggers that call dropped tables, and their functions ───────
-- Triggers first: a `DROP FUNCTION` under a live trigger is refused (2BP01),
-- which would make this file's order a runtime failure rather than a no-op.
-- ⚠ NO `CASCADE` anywhere in this file, on purpose. `CASCADE` would drop
-- whatever else depends on these — and "something else depends on the dead
-- soft-delete machinery" is the finding to surface, not the thing to hide.
DROP TRIGGER IF EXISTS kb_soft_delete_cascade_attachments
  ON public.knowledge_bases;
DROP FUNCTION IF EXISTS public.cascade_kb_soft_delete_to_attachments();

DROP TRIGGER IF EXISTS skill_soft_delete_cascade_attachments
  ON public.skills;
DROP FUNCTION IF EXISTS public.cascade_skill_soft_delete_to_attachments();

-- ── 2. The knowledge trash/restore RPCs ─────────────────────────────────────
-- ⚠ ARGUMENT TYPES ARE PART OF THE NAME. `DROP FUNCTION IF EXISTS` with the
-- wrong signature is a silent no-op, not an error, so an overload left standing
-- reads as dropped. The four below are the identities `pg_get_function_identity_arguments`
-- reports; verify with the query in §3 rather than trusting this comment.
DROP FUNCTION IF EXISTS public.cascade_soft_delete_base(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.cascade_soft_delete_folder(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.cascade_restore_base(UUID);
DROP FUNCTION IF EXISTS public.cascade_restore_folder(UUID);

-- ── 3. Assert the outcome instead of trusting it (INVARIANTS §12) ───────────
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'cascade_%';
--   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
--     AND tgrelid IN ('public.knowledge_bases'::regclass, 'public.skills'::regclass);
DO $$
DECLARE
  survivor TEXT;
BEGIN
  -- ⚠ Matched on NAME ALONE, not on the signatures dropped above: that is the
  -- point. An overload this file's argument lists missed is still a live
  -- soft-delete entry point, and it is exactly what a signature-shaped check
  -- would report as gone.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO survivor
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('cascade_kb_soft_delete_to_attachments',
                       'cascade_skill_soft_delete_to_attachments',
                       'cascade_soft_delete_base',
                       'cascade_soft_delete_folder',
                       'cascade_restore_base',
                       'cascade_restore_folder');
  IF survivor IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge soft-delete functions survived: %', survivor;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('kb_soft_delete_cascade_attachments',
                      'skill_soft_delete_cascade_attachments')
  ) THEN
    RAISE EXCEPTION 'soft-delete cascade triggers outlived their functions';
  END IF;

  -- 🔒 THE SURVIVORS ARE ASSERTED TOO, or "nothing named cascade_% is left" is a
  -- pass this file would also get by dropping the live hard-delete path.
  IF to_regclass('public.knowledge_bases') IS NULL
     OR to_regclass('public.skills') IS NULL THEN
    RAISE EXCEPTION 'this file dropped a table it was only meant to untrigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cascade_hard_delete_folder'
  ) THEN
    RAISE EXCEPTION 'cascade_hard_delete_folder is gone — the live folder delete path';
  END IF;
END $$;

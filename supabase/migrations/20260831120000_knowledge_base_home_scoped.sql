-- ============================================================================
-- knowledge_bases.home_scoped — THE /home SHELF IS ITS OWN PLACE
-- (Samuel's ruling, 2026-08-26: "home-only shelf").
--
-- WHAT THIS IS FOR
-- `/home` → Knowledge → Private → **"across all channels"** (scope C,
-- `apps/desktop-ui/src/pages/home/knowledge-panels.tsx`) used to be defined as
-- *"the caller's HOME workspace, private + own"*. That definition is a WORKSPACE
-- range wearing a CHANNEL label, and it delivered exactly what it promised and
-- not at all what it was for: the operator's whole workspace KB shelf — bases
-- authored months earlier on the workspace Knowledge page, that were never in
-- any channel — showed up under a pill that reads "across all channels".
--
-- This column is the missing noun. `home_scoped = true` means **this base was
-- created FROM the /home shelf**, and after this wave that is the only thing
-- scope C lists. The two surfaces become two PLACES over one table:
--
--     home_scoped = true   → /home → Knowledge → "across all channels"
--     home_scoped = false  → /{workspaceSegment}/knowledge (the workspace page)
--
-- ⚠ SEPARATION IS BOTH WAYS, and that is the ruling, not an implementation
-- convenience. The workspace Knowledge page EXCLUDES home-scoped bases. A shelf
-- that is "its own place" in one direction only is just a filter.
--
-- WHAT ENFORCES IT
-- Writes: `features/knowledge/server/service-base-writes.ts › createBase`. The
-- flag is accepted ONLY when all three hold, checked server-side and never
-- inferred from a header:
--   1. the target workspace IS the caller's own default standard workspace
--      (`features/workspaces/server/repository.ts › findDefaultWorkspaceForUser`
--      — the same answer `POST /api/boot` hands the page, so the fence and the
--      surface cannot disagree about which workspace "home" is);
--   2. the base is `private` — the shelf is the operator's own;
--   3. the credential stands for a PERSON
--      (`shared/auth/credential-audience.ts › isSharedCredential` is false).
-- Anything else that asks for it is refused 403 HOME_SCOPE_FORBIDDEN rather
-- than quietly downgraded: a create that silently lands on the other shelf is
-- the bug this file exists to end.
-- Reads: `features/knowledge/server/service-bases.ts › listBases` takes a
-- `shelf` and `features/knowledge/server/repository-bases.ts ›
-- listBasesForWorkspace` turns it into `.eq('home_scoped', …)`. ABSENT shelf =
-- NO filter, which is what keeps MCP `kb_list_bases` and workspace SEARCH
-- seeing the operator's whole workspace.
--
-- ⚠ THE COLUMN IS NEVER PROJECTED, AND THAT IS DELIBERATE. It is NOT in
-- `server/dto.ts › KNOWLEDGE_BASE_COLS`, not on `KnowledgeBaseRow`, and not on
-- the `KnowledgeBase` domain type. Postgres filters happily on a column the
-- SELECT omits, and keeping it off the row buys three things: the
-- SDK-mirrored `KnowledgeBase` does not widen (`scripts/check-knowledge-type-
-- drift.ts`), no cached payload gains a field that a pre-deploy bundle would
-- read as `undefined` (INVARIANTS §8 stale-cache), and no client can be tempted
-- to re-implement the fence by filtering a list it was handed. **If a surface
-- ever needs to SHOW which shelf a base is on, add it as a SIBLING key on the
-- list response (the `channelGrants` / `baseStats` precedent), not as a field
-- on the row.**
--
-- FALSE IS THE OVERWHELMING MAJORITY AND MEANS "THE WORKSPACE SHELF"
-- Every existing row — every seeded base, every MCP-created base, every base
-- made on the workspace Knowledge page — stays `false` and behaves exactly as
-- before. **There is no backfill in this file, by instruction.** Marking an
-- already-created base onto the home shelf is a one-line UPDATE run by hand
-- against known ids; a migration that hardcodes row ids is not a schema change,
-- it is a data edit that every future environment would replay.
--
-- NO INDEX, AND THE REASON IS THE READ SHAPE
-- The only queries that touch this column are
-- `workspace_id = ? AND deleted_at IS NULL AND home_scoped = ?`, and
-- `knowledge_bases_workspace_active_idx (workspace_id) WHERE deleted_at IS NULL`
-- already narrows that to ONE workspace's live bases — a shelf, not a feed
-- (measured 2026-08-26: the largest workspace in production holds fewer than
-- two dozen). A boolean has two distinct values, so a composite or partial
-- index over it would be a heap-fetch multiplier the planner would decline
-- anyway. ⚠ Re-open this if a shelf read is ever made ACROSS workspaces —
-- that query does not exist today and would not use the index above either.
--
-- REALTIME + RLS (§7)
-- `knowledge_bases` IS in `supabase_realtime`
-- (`20260501030000_knowledge_security_hardening.sql`), so this column rides
-- CDC payloads. Nothing widens: `knowledge_bases_member_select`
-- (`20260504030000_visibility_private_resources.sql`) already gates a private
-- row to its creator, and a home-scoped row is private by fence #2 above — so
-- the only subscriber who can see the flag is the person whose shelf it is. No
-- policy, no replica identity and no column grant is touched here.
--
-- ROLLBACK (prose, per §12) — SAFE IN EITHER ORDER, and it FAILS OPEN.
--   ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS home_scoped;
-- Dropping the column while the app still sends `?shelf=` makes both list reads
-- error (unknown column) rather than widen — the /home pane surfaces its error
-- card and nothing leaks. Rolling the APP back first is the quiet order: every
-- read returns to unfiltered, i.e. the pre-wave behaviour where scope C showed
-- the whole workspace shelf. Neither order can put a private base in front of
-- somebody who could not already read it.
-- ============================================================================

ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS home_scoped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN knowledge_bases.home_scoped IS
  'Which SHELF this base lives on. FALSE (default) = the workspace Knowledge page. TRUE = the /home Knowledge pane''s "across all channels" scope. The two surfaces exclude each other BOTH ways (Samuel''s ruling 2026-08-26). Set only by createBase, and only for a private base in the caller''s own default standard workspace under a person-standing credential; never projected onto the KnowledgeBase row type.';

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- A partially-applied file must RAISE here rather than ship a shelf that does
-- not separate. Both properties are load-bearing: NOT NULL means no read has to
-- spell "false OR null", and DEFAULT FALSE is what makes every pre-existing row
-- a workspace-shelf row without a backfill.
DO $$
DECLARE
  col_nullable BOOLEAN;
  col_default  TEXT;
  col_type     TEXT;
BEGIN
  SELECT (is_nullable = 'YES'), column_default, data_type
    INTO col_nullable, col_default, col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'knowledge_bases'
     AND column_name = 'home_scoped';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'knowledge_base_home_scoped: knowledge_bases.home_scoped was not created';
  END IF;

  IF col_type <> 'boolean' THEN
    RAISE EXCEPTION 'knowledge_base_home_scoped: home_scoped is %, expected boolean', col_type;
  END IF;

  IF col_nullable THEN
    RAISE EXCEPTION 'knowledge_base_home_scoped: home_scoped must be NOT NULL — a NULL shelf is a row neither surface would list';
  END IF;

  IF col_default IS NULL OR col_default NOT LIKE 'false%' THEN
    RAISE EXCEPTION 'knowledge_base_home_scoped: home_scoped must DEFAULT FALSE — that default IS the no-backfill guarantee (got %)', COALESCE(col_default, '(none)');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- KNOWLEDGE ATTACHMENT GETS A SCOPE — a base, a FOLDER, or a single ENTRY (2026-09-08, Samuel)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WRITTEN, NOT APPLIED — §12's standing gate. The Desktop Agent applies it BY NAME
-- (`agent_template_knowledge_scopes`), never by filename version: F-304's re-stamp moved the
-- filenames under the names, and a `supabase migration list` joined on the FILENAME reports a
-- migration as missing that has been live for weeks. Apply order: AFTER
-- `presence_heartbeat_all` (`20260930140000`), which is the highest filename version in this
-- directory at write time (`ls supabase/migrations | tail -1`, 2026-09-08).
--
-- ── WHAT SAMUEL ASKED FOR ───────────────────────────────────────────────────────────────────
--
-- Verbatim (2026-09-08): *"rename knowledge bases to knowledge. And also, right now, you can
-- only select entire bases, but I want to be able to specific folders or entries/files. also i
-- dont think a dropdown is the best way to do it"*.
--
-- The rename and the picker are UI. What is storage is the middle clause: an attachment used to
-- be a BASE and nothing narrower, so an operator who wanted an agent pointed at one runbook had
-- to hand it the whole base — or make a second base, which is a filing system bent around a
-- missing column.
--
-- ── A FOLDER MEANS ITS SUBTREE, INCLUDING WHAT IS ADDED LATER ───────────────────────────────
--
-- A folder scope stores ONE row naming the folder, never an expansion of its children. An
-- expansion would be a snapshot: an entry filed into that folder tomorrow would silently not be
-- attached, and nothing in the UI would say so. This is the same rule the table already keeps
-- one level up — ATTACHMENT IS A REFERENCE, NEVER A COPY (the parent migration's header) — held
-- one level deeper.
--
-- ── ⚠ WHAT THIS FILE DOES **NOT** DO: THE READ CEILING IS STILL BASE-KEYED ──────────────────
--
-- `knowledge/server/service-audience.ts › resolveAgentAudience` / `audienceAdmits` decide what a
-- SESSION may read, and they resolve a BASE id. A folder scope therefore narrows what the role
-- block POINTS AT and not what the tools ALLOW: an agent handed one folder of a base that is
-- already in its audience can still `get_tree` the whole base. That is not a regression — it is
-- exactly today's reach — but it is a gap, it is filed as a finding in
-- `docs/REFACTOR-FINDINGS.md`, and it is deliberately out of scope here. Anyone reading this
-- table as an ACCESS CONTROL is reading it wrong: it is an ATTACHMENT, which is a pointer.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────────────────────
--
--   scope_kind = 'base'    → folder_id NULL, entry_id NULL      (every existing row)
--   scope_kind = 'folder'  → folder_id NOT NULL, entry_id NULL
--   scope_kind = 'entry'   → entry_id NOT NULL, folder_id NULL
--
-- ⚠ NO `path` COLUMN, AND THAT IS THE POINT. `knowledge_folders`/`knowledge_entries` carry no
-- path either — a path is DERIVED by walking `parent_id` (`knowledge/server/path.ts ›
-- resolvePath`) — so a stored path here would be a denormalized copy that a rename or a move
-- silently falsifies, pointing an agent at a document that no longer answers to that name. The
-- ID is the handle; the path is computed for DISPLAY at read time and nowhere else.
--
-- ── THE PRIMARY KEY BECOMES A SURROGATE, AND IT HAS TO ──────────────────────────────────────
--
-- The old PK was `(template_id, knowledge_base_id)`: one row per (template, base), which is
-- exactly the constraint this change exists to remove — a template attaching three folders of
-- one base is three rows sharing that pair. A wider composite PK is not available either,
-- because two of the three key columns are NULL in every shape but their own and a PK column
-- cannot be NULL. So: a surrogate `id`, plus THREE PARTIAL UNIQUE INDEXES that restate the
-- old uniqueness once per shape.
--
-- ── BACKFILL: NONE, AND NONE IS NEEDED ──────────────────────────────────────────────────────
--
-- `scope_kind` defaults to `'base'` and both new id columns default to NULL, so every existing
-- row already satisfies the base shape the moment the columns exist. `DEFAULT 'base'` IS the
-- backfill, exactly as `access_mode`'s `DEFAULT 'workspace'` was in `20260611020000`.
--
-- ── RLS AND GRANTS ARE UNCHANGED, AND THE CLOSING BLOCK ASSERTS IT ──────────────────────────
--
-- No policy is created, dropped or altered here, and no grant moves. A junction row is readable
-- exactly when its template is (`agent_template_knowledge_bases_member_select`, restated from
-- the parent in `20260915120000`), and adding a column to a row does not change WHICH rows a
-- policy admits. Writes stay REVOKEd from `authenticated`/`anon` — the attach gate is still "a
-- base the CALLER can currently read", and now also "a folder/entry that lives in that base",
-- neither of which a `WITH CHECK` can express. `npx tsx scripts/check-rls-pair-gate.ts` has one
-- row for this table and it does not move.
--
-- ── VERIFICATION (AFTER APPLYING) ───────────────────────────────────────────────────────────
--   -- 1. The three shapes, one per index (expect three rows):
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'agent_template_knowledge_bases' AND indexname LIKE '%_scope_uniq';
--   -- 2. Every pre-existing row reads as a base scope (expect zero):
--   SELECT count(*) FROM agent_template_knowledge_bases WHERE scope_kind <> 'base'
--     AND folder_id IS NULL AND entry_id IS NULL;
--   -- 3. The behaviour no catalog can confirm: a folder of ANOTHER base is refused by the
--   --    trigger, and a soft-deleted entry is refused at insert.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
--   -- In a NEW migration: drop the three partial unique indexes and the two shape checks, put
--   -- the composite primary key back on (template_id, knowledge_base_id) after deleting every
--   -- row whose scope_kind is not 'base', then drop the three columns and restore the previous
--   -- body of assert_agent_template_kb_workspace() from 20260822200000.
--   -- Written as prose rather than commented-out SQL because
--   -- `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this directory WITHOUT
--   -- stripping comments.

-- ===========================================================================
-- 1. Columns
-- ===========================================================================

ALTER TABLE public.agent_template_knowledge_bases
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.agent_template_knowledge_bases
  ADD COLUMN IF NOT EXISTS scope_kind TEXT NOT NULL DEFAULT 'base';

-- ⚠ CASCADE, matching the base FK one column over. A folder that is HARD-deleted takes its
-- attachments with it; a SOFT delete (`deleted_at`) does not, and must not — a trashed folder is
-- restorable, and dropping the attachment would make an undo lose the pointer. What the soft
-- delete does move is the READ: `resolveVisibleKnowledgeScopes` drops a scope whose folder or
-- entry is no longer live, so a trashed folder disappears from the payload and comes back with
-- the restore.
ALTER TABLE public.agent_template_knowledge_bases
  ADD COLUMN IF NOT EXISTS folder_id UUID
    REFERENCES public.knowledge_folders(id) ON DELETE CASCADE;

ALTER TABLE public.agent_template_knowledge_bases
  ADD COLUMN IF NOT EXISTS entry_id UUID
    REFERENCES public.knowledge_entries(id) ON DELETE CASCADE;

-- ===========================================================================
-- 2. The shape. TWO checks, not one, because they fail differently.
-- ===========================================================================
-- A bad `scope_kind` is a typo in a writer; a bad COMBINATION is a writer that
-- believed a folder scope also names its base's whole tree. Two constraint
-- names means the error message says which mistake was made.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent_template_kb_scope_kind_check'
  ) THEN
    ALTER TABLE public.agent_template_knowledge_bases
      ADD CONSTRAINT agent_template_kb_scope_kind_check
      CHECK (scope_kind IN ('base', 'folder', 'entry'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent_template_kb_scope_shape_check'
  ) THEN
    ALTER TABLE public.agent_template_knowledge_bases
      ADD CONSTRAINT agent_template_kb_scope_shape_check
      CHECK (
        (scope_kind = 'base'   AND folder_id IS NULL     AND entry_id IS NULL)
        OR (scope_kind = 'folder' AND folder_id IS NOT NULL AND entry_id IS NULL)
        OR (scope_kind = 'entry'  AND folder_id IS NULL     AND entry_id IS NOT NULL)
      );
  END IF;
END $$;

-- ===========================================================================
-- 3. The primary key moves to the surrogate; uniqueness becomes three partials
-- ===========================================================================

ALTER TABLE public.agent_template_knowledge_bases
  DROP CONSTRAINT IF EXISTS agent_template_knowledge_bases_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent_template_knowledge_bases_pkey'
  ) THEN
    ALTER TABLE public.agent_template_knowledge_bases
      ADD CONSTRAINT agent_template_knowledge_bases_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ⚠ THE OLD PK, RESTATED FOR THE BASE SHAPE ALONE. A base cannot be attached to one template
-- twice, exactly as before; what is now legal is that pair appearing again on a FOLDER row.
CREATE UNIQUE INDEX IF NOT EXISTS agent_template_kb_base_scope_uniq
  ON public.agent_template_knowledge_bases (template_id, knowledge_base_id)
  WHERE scope_kind = 'base';

-- ⚠ KEYED ON THE FOLDER, NOT ON (base, folder). A folder belongs to exactly one base — the
-- trigger below is what enforces that — so `knowledge_base_id` in this key would be a second,
-- weaker statement of a fact the FK already owns, and a row that disagreed with it would be
-- unique twice over.
CREATE UNIQUE INDEX IF NOT EXISTS agent_template_kb_folder_scope_uniq
  ON public.agent_template_knowledge_bases (template_id, folder_id)
  WHERE scope_kind = 'folder';

CREATE UNIQUE INDEX IF NOT EXISTS agent_template_kb_entry_scope_uniq
  ON public.agent_template_knowledge_bases (template_id, entry_id)
  WHERE scope_kind = 'entry';

-- FK cover: `knowledge_folders(id)` / `knowledge_entries(id)` ON DELETE CASCADE. The partial
-- uniques above cannot serve as cover — a partial index is not usable for the unconditional
-- lookup a cascading delete performs.
CREATE INDEX IF NOT EXISTS agent_template_knowledge_bases_folder_idx
  ON public.agent_template_knowledge_bases (folder_id);

CREATE INDEX IF NOT EXISTS agent_template_knowledge_bases_entry_idx
  ON public.agent_template_knowledge_bases (entry_id);

-- ===========================================================================
-- 4. The workspace trigger learns the two new columns
-- ===========================================================================
-- ⚠ THE SAME FUNCTION, REPLACED — not a second trigger. Two triggers over one table is two
-- places to read before you know what an insert is checked against, and the second one is the
-- one a later migration forgets to update.
--
-- ⚠ **THE SOFT-DELETE TEST IS AT INSERT AND IS NOT A LIVE INVARIANT.** A folder attached today
-- and trashed tomorrow leaves its row alone: that is the restorable state above, and a trigger
-- that policed it would have to fire on the KNOWLEDGE tables rather than this one. What this
-- refuses is ATTACHING something already in the trash, which is a write nobody means to make.

CREATE OR REPLACE FUNCTION public.assert_agent_template_kb_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  tpl_ws UUID;
  kb_ws UUID;
  fld_base UUID;
  fld_deleted TIMESTAMPTZ;
  ent_base UUID;
  ent_deleted TIMESTAMPTZ;
BEGIN
  SELECT workspace_id INTO tpl_ws FROM agent_templates WHERE id = NEW.template_id;
  SELECT workspace_id INTO kb_ws FROM knowledge_bases WHERE id = NEW.knowledge_base_id;
  IF tpl_ws IS NULL THEN
    RAISE EXCEPTION 'agent_template_knowledge_bases: template % does not exist', NEW.template_id;
  END IF;
  IF kb_ws IS NULL THEN
    RAISE EXCEPTION 'agent_template_knowledge_bases: knowledge base % does not exist', NEW.knowledge_base_id;
  END IF;
  IF tpl_ws <> NEW.workspace_id OR kb_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'agent_template_knowledge_bases: workspace mismatch (junction=%, template=%, kb=%)',
      NEW.workspace_id, tpl_ws, kb_ws;
  END IF;

  -- ⚠ THE SUB-BASE ARMS ARE THE POINT OF THIS REVISION: a folder or an entry attached under a
  -- base it does not live in would render a path that names one base and a tool call that names
  -- another. The service checks this too (404-not-403, `assertAttachableKnowledgeScopes`); this
  -- is the backstop that keeps a service bug from becoming a silently wrong prompt line.
  IF NEW.folder_id IS NOT NULL THEN
    SELECT knowledge_base_id, deleted_at INTO fld_base, fld_deleted
      FROM knowledge_folders WHERE id = NEW.folder_id;
    IF fld_base IS NULL THEN
      RAISE EXCEPTION 'agent_template_knowledge_bases: folder % does not exist', NEW.folder_id;
    END IF;
    IF fld_base <> NEW.knowledge_base_id THEN
      RAISE EXCEPTION 'agent_template_knowledge_bases: folder % lives in base %, not %',
        NEW.folder_id, fld_base, NEW.knowledge_base_id;
    END IF;
    IF fld_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'agent_template_knowledge_bases: folder % is deleted', NEW.folder_id;
    END IF;
  END IF;

  IF NEW.entry_id IS NOT NULL THEN
    SELECT knowledge_base_id, deleted_at INTO ent_base, ent_deleted
      FROM knowledge_entries WHERE id = NEW.entry_id;
    IF ent_base IS NULL THEN
      RAISE EXCEPTION 'agent_template_knowledge_bases: entry % does not exist', NEW.entry_id;
    END IF;
    IF ent_base <> NEW.knowledge_base_id THEN
      RAISE EXCEPTION 'agent_template_knowledge_bases: entry % lives in base %, not %',
        NEW.entry_id, ent_base, NEW.knowledge_base_id;
    END IF;
    IF ent_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'agent_template_knowledge_bases: entry % is deleted', NEW.entry_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- The trigger itself is unchanged (BEFORE INSERT OR UPDATE, FOR EACH ROW); only the body moved.
-- Re-stated so a replay from an empty database that skipped the parent still arms it.
DROP TRIGGER IF EXISTS agent_template_kb_workspace_check
  ON public.agent_template_knowledge_bases;
CREATE TRIGGER agent_template_kb_workspace_check
  BEFORE INSERT OR UPDATE ON public.agent_template_knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.assert_agent_template_kb_workspace();

REVOKE EXECUTE ON FUNCTION public.assert_agent_template_kb_workspace()
  FROM anon, authenticated;

-- ===========================================================================
-- 5. Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE n INT;
BEGIN
  -- The three shapes exist, one partial unique apiece.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'agent_template_knowledge_bases'
     AND indexname IN (
       'agent_template_kb_base_scope_uniq',
       'agent_template_kb_folder_scope_uniq',
       'agent_template_kb_entry_scope_uniq'
     );
  IF n <> 3 THEN
    RAISE EXCEPTION
      'ABORT: expected 3 partial unique indexes on agent_template_knowledge_bases, found % — without one of them a template can attach the same scope twice and the role block renders a duplicate line', n;
  END IF;

  -- 🔒 RLS AND GRANTS DID NOT MOVE. This file adds columns; it must not have become the place a
  -- write policy or a DML grant appeared.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'agent_template_knowledge_bases'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: agent_template_knowledge_bases gained a non-SELECT policy — every write goes through the agent-templates service, which is the only layer that can check a folder or an entry against what the caller may read';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'agent_template_knowledge_bases'
       AND policyname = 'agent_template_knowledge_bases_member_select'
  ) THEN
    RAISE EXCEPTION
      'ABORT: agent_template_knowledge_bases_member_select is gone — scripts/check-rls-pair-gate.ts declares it as this table''s SELECT twin and the read would be unfenced';
  END IF;

  IF has_table_privilege('authenticated', 'public.agent_template_knowledge_bases', 'INSERT')
     OR has_table_privilege('authenticated', 'public.agent_template_knowledge_bases', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.agent_template_knowledge_bases', 'DELETE')
     OR has_table_privilege('anon', 'public.agent_template_knowledge_bases', 'INSERT')
     OR has_table_privilege('anon', 'public.agent_template_knowledge_bases', 'UPDATE')
     OR has_table_privilege('anon', 'public.agent_template_knowledge_bases', 'DELETE') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon retain DML on agent_template_knowledge_bases — the service is the fence and a direct write would bypass the laundering gate';
  END IF;

  RAISE NOTICE
    'agent_template_knowledge_scopes: scope_kind/folder_id/entry_id added, PK is now the surrogate id, 3 partial uniques, trigger asserts sub-base tenancy. RLS unchanged. A folder scope means its SUBTREE, resolved at read time — never expanded into rows.';
END
$$;

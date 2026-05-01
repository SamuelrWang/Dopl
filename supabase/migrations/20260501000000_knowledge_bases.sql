-- Knowledge Bases — user-authored, workspace-scoped folder/file tree.
--
-- Three tables with parent_id self-FK on folders for unbounded nesting.
-- Soft-delete via `deleted_at` on every table; trash + restore live in
-- the service layer. `agent_write_enabled` is a base-level toggle that
-- the service consults when an MCP-origin caller tries to mutate.
-- Body stays as markdown text — the Tiptap editor renders tables and
-- blockquotes from markdown syntax, so structured sub-entities are
-- not first-class.
--
-- RLS reuses `is_workspace_member()` from 20260430200656_workspace_aware_rls.
-- Convention: SELECT requires viewer+, INSERT/UPDATE/DELETE require editor+.
-- Inserts additionally enforce `created_by = auth.uid()` as a no-impersonation
-- guard. The agent-write toggle is NOT enforced in RLS — service-role bypasses
-- RLS, so checking it there would be moot. The service layer is the single
-- enforcement point for `source = 'agent'` callers.

-- ════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  description          TEXT,
  agent_write_enabled  BOOLEAN NOT NULL DEFAULT false,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  CONSTRAINT knowledge_bases_workspace_slug_unique UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS knowledge_folders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id  UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  parent_id          UUID REFERENCES knowledge_folders(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  position           INTEGER NOT NULL DEFAULT 0,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT knowledge_folders_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id   UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  folder_id           UUID REFERENCES knowledge_folders(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  excerpt             TEXT,
  body                TEXT NOT NULL DEFAULT '',
  entry_type          TEXT NOT NULL DEFAULT 'note'
                      CHECK (entry_type IN ('note', 'doc', 'transcript', 'imported')),
  position            INTEGER NOT NULL DEFAULT 0,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_source  TEXT NOT NULL DEFAULT 'user'
                      CHECK (last_edited_source IN ('user', 'agent')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

-- ════════════════════════════════════════════════════════════════════
-- 2. Indexes
-- ════════════════════════════════════════════════════════════════════

-- Active-row browse paths (most common queries).
CREATE INDEX IF NOT EXISTS knowledge_bases_workspace_active_idx
  ON knowledge_bases (workspace_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_folders_kb_parent_active_idx
  ON knowledge_folders (knowledge_base_id, parent_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_folders_workspace_idx
  ON knowledge_folders (workspace_id);

CREATE INDEX IF NOT EXISTS knowledge_entries_kb_folder_active_idx
  ON knowledge_entries (knowledge_base_id, folder_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_entries_workspace_idx
  ON knowledge_entries (workspace_id);

-- Trash view: scan deleted rows by workspace. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS knowledge_entries_workspace_trashed_idx
  ON knowledge_entries (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_folders_workspace_trashed_idx
  ON knowledge_folders (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_bases_workspace_trashed_idx
  ON knowledge_bases (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- 3. updated_at auto-bump triggers
-- ════════════════════════════════════════════════════════════════════
--
-- Generic helper used by all three tables. Fires on every UPDATE.

CREATE OR REPLACE FUNCTION touch_knowledge_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_bases_touch_updated_at'
  ) THEN
    CREATE TRIGGER knowledge_bases_touch_updated_at
      BEFORE UPDATE ON knowledge_bases
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_folders_touch_updated_at'
  ) THEN
    CREATE TRIGGER knowledge_folders_touch_updated_at
      BEFORE UPDATE ON knowledge_folders
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_entries_touch_updated_at'
  ) THEN
    CREATE TRIGGER knowledge_entries_touch_updated_at
      BEFORE UPDATE ON knowledge_entries
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 4. Folder cycle prevention
-- ════════════════════════════════════════════════════════════════════
--
-- The CHECK constraint catches A.parent_id = A self-edges. Multi-hop
-- cycles (A -> B -> C -> A) need a runtime walk. Service layer also
-- pre-checks via `listFolderAncestors` for clean error messages; this
-- is the database safety net.

CREATE OR REPLACE FUNCTION prevent_knowledge_folder_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cur UUID := NEW.parent_id;
  hops INTEGER := 0;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'knowledge_folders cycle detected at %', NEW.id
        USING ERRCODE = '23514';
    END IF;
    hops := hops + 1;
    IF hops > 1000 THEN
      RAISE EXCEPTION 'knowledge_folders ancestor walk exceeded 1000 hops at %', NEW.id
        USING ERRCODE = '23514';
    END IF;
    SELECT parent_id INTO cur FROM knowledge_folders WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_folders_prevent_cycle'
  ) THEN
    CREATE TRIGGER knowledge_folders_prevent_cycle
      BEFORE INSERT OR UPDATE OF parent_id ON knowledge_folders
      FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_folder_cycle();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 5. RLS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_bases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

-- knowledge_bases
CREATE POLICY knowledge_bases_member_select ON knowledge_bases
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY knowledge_bases_editor_insert ON knowledge_bases
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );

CREATE POLICY knowledge_bases_editor_update ON knowledge_bases
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

CREATE POLICY knowledge_bases_editor_delete ON knowledge_bases
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- knowledge_folders
CREATE POLICY knowledge_folders_member_select ON knowledge_folders
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY knowledge_folders_editor_insert ON knowledge_folders
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );

CREATE POLICY knowledge_folders_editor_update ON knowledge_folders
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

CREATE POLICY knowledge_folders_editor_delete ON knowledge_folders
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- knowledge_entries
CREATE POLICY knowledge_entries_member_select ON knowledge_entries
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY knowledge_entries_editor_insert ON knowledge_entries
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );

CREATE POLICY knowledge_entries_editor_update ON knowledge_entries
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

CREATE POLICY knowledge_entries_editor_delete ON knowledge_entries
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- Knowledge System Overhaul Item 4: API key workspace scoping + KB path uniqueness.
--
-- Two unrelated-but-co-deployed concerns:
--
-- 1. `api_keys.workspace_id` (NULL = user-scoped, like today; non-NULL =
--    locked to that workspace). When set, MCP-origin requests using this
--    key resolve their workspace from this column instead of from the
--    `X-Workspace-Id` header. If the header disagrees with the key's
--    workspace, the auth layer returns 403 — prevents accidental
--    cross-workspace MCP usage from a single key.
--
-- 2. Unique partial indexes on `(knowledge_base_id, parent_id, name)` for
--    folders and `(knowledge_base_id, folder_id, title)` for entries —
--    among non-deleted rows only. Item 4 introduces path-based addressing
--    (`projects/foo/spec.md`) and these indexes prevent the path from ever
--    being ambiguous. NULLS NOT DISTINCT (PG ≥15) makes null parent/folder
--    (root) participate as a normal value, so two root folders with the
--    same name also collide.

-- ════════════════════════════════════════════════════════════════════
-- 1. api_keys.workspace_id
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS api_keys_workspace_id_idx
  ON api_keys (workspace_id) WHERE workspace_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- 2. Knowledge folder/entry path uniqueness
-- ════════════════════════════════════════════════════════════════════
--
-- NULLS NOT DISTINCT means a NULL parent_id (root folder) collides with
-- another NULL parent_id of the same name + same kb. Without this clause,
-- Postgres treats NULLs as always distinct and we'd allow duplicate root
-- folders. PG 17 supports this natively.

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_folders_unique_active
  ON knowledge_folders (knowledge_base_id, parent_id, name)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_entries_unique_active
  ON knowledge_entries (knowledge_base_id, folder_id, title)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

-- Skill files — multi-file shape for skills.
--
-- A skill becomes a folder of markdown files. The canonical entry point
-- is named `SKILL.md` and holds the procedure body. Supplementary files
-- (`examples.md`, `references/*.md`, etc.) sit beside it and are
-- referenced from SKILL.md via relative markdown links.
--
-- Migration plan:
--   1. Create `skill_files` table.
--   2. Backfill: insert one `SKILL.md` row per existing skill, body =
--      the existing `skills.body` column, last_edited_source preserved.
--   3. Drop `skills.body`. The column is no longer the source of truth;
--      SKILL.md is.
--
-- RLS mirrors `skills` — workspace member SELECT, editor write. The
-- service layer enforces the per-skill `agent_write_enabled` toggle for
-- agent-origin mutations (RLS bypassed by service role).
--
-- File names follow `[A-Za-z0-9._-]+\.md` (no slashes — no nested dirs
-- in v1). The unique partial index keeps `(skill_id, name)` collision-
-- free among active rows.

CREATE TABLE IF NOT EXISTS skill_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id            UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  body                TEXT NOT NULL DEFAULT '',
  position            INTEGER NOT NULL DEFAULT 0,
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_source  TEXT NOT NULL DEFAULT 'user'
                      CHECK (last_edited_source IN ('user', 'agent')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT skill_files_name_no_slash CHECK (name !~ '/')
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_files_unique_name_per_skill
  ON skill_files (skill_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS skill_files_skill_active_idx
  ON skill_files (skill_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS skill_files_workspace_idx
  ON skill_files (workspace_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'skill_files_touch_updated_at'
  ) THEN
    CREATE TRIGGER skill_files_touch_updated_at
      BEFORE UPDATE ON skill_files
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;
END $$;

ALTER TABLE skill_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_files_member_select ON skill_files
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY skill_files_editor_insert ON skill_files
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );

CREATE POLICY skill_files_editor_update ON skill_files
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

CREATE POLICY skill_files_editor_delete ON skill_files
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- ── Backfill ─────────────────────────────────────────────────────────
-- Copy each existing skill's body into a SKILL.md row. Idempotent — the
-- ON CONFLICT skip lets the migration re-run safely if the partial-
-- unique index is already populated.

INSERT INTO skill_files (
  workspace_id, skill_id, name, body, position,
  created_by, last_edited_by, last_edited_source,
  created_at, updated_at
)
SELECT
  workspace_id,
  id,
  'SKILL.md',
  COALESCE(body, ''),
  0,
  created_by,
  COALESCE(last_edited_by, created_by),
  COALESCE(last_edited_source, 'user'),
  created_at,
  updated_at
FROM skills
WHERE deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ── Drop the old body column ────────────────────────────────────────
-- SKILL.md in skill_files is now the source of truth.

ALTER TABLE skills DROP COLUMN IF EXISTS body;

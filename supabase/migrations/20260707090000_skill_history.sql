-- Skill version history + audit timeline.
--
-- MCP-first trust layer: agents edit skill files while the user isn't
-- looking. Every content save snapshots the file (skill_file_versions);
-- every structural change (create/rename/trash/restore/metadata/publish)
-- lands in skill_events. Together they answer "what did my agent change,
-- when, and can I undo it?"
--
-- Design notes:
--   * Versions are append-only FULL-BODY snapshots of the state AFTER a
--     save. Files are small text; no delta compression. Ordering is
--     (created_at, id) — no version counter, so concurrent writers can't
--     race a sequence.
--   * file_name is denormalized so history stays legible across renames
--     and after a file is trashed.
--   * Writes go through the service role only (no INSERT/UPDATE/DELETE
--     policies). Members get read via RLS for future client reads; the
--     API routes are the primary read path today.
--   * Retention is enforced in the write path (keep newest 200 per file).

CREATE TABLE IF NOT EXISTS skill_file_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id      UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  file_id       UUID NOT NULL REFERENCES skill_files(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  body          TEXT NOT NULL,
  author_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('user', 'agent')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_file_versions_file_idx
  ON skill_file_versions (file_id, created_at DESC);

CREATE INDEX IF NOT EXISTS skill_file_versions_skill_idx
  ON skill_file_versions (skill_id, created_at DESC);

CREATE INDEX IF NOT EXISTS skill_file_versions_workspace_idx
  ON skill_file_versions (workspace_id);

ALTER TABLE skill_file_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_file_versions_member_select ON skill_file_versions
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE TABLE IF NOT EXISTS skill_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id      UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  file_id       UUID REFERENCES skill_files(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                  'skill.created', 'skill.updated', 'skill.published',
                  'skill.trashed', 'skill.restored',
                  'file.created', 'file.renamed', 'file.trashed',
                  'file.restored', 'file.rolled_back'
                )),
  -- Event-specific payload, e.g. {"from":"a.md","to":"b.md"} for renames
  -- or {"fields":["name","status"]} for metadata updates.
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  author_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('user', 'agent')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_events_skill_idx
  ON skill_events (skill_id, created_at DESC);

CREATE INDEX IF NOT EXISTS skill_events_workspace_idx
  ON skill_events (workspace_id);

ALTER TABLE skill_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_events_member_select ON skill_events
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

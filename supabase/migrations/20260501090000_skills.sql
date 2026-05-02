-- Skills — workspace-scoped procedural prompts surfaced to a connected
-- agent via MCP. Each row carries trigger metadata (description,
-- when_to_use, when_not_to_use) plus a markdown procedure body. The
-- body references KBs and connectors via vanilla markdown links with
-- a `dopl://` URI scheme: `[label](dopl://kb/<slug>)`,
-- `[label](dopl://connector/<provider>[.<field>])`. Vanilla markdown
-- renderers degrade to a clickable link; the Dopl renderer substitutes
-- a typed chip.
--
-- v1 ships read-only at the agent boundary (skill_list + skill_get).
-- `agent_write_enabled` is forward-looking — no MCP write tools ship
-- in v1, but the column exists so a future migration doesn't have to
-- add it. RLS mirrors knowledge_bases; service-role bypasses RLS, so
-- agent-write enforcement lives in the service layer.
--
-- Connectors / examples / recent_runs / total_invocations are JSONB
-- so the v0 hardcoded detail UI keeps working without spinning up
-- additional tables. They're populated by seed only in v1; the future
-- editor + invocations pipeline becomes the writer.

CREATE TABLE IF NOT EXISTS skills (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL,
  when_to_use          TEXT NOT NULL,
  when_not_to_use      TEXT,
  body                 TEXT NOT NULL,
  connectors           JSONB NOT NULL DEFAULT '[]'::jsonb,
  examples             JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_runs          JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_invocations    INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'draft')),
  agent_write_enabled  BOOLEAN NOT NULL DEFAULT false,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_source   TEXT NOT NULL DEFAULT 'user'
                       CHECK (last_edited_source IN ('user', 'agent')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS skills_workspace_slug_active_idx
  ON skills (workspace_id, slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS skills_workspace_active_idx
  ON skills (workspace_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS skills_workspace_trashed_idx
  ON skills (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- Reuse the generic updated_at trigger from the knowledge migration.
-- The function name carries "knowledge" because that's where it was
-- defined first; its body is just `NEW.updated_at := now()`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'skills_touch_updated_at'
  ) THEN
    CREATE TRIGGER skills_touch_updated_at
      BEFORE UPDATE ON skills
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;
END $$;

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY skills_member_select ON skills
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY skills_editor_insert ON skills
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );

CREATE POLICY skills_editor_update ON skills
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

CREATE POLICY skills_editor_delete ON skills
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- cluster_skills — junction table linking clusters to skills. Mirrors
-- cluster_knowledge_bases. A skill can be attached to many clusters
-- (e.g. a "company voice" skill attached to both an email-drafting
-- cluster and an Instagram-DM cluster) — one row per attachment.

CREATE TABLE IF NOT EXISTS cluster_skills (
  cluster_id        UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  skill_id          UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, skill_id)
);

CREATE INDEX IF NOT EXISTS cluster_skills_workspace_idx
  ON cluster_skills (workspace_id);

CREATE INDEX IF NOT EXISTS cluster_skills_skill_idx
  ON cluster_skills (skill_id);

ALTER TABLE cluster_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY cluster_skills_member_select ON cluster_skills
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY cluster_skills_editor_insert ON cluster_skills
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND added_by_user_id = auth.uid()
  );

CREATE POLICY cluster_skills_editor_delete ON cluster_skills
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

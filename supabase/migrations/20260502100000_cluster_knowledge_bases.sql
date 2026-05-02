-- cluster_knowledge_bases — junction table linking clusters to knowledge
-- bases. A KB can be attached to many clusters (one row per attachment),
-- and a cluster can have many KBs attached. The junction is the source of
-- truth for "what KBs does this cluster have access to" — independent of
-- canvas-panel state, so the agent can read attached KBs without a canvas
-- being loaded.
--
-- Composite PK on (cluster_id, knowledge_base_id) keeps a KB from being
-- attached twice to the same cluster. Workspace_id is denormalized so RLS
-- can be enforced cheaply (matches the cluster + KB workspace).

CREATE TABLE IF NOT EXISTS cluster_knowledge_bases (
  cluster_id          UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  knowledge_base_id   UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, knowledge_base_id)
);

CREATE INDEX IF NOT EXISTS cluster_knowledge_bases_workspace_idx
  ON cluster_knowledge_bases (workspace_id);

CREATE INDEX IF NOT EXISTS cluster_knowledge_bases_kb_idx
  ON cluster_knowledge_bases (knowledge_base_id);

ALTER TABLE cluster_knowledge_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY cluster_knowledge_bases_member_select ON cluster_knowledge_bases
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

CREATE POLICY cluster_knowledge_bases_editor_insert ON cluster_knowledge_bases
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND added_by_user_id = auth.uid()
  );

CREATE POLICY cluster_knowledge_bases_editor_delete ON cluster_knowledge_bases
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

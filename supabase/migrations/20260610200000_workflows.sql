-- Workflows: a workflow is a header panel + its edge-connected node graph.
-- Clusters become non-spatial containers that GROUP workflows; KB/skill
-- attachments + dopl exposure move from cluster level to workflow level.
-- Additive migration: creates the workflow tables, backfills one workflow
-- per existing cluster (cluster_id = self) carrying that cluster's
-- name/slug/description + attachments, converts the existing cluster-info
-- header panels to 'workflow' panels, and leaves the clusters tables intact
-- as the container layer.

-- 1. Allow the new 'workflow' header panel type (keep 'cluster-info' as a
--    defensive back-compat value; all current rows are converted in step 7).
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;
ALTER TABLE canvas_panels ADD CONSTRAINT canvas_panels_panel_type_check
  CHECK (panel_type = ANY (ARRAY[
    'chat','connection','knowledge','skills','knowledge-base','skill',
    'artifact','cluster-info','node','workflow'
  ]::text[]));

-- 2. workflows — mirrors clusters, plus a nullable cluster_id grouping FK.
CREATE TABLE IF NOT EXISTS workflows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cluster_id   UUID REFERENCES clusters(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_workspace_slug ON workflows (workspace_id, slug);
CREATE INDEX IF NOT EXISTS workflows_workspace_idx ON workflows (workspace_id);
CREATE INDEX IF NOT EXISTS workflows_cluster_idx ON workflows (cluster_id);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflows_member_select ON workflows FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY workflows_editor_insert ON workflows FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor') AND user_id = auth.uid());
CREATE POLICY workflows_editor_update ON workflows FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY workflows_editor_delete ON workflows FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- 3. workflow_knowledge_bases + workflow_skills — mirror the cluster junctions.
CREATE TABLE IF NOT EXISTS workflow_knowledge_bases (
  workflow_id        UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  knowledge_base_id  UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, knowledge_base_id)
);
CREATE INDEX IF NOT EXISTS workflow_knowledge_bases_workspace_idx ON workflow_knowledge_bases (workspace_id);
CREATE INDEX IF NOT EXISTS workflow_knowledge_bases_kb_idx ON workflow_knowledge_bases (knowledge_base_id);
ALTER TABLE workflow_knowledge_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_knowledge_bases_member_select ON workflow_knowledge_bases FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY workflow_knowledge_bases_editor_insert ON workflow_knowledge_bases FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor') AND added_by_user_id = auth.uid());
CREATE POLICY workflow_knowledge_bases_editor_delete ON workflow_knowledge_bases FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

CREATE TABLE IF NOT EXISTS workflow_skills (
  workflow_id       UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  skill_id          UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, skill_id)
);
CREATE INDEX IF NOT EXISTS workflow_skills_workspace_idx ON workflow_skills (workspace_id);
CREATE INDEX IF NOT EXISTS workflow_skills_skill_idx ON workflow_skills (skill_id);
ALTER TABLE workflow_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_skills_member_select ON workflow_skills FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY workflow_skills_editor_insert ON workflow_skills FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor') AND added_by_user_id = auth.uid());
CREATE POLICY workflow_skills_editor_delete ON workflow_skills FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- 4. workspace-consistency backstop triggers (mirror cluster safeguards).
CREATE OR REPLACE FUNCTION assert_workflow_kb_workspace() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE wf_ws UUID; kb_ws UUID;
BEGIN
  SELECT workspace_id INTO wf_ws FROM workflows WHERE id = NEW.workflow_id;
  SELECT workspace_id INTO kb_ws FROM knowledge_bases WHERE id = NEW.knowledge_base_id;
  IF wf_ws IS NULL THEN RAISE EXCEPTION 'workflow_knowledge_bases: workflow % does not exist', NEW.workflow_id; END IF;
  IF kb_ws IS NULL THEN RAISE EXCEPTION 'workflow_knowledge_bases: knowledge_base % does not exist', NEW.knowledge_base_id; END IF;
  IF wf_ws <> NEW.workspace_id OR kb_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'workflow_knowledge_bases: workspace mismatch (junction=%, workflow=%, kb=%)', NEW.workspace_id, wf_ws, kb_ws;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workflow_kb_workspace_check ON workflow_knowledge_bases;
CREATE TRIGGER workflow_kb_workspace_check BEFORE INSERT OR UPDATE ON workflow_knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION assert_workflow_kb_workspace();

CREATE OR REPLACE FUNCTION assert_workflow_skill_workspace() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE wf_ws UUID; skill_ws UUID;
BEGIN
  SELECT workspace_id INTO wf_ws FROM workflows WHERE id = NEW.workflow_id;
  SELECT workspace_id INTO skill_ws FROM skills WHERE id = NEW.skill_id;
  IF wf_ws IS NULL THEN RAISE EXCEPTION 'workflow_skills: workflow % does not exist', NEW.workflow_id; END IF;
  IF skill_ws IS NULL THEN RAISE EXCEPTION 'workflow_skills: skill % does not exist', NEW.skill_id; END IF;
  IF wf_ws <> NEW.workspace_id OR skill_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'workflow_skills: workspace mismatch (junction=%, workflow=%, skill=%)', NEW.workspace_id, wf_ws, skill_ws;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workflow_skill_workspace_check ON workflow_skills;
CREATE TRIGGER workflow_skill_workspace_check BEFORE INSERT OR UPDATE ON workflow_skills
  FOR EACH ROW EXECUTE FUNCTION assert_workflow_skill_workspace();

-- Extend the existing soft-delete cascade fns to also drop workflow junctions.
CREATE OR REPLACE FUNCTION cascade_kb_soft_delete_to_attachments() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM cluster_knowledge_bases WHERE knowledge_base_id = NEW.id;
    DELETE FROM workflow_knowledge_bases WHERE knowledge_base_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION cascade_skill_soft_delete_to_attachments() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM cluster_skills WHERE skill_id = NEW.id;
    DELETE FROM workflow_skills WHERE skill_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

-- 5. realtime parity with the cluster junctions.
ALTER PUBLICATION supabase_realtime ADD TABLE workflows;
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_knowledge_bases;
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_skills;

-- 6. Backfill one workflow per existing cluster (cluster_id = self), carrying
--    the cluster's metadata; copy attachments to the workflow level.
INSERT INTO workflows (id, workspace_id, cluster_id, user_id, name, slug, description, created_at, updated_at)
SELECT gen_random_uuid(), c.workspace_id, c.id, c.user_id, c.name, c.slug, c.description, now(), now()
FROM clusters c
WHERE NOT EXISTS (SELECT 1 FROM workflows w WHERE w.cluster_id = c.id);

INSERT INTO workflow_knowledge_bases (workflow_id, knowledge_base_id, workspace_id, added_by_user_id, added_at)
SELECT w.id, ckb.knowledge_base_id, ckb.workspace_id, ckb.added_by_user_id, ckb.added_at
FROM cluster_knowledge_bases ckb JOIN workflows w ON w.cluster_id = ckb.cluster_id
ON CONFLICT DO NOTHING;

INSERT INTO workflow_skills (workflow_id, skill_id, workspace_id, added_by_user_id, added_at)
SELECT w.id, cs.skill_id, cs.workspace_id, cs.added_by_user_id, cs.added_at
FROM cluster_skills cs JOIN workflows w ON w.cluster_id = cs.cluster_id
ON CONFLICT DO NOTHING;

-- 7. Convert existing cluster-info header panels → workflow panels, linking
--    each to its cluster's workflow (resolved via canvas_state.clusters jsonb:
--    panel_data.clusterId -> element.dbId -> workflows.cluster_id).
WITH panel_link AS (
  SELECT cp.id AS panel_pk, w.id AS workflow_id, w.name AS wf_name, w.description AS wf_desc
  FROM canvas_panels cp
  JOIN canvas_state cs ON cs.workspace_id = cp.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements(cs.clusters) elem
  JOIN workflows w ON w.cluster_id = (elem->>'dbId')::uuid
  WHERE cp.panel_type = 'cluster-info'
    AND elem->>'id' = cp.panel_data->>'clusterId'
    AND elem->>'dbId' IS NOT NULL
)
UPDATE canvas_panels cp
SET panel_type = 'workflow',
    panel_data = jsonb_build_object(
      'workflowId', pl.workflow_id::text,
      'name', pl.wf_name,
      'description', COALESCE(pl.wf_desc, '')
    )
FROM panel_link pl
WHERE cp.id = pl.panel_pk;

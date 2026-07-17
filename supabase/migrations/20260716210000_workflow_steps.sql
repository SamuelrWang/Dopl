-- Workflow steps: first-class step-graph tables that replace the canvas-stored
-- representation (canvas_panels 'node'/'workflow' rows + canvas_edges, composed
-- by BFS from a header panel). A workflow is now its rows in workflow_steps
-- (agent-followable steps) wired together by workflow_step_edges (branch-
-- conditioned connectors). There is no header concept anymore: entry steps are
-- those with no incoming edge (indegree 0).
--
-- The canvas tables are intentionally NOT dropped here — the canvas teardown
-- migration does that AFTER the one-off port (scripts/port-workflows.mts) copies
-- the two authored workflows across.

-- 1. workflow_steps — one row per step. `ref` is the stable authoring key
--    (agent-chosen handle; survives edits, UNIQUE per workflow). reads/actions
--    mirror the old panel_data jsonb shape:
--      reads:   [{ kind: 'kb'|'file', kbId, entryId?, name }]
--      actions: [{ kind: 'skill', skillId, name }]
--    `position` is a stable ordering hint used to break topological-sort ties.
CREATE TABLE IF NOT EXISTS workflow_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ref               TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  reads             JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_input        TEXT NOT NULL DEFAULT '',
  agent_output      TEXT NOT NULL DEFAULT '',
  next_instructions TEXT NOT NULL DEFAULT '',
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, ref)
);
CREATE INDEX IF NOT EXISTS workflow_steps_workflow_idx ON workflow_steps (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_steps_workspace_idx ON workflow_steps (workspace_id);

-- RLS mirrors the workflows table: member (viewer) SELECT, editor writes. All
-- app traffic uses the service role (bypasses RLS); these are the direct-
-- PostgREST backstop. Steps carry no per-user column, so the editor policies
-- omit the `= auth.uid()` author clause the workflow_knowledge_bases junction
-- uses.
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_steps_member_select ON workflow_steps FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY workflow_steps_editor_insert ON workflow_steps FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY workflow_steps_editor_update ON workflow_steps FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY workflow_steps_editor_delete ON workflow_steps FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- 2. workflow_step_edges — directed connectors between steps. `condition` is an
--    agent-readable branch guard (free text; '' = unconditional). The CHECK +
--    UNIQUE keep the graph a simple DAG surface: no self-edges, no dup pairs.
CREATE TABLE IF NOT EXISTS workflow_step_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_step_id  UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  to_step_id    UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  condition     TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, from_step_id, to_step_id),
  CHECK (from_step_id <> to_step_id)
);
CREATE INDEX IF NOT EXISTS workflow_step_edges_workflow_idx ON workflow_step_edges (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_step_edges_workspace_idx ON workflow_step_edges (workspace_id);
CREATE INDEX IF NOT EXISTS workflow_step_edges_from_idx ON workflow_step_edges (from_step_id);
CREATE INDEX IF NOT EXISTS workflow_step_edges_to_idx ON workflow_step_edges (to_step_id);

ALTER TABLE workflow_step_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_step_edges_member_select ON workflow_step_edges FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY workflow_step_edges_editor_insert ON workflow_step_edges FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY workflow_step_edges_editor_update ON workflow_step_edges FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY workflow_step_edges_editor_delete ON workflow_step_edges FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- 3. Workspace-consistency backstop triggers (mirror assert_workflow_kb_workspace
--    from 20260610200000): a step/edge's workspace_id must match its workflow's,
--    and an edge's endpoints must both belong to the same workflow. search_path
--    pinned (advisor 0028/0029).
CREATE OR REPLACE FUNCTION assert_workflow_step_workspace() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
DECLARE wf_ws UUID;
BEGIN
  SELECT workspace_id INTO wf_ws FROM workflows WHERE id = NEW.workflow_id;
  IF wf_ws IS NULL THEN
    RAISE EXCEPTION 'workflow_steps: workflow % does not exist', NEW.workflow_id;
  END IF;
  IF wf_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'workflow_steps: workspace mismatch (step=%, workflow=%)', NEW.workspace_id, wf_ws;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workflow_step_workspace_check ON workflow_steps;
CREATE TRIGGER workflow_step_workspace_check BEFORE INSERT OR UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION assert_workflow_step_workspace();

CREATE OR REPLACE FUNCTION assert_workflow_step_edge_consistency() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
DECLARE wf_ws UUID; from_wf UUID; to_wf UUID;
BEGIN
  SELECT workspace_id INTO wf_ws FROM workflows WHERE id = NEW.workflow_id;
  IF wf_ws IS NULL THEN
    RAISE EXCEPTION 'workflow_step_edges: workflow % does not exist', NEW.workflow_id;
  END IF;
  IF wf_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'workflow_step_edges: workspace mismatch (edge=%, workflow=%)', NEW.workspace_id, wf_ws;
  END IF;
  SELECT workflow_id INTO from_wf FROM workflow_steps WHERE id = NEW.from_step_id;
  SELECT workflow_id INTO to_wf   FROM workflow_steps WHERE id = NEW.to_step_id;
  IF from_wf IS NULL OR from_wf <> NEW.workflow_id THEN
    RAISE EXCEPTION 'workflow_step_edges: from_step % is not in workflow %', NEW.from_step_id, NEW.workflow_id;
  END IF;
  IF to_wf IS NULL OR to_wf <> NEW.workflow_id THEN
    RAISE EXCEPTION 'workflow_step_edges: to_step % is not in workflow %', NEW.to_step_id, NEW.workflow_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workflow_step_edge_consistency_check ON workflow_step_edges;
CREATE TRIGGER workflow_step_edge_consistency_check BEFORE INSERT OR UPDATE ON workflow_step_edges
  FOR EACH ROW EXECUTE FUNCTION assert_workflow_step_edge_consistency();

REVOKE EXECUTE ON FUNCTION public.assert_workflow_step_workspace() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_workflow_step_edge_consistency() FROM anon, authenticated;

-- 4. Realtime parity with workflows + the workflow junctions (so an open UI can
--    reflect authoring writes live, as the canvas subscription used to).
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_steps;
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_step_edges;

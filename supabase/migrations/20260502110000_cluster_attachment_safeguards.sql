-- Defense-in-depth + orphan cleanup for cluster ↔ KB/skill attachments.
--
-- Three concerns, one migration:
--
--  L-2  workspace consistency — ensure cluster.workspace_id ==
--       junction.workspace_id == target.workspace_id at insert time.
--       Service layer enforces this; the trigger is a backstop.
--
--  L-4  soft-delete cascade — when a KB or skill is soft-deleted
--       (deleted_at flips NULL → non-NULL), drop matching junction
--       rows so the agent stops citing the resource. Hard-delete
--       already cascades via FK ON DELETE CASCADE.
--
--  O-1  canvas-panel orphan cleanup — when a KB or skill is
--       hard-deleted, remove the corresponding `knowledge-base` /
--       `skill` rows from canvas_panels (matched via panel_data
--       JSONB) so broken panels don't haunt the canvas.

-- ── L-2: workspace consistency on cluster_knowledge_bases ────────────

CREATE OR REPLACE FUNCTION assert_cluster_kb_workspace()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  cluster_ws UUID;
  kb_ws UUID;
BEGIN
  SELECT workspace_id INTO cluster_ws FROM clusters WHERE id = NEW.cluster_id;
  SELECT workspace_id INTO kb_ws FROM knowledge_bases WHERE id = NEW.knowledge_base_id;

  IF cluster_ws IS NULL THEN
    RAISE EXCEPTION 'cluster_knowledge_bases: cluster % does not exist', NEW.cluster_id;
  END IF;
  IF kb_ws IS NULL THEN
    RAISE EXCEPTION 'cluster_knowledge_bases: knowledge_base % does not exist', NEW.knowledge_base_id;
  END IF;
  IF cluster_ws <> NEW.workspace_id OR kb_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION
      'cluster_knowledge_bases: workspace mismatch (junction=%, cluster=%, kb=%)',
      NEW.workspace_id, cluster_ws, kb_ws;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cluster_kb_workspace_check ON cluster_knowledge_bases;
CREATE TRIGGER cluster_kb_workspace_check
  BEFORE INSERT OR UPDATE ON cluster_knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION assert_cluster_kb_workspace();

-- ── L-2: workspace consistency on cluster_skills ─────────────────────

CREATE OR REPLACE FUNCTION assert_cluster_skill_workspace()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  cluster_ws UUID;
  skill_ws UUID;
BEGIN
  SELECT workspace_id INTO cluster_ws FROM clusters WHERE id = NEW.cluster_id;
  SELECT workspace_id INTO skill_ws FROM skills WHERE id = NEW.skill_id;

  IF cluster_ws IS NULL THEN
    RAISE EXCEPTION 'cluster_skills: cluster % does not exist', NEW.cluster_id;
  END IF;
  IF skill_ws IS NULL THEN
    RAISE EXCEPTION 'cluster_skills: skill % does not exist', NEW.skill_id;
  END IF;
  IF cluster_ws <> NEW.workspace_id OR skill_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION
      'cluster_skills: workspace mismatch (junction=%, cluster=%, skill=%)',
      NEW.workspace_id, cluster_ws, skill_ws;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cluster_skill_workspace_check ON cluster_skills;
CREATE TRIGGER cluster_skill_workspace_check
  BEFORE INSERT OR UPDATE ON cluster_skills
  FOR EACH ROW EXECUTE FUNCTION assert_cluster_skill_workspace();

-- ── L-4: soft-delete cascade — knowledge_bases ───────────────────────

CREATE OR REPLACE FUNCTION cascade_kb_soft_delete_to_attachments()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM cluster_knowledge_bases WHERE knowledge_base_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS kb_soft_delete_cascade_attachments ON knowledge_bases;
CREATE TRIGGER kb_soft_delete_cascade_attachments
  AFTER UPDATE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION cascade_kb_soft_delete_to_attachments();

-- ── L-4: soft-delete cascade — skills ────────────────────────────────

CREATE OR REPLACE FUNCTION cascade_skill_soft_delete_to_attachments()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM cluster_skills WHERE skill_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS skill_soft_delete_cascade_attachments ON skills;
CREATE TRIGGER skill_soft_delete_cascade_attachments
  AFTER UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION cascade_skill_soft_delete_to_attachments();

-- ── O-1: canvas-panel orphan cleanup on KB hard-delete ───────────────

CREATE OR REPLACE FUNCTION cleanup_canvas_panels_on_kb_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM canvas_panels
  WHERE panel_type = 'knowledge-base'
    AND panel_data ->> 'knowledgeBaseId' = OLD.id::text;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS kb_delete_cleanup_canvas_panels ON knowledge_bases;
CREATE TRIGGER kb_delete_cleanup_canvas_panels
  AFTER DELETE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION cleanup_canvas_panels_on_kb_delete();

-- ── O-1: canvas-panel orphan cleanup on skill hard-delete ────────────

CREATE OR REPLACE FUNCTION cleanup_canvas_panels_on_skill_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM canvas_panels
  WHERE panel_type = 'skill'
    AND panel_data ->> 'skillId' = OLD.id::text;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS skill_delete_cleanup_canvas_panels ON skills;
CREATE TRIGGER skill_delete_cleanup_canvas_panels
  AFTER DELETE ON skills
  FOR EACH ROW EXECUTE FUNCTION cleanup_canvas_panels_on_skill_delete();

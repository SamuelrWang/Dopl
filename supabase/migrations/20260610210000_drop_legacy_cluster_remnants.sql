-- Drop the legacy spatial-cluster remnants now that workflows own KB/skill
-- attachments + the node graph, and all cluster-info header panels have been
-- converted to 'workflow' panels.

-- 1. The soft-delete cascade fns referenced cluster_knowledge_bases /
--    cluster_skills (dropped below) — repoint them at the workflow junctions
--    only so they don't error after the tables are gone.
CREATE OR REPLACE FUNCTION cascade_kb_soft_delete_to_attachments() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM workflow_knowledge_bases WHERE knowledge_base_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION cascade_skill_soft_delete_to_attachments() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM workflow_skills WHERE skill_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

-- 2. Drop the legacy cluster junction tables (their triggers drop with them;
--    dropping also removes them from the supabase_realtime publication).
DROP TABLE IF EXISTS cluster_knowledge_bases CASCADE;
DROP TABLE IF EXISTS cluster_skills CASCADE;

-- 3. Drop now-orphaned workspace-assert functions for those tables.
DROP FUNCTION IF EXISTS assert_cluster_kb_workspace() CASCADE;
DROP FUNCTION IF EXISTS assert_cluster_skill_workspace() CASCADE;

-- 4. Remove the legacy 'cluster-info' panel type (all rows converted to
--    'workflow'). Re-add the CHECK without it.
-- The 200000 backfill only converts cluster-info panels whose cluster
-- synced to the DB (canvas_state.clusters elem with a dbId); any straggler
-- would make the ADD CONSTRAINT below abort the whole migration — and step
-- 5 then couldn't be retried meaningfully because the linkage jsonb is
-- dropped. Delete stragglers first (prod had zero; this guards fresh envs).
DELETE FROM canvas_panels WHERE panel_type = 'cluster-info';
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;
ALTER TABLE canvas_panels ADD CONSTRAINT canvas_panels_panel_type_check
  CHECK (panel_type = ANY (ARRAY[
    'chat','connection','knowledge','skills','knowledge-base','skill',
    'artifact','node','workflow'
  ]::text[]));

-- 5. Drop the unused spatial-grouping columns on canvas_state.
ALTER TABLE canvas_state DROP COLUMN IF EXISTS clusters;
ALTER TABLE canvas_state DROP COLUMN IF EXISTS next_cluster_id;

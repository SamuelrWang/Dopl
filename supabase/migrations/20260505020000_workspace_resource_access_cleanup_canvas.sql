-- Audit follow-up to 20260504050000_workspace_resource_access_defensive_rls_and_cleanup.sql.
--
-- That migration added ON DELETE triggers on `knowledge_bases` and
-- `skills` that drop polymorphic override rows in
-- `workspace_resource_access` (the FK is polymorphic via
-- `resource_type` so a real `ON DELETE CASCADE` isn't expressible).
--
-- It missed the third polymorphic resource_type: `canvas`. Hard-deleting
-- a canvas (today only happens via workspace cascade, but
-- workspace_resource_access.workspace_id CASCADE handles that case
-- already) leaves orphan canvas overrides if any other delete path is
-- ever introduced. Adding the trigger now closes the gap symmetrically
-- with the KB and skill triggers, so future canvas-delete paths don't
-- silently leak.

CREATE OR REPLACE FUNCTION public.cleanup_resource_access_on_canvas_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM workspace_resource_access
   WHERE resource_type = 'canvas'
     AND resource_id   = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS canvas_delete_cleanup_access
  ON canvases;
CREATE TRIGGER canvas_delete_cleanup_access
AFTER DELETE ON canvases
FOR EACH ROW
EXECUTE FUNCTION cleanup_resource_access_on_canvas_delete();

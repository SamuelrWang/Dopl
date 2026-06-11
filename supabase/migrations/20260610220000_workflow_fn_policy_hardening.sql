-- Hardening follow-ups to the workflows pivot (20260610200000 / 210000):
--
-- 1. Re-pin search_path on the trigger functions. 20260502110100 pinned
--    `cascade_kb_soft_delete_to_attachments` / `cascade_skill_…`, but the
--    CREATE OR REPLACE in 200000 and again in 210000 reset proconfig and
--    dropped the pin; the new `assert_workflow_*_workspace` fns were never
--    pinned. Unpinned SECURITY-relevant trigger fns are open to search_path
--    hijack via objects in schemas earlier on the caller's path.
ALTER FUNCTION public.cascade_kb_soft_delete_to_attachments() SET search_path = public, pg_temp;
ALTER FUNCTION public.cascade_skill_soft_delete_to_attachments() SET search_path = public, pg_temp;
ALTER FUNCTION public.assert_workflow_kb_workspace() SET search_path = public, pg_temp;
ALTER FUNCTION public.assert_workflow_skill_workspace() SET search_path = public, pg_temp;

-- 2. Add an explicit WITH CHECK to the workflows UPDATE policy. Without
--    one the USING expression is silently re-evaluated on the NEW row,
--    which reads as intent-free; stating it explicitly asserts the NEW
--    row's workspace membership, blocking an UPDATE that rewrites
--    workspace_id to a workspace the caller isn't an editor of. (Moves
--    between two workspaces the caller edits remain possible — full
--    immutability would need a trigger; app traffic uses the service
--    role, so this is the direct-PostgREST backstop only.)
DROP POLICY IF EXISTS workflows_editor_update ON workflows;
CREATE POLICY workflows_editor_update ON workflows FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- F-020: drop the inert `workspace_resource_access` table and its
-- orphaned cleanup trigger functions.
--
-- Per-member resource overrides were replaced wholesale by team-based
-- grants (`teams` / `team_members` / `team_resource_access` +
-- `access_mode` columns) in 20260611020000_teams.sql. Every code path
-- that read or wrote this table was removed at cutover; the table and
-- its SECURITY DEFINER trigger functions (which also trip the Supabase
-- SECURITY DEFINER advisor) have been dead since.
--
-- What the creating migrations left behind:
--   • 20260502140000 — table + `_resource_idx` / `_member_idx` indexes
--   • 20260503232327 — RLS + `admin_modify` / `member_select` policies
--   • 20260504050000 — `self_select` policy; KB + skill cleanup
--     triggers and their functions
--   • 20260505020000 — canvas cleanup trigger + function (the trigger
--     itself already died with the `canvases` table in
--     20260716220000_drop_canvas_tables.sql; the function survived)
--
-- Order: triggers first (they depend on the functions), then the
-- functions, then the table (policies + indexes + PK drop with it).

DROP TRIGGER IF EXISTS knowledge_base_delete_cleanup_access
  ON knowledge_bases;
DROP TRIGGER IF EXISTS skill_delete_cleanup_access
  ON skills;
-- No canvases trigger drop: the `canvases` relation no longer exists,
-- and DROP TRIGGER IF EXISTS still errors on a missing table.

DROP FUNCTION IF EXISTS public.cleanup_resource_access_on_kb_delete();
DROP FUNCTION IF EXISTS public.cleanup_resource_access_on_skill_delete();
DROP FUNCTION IF EXISTS public.cleanup_resource_access_on_canvas_delete();

DROP POLICY IF EXISTS workspace_resource_access_admin_modify
  ON workspace_resource_access;
DROP POLICY IF EXISTS workspace_resource_access_member_select
  ON workspace_resource_access;
DROP POLICY IF EXISTS workspace_resource_access_self_select
  ON workspace_resource_access;

DROP INDEX IF EXISTS workspace_resource_access_resource_idx;
DROP INDEX IF EXISTS workspace_resource_access_member_idx;

DROP TABLE IF EXISTS workspace_resource_access;

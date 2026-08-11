-- Forward drop: retire workflows + clusters (2026-08-11).
-- Capture, reinstate script and data snapshot live outside the repo at
-- ~/Desktop/dopl-artifacts/workflows/ (schema/forward-drop-migration.sql is the
-- source this file was copied from).
-- Order matters: children first; workflows before clusters (workflows.cluster_id FK).
-- DROP TABLE removes the tables' own triggers; the functions are dropped explicitly after.
-- team_resource_access rows with resource_type='workflow' were already zero at capture
-- (see data-snapshot-2026-08-11.json), the DELETE is belt-and-braces.
-- The 'workflow' value deliberately STAYS in the team_resource_grants resource_type CHECK
-- constraint — removing it buys nothing once rows are purged and would rewrite a shared
-- constraint three other migrations extended.

DELETE FROM public.team_resource_access WHERE resource_type = 'workflow';

DROP TABLE IF EXISTS public.workflow_step_edges;
DROP TABLE IF EXISTS public.workflow_steps;
DROP TABLE IF EXISTS public.workflow_knowledge_bases;
DROP TABLE IF EXISTS public.workflow_skills;
DROP TABLE IF EXISTS public.workflows;
DROP TABLE IF EXISTS public.clusters;

DROP FUNCTION IF EXISTS public.assert_workflow_kb_workspace();
DROP FUNCTION IF EXISTS public.assert_workflow_skill_workspace();
DROP FUNCTION IF EXISTS public.assert_workflow_step_workspace();
DROP FUNCTION IF EXISTS public.assert_workflow_step_edge_consistency();
DROP FUNCTION IF EXISTS public.delete_workflow_team_grants();

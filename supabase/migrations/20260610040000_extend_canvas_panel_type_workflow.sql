-- Workflow builder: allow the two new panel types in canvas_panels.
--
-- The API allow-list (src/app/api/canvas/panels/route.ts) and the client
-- discriminated union (src/features/canvas/types.ts) already accept
-- 'cluster-info' (a workflow's header card) and 'node' (a workflow
-- step), but the DB CHECK — last rewritten by
-- 20260608040000_drop_entries_and_composio_integrations.sql — was never
-- extended. Every POST of those panels violated
-- canvas_panels_panel_type_check, so node / cluster-info panels never
-- persisted and silently vanished on reload.

ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;
ALTER TABLE canvas_panels ADD CONSTRAINT canvas_panels_panel_type_check
  CHECK (panel_type = ANY (ARRAY[
    'chat'::text, 'connection'::text, 'knowledge'::text, 'skills'::text,
    'knowledge-base'::text, 'skill'::text, 'artifact'::text,
    'cluster-info'::text, 'node'::text
  ]));

-- Extend canvas_panels.panel_type CHECK to include the four panel types added
-- by the KB/Skills × clusters work: 'knowledge', 'skills', 'knowledge-base',
-- 'skill'. App code already inserts these (see
-- src/app/api/canvas/panels/route.ts VALID_PANEL_TYPES and the discriminated
-- union in src/features/canvas/types.ts), and the cluster-attachment
-- safeguards migration (20260502110000) writes triggers that assume rows of
-- these types exist — but the underlying CHECK constraint was never extended,
-- so on a fresh DB those INSERTs would fail with a check violation.
--
-- The list below is the full superset (5 original + 4 new). It must stay in
-- sync with VALID_PANEL_TYPES in the route handler and the Panel union in
-- src/features/canvas/types.ts.

ALTER TABLE canvas_panels
  DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;

ALTER TABLE canvas_panels
  ADD CONSTRAINT canvas_panels_panel_type_check
    CHECK (panel_type IN (
      'entry',
      'chat',
      'connection',
      'browse',
      'cluster-brain',
      'knowledge',
      'skills',
      'knowledge-base',
      'skill'
    ));

-- Expand canvas_panels to store ALL panel types (not just entry panels).
-- Adds panel_type, panel_id (client-side string id), dimensions, and a
-- JSONB blob for type-specific data.

-- New columns
ALTER TABLE canvas_panels
  ADD COLUMN panel_type TEXT NOT NULL DEFAULT 'entry',
  ADD COLUMN panel_id   TEXT,
  ADD COLUMN width      FLOAT,
  ADD COLUMN height     FLOAT,
  ADD COLUMN panel_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- entry_id is nullable for non-entry panels (chat, connection, browse, cluster-brain)
ALTER TABLE canvas_panels ALTER COLUMN entry_id DROP NOT NULL;

-- Backfill panel_id for existing entry rows
UPDATE canvas_panels SET panel_id = 'entry-' || id::text WHERE panel_id IS NULL;
ALTER TABLE canvas_panels ALTER COLUMN panel_id SET NOT NULL;

-- Replace the old unique constraint with broader panel_id-based one
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_user_id_entry_id_key;
CREATE UNIQUE INDEX idx_canvas_panels_user_panel ON canvas_panels(user_id, panel_id);

-- Keep entry-specific uniqueness (one entry panel per entry per user)
CREATE UNIQUE INDEX idx_canvas_panels_user_entry ON canvas_panels(user_id, entry_id)
  WHERE entry_id IS NOT NULL;

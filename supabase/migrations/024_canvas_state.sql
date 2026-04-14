-- Per-user canvas viewport state (camera, counters, preferences).
-- One row per user — the source of truth for canvas meta that was
-- previously stored only in localStorage.

CREATE TABLE canvas_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  camera_x        FLOAT NOT NULL DEFAULT 0,
  camera_y        FLOAT NOT NULL DEFAULT 0,
  camera_zoom     FLOAT NOT NULL DEFAULT 1,
  next_panel_id   INTEGER NOT NULL DEFAULT 1,
  next_cluster_id INTEGER NOT NULL DEFAULT 1,
  sidebar_open    BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_canvas_state_user ON canvas_state(user_id);

ALTER TABLE canvas_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY canvas_state_select_own ON canvas_state
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY canvas_state_insert_own ON canvas_state
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY canvas_state_update_own ON canvas_state
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY canvas_state_delete_own ON canvas_state
  FOR DELETE USING (user_id = auth.uid());

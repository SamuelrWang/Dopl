-- Canvas panels: server-side persistence for entry panels on the user's canvas.
-- Only entry-type panels are stored here (chat/ingestion/browse are transient).
-- The MCP server uses these endpoints to let Claude read/modify the canvas.

CREATE TABLE canvas_panels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id   UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  title      TEXT,
  summary    TEXT,
  source_url TEXT,
  x          FLOAT DEFAULT 0,
  y          FLOAT DEFAULT 0,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, entry_id)
);

CREATE INDEX idx_canvas_panels_user ON canvas_panels(user_id);
CREATE INDEX idx_canvas_panels_entry ON canvas_panels(entry_id);

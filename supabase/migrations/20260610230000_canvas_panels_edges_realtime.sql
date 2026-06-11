-- Publish canvas_panels + canvas_edges so the client canvas reflects writes
-- from other writers (notably an MCP agent authoring a workflow) live.
-- REPLICA IDENTITY FULL so DELETE events carry the row's panel_id / edge
-- endpoints (the PK is `id`, but the client keys panels by panel_id).
ALTER TABLE canvas_panels REPLICA IDENTITY FULL;
ALTER TABLE canvas_edges REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE canvas_panels;
ALTER PUBLICATION supabase_realtime ADD TABLE canvas_edges;

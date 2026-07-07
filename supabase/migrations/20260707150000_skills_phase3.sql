-- Skills overhaul phase 3.
--
-- 1. mcp_events.workspace_id — per-workspace attribution for agent
--    calls. Nullable: session (UI) calls are unlogged, and pre-existing
--    rows stay null. Populated from the x-workspace-id header the MCP
--    loopback always sends. This unblocks per-skill usage counts
--    without endpoint-LIKE matching bleeding across workspaces that
--    share a slug.
-- 2. Drop the vestigial skills columns that only seed fixtures ever
--    wrote (fake demo data): recent_runs, total_invocations, examples.
--    Real usage now comes from mcp_events; real history from
--    skill_file_versions / skill_events.

ALTER TABLE mcp_events
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mcp_events_workspace_created_idx
  ON mcp_events (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE skills DROP COLUMN IF EXISTS recent_runs;
ALTER TABLE skills DROP COLUMN IF EXISTS total_invocations;
ALTER TABLE skills DROP COLUMN IF EXISTS examples;

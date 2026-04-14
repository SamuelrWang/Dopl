-- Track when the user's MCP server last connected (for onboarding detection).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mcp_connected_at TIMESTAMPTZ;

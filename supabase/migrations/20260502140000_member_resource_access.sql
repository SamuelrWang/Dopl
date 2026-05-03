-- Per-(member, resource) read/edit access overrides. Owner/admin always
-- have edit; this table only stores explicit overrides for member /
-- viewer roles. Default-by-role lookup happens in the service layer:
--   - member  → edit
--   - viewer  → read
-- An override row downgrades or upgrades from the role default.
--
-- Enforcement scope (v1): MCP / external API key requests only. Web UI
-- (session cookie auth) is unaffected.

CREATE TABLE workspace_resource_access (
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('knowledge_base','skill','canvas')),
  resource_id   UUID NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('read','edit')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, resource_type, resource_id)
);

-- Resource-side lookup (e.g. listing every member's access to KB X).
CREATE INDEX workspace_resource_access_resource_idx
  ON workspace_resource_access (workspace_id, resource_type, resource_id);

-- Member-side lookup (e.g. listing every override for member Y).
CREATE INDEX workspace_resource_access_member_idx
  ON workspace_resource_access (workspace_id, user_id);

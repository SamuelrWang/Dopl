-- Shareable workspace join links + admin-approved join requests.
--
-- Flow: admin copies the workspace's standing join link (one per
-- workspace, token rotatable). Anyone with the link can request to
-- join; the request sits pending until an admin approves (picking a
-- role) or declines. The requester gets a one-time popup for each
-- state change, tracked via the two acknowledged_at columns:
--   pending_acknowledged_at  -> "awaiting admin approval" popup shown
--   resolved_acknowledged_at -> "approved/declined" outcome popup shown
--
-- Both tables are service-role only (RLS on, no policies) — all access
-- goes through the API layer, matching workspace_invitations.

CREATE TABLE IF NOT EXISTS workspace_join_links (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at   TIMESTAMPTZ
);
ALTER TABLE workspace_join_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workspace_join_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','declined')),
  requested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at              TIMESTAMPTZ,
  resolved_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pending_acknowledged_at  TIMESTAMPTZ,
  resolved_acknowledged_at TIMESTAMPTZ,
  CONSTRAINT workspace_join_requests_unique UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_join_requests_workspace_status_idx
  ON workspace_join_requests (workspace_id, status);
CREATE INDEX IF NOT EXISTS workspace_join_requests_user_idx
  ON workspace_join_requests (user_id);
ALTER TABLE workspace_join_requests ENABLE ROW LEVEL SECURITY;

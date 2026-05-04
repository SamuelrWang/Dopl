-- Third-party integrations (Notion, Gmail, Drive, Slack, …).
--
-- Stores the per-(workspace, user, provider) handle that lets the
-- backend talk to a third-party service on the user's behalf. The
-- actual OAuth tokens are held by Composio (our broker); we only
-- persist Composio's connection id, which is sensitive and never
-- leaves the server.
--
-- Branding: end users never see "Composio" anywhere — we register our
-- own OAuth apps with each provider, so the consent screen says "Dopl".
-- See src/features/integrations/server/composio-client.ts.
--
-- v1 scope: pull-on-demand only (no scheduled sync), one connection
-- per (workspace, user, provider). The unique constraint enforces that.

CREATE TABLE oauth_connections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  composio_connection_id   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'connected'
                            CHECK (status IN ('connected', 'needs_auth', 'error')),
  scopes                   TEXT[] NOT NULL DEFAULT '{}',
  last_used_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_connections_unique_per_user
    UNIQUE (workspace_id, user_id, provider)
);

CREATE INDEX oauth_connections_workspace_user_idx
  ON oauth_connections (workspace_id, user_id);

CREATE INDEX oauth_connections_provider_idx
  ON oauth_connections (provider);

ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;

-- Users can see their own connections (status only — the
-- composio_connection_id is stripped at the DTO boundary in
-- src/features/integrations/server/dto.ts before it ever reaches a
-- response payload).
CREATE POLICY "users read own oauth connections"
  ON oauth_connections FOR SELECT
  USING (user_id = auth.uid());

-- Users can disconnect (delete) their own connections.
CREATE POLICY "users delete own oauth connections"
  ON oauth_connections FOR DELETE
  USING (user_id = auth.uid());

-- Inserts and updates go through service-role from API routes
-- (POST /api/integrations/[provider]/callback persists; the service
-- layer is the only writer). No user-facing INSERT/UPDATE policy.

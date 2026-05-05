-- User-level OAuth connections + per-workspace grants.
--
-- Replaces the prior workspace-keyed `oauth_connections` table. The
-- new model keeps connections at the user level so a single OAuth
-- handshake covers every workspace the user belongs to. Workspace
-- access is controlled by a separate `oauth_connection_grants` table
-- that the user manages in /settings/integrations.
--
-- Branding: end users never see "Composio" anywhere — we register our
-- own OAuth apps with each provider, so the consent screen says
-- "Dopl". See src/features/integrations/server/composio-client.ts.
--
-- Multi-account: `(user_id, provider, alias)` is unique. `alias`
-- defaults to the connected account's email (auto-derived from the
-- broker's connectedAccount metadata at finalize time), which lets a
-- user connect e.g. two Gmail accounts under different aliases.
--
-- Migration shape (per Sam's call): fresh slate. The prior
-- workspace-keyed rows are dropped — there are <5 active users and
-- they'll reconnect from the new /settings/integrations page.

DROP TABLE IF EXISTS oauth_connections CASCADE;

CREATE TABLE oauth_connections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  alias                    TEXT NOT NULL,
  composio_connection_id   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'connected'
                            CHECK (status IN ('connected', 'needs_auth', 'error')),
  account_email            TEXT,
  account_label            TEXT,
  scopes                   TEXT[] NOT NULL DEFAULT '{}',
  last_used_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_connections_unique_alias
    UNIQUE (user_id, provider, alias)
);

CREATE INDEX oauth_connections_user_provider_idx
  ON oauth_connections (user_id, provider);

CREATE INDEX oauth_connections_provider_idx
  ON oauth_connections (provider);

ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;

-- Users can read/delete their own connections. Inserts and updates go
-- through service-role from API routes (POST connect, GET callback);
-- no user-facing INSERT/UPDATE policy. composio_connection_id is
-- stripped at the DTO boundary in
-- src/features/integrations/server/dto.ts before any response.
CREATE POLICY "users read own oauth connections"
  ON oauth_connections FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users delete own oauth connections"
  ON oauth_connections FOR DELETE
  USING (user_id = auth.uid());

-- Per-workspace grants for a user-level connection.
-- A connection with no rows here is effectively private to the user
-- (the agent can't use it from any workspace). On connect we auto-
-- populate one row per workspace the user currently belongs to so the
-- default UX is "use everywhere"; users prune grants from the
-- /settings/integrations page if they want a connection scoped tighter.
CREATE TABLE oauth_connection_grants (
  connection_id  UUID NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, workspace_id)
);

CREATE INDEX oauth_connection_grants_workspace_idx
  ON oauth_connection_grants (workspace_id);

ALTER TABLE oauth_connection_grants ENABLE ROW LEVEL SECURITY;

-- A user can read grants for their own connections.
CREATE POLICY "users read own grants"
  ON oauth_connection_grants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM oauth_connections oc
      WHERE oc.id = oauth_connection_grants.connection_id
        AND oc.user_id = auth.uid()
    )
  );

-- Mutations (insert/delete) go through service-role from the
-- /settings/integrations grants API, which checks the caller is the
-- connection owner before writing.

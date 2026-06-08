-- Remote MCP OAuth 2.1 authorization server.
--
-- Backs the "Connect → log in" flow for the hosted MCP endpoint (/api/mcp):
-- MCP clients dynamically register (RFC 7591), run authorization-code + PKCE
-- (S256), and receive Dopl-minted access/refresh tokens. Human login is
-- delegated to the existing Supabase Google/magic-link auth; these tables only
-- hold the OAuth client registry, short-lived auth codes, and issued tokens.
--
-- All three tables are SERVICE-ROLE ONLY: accessed exclusively via
-- supabaseAdmin() in the server. RLS is ENABLED with NO policies so the
-- anon/authenticated PostgREST roles are denied entirely (service role
-- bypasses RLS), mirroring how api_keys is treated. Only hashes of secrets
-- are stored — never plaintext codes/tokens.

-- ── 1. Registered OAuth clients (Dynamic Client Registration) ─────────
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                   TEXT PRIMARY KEY,
  client_name                 TEXT,
  redirect_uris               TEXT[] NOT NULL,
  grant_types                 TEXT[] NOT NULL
                                DEFAULT ARRAY['authorization_code', 'refresh_token'],
  token_endpoint_auth_method  TEXT NOT NULL DEFAULT 'none',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Authorization codes (short-lived, PKCE) ────────────────────────
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash              TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scopes                TEXT[] NOT NULL DEFAULT '{}',
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expires_idx
  ON oauth_authorization_codes (expires_at);

-- ── 3. Issued access + refresh tokens (hashes only) ───────────────────
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  access_token_hash   TEXT NOT NULL UNIQUE,
  refresh_token_hash  TEXT UNIQUE,
  scopes              TEXT[] NOT NULL DEFAULT '{}',
  access_expires_at   TIMESTAMPTZ NOT NULL,
  refresh_expires_at  TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  -- Denormalized client name so the settings "Connected apps" list renders
  -- without a join even if the client row is later pruned.
  client_name         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: validate an access token by hash on every MCP/loopback request.
CREATE INDEX IF NOT EXISTS mcp_tokens_access_hash_idx
  ON mcp_tokens (access_token_hash);
CREATE INDEX IF NOT EXISTS mcp_tokens_refresh_hash_idx
  ON mcp_tokens (refresh_token_hash);
-- Settings list: a user's active grants.
CREATE INDEX IF NOT EXISTS mcp_tokens_user_active_idx
  ON mcp_tokens (user_id) WHERE revoked_at IS NULL;

-- ── 4. Lock down: RLS on, no policies (service-role only) ──────────────
ALTER TABLE oauth_clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tokens                 ENABLE ROW LEVEL SECURITY;

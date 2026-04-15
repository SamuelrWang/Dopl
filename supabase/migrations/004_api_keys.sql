-- API key authentication system.
-- Keys are stored as SHA-256 hashes. Plaintext is shown once at creation.

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,       -- e.g. "sk-dopl-a1b2c3" for display
  name TEXT NOT NULL,             -- human label
  rate_limit_rpm INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ          -- NULL = active
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

CREATE TABLE api_key_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_key_usage_rate ON api_key_usage(api_key_id, requested_at);

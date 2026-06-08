-- Refresh-token rotation families (OAuth 2.1 BCP §4.13.2).
--
-- Each authorization grant starts a token "family"; every refresh rotation
-- carries the same family_id forward. If an already-rotated (revoked) refresh
-- token is presented again — the classic stolen-token signal — the server
-- revokes the ENTIRE family, not just that token. NOT NULL DEFAULT gives every
-- existing row its own singleton family; new tokens set it explicitly.

ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID NOT NULL DEFAULT gen_random_uuid();

-- Family-revocation sweep on reuse detection.
CREATE INDEX IF NOT EXISTS mcp_tokens_family_active_idx
  ON mcp_tokens (family_id) WHERE revoked_at IS NULL;

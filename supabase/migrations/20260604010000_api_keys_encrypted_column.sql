-- Unify API keys, step 1 of 2 (additive, zero-downtime).
--
-- Adds a column to hold the API key's plaintext encrypted at rest
-- (AES-256-GCM, packed base64 `iv ‖ tag ‖ ciphertext`) so the owner can
-- REVEAL their key and the setup snippets can be auto-filled after
-- creation. Auth is unaffected — `validateApiKey` still uses `key_hash`
-- (one-way SHA-256). Nullable because pre-existing rows have no
-- recoverable plaintext (they are revoked in the clean-slate step 2).
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS encrypted_key TEXT;

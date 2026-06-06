-- Unify API keys, step 2 of 2 — clean slate + one-key-per-workspace.
--
-- Clean slate (user-approved): revoke EVERY active LEGACY key tied to a
-- user — the ~500 auto-created "MCP Connection" junk keys and any older
-- personal keys. Admin/service keys (user_id IS NULL) are untouched.
--
-- The `encrypted_key IS NULL` guard makes this safe to re-run: legacy
-- keys never had encrypted ciphertext, while every key minted under the
-- new system (backfill + auto-gen) DOES — so a replay can never revoke a
-- live workspace key. Fresh keys are minted per active membership by
-- scripts/backfill-workspace-keys.ts (key-gen + AES-GCM needs Node).
UPDATE api_keys
  SET revoked_at = now()
  WHERE revoked_at IS NULL AND user_id IS NOT NULL AND encrypted_key IS NULL;

-- Enforce exactly one ACTIVE key per (user, workspace). Created AFTER the
-- clean-slate revoke so it can't trip on pre-existing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_per_user_workspace
  ON api_keys (user_id, workspace_id)
  WHERE workspace_id IS NOT NULL AND revoked_at IS NULL;

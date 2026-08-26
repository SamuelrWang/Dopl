-- ============================================================================
-- mcp_tokens.workspace_id — THE CONTAINER-LOCKED CREDENTIAL (Home Knowledge
-- Panels M5 / plan §4.4 B1, Samuel's RULING 4: "build the real fence").
--
-- WHAT THIS IS FOR
-- When the desktop spawns a session into a `kind='link'` container that has a
-- PEER in it, it mints a CHILD credential locked to that container and hands
-- that to the session instead of the operator's 90-day device token. This
-- column is the lock.
--
-- 🔒 WHY THE LOCK HAS TO LIVE HERE AND NOT IN A HEADER. `X-Workspace-Id`,
-- `X-Dopl-Runtime` and `X-Dopl-Session-Id` are documented NON-authorization
-- signals: any bearer holder can send any value for any of them. A `full`
-- profile has Bash, so an agent can issue the loopback HTTP itself with whatever
-- headers it likes — which is exactly why the MCP directory lock (B3) and the
-- desktop grant gate (B2) are TRIPWIRES. A lock on the TOKEN ROW is different in
-- kind: it rides the credential, so it binds the agent's own process AND
-- anything that process shells out to, because everything downstream can only
-- present the credential it was given.
--
-- WHAT ENFORCES IT
-- `shared/auth/mcp-oauth.ts › validateAccessToken` reads this column out;
-- `shared/auth/with-auth.ts` forwards it as `apiKeyWorkspaceId`; and
-- `shared/auth/with-workspace-auth.ts` OVERRIDES the requested workspace with it
-- and 403s `API_KEY_WORKSPACE_MISMATCH` on a contradicting target. That chain
-- has existed since the `api_keys` table it was written for
-- (`20260609000000_drop_api_key_auth.sql` dropped that table); INVARIANTS §4
-- called it "dead scaffolding; preserved". It is no longer dead — this file is
-- the missing PRODUCER.
--
-- NULL IS THE OVERWHELMING MAJORITY AND MEANS "NOT LOCKED"
-- Every device token, every OAuth-app grant and every playground token stays
-- NULL and behaves exactly as before. Only a container-locked child credential
-- carries a value. There is no backfill and nothing changes for an existing row.
--
-- INDEX
-- `mcp_tokens_workspace_idx` is PARTIAL on `workspace_id IS NOT NULL` — it
-- indexes only the container-locked tokens, which are a small minority of the
-- table. Its named statements are (1) the FK's ON DELETE CASCADE, which §12
-- counts as a statement and which never probes a NULL, and (2) the sweep that
-- revokes a container's outstanding child credentials
-- (`shared/auth/mcp-container-token.ts › revokeContainerTokens`).
--
-- ⚠ NOT A REALTIME CHANGE. `mcp_tokens` is in no publication, its replica
-- identity is untouched, and it has RLS enabled with NO policies (service-role
-- only, `20260606000000_mcp_oauth_server.sql`) — so no policy and no column
-- grant is touched here either. Nothing in §7 applies.
--
-- ROLLBACK (prose, per §12) — ⚠ IT HAS AN ORDERING TRAP, AND THE TRAP OPENS A
-- FENCE RATHER THAN CLOSING ONE.
--   DROP INDEX IF EXISTS mcp_tokens_workspace_idx;
--   ALTER TABLE mcp_tokens DROP COLUMN IF EXISTS workspace_id;
-- Dropping this column while container-locked tokens are LIVE and unexpired
-- turns each of them back into an UNLOCKED credential with the operator's full
-- scopes: `validateAccessToken` reads no lock, `with-workspace-auth` stops
-- overriding the target, and a session that was fenced to one container can
-- address every workspace its operator belongs to. There is no error anywhere
-- and nothing in a log says it happened. **Revoke every row with a non-null
-- `workspace_id` FIRST** —
--   UPDATE mcp_tokens SET revoked_at = now()
--    WHERE workspace_id IS NOT NULL AND revoked_at IS NULL;
-- — and only then drop. Rolling back the app code alone is safe in either
-- order; it is dropping the COLUMN under live rows that widens.
-- ============================================================================

ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES workspaces(id) ON DELETE CASCADE;

COMMENT ON COLUMN mcp_tokens.workspace_id IS
  'Container lock. NULL = unlocked (device tokens, OAuth grants, playground). Non-null = this credential may only ever act in that ONE workspace; withWorkspaceAuth overrides the requested target with it and 403s API_KEY_WORKSPACE_MISMATCH on a contradiction. Home Knowledge Panels M5 / plan B1.';

CREATE INDEX IF NOT EXISTS mcp_tokens_workspace_idx
  ON mcp_tokens (workspace_id)
  WHERE workspace_id IS NOT NULL;

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- Asserts the three things the fence depends on, so a partially-applied file
-- RAISEs here instead of shipping a lock that does not lock.
DO $$
DECLARE
  col_exists   BOOLEAN;
  col_nullable BOOLEAN;
  idx_exists   BOOLEAN;
  fk_action    TEXT;
BEGIN
  SELECT TRUE, (is_nullable = 'YES')
    INTO col_exists, col_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'mcp_tokens'
     AND column_name = 'workspace_id';

  IF NOT COALESCE(col_exists, FALSE) THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock: mcp_tokens.workspace_id was not created';
  END IF;

  -- NULLABLE IS LOAD-BEARING: every pre-existing token row is unlocked, and a
  -- NOT NULL column would have required inventing a workspace for each of them.
  IF NOT col_nullable THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock: mcp_tokens.workspace_id must be NULLABLE — NULL is "not locked"';
  END IF;

  SELECT TRUE INTO idx_exists
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'mcp_tokens'
     AND indexname = 'mcp_tokens_workspace_idx';

  IF NOT COALESCE(idx_exists, FALSE) THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock: mcp_tokens_workspace_idx is missing — the FK cascade and the revoke sweep would both seq-scan';
  END IF;

  -- The cascade is what stops a deleted container leaving live credentials that
  -- name it behind.
  SELECT rc.delete_rule
    INTO fk_action
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.table_schema
   WHERE tc.table_schema = 'public'
     AND tc.table_name = 'mcp_tokens'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'workspace_id';

  IF fk_action IS DISTINCT FROM 'CASCADE' THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock: workspace_id FK delete rule is %, expected CASCADE', COALESCE(fk_action, '(no FK)');
  END IF;
END $$;

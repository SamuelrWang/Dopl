-- ============================================================================
-- mcp_tokens.workspace_lock_kind — WHAT KIND OF LOCK, not WHICH WORKSPACE
-- (F-336 / F-333, Samuel's ruling 2026-08-27: "implement option B").
--
-- WHAT THIS IS FOR
-- `20260827130000_mcp_token_workspace_lock.sql` added `workspace_id`: the
-- container lock, layer B1 of the audience ceiling. Every M-10 visibility
-- predicate in the app then read that ONE column as its answer to a DIFFERENT
-- question:
--
--   workspace_id  answers  WHICH WORKSPACE may this credential act in?
--   visibility    answers  WHICH ROWS INSIDE IT may it read?
--
-- `knowledge/server/service-shared.ts › canSeeBase` — and its mirrors in chats,
-- skills and agent-templates — were written as `if (apiKeyWorkspaceId) return
-- false`, i.e. the workspace fence used as a visibility fence. The rule they
-- MEAN is "a credential that may be shared between humans inherits nobody's
-- personal reach", which was written for the workspace-scoped API key in the
-- `api_keys` table `20260609000000_drop_api_key_auth.sql` dropped. B1's child
-- credential is the opposite kind of thing: minted for ONE desktop session,
-- carrying the OPERATOR's user id and the operator's own proved membership,
-- then NARROWED to one workspace.
--
-- The consequence was that the operator's own agent could not read the
-- operator's own private knowledge base **even when it was granted `agent_only`
-- into the channel** — `service-bases.ts › getBaseById` runs `assertBaseVisible`
-- BEFORE `assertWithinAudience`, so the grant row was never consulted and the
-- whole `agent_only` level was decoration. Same mechanism made every "Use in
-- this channel" template copy (forced `private` by `containerCopyDraft`)
-- invisible to the agents in that channel.
--
-- THIS COLUMN IS THE DISCRIMINATOR
-- `shared/auth/mcp-container-token.ts › issueContainerToken` — today the ONLY
-- writer of `mcp_tokens.workspace_id` — stamps `'container_session'`. The read
-- path is `shared/auth/mcp-access-token.ts › validateAccessToken` →
-- `apiKeyWorkspaceLockKind` → `shared/auth/credential-audience.ts ›
-- isSharedCredential`, which is the ONLY predicate the visibility gates may ask.
--
-- 🔒 NULL FAILS CLOSED, AND THAT IS THE POINT OF HAVING A COLUMN AT ALL.
-- "Locked, kind not stated" reads as a SHARED credential — the pre-ruling
-- refusal, verbatim. Because `issueContainerToken` is the only lock producer in
-- the tree today, this could have been written in the app as "locked ⇒ container
-- session" with no schema change and it would be TRUE today. It is deliberately
-- NOT written that way: a shared workspace credential reintroduced later would
-- inherit the WIDER rule silently, and that case is the entire reason M-10
-- exists. A new lock kind has to name itself before it reads anybody's private
-- rows.
--
-- NO BACKFILL, DELIBERATELY
-- Container credentials live at most `CONTAINER_TOKEN_TTL_S` (24h) and are
-- revoked at session end. Any row outstanding when this applies keeps
-- `workspace_lock_kind IS NULL` and therefore keeps TODAY's behaviour until it
-- dies — the fail-closed direction. Backfilling to 'container_session' would be
-- truthful (there is no other producer) but would WIDEN live credentials as a
-- side effect of a schema change, which is not a thing a migration should do.
--
-- ⚠ NOT A REALTIME CHANGE. `mcp_tokens` is in no publication, its replica
-- identity is untouched, and it has RLS enabled with NO policies (service-role
-- only, `20260606000000_mcp_oauth_server.sql`) — no policy and no column grant
-- is touched here. Nothing in §7 applies.
--
-- NO INDEX, DELIBERATELY (§12's own rule: an index exists only if a named
-- statement uses it). Nothing filters on this column: every reader has already
-- reached the row by `access_token_hash`, and the revoke sweep filters on
-- `workspace_id IS NOT NULL`, which `mcp_tokens_workspace_idx` already covers.
--
-- ROLLBACK (prose, per §12) — ⚠ IT CLOSES A FENCE RATHER THAN OPENING ONE,
-- WHICH IS THE OPPOSITE OF THE MIGRATION IT SITS ON TOP OF.
--   ALTER TABLE mcp_tokens DROP CONSTRAINT IF EXISTS mcp_tokens_workspace_lock_kind_check;
--   ALTER TABLE mcp_tokens DROP CONSTRAINT IF EXISTS mcp_tokens_lock_kind_needs_lock_check;
--   ALTER TABLE mcp_tokens DROP COLUMN IF EXISTS workspace_lock_kind;
-- Dropping this column under live container credentials does not widen
-- anything: `validateAccessToken` reads no kind, `isSharedCredential` answers
-- TRUE, and every locked session reverts to the pre-2026-08-27 refusal. The
-- SYMPTOM is an operator's agent 404ing on the operator's own granted knowledge
-- base with nothing in a log saying why — annoying, never unsafe. There is no
-- ordering trap. ⚠ Roll the APP code back with it, or `issueContainerToken`
-- 42703s on every mint and no session in a shared container gets a credential
-- at all.
-- ============================================================================

ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS workspace_lock_kind TEXT;

-- The closed set of kinds. ONE value ships; a second one is a deliberate edit
-- here AND a new arm in `credential-audience.ts`, in the same change.
ALTER TABLE mcp_tokens
  DROP CONSTRAINT IF EXISTS mcp_tokens_workspace_lock_kind_check;
ALTER TABLE mcp_tokens
  ADD CONSTRAINT mcp_tokens_workspace_lock_kind_check
  CHECK (workspace_lock_kind IS NULL OR workspace_lock_kind IN ('container_session'));

-- A kind without a lock is meaningless — and would be READ as meaningless
-- (`isSharedCredential` short-circuits on an absent `workspace_id`), so the
-- constraint keeps the table from carrying a fact nothing consults.
ALTER TABLE mcp_tokens
  DROP CONSTRAINT IF EXISTS mcp_tokens_lock_kind_needs_lock_check;
ALTER TABLE mcp_tokens
  ADD CONSTRAINT mcp_tokens_lock_kind_needs_lock_check
  CHECK (workspace_lock_kind IS NULL OR workspace_id IS NOT NULL);

COMMENT ON COLUMN mcp_tokens.workspace_lock_kind IS
  'WHAT KIND of workspace lock (never WHICH workspace — that is workspace_id). ''container_session'' = a per-session child credential minted by the desktop for ONE spawned session, acting as the operator: it reads the operator''s own private rows, still fenced to one workspace by B1 and to the container''s GRANTED bases by layer A. NULL = kind not stated, read as a SHARED credential with nobody behind it, which is denied every private row (M-10). F-336/F-333.';

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- A partially-applied file RAISEs here rather than shipping a discriminator
-- that does not discriminate.
DO $$
DECLARE
  col_nullable BOOLEAN;
  kind_check   TEXT;
  pair_check   TEXT;
  stray_rows   BIGINT;
BEGIN
  SELECT (is_nullable = 'YES')
    INTO col_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'mcp_tokens'
     AND column_name = 'workspace_lock_kind';

  IF col_nullable IS NULL THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock_kind: column was not created';
  END IF;

  -- NULLABLE IS LOAD-BEARING AND IT IS THE FAIL-CLOSED DIRECTION: every
  -- pre-existing token row keeps NULL and keeps the old refusal.
  IF NOT col_nullable THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock_kind: column must be NULLABLE — NULL is "kind not stated" = shared credential';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO kind_check
    FROM pg_constraint
   WHERE conrelid = 'public.mcp_tokens'::regclass
     AND conname = 'mcp_tokens_workspace_lock_kind_check';
  IF kind_check IS NULL OR kind_check NOT LIKE '%container_session%' THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock_kind: the value CHECK is missing or does not name container_session (got %)', COALESCE(kind_check, '(none)');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO pair_check
    FROM pg_constraint
   WHERE conrelid = 'public.mcp_tokens'::regclass
     AND conname = 'mcp_tokens_lock_kind_needs_lock_check';
  IF pair_check IS NULL THEN
    RAISE EXCEPTION 'mcp_token_workspace_lock_kind: the "kind implies lock" CHECK is missing';
  END IF;

  -- Nothing may have been backfilled by this file. Stated as an assertion
  -- because a future edit adding one would be a SILENT WIDENING of every live
  -- container credential.
  SELECT count(*) INTO stray_rows
    FROM mcp_tokens
   WHERE workspace_lock_kind IS NOT NULL;
  IF stray_rows > 0 AND NOT EXISTS (
    SELECT 1 FROM mcp_tokens
     WHERE workspace_lock_kind IS NOT NULL AND workspace_id IS NULL
  ) THEN
    RAISE NOTICE 'mcp_token_workspace_lock_kind: % row(s) already carry a kind (a re-run, or the app is already minting them)', stray_rows;
  END IF;
END $$;

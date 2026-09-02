-- ============================================================================
-- mcp_tokens.container_id + mcp_tokens.subject_user_id — THE TWO CREDENTIAL
-- AXES, SEPARATED (2026-09-02, v2 wave B slice B3; tenancy risk 4, F6).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED.** Docker is unavailable in the
-- environment this was authored in, so `supabase db reset` has NOT been run
-- against it and this file has executed NOWHERE. Do not read the absence of an
-- error as evidence that it works.
-- ⚠ RE-DERIVE RATHER THAN TRUSTING THAT LINE, AND JOIN ON THE NAME:
-- `supabase migration list --linked` (or MCP `list_migrations`) plus a look at
-- the live columns. INVARIANTS §12; F-304's re-stamp is the precedent.
--
-- ⚠ READ `20260827130000_mcp_token_workspace_lock.sql` (the lock) and
-- `20260829120000_mcp_token_workspace_lock_kind.sql` (the discriminator bolted
-- onto it) before changing anything here. This file finishes the job those two
-- started, and the reason it exists is stated at ── WHY ── below.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- The container lock rides ONE field and answers TWO questions:
--
--   WHICH container may this credential act in?   `workspace_id`
--   WHOSE reach does this credential inherit?     `workspace_lock_kind`, read
--                                                 as an ENUM by a predicate
--                                                 that wanted a PERSON
--
-- F-336/F-333 is what happens when they are conflated: every M-10 visibility
-- gate read `if (apiKeyWorkspaceId) return false`, i.e. the WHICH answer used as
-- the WHOSE answer, and the operator's own agent lost the operator's own private
-- rows. `20260829120000` fixed the SYMPTOM by adding a kind column and a
-- three-arm predicate over the PAIR (`no lock` / `locked, container_session` /
-- `locked, anything else`). That predicate is still reading a lock to learn
-- about a person: the fact it wants — WHO stands behind this credential — is
-- nowhere on the row, and is inferred.
--
-- These two columns make both facts explicit and independent:
--
--   container_id     WHICH container. Null = unfenced. Exactly `workspace_id`'s
--                    meaning, under a name that does not also imply an audience.
--   subject_user_id  WHOSE reach. The ONE human this credential acts as; NULL =
--                    nobody in particular, i.e. a credential that may be passed
--                    between humans and therefore inherits no one person's
--                    reach. This is the whole of M-10, as a null check.
--
-- 🔒 **THEY ARE INDEPENDENT, AND ALL FOUR COMBINATIONS ARE MEANINGFUL** — which
-- is the property the single field could not express and the reason B13 may
-- remove `workspace=` without removing the fence with it (tenancy risk 4):
--
--   container_id NULL, subject SET   an ordinary device / OAuth token: a person,
--                                    unfenced. The overwhelming majority.
--   container_id SET,  subject SET   a container SESSION: one human's session,
--                                    narrowed to one container. Reads that
--                                    human's private rows; still fenced by B1
--                                    and by layer A's grants.
--   container_id SET,  subject NULL  a SHARED container credential (a CI runner,
--                                    a service account). Fenced AND anonymous:
--                                    denied every private row. Nothing mints one
--                                    today; the shape exists so that when
--                                    something does, it inherits the NARROW rule
--                                    by construction rather than by remembering.
--   container_id NULL, subject NULL  a shared credential with no fence at all.
--                                    Representable and correctly handled (it
--                                    reads nobody's private rows), but nothing
--                                    mints one and nothing should.
--
-- ── BACKFILL: EXACTLY TODAY'S THREE-ARM PREDICATE, WRITTEN DOWN ──────────────
--
-- `credential-audience.ts › isSharedCredential` answers, today:
--   no lock                        → a person   (unlocked = a device token)
--   locked, 'container_session'    → a person   (the operator's own session)
--   locked, any other/unstated kind→ SHARED     (the pre-2026-08-27 refusal)
--
-- So `subject_user_id := user_id` for arms 1 and 2, and stays NULL for arm 3.
-- 🔒 **NO ROW CHANGES BEHAVIOUR.** Unlike `20260829120000` — which deliberately
-- refused to backfill because doing so would have WIDENED live credentials as a
-- side effect of a schema change — this backfill is the identity: it writes down
-- the answer the app already computes, for every row, in both directions. The
-- verification block below asserts that equivalence rather than asserting the
-- absence of a backfill.
--
-- ── DUAL-WRITE / DUAL-READ FOR ONE RELEASE ──────────────────────────────────
--
-- `mcp-container-token.ts › issueContainerToken` writes BOTH pairs
-- (`workspace_id` + `workspace_lock_kind` AND `container_id` + `subject_user_id`)
-- and the `mcp_tokens_axes_agree_check` below makes a divergence unrepresentable
-- rather than merely unlikely. `mcp-access-token.ts › validateAccessToken` reads
-- the new axes and falls back to deriving them from the legacy pair, so the app
-- behaves identically whether or not this file has applied. The legacy columns
-- and this dual lane are removed by B13, not here.
--
-- ⚠ NOT A REALTIME CHANGE. `mcp_tokens` is in no publication, its replica
-- identity is untouched, and it has RLS enabled with NO policies (service-role
-- only, `20260606000000_mcp_oauth_server.sql`) — no policy and no column grant
-- is touched here. Nothing in §7 applies.
--
-- INDEX. `mcp_tokens_container_idx` is PARTIAL on `container_id IS NOT NULL`,
-- for the same two named statements `mcp_tokens_workspace_idx` carries (§12's
-- rule: an index exists only if a named statement uses it): the FK's ON DELETE
-- CASCADE, and the revoke sweep once B13 repoints it. NO index on
-- `subject_user_id` — nothing filters on it. Every reader has already reached the
-- row by `access_token_hash` and reads the column off the row it has.
--
-- ROLLBACK (prose, per §12) — ⚠ SAFE IN BOTH DIRECTIONS *WHILE THE LEGACY
-- COLUMNS EXIST*, WHICH IS THE ENTIRE POINT OF THE DUAL LANE.
--   ALTER TABLE mcp_tokens DROP CONSTRAINT IF EXISTS mcp_tokens_axes_agree_check;
--   ALTER TABLE mcp_tokens DROP CONSTRAINT IF EXISTS mcp_tokens_subject_is_owner_check;
--   DROP INDEX IF EXISTS mcp_tokens_container_idx;
--   ALTER TABLE mcp_tokens DROP COLUMN IF EXISTS subject_user_id;
--   ALTER TABLE mcp_tokens DROP COLUMN IF EXISTS container_id;
-- Dropping these columns under live rows changes NOTHING: `validateAccessToken`
-- falls back to deriving both axes from `workspace_id` + `workspace_lock_kind`,
-- which by construction of the backfill above give the same answer. There is no
-- ordering trap in THIS file. ⚠ **BUT THE MINTER IS NOT SYMMETRIC WITH THE
-- READER**: `issueContainerToken` INSERTs both new columns, so rolling back this
-- file without rolling back the app code 42703s on every mint and no session in
-- a shared container gets a credential at all — the `20260829120000` precedent,
-- verbatim. The mint fails OPEN and is logged (`session-credential.js`), so the
-- session runs on the device token with layer A, B2 and B3 still in force; it is
-- a degraded fence, never a wrong one. Roll the app code back with it.
-- 🔒 **THE REAL TRAP IS THE OTHER ORDER, AND IT BELONGS
-- TO B13:** dropping the LEGACY pair while any reader still derives from it, or
-- before this file has applied, leaves `validateAccessToken` with neither source
-- — every credential reads as unlocked AND anonymous, which OPENS the workspace
-- fence and CLOSES every visibility gate at once. Legacy goes last, after the
-- new columns are proved live.
-- ============================================================================

-- ── 1. WHICH CONTAINER ──────────────────────────────────────────────────────
ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS container_id UUID
    REFERENCES workspaces(id) ON DELETE CASCADE;

COMMENT ON COLUMN mcp_tokens.container_id IS
  'WHICH container this credential may act in, and nothing else — never WHOSE reach it inherits (that is subject_user_id). NULL = unfenced (device tokens, OAuth grants, playground). Non-null = withWorkspaceAuth overrides the requested target with it and 403s API_KEY_WORKSPACE_MISMATCH on a contradiction. Supersedes workspace_id, which is dual-written until B13.';

CREATE INDEX IF NOT EXISTS mcp_tokens_container_idx
  ON mcp_tokens (container_id)
  WHERE container_id IS NOT NULL;

-- ── 2. WHOSE REACH ──────────────────────────────────────────────────────────
ALTER TABLE mcp_tokens
  ADD COLUMN IF NOT EXISTS subject_user_id UUID
    REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN mcp_tokens.subject_user_id IS
  'WHOSE reach this credential inherits: the ONE human it acts as. NULL = nobody in particular — a credential that may be passed between humans, which is denied every private row (M-10, credential-audience.ts › isSharedCredential). Independent of container_id: a credential can be fenced and anonymous, fenced and personal, or unfenced and personal. Supersedes workspace_lock_kind. F-336/F-333.';

-- ── 3. BACKFILL — the identity, not a widening ──────────────────────────────
-- Idempotent by the `IS NULL` guards: a re-run writes nothing, and a row an
-- already-upgraded app minted keeps what the app wrote.
UPDATE mcp_tokens
   SET container_id = workspace_id
 WHERE container_id IS NULL
   AND workspace_id IS NOT NULL;

-- Arms 1 and 2 of today's predicate. Arm 3 (locked with any other or unstated
-- kind) is the SHARED case and correctly keeps NULL.
UPDATE mcp_tokens
   SET subject_user_id = user_id
 WHERE subject_user_id IS NULL
   AND (workspace_id IS NULL OR workspace_lock_kind = 'container_session');

-- ── 4. THE TWO INVARIANTS ───────────────────────────────────────────────────

-- 🔒 A CREDENTIAL NEVER ACTS AS SOMEBODY ELSE. A child credential is never more
-- than its parent (`mcp-container-token.ts`), and this makes the widening the
-- word "subject" invites — a credential owned by A that reads as B — impossible
-- to store rather than merely absent from the minter.
ALTER TABLE mcp_tokens
  DROP CONSTRAINT IF EXISTS mcp_tokens_subject_is_owner_check;
ALTER TABLE mcp_tokens
  ADD CONSTRAINT mcp_tokens_subject_is_owner_check
  CHECK (subject_user_id IS NULL OR subject_user_id = user_id);

-- The dual-write guard: while both lanes exist they may not disagree, because a
-- disagreement is a fence with two answers and nothing would say which won.
-- ⚠ RETIRES WITH `workspace_id`, in B13, together with the column it names.
ALTER TABLE mcp_tokens
  DROP CONSTRAINT IF EXISTS mcp_tokens_axes_agree_check;
ALTER TABLE mcp_tokens
  ADD CONSTRAINT mcp_tokens_axes_agree_check
  CHECK (container_id IS NULL OR workspace_id IS NULL OR container_id = workspace_id);

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- A partially-applied file RAISEs here rather than shipping half an axis.
DO $$
DECLARE
  container_nullable BOOLEAN;
  subject_nullable   BOOLEAN;
  idx_exists         BOOLEAN;
  fk_action          TEXT;
  owner_check        TEXT;
  agree_check        TEXT;
  disagreeing        BIGINT;
BEGIN
  SELECT (is_nullable = 'YES') INTO container_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'mcp_tokens'
     AND column_name = 'container_id';
  SELECT (is_nullable = 'YES') INTO subject_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'mcp_tokens'
     AND column_name = 'subject_user_id';

  IF container_nullable IS NULL OR subject_nullable IS NULL THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: one or both columns were not created (container_id=%, subject_user_id=%)',
      COALESCE(container_nullable::TEXT, '(absent)'), COALESCE(subject_nullable::TEXT, '(absent)');
  END IF;

  -- NULLABLE IS LOAD-BEARING ON BOTH, AND THEY FAIL IN OPPOSITE DIRECTIONS.
  -- `container_id` NULL is "unfenced", the ordinary case. `subject_user_id` NULL
  -- is "nobody in particular", the RESTRICTIVE case. A NOT NULL on either would
  -- have required inventing a value that means the other thing.
  IF NOT container_nullable THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: container_id must be NULLABLE — NULL is "unfenced"';
  END IF;
  IF NOT subject_nullable THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: subject_user_id must be NULLABLE — NULL is "nobody in particular", the M-10 refusal';
  END IF;

  SELECT TRUE INTO idx_exists
    FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'mcp_tokens'
     AND indexname = 'mcp_tokens_container_idx';
  IF NOT COALESCE(idx_exists, FALSE) THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: mcp_tokens_container_idx is missing — the FK cascade would seq-scan';
  END IF;

  -- The cascade is what stops a deleted container leaving live credentials that
  -- name it behind — the same argument `mcp_tokens_workspace_idx` carries.
  SELECT rc.delete_rule INTO fk_action
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.table_schema
   WHERE tc.table_schema = 'public' AND tc.table_name = 'mcp_tokens'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'container_id';
  IF fk_action IS DISTINCT FROM 'CASCADE' THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: container_id FK delete rule is %, expected CASCADE', COALESCE(fk_action, '(no FK)');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO owner_check
    FROM pg_constraint
   WHERE conrelid = 'public.mcp_tokens'::regclass
     AND conname = 'mcp_tokens_subject_is_owner_check';
  IF owner_check IS NULL THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: the "subject is the owner" CHECK is missing — a credential could store somebody else''s reach';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO agree_check
    FROM pg_constraint
   WHERE conrelid = 'public.mcp_tokens'::regclass
     AND conname = 'mcp_tokens_axes_agree_check';
  IF agree_check IS NULL THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: the dual-write agreement CHECK is missing';
  END IF;

  -- 🔒 THE BACKFILL IS THE IDENTITY, ASSERTED IN BOTH DIRECTIONS. Every row must
  -- now answer the new predicate (`subject_user_id IS NULL`) exactly as it
  -- answers the old three-arm one. A row that disagrees is a row whose visibility
  -- changed as a side effect of a schema change, which is the thing
  -- `20260829120000` refused to do and this file must not do either.
  SELECT count(*) INTO disagreeing
    FROM mcp_tokens
   WHERE (subject_user_id IS NULL)
      <> (workspace_id IS NOT NULL AND workspace_lock_kind IS DISTINCT FROM 'container_session');
  IF disagreeing > 0 THEN
    RAISE EXCEPTION 'mcp_token_credential_axes: % row(s) answer the new axis differently from the legacy pair — the backfill is not the identity', disagreeing;
  END IF;
END $$;

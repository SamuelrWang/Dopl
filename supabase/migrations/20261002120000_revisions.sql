-- REVISIONS — ONE append-only history table for every resource that keeps one
-- (2026-09-09, the CHANGELOG lane, part 1; Samuel's design of the same day).
--
-- ⚠️ **WRITTEN, NOT APPLIED** — this directory's standing gate. Replay is OWED
-- and recorded rather than glossed (Docker is unavailable on the authoring
-- machine; CI's `rls-redteam` job is the replay, INVARIANTS §14).
--
-- 🔒 **APPLY IT BY NAME (`revisions`), NEVER BY FILENAME VERSION** (F-304's
-- re-stamp, INVARIANTS §12).
--
-- **APPLY ORDER: IMMEDIATELY AFTER `ontology_readable` (`20261001130000`)**,
-- which creates `dopl_ontology_readable()` — one of the two predicates the
-- SELECT policy below defers to. The other,
-- `dopl_knowledge_base_readable()`, has existed since `20260919120000` and was
-- last replaced by `20260923140000`.
--
-- ═══ WHAT ONE ROW IS ═══════════════════════════════════════════════════════
--
-- A row is ONE WRITE OPERATION against ONE resource, with the POST-WRITE
-- snapshot in `payload`. Not a keystroke, not a field-level delta, not a diff:
-- the diff is COMPUTED at read time from two snapshots (`revisions/lib/diff.ts`),
-- so a stored diff can never disagree with the body it claims to describe.
--
-- ⚠ **TWO SHAPES OF `payload`, ONE COLUMN, AND THE `resource_type` SAYS WHICH.**
-- Knowledge stores `{body, title, path}` — the whole document as it stood after
-- the write. Ontology (part 2, owed) stores `{field, before, after}` — the
-- HubSpot-shaped per-field history. They share this table because they share
-- every other column and every rule below; they do not share a payload schema,
-- and nothing may read one shape without first reading `resource_type`.
--
-- ═══ 🔒 APPEND-ONLY, WITH EXACTLY ONE NAMED EXCEPTION ══════════════════════
--
-- Nothing rewrites a revision and nothing deletes one. The single exception is
-- the HUMAN COALESCING WINDOW, and it is the reason `updated_at` exists at all:
-- a person typing into an entry produces one autosave PATCH every few seconds,
-- and a history that recorded each of them would be a keystroke log wearing the
-- word "revision". So consecutive `actor_kind='user'` + `op='edit'` writes by
-- the SAME user against the SAME resource REPLACE the open row's `payload`,
-- `content_hash` and `updated_at` while `now() - created_at < 5 minutes`;
-- `created_at` never moves, so the row keeps the moment the person STARTED.
-- The window's arithmetic lives in `src/features/revisions/server/service.ts`,
-- stated once — this file gives it a column to write and nothing else.
--
-- ⚠ **AN AGENT WRITE NEVER COALESCES**, in either direction: an agent's writes
-- are already ONE PER OPERATION (a `write_file` is a decision, not a keystroke),
-- and an agent write arriving inside a person's open window CLOSES it — the two
-- authors must never share a row. The rule is enforced in the service and
-- asserted there; the database's job here is only that both can be recorded.
--
-- ═══ 🔒 THE FENCE DEFERS; IT STATES NOTHING OF ITS OWN ═════════════════════
--
-- ONE SELECT policy, over ONE `SECURITY DEFINER` function
-- `dopl_revision_readable(resource_type, resource_id)`, whose whole body is a
-- `CASE` handing the question to the resource's OWN predicate. A revision is
-- readable exactly when the thing it is about is readable — never on its own
-- terms, and never by a rule restated here. A second statement of "who may read
-- a knowledge base" is how the two come to disagree, which is
-- `20260923140000` §3b's lesson taken before it can be re-learned.
--
-- ⚠ **A REVISION OF A DELETED RESOURCE READS AS INVISIBLE, AND THAT IS THE
-- FAIL-CLOSED DIRECTION.** Knowledge deletes are PERMANENT (no trash), so the
-- `EXISTS` arms below find nothing once the entry or folder is gone and the
-- policy answers false. The cost is a delete revision that no caller-scoped read
-- can see; the alternative — a rule that admits a row about a resource nobody
-- can point at any more — is a leak. Every read in the product today runs as
-- SERVICE ROLE and never meets this policy (INVARIANTS §2), so the SERVICE is
-- the fence and this is the phase-2 backstop for the day a revision read moves
-- to `readClient()` (`RLS_CALLER_SCOPED_READS`, off).
--
-- ⚠ **THE `CASE` HAS NO `ELSE` THAT ADMITS.** An unrecognised `resource_type` —
-- a type added to the CHECK and forgotten here — answers FALSE, the same
-- fail-closed reading `dopl_ontology_level_rank`'s `ELSE -1` takes.
--
-- ═══ 🔒 WRITES ARE SERVICE-ROLE ONLY ═══════════════════════════════════════
--
-- INSERT / UPDATE / DELETE are REVOKED from `authenticated` and `anon`, and no
-- write policy is created. PostgREST is a second door (this file's neighbours
-- learned that on `channel_resource_grants`), and an audit log a subject can
-- forge or erase with their own JWT is not an audit log. The only writer is the
-- service role, reached through
-- `src/features/revisions/server/repository.ts › appendRevision`.
--
-- ⚠ **AND THE APPEND IS AWAITED, NEVER FIRE-AND-FORGET.** A lost revision is a
-- lost audit, so its failure is the caller's error — the opposite choice from
-- `logMcpToolCall`'s `void`, and deliberately so: that one loses a usage tally,
-- this one loses the record that a document changed.
--
-- ═══ ⚠ NOT A REALTIME CHANGE ═══════════════════════════════════════════════
--
-- `revisions` is NOT added to `supabase_realtime` and must not be. History is
-- read on demand, per resource, behind an explicit request; a publication
-- membership would push every write in the workspace to every subscriber and
-- pay the per-subscriber policy evaluation for a surface nobody is watching
-- (INVARIANTS §7). The closing `DO $$` ASSERTS the absence rather than trusting
-- it.
--
-- ═══ ROLLBACK — PROSE, NOT COMMENTED-OUT SQL ═══════════════════════════════
--
-- Purely additive: one table, two indexes, one function, one policy, and no
-- change to any existing object. Rollback is `DROP POLICY
-- revisions_member_select ON public.revisions;` then `DROP FUNCTION
-- public.dopl_revision_readable(text, uuid);` then `DROP TABLE public.revisions;`
-- — in that order, because the policy calls the function and the function is
-- referenced only by it. ⚠ The DROP TABLE DESTROYS HISTORY and is not
-- reversible: dump the table first if the rollback is anything but a revert of
-- an unshipped deploy. Nothing else in the schema depends on this file, so a
-- rollback needs no other migration rolled back with it.

-- ── 1. The table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.revisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ⚠ THE VOCABULARY IS PINNED IN TS TOO — `revisions/types.ts ›
  -- REVISION_RESOURCE_TYPES`, asserted against this CHECK by
  -- `revisions/schema-sql.test.ts`. A type added on one side only is a row the
  -- other side cannot file or cannot read.
  resource_type TEXT NOT NULL CHECK (resource_type IN
                  ('knowledge_base','knowledge_folder','knowledge_entry',
                   'ontology_cluster','ontology_object')),
  resource_id   UUID NOT NULL,
  -- 🔒 THE RESOURCE'S container, never the actor's — `resource_grants`'s rule 3,
  -- for the same reason: an agent in a channel writes into a base that lives
  -- somewhere else, and a row filed under the WRITER's container would be
  -- invisible from the base it is the history of.
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- ⚠ NULLABLE, and `ON DELETE SET NULL`: a deleted account must not take the
  -- history of everything it wrote with it. The row survives its author.
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user','agent')),
  -- The desktop's session slot key (`X-Dopl-Session-Id`), verbatim, for an agent
  -- write; NULL for every human one and for an agent that sent none. It is what
  -- makes the changelog GROUP a session's writes visually.
  -- ⚠ A NON-AUTHORIZATION SIGNAL and the one forgeable field on the row
  -- (`shared/auth/session-header.ts`). Nothing may grant on it and no policy
  -- reads it.
  agent_session_id TEXT,
  op            TEXT NOT NULL CHECK (op IN
                  ('create','edit','section_edit','rename','move','delete','restore')),
  summary       TEXT,
  -- Post-write snapshot. Knowledge: `{body, title, path}`. Ontology (part 2):
  -- `{field, before, after}`. See the header.
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- SHA-256 of the snapshot's content, so "did this write change anything" is
  -- answerable without hauling two bodies.
  content_hash  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ⚠ EQUALS `created_at` ON EVERY SEALED ROW. It moves only inside the human
  -- coalescing window — see the header.
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Indexes, one named statement each ───────────────────────────────────
--
-- ⚠ TWO READS, TWO INDEXES, AND NEITHER COVERS THE OTHER. The per-resource
-- history is `WHERE resource_type = $1 AND resource_id = $2 ORDER BY created_at
-- DESC` — the keyset page an entry's own history walks. The base ROLL-UP asks a
-- whole container's rows in time order and narrows in the service to the base's
-- own resource ids, so its leading column is `workspace_id`.
CREATE INDEX IF NOT EXISTS revisions_resource_idx
  ON public.revisions (resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS revisions_workspace_idx
  ON public.revisions (workspace_id, created_at DESC);

-- ── 3. The read rule, written ONCE, as a CASE that defers ──────────────────
CREATE OR REPLACE FUNCTION public.dopl_revision_readable(
  p_resource_type text,
  p_resource_id   uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_resource_type
           WHEN 'knowledge_base' THEN
             public.dopl_knowledge_base_readable(p_resource_id)
           WHEN 'knowledge_folder' THEN
             EXISTS (
               SELECT 1 FROM public.knowledge_folders f
                WHERE f.id = p_resource_id
                  AND public.dopl_knowledge_base_readable(f.knowledge_base_id)
             )
           WHEN 'knowledge_entry' THEN
             EXISTS (
               SELECT 1 FROM public.knowledge_entries e
                WHERE e.id = p_resource_id
                  AND public.dopl_knowledge_base_readable(e.knowledge_base_id)
             )
           WHEN 'ontology_cluster' THEN
             public.dopl_ontology_readable(p_resource_id)
           WHEN 'ontology_object' THEN
             EXISTS (
               SELECT 1
                 FROM public.dopl_ontology_object_clusters(p_resource_id) AS cid
                WHERE public.dopl_ontology_readable(cid)
             )
           -- 🔒 An unrecognised type admits nobody.
           ELSE false
         END;
$function$;

COMMENT ON FUNCTION public.dopl_revision_readable(text, uuid) IS
  'A revision is readable exactly when the resource it is about is readable. States no rule of its own — every arm defers to that resource''s own predicate.';

-- ⚠ NO caller-supplied SUBJECT anywhere in the signature, so `authenticated`
-- may hold EXECUTE (the `dopl_grant_admits` / `dopl_ontology_readable` shape).
-- A function here that ever grows a `p_user_id` must lose that grant in the
-- same change (`20260930140000`'s rule).
REVOKE ALL ON FUNCTION public.dopl_revision_readable(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dopl_revision_readable(text, uuid)
  TO authenticated, service_role;

-- ── 4. RLS — one SELECT policy, no write policy ────────────────────────────
ALTER TABLE public.revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS revisions_member_select ON public.revisions;
CREATE POLICY revisions_member_select ON public.revisions
  FOR SELECT
  USING (public.dopl_revision_readable(resource_type, resource_id));

-- 🔒 The only writer is the service role. See the header.
REVOKE INSERT, UPDATE, DELETE ON public.revisions FROM authenticated, anon;

-- ── 5. Verification (INVARIANTS §12) ───────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  IF to_regclass('public.revisions') IS NULL THEN
    RAISE EXCEPTION 'revisions was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relnamespace = 'public'::regnamespace
       AND relname = 'revisions'
       AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'revisions does not have ROW LEVEL SECURITY enabled — every policy on it would be inert';
  END IF;

  -- 🔒 EXACTLY ONE SELECT POLICY, AND NO WRITE POLICY AT ALL. Permissive
  -- policies are OR-ed, so a second one is a widening no per-policy check sees
  -- (`check-rls-pair-gate.ts` check 3, asserted here at apply time too).
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'revisions' AND cmd = 'SELECT';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 SELECT policy on revisions, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'revisions' AND cmd <> 'SELECT';
  IF n <> 0 THEN
    RAISE EXCEPTION 'revisions has % write polic(ies) — the audit log has exactly one writer, the service role', n;
  END IF;

  -- 🔒 The fence DEFERS. A policy that stopped calling the function would keep
  -- its name and its shape while meaning nothing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'revisions'
       AND policyname = 'revisions_member_select'
       AND qual LIKE '%dopl_revision_readable%'
  ) THEN
    RAISE EXCEPTION 'revisions_member_select no longer reaches dopl_revision_readable()';
  END IF;

  -- 🔒 And the function defers in turn — to BOTH resource families. An arm that
  -- restated a visibility rule instead of calling it is the failure this file's
  -- header is about.
  IF (SELECT count(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname = 'dopl_revision_readable'
         AND prosecdef
         AND prosrc LIKE '%dopl_knowledge_base_readable%'
         AND prosrc LIKE '%dopl_ontology_readable%') <> 1 THEN
    RAISE EXCEPTION 'dopl_revision_readable is missing, is not SECURITY DEFINER, or stopped deferring to a resource predicate';
  END IF;

  -- Both indexes, by name — a read plan is not a fact until the index exists.
  IF (SELECT count(*) FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'revisions'
         AND indexname IN ('revisions_resource_idx', 'revisions_workspace_idx')) <> 2 THEN
    RAISE EXCEPTION 'a revisions index is missing';
  END IF;

  -- ⚠ NOT a realtime change, asserted rather than trusted.
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'revisions'
  ) THEN
    RAISE EXCEPTION 'revisions joined supabase_realtime — history is pulled per resource, never pushed (INVARIANTS §7)';
  END IF;

  RAISE NOTICE 'revisions: table + 2 indexes + 1 deferring SELECT policy created; writes are service-role only; not in realtime';
END $$;

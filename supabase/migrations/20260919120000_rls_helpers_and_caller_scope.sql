-- ============================================================================
-- RLS PHASE 1 — the policy becomes the fence for the first three knowledge
-- tables (Wave B slice B7 / `v2/b-rls-real-1`; Samuel's ruling B5)
-- ============================================================================
--
-- ⚠ NEVER APPLIED. Docker is down on the authoring machine (`docker info`
-- fails), so `supabase start` could not run and this file has NOT been replayed
-- against a database. It is written to be idempotent and to be applied with the
-- rest of Wave B's migrations, after Wave A's seven, which are also unapplied.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------------
-- Every knowledge read runs on the SERVICE-ROLE client, which bypasses RLS, so
-- the SELECT policies on these tables have never decided anything. Each
-- visibility rule is therefore written TWICE — once as a TS predicate that is
-- the real fence, once as a policy that runs nowhere — and the two have drifted
-- in the WIDE direction. Measured against `523bfc92`, the live SELECT policy on
-- all three tables is
--
--     is_current_workspace_member(workspace_id, 'viewer')
--     AND (visibility = 'public' OR created_by = auth.uid())
--
-- (`20260720211005_rls_pin_workspace_member_and_initplan.sql`), while the TS
-- fence — `knowledge/server/service-shared.ts › canSeeBase` +
-- `assertBaseVisible` / `filterTeamVisibleBases` — refuses TWO further cases:
--
--   1. **A SHARED CREDENTIAL READING A PRIVATE ROW.** `canSeeBase`'s middle arm
--      (`isSharedCredential(ctx) → false`) is M-10: a credential standing for
--      NOBODY IN PARTICULAR inherits no one person's reach, so `created_by =
--      auth.uid()` is not enough on its own. The policy had no way to ask,
--      because a service-role read carries no credential axes. It does now: the
--      minted caller JWT states them (`shared/supabase/caller-jwt.ts`).
--   2. **A TEAMS-MODE ROW WITH NO GRANT.** `access_mode = 'teams'` narrows a row
--      to the teams it was granted to (plus admin/owner, plus its creator);
--      `assertBaseVisible` and `filterTeamVisibleBases` enforce it, the policy
--      did not mention it at all.
--
-- Both are policy-WIDER-than-predicate, i.e. exactly the shape that becomes a
-- leak the moment a read moves off the service role. This migration closes both
-- and writes the rule ONCE, in `dopl_knowledge_base_readable()`, which the three
-- policies call.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES *NOT* DO
-- ---------------------------------------------------------------------------
-- * **No policy is deleted.** Every SELECT policy below keeps its NAME and is
--   replaced in place (the `DROP … IF EXISTS` + `CREATE` idiom this repo already
--   uses for policy edits). A policy is the record of a leak that was once
--   possible — `20260716150000` is the standing example — and tenancy risk 1
--   says they are corrected, never removed.
-- * **No TS predicate is deleted.** The predicates stay until the flag has been
--   on for a release; a later slice (B16) deletes each one behind its own green
--   redteam test.
-- * **INSERT / UPDATE / DELETE policies are untouched.** Writes stay on the
--   service role until RLS plan phase 4. Only the read half moves here.
-- * **The AGENT AUDIENCE CEILING is NOT in these policies** (`service-audience.ts
--   › resolveAgentAudience`, layer A). It is a per-REQUEST ceiling keyed on the
--   container's kind, its live member count and a session-scoped narrowing
--   header, not a property of the row; folding it in would put a forgeable
--   narrowing input into a policy. It remains a TS fence and MUST NOT be deleted
--   by the slice that deletes `canSeeBase`. Recorded as F-524.
--
-- ---------------------------------------------------------------------------
-- ⚠ CROSS-SLICE, AND IT HAPPENED: `dopl_teams_mode_visible()` was written
-- against `team_resource_access`, which slice B1 DROPS in
-- `20260916120000_drop_team_resource_access`. That is why the team arm is a
-- FUNCTION and not an inline EXISTS in three policies — the repair is ONE
-- `CREATE OR REPLACE` and no policy moves. Applied at the Wave B batch-1
-- integration (F-468/F-525): the body below reads `resource_grants` with
-- `scope_type = 'team'`.
-- ⚠ THE `scope_type` TERM IS NOT OPTIONAL. Without it this helper would answer
-- "is this teams-mode resource visible to me" with a CHANNEL grant on the same
-- resource — a room's audience silently becoming a workspace-wide read, through
-- a function whose name says nothing about scopes.
-- ⚠ `LANGUAGE sql` IS WHY THIS COULD NOT BE LEFT: Postgres parses the body at
-- CREATE time, so the unrepaired version aborts the replay outright rather than
-- failing on first call. `knowledge/schema-sql.test.ts` — "no migration AFTER
-- the drop mentions a dropped table" — is the gate, and it was red on the merged
-- tree before this edit.
--
-- ⚠ PERFORMANCE. `dopl_knowledge_base_readable()` is SECURITY DEFINER, so the
-- planner will not inline it: it is one indexed lookup per candidate row (PK on
-- `knowledge_bases`, `resource_grants_resource_idx`, `team_members_user_idx`
-- — all present). The RLS plan's "measure with realistic data" gate applies at
-- rollout; the flag is the mitigation if it does not hold.
--
-- ROLLBACK: turn `RLS_CALLER_SCOPED_READS` off — every read returns to the
-- service-role client and no policy below is consulted. To revert the SQL
-- itself, recreate the three `*_member_select` policies with the two-arm bodies
-- quoted above.
-- ============================================================================


-- ===========================================================================
-- STEP 1 — the credential axis (`credential-audience.ts › isSharedCredential`)
-- ===========================================================================
-- ⚠ AN ABSENT CLAIM READS AS "NOT SHARED", and that is the correct default, not
-- a lax one: the only token that reaches a policy without `dopl_credential` is a
-- GoTrue session token, and a session IS a person — `isSharedCredential`'s first
-- arm answers `false` for exactly that case. Every token minted by
-- `caller-jwt.ts` states the axis explicitly.
-- ⚠ THE CLAIM NAME IS THE CONTRACT, shared with `caller-jwt.ts ›
-- DOPL_CREDENTIAL_CLAIM`.
-- ⚠ `SET search_path` ON A SECURITY INVOKER FUNCTION, ADDED 2026-09-02 IN REVIEW.
-- Both bodies are already fully schema-qualified (`auth.jwt()`,
-- `public.dopl_credential_is_shared()`), so nothing here was resolvable to a
-- caller's own schema — but these two were the only helpers in this file
-- WITHOUT the setting, which makes them the two the Supabase advisor
-- (`function_search_path_mutable`, 0011) flags and the two a reader has to
-- reason about individually. Uniform is cheaper than argued.
CREATE OR REPLACE FUNCTION public.dopl_credential_is_shared()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    ((SELECT auth.jwt()) -> 'dopl_credential' ->> 'shared')::boolean,
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_credential_is_shared() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_credential_is_shared() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_credential_is_shared() TO service_role;


-- ===========================================================================
-- STEP 2 — M-10 visibility (`service-shared.ts › canSeeBase`), one for one
-- ===========================================================================
--   public                        -> true
--   private via a SHARED credential -> false
--   private                       -> creator only
CREATE OR REPLACE FUNCTION public.dopl_can_see_visibility(
  p_visibility text,
  p_created_by uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_temp
AS $function$
  SELECT
    p_visibility = 'public'
    OR (
      NOT public.dopl_credential_is_shared()
      AND p_created_by = (SELECT auth.uid())
    );
$function$;

REVOKE ALL ON FUNCTION public.dopl_can_see_visibility(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_can_see_visibility(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_can_see_visibility(text, uuid) TO service_role;


-- ===========================================================================
-- STEP 3 — the teams axis (`teams/server/access.ts › effectiveResourceAccess`,
-- the VISIBILITY half: is the effective level non-null?)
-- ===========================================================================
--   admin/owner                     -> visible ('edit', before any grant)
--   creator                         -> visible (role ceiling)
--   a grant on one of the caller's teams -> visible
--   otherwise                       -> invisible
--
-- ⚠ THE GUEST ARM IS NOT MISSING, IT IS UPSTREAM. `defaultLevelForRole('guest')`
-- is `null` — a guest holds nothing on any shareable resource — and every policy
-- below already floors at `is_current_workspace_member(…, 'viewer')`, which a
-- guest fails by rank (`20260825140000_guest_role.sql`: guest = -1, viewer = 0).
-- Restating it here would be a second copy of the same refusal.
--
-- ⚠ SECURITY DEFINER: `team_members` / `team_resource_access` carry their own
-- viewer+ SELECT policies, and a nested policy evaluation is both slower and a
-- second place for the answer to change.
CREATE OR REPLACE FUNCTION public.dopl_teams_mode_visible(
  p_workspace_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_created_by uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    public.is_current_workspace_member(p_workspace_id, 'admin')
    OR p_created_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.resource_grants g
      JOIN public.team_members tm
        ON tm.team_id = g.scope_id
       AND tm.workspace_id = g.workspace_id
      WHERE g.scope_type    = 'team'
        AND g.workspace_id  = p_workspace_id
        AND g.resource_type = p_resource_type
        AND g.resource_id   = p_resource_id
        AND tm.user_id      = (SELECT auth.uid())
    );
$function$;

REVOKE ALL ON FUNCTION public.dopl_teams_mode_visible(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_teams_mode_visible(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_teams_mode_visible(uuid, text, uuid, uuid) TO service_role;


-- ===========================================================================
-- STEP 4 — THE RULE, WRITTEN ONCE
-- ===========================================================================
-- "May the caller read this knowledge base?" — membership, then M-10, then the
-- teams axis. The three policies in STEP 5 are this function applied to the row
-- itself (`knowledge_bases`) or to the row's parent (`knowledge_folders`,
-- `knowledge_entries`), which is precisely how the TS side composes it: every
-- entry and folder read goes through `service-bases.ts › getBaseById`.
--
-- ⚠ THE PARENT LOOKUP IS THE WHOLE POINT FOR THE CHILD TABLES. The 2026-08-26
-- incident (INVARIANTS §4, `GET /api/knowledge/entries/[entryId]`) was a route
-- that checked the workspace and not the base — "you need the id" was never the
-- fence, because ontology attributes ship raw entry-id arrays. A child policy
-- that asked only `is_current_workspace_member` would reintroduce it in the
-- database.
CREATE OR REPLACE FUNCTION public.dopl_knowledge_base_readable(p_base_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.knowledge_bases kb
    WHERE kb.id = p_base_id
      AND public.is_current_workspace_member(kb.workspace_id, 'viewer')
      AND public.dopl_can_see_visibility(kb.visibility, kb.created_by)
      AND (
        kb.access_mode IS DISTINCT FROM 'teams'
        OR public.dopl_teams_mode_visible(
             kb.workspace_id, 'knowledge_base', kb.id, kb.created_by
           )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_knowledge_base_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_knowledge_base_readable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_knowledge_base_readable(uuid) TO service_role;


-- ===========================================================================
-- STEP 5 — the three SELECT policies, repaired in place
-- ===========================================================================
-- ⚠ SAME NAMES, SAME cmd, SAME (default) ROLES as the policies they replace, so
-- policy TOPOLOGY does not move and the `canSee*` ↔ policy pair gate
-- (`scripts/check-rls-pair-gate.ts`) keeps finding its twin.
-- ⚠ `deleted_at` IS DELIBERATELY ABSENT. Soft-delete is a repository filter, not
-- a visibility rule — the trash views read deleted rows on purpose — and a
-- policy that hid them would break restore for every caller at once.

-- ---- knowledge_bases -------------------------------------------------------
DROP POLICY IF EXISTS knowledge_bases_member_select ON knowledge_bases;
CREATE POLICY knowledge_bases_member_select ON knowledge_bases
  FOR SELECT
  USING (public.dopl_knowledge_base_readable(id));

-- ---- knowledge_folders -----------------------------------------------------
-- The workspace arm is kept ahead of the parent lookup: it is the cheap,
-- indexed half, and it states the tenancy fence on the row itself.
DROP POLICY IF EXISTS knowledge_folders_member_select ON knowledge_folders;
CREATE POLICY knowledge_folders_member_select ON knowledge_folders
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND public.dopl_knowledge_base_readable(knowledge_base_id)
  );

-- ---- knowledge_entries -----------------------------------------------------
DROP POLICY IF EXISTS knowledge_entries_member_select ON knowledge_entries;
CREATE POLICY knowledge_entries_member_select ON knowledge_entries
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND public.dopl_knowledge_base_readable(knowledge_base_id)
  );


-- ===========================================================================
-- STEP 6 — indexes the policies filter on (RLS plan phase 1)
-- ===========================================================================
-- ⚠ Both of the team-side indexes already exist (`20260611020000_teams.sql`), as
-- does the `knowledge_bases` PK. What is NOT indexed today is the child tables'
-- parent column on its own, which every child policy now joins on.
CREATE INDEX IF NOT EXISTS knowledge_folders_base_idx
  ON knowledge_folders (knowledge_base_id);
CREATE INDEX IF NOT EXISTS knowledge_entries_base_idx
  ON knowledge_entries (knowledge_base_id);


-- ===========================================================================
-- VERIFICATION (INVARIANTS §12 — record the command, never the answer)
-- ===========================================================================
--   SELECT policyname, qual FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('knowledge_bases','knowledge_folders','knowledge_entries')
--      AND cmd = 'SELECT';
--   -- and, for the caller lane, that PostgREST can reach the tables at all:
--   SELECT has_table_privilege('authenticated', 'public.knowledge_bases', 'SELECT');

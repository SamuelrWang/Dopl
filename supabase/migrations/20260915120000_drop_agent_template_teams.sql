-- DROP `agent_template_teams` — the third shape of one sentence.
-- Wave B slice B1, second of three. Requires `20260914120000_resource_grants`.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ═══ WHAT GOES, AND WHAT EXPLICITLY DOES NOT ════════════════════════════════
--
-- ⚠ **TEAM VISIBILITY ON A TEMPLATE SURVIVES THIS FILE.** Ruling B4 retires the
-- team AXIS, not the team CAPABILITY: `agent_templates.visibility = 'team'` is
-- untouched, `TemplateVisibility` keeps three values, and
-- `packages/mcp-server/src/tools/agent-team-axis.test.ts` keeps passing. What
-- goes is the dedicated junction — the rows move to
-- `resource_grants(scope_type='team', resource_type='agent_template',
-- level='read')`, backfilled by the previous migration.
--
-- `20260822200000` §2 split this table off `team_resource_access` on purpose
-- (F-277) for two reasons, and both are answered rather than overruled:
--   1. *"a `level` column that is always `'read'` is a field that will
--      eventually be believed."* It still is `'read'`, and now the CHECK says
--      so: `resource_grants_level_check` admits only `read|edit` on a team
--      scope, and the template WRITE path stays creator-or-workspace-admin. The
--      field is not new information; it is the same information the junction
--      encoded by existing.
--   2. *"joining that table means widening `TeamResourceType`"* — a union with
--      four consumers outside that lane (`RESOURCE_TABLES`,
--      `listTeamsModeResources`, `member-bits.tsx › RESOURCE_META`, the
--      hand-copied mirror in `members-render.ts`). ⚠ **THAT UNION IS NOT
--      WIDENED.** `TeamResourceType` still names four types; `resource_grants`
--      accepts five, and the teams repository reads its four by an explicit
--      `resource_type` filter. The type that would have rendered through an
--      undefined lookup never reaches those consumers.
--   Measured 0 rows on production 2026-09-02 (findings-tenancy §1), so the
--   backfill is a formality on this tree and a correctness requirement on any
--   other.
--
-- ═══ 🔒 THE POLICY ARM WAS WRITTEN THREE TIMES; IT IS NOW WRITTEN ONCE ══════
--
-- `20260822200000` §4 restated the whole `canSeeTemplate` matrix in each of
-- three SELECT policies — deliberately ("RESTATED, NOT NESTED"), because RLS on
-- a table referenced INSIDE a policy is not applied, so nesting would not have
-- worked. One of the three tables is being dropped here, and the remaining two
-- copies are collapsed into `can_current_user_read_agent_template(uuid)`: a
-- SECURITY DEFINER, STABLE predicate that is the single statement of the matrix.
-- The arm order is preserved exactly, admin arm included —
--   creator → always · workspace → any active member · team → an admin OR a
--   member of a linked team · private → nobody else
-- — so the API and the database still agree, which is the property
-- `20260716150000` exists to protect.
-- ⚠ SECURITY DEFINER is what makes the collapse legal: the function runs as the
-- table owner, which bypasses RLS, so the inner read of `agent_templates` cannot
-- recurse into the policy that calls it. Same mechanism as
-- `is_current_workspace_member` (`20260720211005` STEP 1).
--
-- ═══ APPLY / VERIFY / REPLAY ═══════════════════════════════════════════════
--
-- ⚠ **THE BEHAVIOURAL PROBES ARE OWED, NOT RUN** — no database on this branch.
-- Owed, all inside `BEGIN; … ROLLBACK;`, as the caller (`SET LOCAL ROLE
-- authenticated` + a request JWT), three per policy branch:
--   P1  creator reads own `private` template                → 1 row
--   P2  a second member reads that `private` template       → 0 rows
--   P3  an ADMIN reads someone's `private` template         → 0 rows (tighter
--       than `chats_member_select` on purpose — see `20260822200000` §4)
--   P4  any active member reads a `workspace` template      → 1 row
--   P5  a `guest` reads a `workspace` template              → 0 rows
--   P6  a member of a linked team reads a `team` template   → 1 row
--   P7  a member of NO linked team reads it                 → 0 rows
--   P8  an admin reads a `team` template                    → 1 row
--   P9  P6 after DELETEing the `resource_grants` row        → 0 rows
--   P10 the same nine against `agent_template_knowledge_bases`, whose policy is
--       now the same predicate applied to `template_id`
--   P11 `SELECT … FROM agent_template_teams`                → 42P01 (gone)
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS THE GATE (INVARIANTS §12), OWED.
-- ⚠ NEW FILE — never an edit to an applied migration.
--
-- ROLLBACK (prose). Re-run `20260822200000` §2 (the table, its three indexes,
-- `assert_agent_template_team_workspace` and its trigger), re-insert from
-- `resource_grants WHERE scope_type='team' AND resource_type='agent_template'`,
-- then re-create the three SELECT policies with the bodies quoted in that file
-- and `DROP FUNCTION can_current_user_read_agent_template(uuid);`. ⚠ ORDERING
-- TRAP: `20260914120000`'s backfill reads this table, so reverting THIS file
-- without also reverting that one leaves the grants standing and the junction
-- empty — re-insert before re-creating the policies, or team templates go dark
-- for their teams (and stay visible to their admins, which reads as a partial
-- outage rather than an error).

-- ── 1. The matrix, stated once ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_current_user_read_agent_template(
  p_template_id uuid
) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM agent_templates t
     WHERE t.id = p_template_id
       AND is_current_workspace_member(t.workspace_id, 'viewer'::text)
       AND (
         t.created_by = (SELECT auth.uid())
         OR t.visibility = 'workspace'
         OR (
           t.visibility = 'team'
           AND (
             -- ⚠ THE ADMIN ARM IS INSIDE THE 'team' BRANCH, NOT ABOVE IT: an
             -- admin administers the SHARING of a team template and has no read
             -- of someone else's PRIVATE one. Moving it out is a widening.
             is_current_workspace_member(t.workspace_id, 'admin'::text)
             OR EXISTS (
               SELECT 1
                 FROM resource_grants g
                 JOIN team_members tm ON tm.team_id = g.scope_id
                WHERE g.scope_type    = 'team'
                  AND g.resource_type = 'agent_template'
                  AND g.resource_id   = t.id
                  AND tm.user_id      = (SELECT auth.uid())
             )
           )
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.can_current_user_read_agent_template(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_current_user_read_agent_template(uuid) FROM anon;
-- The policies below call it as the QUERYING role, so `authenticated` needs it.
GRANT EXECUTE ON FUNCTION public.can_current_user_read_agent_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_current_user_read_agent_template(uuid) TO service_role;

-- ── 2. The two surviving policies, re-stated onto the predicate ─────────────
DROP POLICY IF EXISTS agent_templates_member_select ON public.agent_templates;
CREATE POLICY agent_templates_member_select ON public.agent_templates
  FOR SELECT
  USING (public.can_current_user_read_agent_template(id));

-- A knowledge-base link is readable exactly when its template is.
DROP POLICY IF EXISTS agent_template_knowledge_bases_member_select
  ON public.agent_template_knowledge_bases;
CREATE POLICY agent_template_knowledge_bases_member_select
  ON public.agent_template_knowledge_bases
  FOR SELECT
  USING (public.can_current_user_read_agent_template(template_id));

-- ── 3. The junction goes ────────────────────────────────────────────────────
-- Its own policy first: a policy is a dependency of the table it names, and
-- dropping the table under it is what `DROP … CASCADE` would paper over.
DROP POLICY IF EXISTS agent_template_teams_member_select ON public.agent_template_teams;
DROP TABLE IF EXISTS public.agent_template_teams;
-- Its trigger went with the table; the function it named did not.
DROP FUNCTION IF EXISTS public.assert_agent_template_team_workspace();

-- ── 4. Assert the outcome instead of trusting it (INVARIANTS §12) ──────────
--   SELECT to_regclass('public.agent_template_teams');
--   SELECT policyname, qual FROM pg_policies
--     WHERE tablename IN ('agent_templates','agent_template_knowledge_bases');
DO $$
BEGIN
  IF to_regclass('public.agent_template_teams') IS NOT NULL THEN
    RAISE EXCEPTION 'agent_template_teams still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace
                AND proname = 'assert_agent_template_team_workspace') THEN
    RAISE EXCEPTION 'assert_agent_template_team_workspace still exists';
  END IF;

  -- 🔒 Both surviving policies must go through the ONE predicate. A policy that
  -- still spells the matrix inline is a second copy, which is the defect this
  -- file closes.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename IN ('agent_templates','agent_template_knowledge_bases')
       AND cmd = 'SELECT'
       AND qual::text NOT LIKE '%can_current_user_read_agent_template%'
  ) THEN
    RAISE EXCEPTION 'an agent-template SELECT policy still states the matrix inline';
  END IF;

  -- Writes stay service-role only, exactly as `20260822200000` §4 left them.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename IN ('agent_templates','agent_template_knowledge_bases')
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'a non-SELECT policy appeared on the agent-template tables';
  END IF;

  RAISE NOTICE 'agent_template_teams dropped; the visibility matrix is stated once, in can_current_user_read_agent_template()';
END $$;

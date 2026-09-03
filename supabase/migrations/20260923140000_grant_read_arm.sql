-- THE READ HALF OF A GRANT (F-604) — `dopl_grant_admits()`, and the arm it adds
-- to the two readable predicates. Wave B batch 3, integration.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ═══ WHAT WAS MISSING ═══════════════════════════════════════════════════════
--
-- Ruling B11: **grants replace copies.** B15 deleted the copy ops and shipped
-- the WRITE door — `dopl_kb(op="grant")`, `dopl_agent(op="grant")`, and /home's
-- "Share into this channel" — which files a `resource_grants` row. Nothing read
-- it back. A lent row still lives in the grantor's container as `private` and
-- created-by-them, so in the scope it was lent TO both the TypeScript predicate
-- and its policy twin refused it. **The write door wrote correct rows that no
-- reader honoured**, which F-604 records as the one incomplete seam of B15.
--
-- ⚠ **THE `channel` × `knowledge_base` LANE WAS THE EXCEPTION AND ALREADY
-- WORKED**, through `knowledge/server/repository-audience.ts`, which reads the
-- grants directly for the AGENT audience ceiling. That is a different question
-- with a different level rule (see below) and it is untouched here.
--
-- ═══ ONE FUNCTION, BECAUSE IT IS ONE SENTENCE ═══════════════════════════════
--
-- *"Somebody may reach this resource through that scope."* `dopl_grant_admits`
-- is that sentence for the CALLER, and its TypeScript twin is
-- `src/shared/tenancy/resource-grant-reach.ts › grantedResourceIds`. Both are
-- reused by knowledge and by agent templates rather than copied into each —
-- the shape `20260919120000` established with `dopl_teams_mode_visible()` and
-- the one §5A's "ONE RULE WRITTEN TWICE" warning is about.
--
-- ═══ 🔒 TWO SCOPES HERE, AND THE THIRD IS SOMEWHERE ELSE ON PURPOSE ═════════
--
-- `channel` and `container`. **`team` returns FALSE from this function**, and
-- that is not an omission: the team axis is already an arm of
-- `dopl_teams_mode_visible()`, reached through `access_mode = 'teams'` /
-- `visibility = 'team'`. Answering it twice would be two rules for one grant,
-- and the copy that rots is always the second. Ruling B4 made team a SCOPE, not
-- a second mechanism; A8 took it off the MCP surface entirely.
--
-- ═══ 🔒 LEVEL IS TWO VOCABULARIES, NOT ONE LADDER ═══════════════════════════
--
--   * `container` carries `read | edit` — **both admit reading.**
--   * `channel`   carries `agent_only | visible` — two AUDIENCES, not a
--     high/low pair (`20260827120000`). **Only `visible` names a HUMAN
--     audience**, so `agent_only` must not widen a person's read. That is
--     exactly the split `resource_grants_member_select` already makes about the
--     grant ROW's own existence, and the INVERSE of the one
--     `listGrantedBaseIdsForChannels` makes for the AGENT's ceiling, where both
--     levels count. Three lanes over one table, each naming its audience.
--
-- ═══ 🔒 NO `workspace_id` TERM, AND THAT IS THE POINT ═══════════════════════
--
-- A grant row is filed under the RESOURCE's container (`20260914120000` rule 3)
-- while the caller reaches it through the SCOPE's. A `workspace_id` predicate
-- here would refuse precisely the cross-container lend this function exists to
-- honour. The membership tests below are the fence, and they are the CALLER's.
--
-- ⚠ THE ARM IS AN `OR` BESIDE THE MEMBERSHIP GROUP, not a term inside it, for
-- the same reason: the grantee is typically NOT a member of the resource's
-- container, so an arm under `is_current_workspace_member` would be unreachable.
--
-- ═══ 🔒 …BUT IT IS NOT AT THE TOP — TWO ARMS STAND ABOVE IT ════════════════
--
-- The TypeScript twins are the specification, and both refuse before they ever
-- reach the grant (`knowledge › canSeeBase` arm 2, `agent-templates ›
-- canSeeTemplate` arm 2):
--
--   1. **A SHARED CREDENTIAL IS NEVER WIDENED BY A GRANT.** It stands for
--      nobody in particular, so it has no membership of the granted scope to
--      read the grant THROUGH. Written here as
--      `NOT public.dopl_credential_is_shared() AND public.dopl_grant_admits(…)`
--      — the conjunct is the arm-2 refusal, restated where the arm is.
--      ⚠ Without it the policy admitted what its twin refuses, which is the
--      exact divergence the redteam suites exist to catch.
--   2. **THE TEAMS GATE STILL APPLIES TO A LENT ROW** (knowledge only). Its
--      twin is `assertBaseVisible`, which runs `canSeeBase` AND THEN the
--      teams-mode check, and `filterTeamVisibleBases` drops a teams-mode base
--      the caller holds no level on however it became visible. So the gate is
--      AND-ed over the whole readable group rather than restated inside each
--      arm — one statement, and a grant cannot route around it.
--
-- ⚠ SECURITY DEFINER, matching `dopl_teams_mode_visible()`: `resource_grants`
-- carries its own SELECT policy and a nested policy evaluation is both slower
-- and a second place for the answer to change.
--
-- ═══ IDEMPOTENT ════════════════════════════════════════════════════════════
--
-- Three `CREATE OR REPLACE FUNCTION`s and no DDL. The two predicates are
-- re-stated WHOLE rather than wrapped, because a wrapper would be a third place
-- the matrix lives; every arm they had is below, unchanged, with one `OR`
-- added. **No policy moves**, so policy topology is untouched and the
-- `canSee*` ↔ policy pair gate keeps finding its twins — the payoff B1 and B12
-- bought by making each matrix a function.
--
-- ROLLBACK: re-run `20260919120000` STEP 4 and `20260921120000` STEP 4, then
-- `DROP FUNCTION public.dopl_grant_admits(text, uuid);`.
--
-- ⚠ PROBES OWED ON REPLAY (F-461's list grows by four, P21-P24):
--   P21  container grant, caller is a member of the scope    → row visible
--   P22  container grant, caller is NOT                      → invisible
--   P23  channel grant at `agent_only`, caller in the channel→ invisible
--   P24  the same row at `visible`                           → visible
--   P25  ANY grant, read through a SHARED credential          → invisible
-- The live halves of `rls-redteam.test.ts` (knowledge, agent_templates) are
-- these five; `RLS_REDTEAM_LIVE=1` in CI is what pays them.

-- ── 1. The sentence, once ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dopl_grant_admits(
  p_resource_type text,
  p_resource_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.resource_grants g
     WHERE g.resource_type = p_resource_type
       AND g.resource_id   = p_resource_id
       AND CASE g.scope_type
             WHEN 'container' THEN
               public.is_current_workspace_member(g.scope_id, 'viewer')
             WHEN 'channel' THEN
               g.level = 'visible' AND public.is_channel_member(g.scope_id)
             ELSE false
           END
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_grant_admits(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dopl_grant_admits(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dopl_grant_admits(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_grant_admits(text, uuid) TO service_role;


-- ── 2. knowledge_bases — `20260919120000` STEP 4, plus arm 4 ────────────────
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
      -- `canSeeBase`: membership + M-10, OR the grant — and the grant carries
      -- arm 2's refusal with it, because a shared credential reaches no scope.
      AND (
        (
          public.is_current_workspace_member(kb.workspace_id, 'viewer')
          AND public.dopl_can_see_visibility(kb.visibility, kb.created_by)
        )
        OR (
          NOT public.dopl_credential_is_shared()
          AND public.dopl_grant_admits('knowledge_base', kb.id)
        )
      )
      -- `assertBaseVisible`'s SECOND question, AND-ed over both arms exactly as
      -- the TypeScript asks it: a lent row in teams mode still needs a level.
      AND (
        kb.access_mode IS DISTINCT FROM 'teams'
        OR public.dopl_teams_mode_visible(
             kb.workspace_id, 'knowledge_base', kb.id, kb.created_by
           )
      )
  );
$function$;


-- ── 3. agent_templates — `20260921120000` STEP 4, plus arm 4 ────────────────
CREATE OR REPLACE FUNCTION public.can_current_user_read_agent_template(
  p_template_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.agent_templates t
     WHERE t.id = p_template_id
       AND (
         (
           public.is_current_workspace_member(t.workspace_id, 'viewer'::text)
           AND (
             t.visibility = 'workspace'
             OR (
               NOT public.dopl_credential_is_shared()
               AND (
                 t.created_by = (SELECT auth.uid())
                 OR (
                   t.visibility = 'team'
                   AND public.dopl_teams_mode_visible(
                         t.workspace_id, 'agent_template', t.id, t.created_by
                       )
                 )
               )
             )
           )
         )
         -- Arm 4, and arm 2 travels with it: `canSeeTemplate` refuses a shared
         -- credential BEFORE it consults the grant set.
         OR (
           NOT public.dopl_credential_is_shared()
           AND public.dopl_grant_admits('agent_template', t.id)
         )
       )
  );
$function$;


-- ── 4. Verification (INVARIANTS §12) ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = 'dopl_grant_admits'
  ) THEN
    RAISE EXCEPTION 'dopl_grant_admits was not created';
  END IF;
  -- Both predicates must REACH it, or this migration shipped a helper nothing
  -- calls and the grant is still a recorded intent.
  IF (SELECT count(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('dopl_knowledge_base_readable',
                         'can_current_user_read_agent_template')
         AND prosrc LIKE '%dopl_grant_admits%') <> 2 THEN
    RAISE EXCEPTION 'a readable predicate does not call dopl_grant_admits';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- `enforce_resource_grant()` GAINS THE TWO ARMS IT WAS MISSING, AND LOSES THE
-- ONE THAT BLOCKED A USER DELETE (F-583, F-584)
-- Wave B, batch-2 review. 2026-09-02.
--
-- ⚠ **WHY A SEPARATE FILE AND NOT AN EDIT TO `20260914120000`.** The share test
-- below needs the TEAMS axis for a NAMED user, and the only statement of that
-- axis lives in `20260919120000 › dopl_teams_mode_visible` — five versions
-- LATER in apply order. Writing it into `…0914` would have meant a second copy
-- of the rule, which is the defect this wave spent B12 removing. So the rule is
-- generalised here, once, and `dopl_teams_mode_visible` becomes the caller-
-- scoped case of it.
--
-- ═══ F-583 — THE GRANTOR ARM ASKED THE WRONG QUESTION ═══════════════════════
--
-- `…0914` §4 arm 4 asked only `is_workspace_member(res_ws, NEW.created_by,
-- 'viewer')` — "is the grantor in the resource's container at all". It never
-- asked the resource's OWN question. So a bare `viewer` of a container could
-- file a grant lending out a **`private` knowledge base they cannot read**, a
-- **`teams`-mode skill no team of theirs holds**, or a **`private` agent
-- template belonging to someone else — and `resource_grants` IS the fence those
-- readers consult (`dopl_teams_mode_visible`, `listGrantedBaseIdsForChannels`).
-- A row that no reader may create is not a row a writer may file.
--
-- TWO CHANGES, and each is one half of the ruling:
--   1. **AN EDIT-CAPABLE RANK.** `'member'` (rank 1) rather than `'viewer'`
--      (rank 0) on the RESOURCE side — lending a resource out is an edit to who
--      may reach it, and a read-only member of a container may not make it. The
--      SCOPE side stays at `'viewer'`: lending INTO a room you can see is not an
--      edit to that room.
--   2. **THE RESOURCE'S OWN VISIBILITY TEST**, per type, for the GRANTOR rather
--      than for the caller — {@link dopl_user_may_share_resource}.
--
-- ⚠ **THE SHARED-CREDENTIAL AXIS IS DELIBERATELY ABSENT HERE.** `M-10`'s
-- `dopl_credential_is_shared()` asks about the TOKEN IN THE REQUEST; this asks
-- about a `created_by` uuid recorded on a row, possibly long ago. There is no
-- credential to interrogate, and inventing one would make the answer depend on
-- who happens to be re-saving the grant.
--
-- ═══ F-584 — THE SAME ARM MADE `ON DELETE SET NULL` UNDELETABLE ═════════════
--
-- `resource_grants.created_by` is `UUID REFERENCES auth.users(id) ON DELETE SET
-- NULL`. Deleting the user therefore fires this BEFORE UPDATE trigger with
-- `NEW.created_by IS NULL`, which takes the unattributed branch — and that
-- branch RAISEs for a CROSS-CONTAINER grant, the one shape B4 exists to unlock.
-- **So a single legal cross-container grant made the grantor's account
-- undeletable**, with `P0001 … may not cross containers` out of a `DELETE FROM
-- auth.users`. The row was valid when written; a de-attribution is not a
-- re-grant, and re-validating one is asking a question nobody posed.
--
-- The skip is narrow on purpose: UPDATE only, `created_by` going NOT NULL →
-- NULL, and **every other column identical**. A statement that de-attributes
-- and moves the grant in one breath is a re-grant and is validated as one.
--
-- ═══ APPLY / VERIFY / REPLAY ════════════════════════════════════════════════
--
-- Idempotent: `CREATE OR REPLACE` throughout, `DROP TRIGGER IF EXISTS` before
-- the `CREATE TRIGGER`. Depends on `20260919120000` (the teams axis) and
-- `20260914120000` (the table). The commands, not their answers:
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('dopl_teams_visible_for_user','dopl_teams_mode_visible',
--                      'dopl_user_may_share_resource','enforce_resource_grant');
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.resource_grants'::regclass AND NOT tgisinternal;
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS OWED, NOT RUN: Docker is
-- unavailable on this machine. F-461's behavioural probes are still owed and
-- this file adds to them:
--   P15 a `viewer` of the KB's container grants a `public` KB   → 42501-free INSERT refused, P0001 grantor … not edit-capable
--   P16 a `member` grants a `private` KB they did NOT create    → P0001 grantor … may not share this resource
--   P17 a `member` grants a `private` KB they DID create        → INSERT succeeds
--   P18 a `teams`-mode skill, grantor on no holding team        → P0001 may not share this resource
--   P19 DELETE the grantor of a live CROSS-CONTAINER grant      → succeeds, row survives with created_by NULL
--   P20 UPDATE that NULLs created_by AND moves `level`          → validated as a re-grant (P0001)
--
-- ROLLBACK (prose). `CREATE OR REPLACE` the three functions with the bodies
-- `20260914120000` §4 and `20260919120000` STEP 3 carry. Doing so re-opens both
-- defects; no data is touched either way.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The teams axis, said once, for ANY user ──────────────────────────────
-- ⚠ THE BODY IS `20260919120000` STEP 3's, with `(SELECT auth.uid())` lifted
-- into a parameter. Nothing else moved: same three arms, same order, same
-- SECURITY DEFINER (the reason is unchanged — `team_members` carries its own
-- viewer+ policy and a nested evaluation is both slower and a second place for
-- the answer to change).
CREATE OR REPLACE FUNCTION public.dopl_teams_visible_for_user(
  p_user_id       uuid,
  p_workspace_id  uuid,
  p_resource_type text,
  p_resource_id   uuid,
  p_created_by    uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT
    public.is_workspace_member(p_workspace_id, p_user_id, 'admin')
    OR p_created_by = p_user_id
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
        AND tm.user_id      = p_user_id
    );
$function$;

REVOKE ALL ON FUNCTION public.dopl_teams_visible_for_user(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_teams_visible_for_user(uuid, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_teams_visible_for_user(uuid, uuid, text, uuid, uuid) TO service_role;

-- ── 2. …and the caller-scoped case becomes one line over it ─────────────────
-- ⚠ SAME NAME, SAME SIGNATURE, SAME ANSWER — every policy that calls it is
-- untouched, and the pair gate still finds its twins. What changes is that
-- there is now ONE statement of the axis instead of two that could drift.
-- ⚠ `is_current_workspace_member` is NOT what the admin arm becomes: that
-- function reads the caller's own JWT, and this one must answer for whichever
-- user id it was handed. `is_workspace_member(ws, auth.uid(), …)` is the same
-- question asked the way this file can ask it.
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
  SELECT public.dopl_teams_visible_for_user(
    (SELECT auth.uid()), p_workspace_id, p_resource_type, p_resource_id, p_created_by
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_teams_mode_visible(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dopl_teams_mode_visible(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_teams_mode_visible(uuid, text, uuid, uuid) TO service_role;

-- ── 3. 🔒 "May THIS user lend THIS resource out?" ───────────────────────────
-- Rank + the resource's own visibility, per resource type. The five branches
-- are the five `canSee*` matrices, asked about a named user:
--   * `knowledge_base` / `skill`  — `created_by`, `private|public`, `access_mode`
--   * `chat`                      — `owner_id`  (the one column that differs)
--   * `chat_folder`               — `user_id`   (and the second)
--   * `agent_template`            — its own vocabulary, `workspace|team|private`,
--                                   and no `access_mode` at all
-- ⚠ AN UNKNOWN TYPE ANSWERS `false`, not NULL: the trigger's own CASE already
-- RAISEs on an unsupported `resource_type`, and a NULL here would make the
-- grantor arm skip rather than refuse if that ever stopped being true.
CREATE OR REPLACE FUNCTION public.dopl_user_may_share_resource(
  p_user_id       uuid,
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
    WHEN 'knowledge_base' THEN EXISTS (
      SELECT 1 FROM public.knowledge_bases r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.created_by = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'knowledge_base', r.id, r.created_by))
    )
    WHEN 'skill' THEN EXISTS (
      SELECT 1 FROM public.skills r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.created_by = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'skill', r.id, r.created_by))
    )
    WHEN 'chat' THEN EXISTS (
      SELECT 1 FROM public.chats r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.owner_id = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'chat', r.id, r.owner_id))
    )
    WHEN 'chat_folder' THEN EXISTS (
      SELECT 1 FROM public.chat_folders r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.user_id = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'chat_folder', r.id, r.user_id))
    )
    WHEN 'agent_template' THEN EXISTS (
      SELECT 1 FROM public.agent_templates r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (
           r.visibility = 'workspace'
           OR r.created_by = p_user_id
           OR (r.visibility = 'team'
               AND public.dopl_teams_visible_for_user(
                     p_user_id, r.workspace_id, 'agent_template', r.id, r.created_by))
         )
    )
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.dopl_user_may_share_resource(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dopl_user_may_share_resource(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dopl_user_may_share_resource(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_user_may_share_resource(uuid, text, uuid) TO service_role;

-- ── 4. 🔒 The validity trigger, with both arms repaired ─────────────────────
-- Steps 1–3 are `20260914120000` §4 verbatim; steps 0 and 4 are this file.
CREATE OR REPLACE FUNCTION public.enforce_resource_grant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  scope_ws UUID;
  res_ws   UUID;
BEGIN
  -- 0. 🔒 DE-ATTRIBUTION IS NOT A RE-GRANT (F-584). `created_by` is ON DELETE
  --    SET NULL, so deleting the grantor's account re-enters this trigger with
  --    a NULL author and, for a legal CROSS-CONTAINER grant, RAISEs on step 4's
  --    unattributed branch — making the account undeletable. Narrow on purpose:
  --    UPDATE only, NOT NULL → NULL, everything else identical.
  IF TG_OP = 'UPDATE'
     AND OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND (NEW.scope_type, NEW.scope_id, NEW.resource_type, NEW.resource_id,
          NEW.workspace_id, NEW.level, NEW.guest_write)
         IS NOT DISTINCT FROM
         (OLD.scope_type, OLD.scope_id, OLD.resource_type, OLD.resource_id,
          OLD.workspace_id, OLD.level, OLD.guest_write)
  THEN
    RETURN NEW;
  END IF;

  -- 1. The scope exists, and resolves to a container.
  CASE NEW.scope_type
    WHEN 'channel'   THEN SELECT workspace_id INTO scope_ws FROM channels   WHERE id = NEW.scope_id;
    WHEN 'container' THEN SELECT id           INTO scope_ws FROM workspaces WHERE id = NEW.scope_id;
    WHEN 'team'      THEN SELECT workspace_id INTO scope_ws FROM teams      WHERE id = NEW.scope_id;
    ELSE RAISE EXCEPTION 'resource_grants: unsupported scope_type %', NEW.scope_type;
  END CASE;
  IF scope_ws IS NULL THEN
    RAISE EXCEPTION 'resource_grants: % % does not exist', NEW.scope_type, NEW.scope_id;
  END IF;

  -- 2. The resource exists.
  CASE NEW.resource_type
    WHEN 'knowledge_base' THEN SELECT workspace_id INTO res_ws FROM knowledge_bases WHERE id = NEW.resource_id;
    WHEN 'agent_template' THEN SELECT workspace_id INTO res_ws FROM agent_templates WHERE id = NEW.resource_id;
    WHEN 'skill'          THEN SELECT workspace_id INTO res_ws FROM skills          WHERE id = NEW.resource_id;
    WHEN 'chat'           THEN SELECT workspace_id INTO res_ws FROM chats           WHERE id = NEW.resource_id;
    WHEN 'chat_folder'    THEN SELECT workspace_id INTO res_ws FROM chat_folders    WHERE id = NEW.resource_id;
    ELSE RAISE EXCEPTION 'resource_grants: unsupported resource_type %', NEW.resource_type;
  END CASE;
  IF res_ws IS NULL THEN
    RAISE EXCEPTION 'resource_grants: % % does not exist', NEW.resource_type, NEW.resource_id;
  END IF;

  -- 3. The row is filed under the RESOURCE's container.
  IF res_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'resource_grants: resource workspace mismatch (grant=%, resource=%)',
      NEW.workspace_id, res_ws;
  END IF;

  -- 4. 🔒 The grantor may reach both sides. Unattributed rows keep the old
  --    same-container rule — reach across containers is bought with an author.
  --    ⚠ THE RESOURCE SIDE IS NOW TWO QUESTIONS, NOT ONE (F-583): an
  --    EDIT-CAPABLE rank, and the resource's own visibility test. The scope
  --    side stays at `viewer` — lending INTO a room you can see is not an edit
  --    to that room.
  IF NEW.created_by IS NULL THEN
    IF scope_ws <> res_ws THEN
      RAISE EXCEPTION 'resource_grants: an unattributed grant may not cross containers (resource=%, scope=%)',
        res_ws, scope_ws;
    END IF;
  ELSIF NOT is_workspace_member(res_ws, NEW.created_by, 'member') THEN
    RAISE EXCEPTION 'resource_grants: grantor % is not edit-capable in container %',
      NEW.created_by, res_ws;
  ELSIF NOT dopl_user_may_share_resource(NEW.created_by, NEW.resource_type, NEW.resource_id) THEN
    RAISE EXCEPTION 'resource_grants: grantor % may not share % %',
      NEW.created_by, NEW.resource_type, NEW.resource_id;
  ELSIF NOT is_workspace_member(scope_ws, NEW.created_by, 'viewer') THEN
    RAISE EXCEPTION 'resource_grants: grantor % may not share into container %',
      NEW.created_by, scope_ws;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.enforce_resource_grant() FROM anon, authenticated;

DROP TRIGGER IF EXISTS resource_grant_validity_check ON public.resource_grants;
CREATE TRIGGER resource_grant_validity_check
  BEFORE INSERT OR UPDATE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_resource_grant();

-- ── 5. Assert the outcome instead of trusting it (INVARIANTS §12) ───────────
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'enforce_resource_grant';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'enforce_resource_grant missing';
  END IF;
  IF v_src NOT LIKE '%dopl_user_may_share_resource%' THEN
    RAISE EXCEPTION 'enforce_resource_grant does not call the share test';
  END IF;
  IF v_src NOT LIKE '%is not edit-capable%' THEN
    RAISE EXCEPTION 'enforce_resource_grant kept the viewer floor';
  END IF;
  IF to_regprocedure('public.dopl_teams_visible_for_user(uuid,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'dopl_teams_visible_for_user missing';
  END IF;
END $$;

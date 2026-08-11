-- Fix assert_team_grant_workspace(): its ELSE branch still reads the dropped
-- `workflows` table (2026-08-11).
--
-- WHAT WAS LEFT BEHIND. The trigger function was last redefined by
-- 20260708150001_skill_team_sharing.sql, which grew explicit branches for
-- knowledge_base / chat / chat_folder / skill and left `workflow` — the
-- ORIGINAL and at the time only other case — sitting in the ELSE fallback as
-- `SELECT workspace_id FROM workflows WHERE id = NEW.resource_id`.
-- 20260811120000_drop_workflows_and_clusters.sql then dropped `workflows`. The
-- function body was never touched, so its ELSE branch now names a relation that
-- does not exist.
--
-- WHY IT HAS NOT FIRED. plpgsql resolves table references at first EXECUTION of
-- a branch, not at CREATE, so the function is still installable and every
-- INSERT/UPDATE on team_resource_access that names one of the four live
-- resource types runs fine and always has. The dead branch is reachable only by
-- a row whose resource_type is neither of those four — i.e. `'workflow'`, which
-- the CHECK constraint deliberately still ACCEPTS (see the drop migration: the
-- value was kept rather than rewriting a constraint three migrations extended,
-- once the rows were purged). Such a row would fail with a bare
-- `relation "workflows" does not exist` — a Postgres internal, not a statement
-- about the grant, in a trigger whose entire job is to explain why a grant is
-- invalid.
--
-- THE FIX IS THE ELSE BRANCH AND NOTHING ELSE. The four real branches are
-- reproduced VERBATIM from the deployed definition, as are the three RAISEs,
-- LANGUAGE plpgsql, the (non-DEFINER) security context and
-- `SET search_path TO 'public'`. The ELSE now RAISEs instead of querying, which
-- is the correct answer for a resource_type this function cannot resolve a
-- workspace for: it names the type, it fails closed, and it stops being one
-- more reference to a table that is gone.
--
-- NO TRIGGER CHANGE. `team_grant_workspace_check` (20260611020000_teams.sql)
-- already points at this function by name; CREATE OR REPLACE keeps it bound.
-- The REVOKE is re-asserted because REPLACE resets nothing but a fresh CREATE
-- on a new database would otherwise inherit the default PUBLIC EXECUTE
-- (advisor 0028/0029), exactly as the original migration argued.

CREATE OR REPLACE FUNCTION assert_team_grant_workspace() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE team_ws UUID; res_ws UUID;
BEGIN
  SELECT workspace_id INTO team_ws FROM teams WHERE id = NEW.team_id;
  IF NEW.resource_type = 'knowledge_base' THEN
    SELECT workspace_id INTO res_ws FROM knowledge_bases WHERE id = NEW.resource_id;
  ELSIF NEW.resource_type = 'chat' THEN
    SELECT workspace_id INTO res_ws FROM chats WHERE id = NEW.resource_id;
  ELSIF NEW.resource_type = 'chat_folder' THEN
    SELECT workspace_id INTO res_ws FROM chat_folders WHERE id = NEW.resource_id;
  ELSIF NEW.resource_type = 'skill' THEN
    SELECT workspace_id INTO res_ws FROM skills WHERE id = NEW.resource_id;
  ELSE
    RAISE EXCEPTION 'team_resource_access: unknown resource_type %', NEW.resource_type;
  END IF;
  IF team_ws IS NULL THEN
    RAISE EXCEPTION 'team_resource_access: team % does not exist', NEW.team_id;
  END IF;
  IF res_ws IS NULL THEN
    RAISE EXCEPTION 'team_resource_access: % % does not exist', NEW.resource_type, NEW.resource_id;
  END IF;
  IF team_ws <> NEW.workspace_id OR res_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'team_resource_access: workspace mismatch (grant=%, team=%, resource=%)', NEW.workspace_id, team_ws, res_ws;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.assert_team_grant_workspace() FROM anon, authenticated;

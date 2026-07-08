-- Skill team sharing — skills adopt the full KB/chat three-way model:
--
--   private   → visibility 'private'                          (owner only)
--   team      → visibility 'public' + access_mode 'teams'     (granted teams)
--   workspace → visibility 'public' + access_mode 'workspace' (everyone)
--
-- This RETIRES the M-10 "once public, always public" rule for skills:
-- sharing becomes fully re-scopable (owner or workspace admin), same as
-- knowledge bases and chats.
--
-- 1. skills.access_mode mirrors knowledge_bases.access_mode. DEFAULT
--    'workspace' is the backfill: every already-public skill keeps its
--    workspace-wide reach, nothing hides.
-- 2. team_resource_access.resource_type learns 'skill'.
-- 3. assert_team_grant_workspace() resolves the skill's workspace for
--    the consistency backstop.
-- 4. Grants are cleaned on hard delete (trash purge) via trigger.
--
-- RLS note: skills_member_select stays (public OR owner) — team scoping
-- is enforced in the service layer, matching how KB and chat team modes
-- work today. Realtime events only trigger refetches through the
-- service-filtered API, so team-mode rows don't leak through reads.

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'workspace'
    CHECK (access_mode IN ('workspace', 'teams'));

ALTER TABLE team_resource_access
  DROP CONSTRAINT team_resource_access_resource_type_check;
ALTER TABLE team_resource_access
  ADD CONSTRAINT team_resource_access_resource_type_check
  CHECK (resource_type IN ('knowledge_base', 'workflow', 'chat', 'chat_folder', 'skill'));

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
    SELECT workspace_id INTO res_ws FROM workflows WHERE id = NEW.resource_id;
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

-- Hard-deleting a skill (trash purge) must drop its grants — skills are
-- normally soft-deleted, but purge removes rows for good.
CREATE OR REPLACE FUNCTION drop_skill_grants() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM team_resource_access
  WHERE resource_type = 'skill' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS skill_grants_cleanup ON skills;
CREATE TRIGGER skill_grants_cleanup AFTER DELETE ON skills
  FOR EACH ROW EXECUTE FUNCTION drop_skill_grants();

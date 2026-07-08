-- Chat team sharing — chats adopt the KB sharing model:
--
--   private   → visibility 'private'                    (owner only)
--   team      → visibility 'public' + access_mode 'teams'    (granted teams)
--   workspace → visibility 'public' + access_mode 'workspace' (everyone)
--
-- 1. chats.access_mode mirrors knowledge_bases.access_mode. DEFAULT
--    'workspace' is the backfill: every already-public chat keeps its
--    workspace-wide reach, nothing hides.
-- 2. team_resource_access.resource_type learns 'chat'. Grants are
--    read-level only in practice (chats are owner-edited), but the
--    column CHECK stays shared with KBs/workflows.
-- 3. assert_team_grant_workspace() resolves the chat's workspace for
--    the consistency backstop, same as KBs and workflows.

ALTER TABLE chats ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'workspace'
  CHECK (access_mode IN ('workspace','teams'));

ALTER TABLE team_resource_access
  DROP CONSTRAINT team_resource_access_resource_type_check;
ALTER TABLE team_resource_access
  ADD CONSTRAINT team_resource_access_resource_type_check
  CHECK (resource_type IN ('knowledge_base','workflow','chat'));

CREATE OR REPLACE FUNCTION assert_team_grant_workspace() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE team_ws UUID; res_ws UUID;
BEGIN
  SELECT workspace_id INTO team_ws FROM teams WHERE id = NEW.team_id;
  IF NEW.resource_type = 'knowledge_base' THEN
    SELECT workspace_id INTO res_ws FROM knowledge_bases WHERE id = NEW.resource_id;
  ELSIF NEW.resource_type = 'chat' THEN
    SELECT workspace_id INTO res_ws FROM chats WHERE id = NEW.resource_id;
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

-- Deleting a chat must drop its grants (KBs/workflows get this from
-- their own delete paths; chats delete rows directly).
CREATE OR REPLACE FUNCTION drop_chat_grants() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM team_resource_access
  WHERE resource_type = 'chat' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS chat_grants_cleanup ON chats;
CREATE TRIGGER chat_grants_cleanup AFTER DELETE ON chats
  FOR EACH ROW EXECUTE FUNCTION drop_chat_grants();

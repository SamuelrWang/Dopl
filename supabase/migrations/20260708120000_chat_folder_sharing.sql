-- Chat folder sharing — the folder's scope is authoritative for its chats.
--
--   private   → visibility 'private'                         (owner only)
--   team      → visibility 'public' + access_mode 'teams'    (granted teams)
--   workspace → visibility 'public' + access_mode 'workspace' (everyone)
--
-- Model (enforced in the service layer):
--   1. A chat filed in a folder INHERITS the folder's scope — on move,
--      on export-into-folder, and whenever the folder's scope changes
--      (propagated to every member chat).
--   2. Sharing a filed chat directly is rejected; the caller is told to
--      change the folder's scope or unfile the chat. No mixed folders.
--   3. Unfiling keeps the chat's current scope (no silent unshare).
--   4. Folders stay personal: non-owners never see folder structure.
--      Folder scope is a bulk sharing policy, not shared browsing.
--
-- Chat grants stay materialized per-chat (team_resource_access rows with
-- resource_type 'chat'), so the chat read model is unchanged. Folder
-- grants ('chat_folder') are the policy source the per-chat rows are
-- propagated from.

ALTER TABLE chat_folders
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'workspace'
    CHECK (access_mode IN ('workspace', 'teams'));

ALTER TABLE team_resource_access
  DROP CONSTRAINT team_resource_access_resource_type_check;
ALTER TABLE team_resource_access
  ADD CONSTRAINT team_resource_access_resource_type_check
  CHECK (resource_type IN ('knowledge_base', 'workflow', 'chat', 'chat_folder'));

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

-- Deleting a folder must drop its grants (same pattern as chats).
CREATE OR REPLACE FUNCTION drop_chat_folder_grants() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM team_resource_access
  WHERE resource_type = 'chat_folder' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS chat_folder_grants_cleanup ON chat_folders;
CREATE TRIGGER chat_folder_grants_cleanup AFTER DELETE ON chat_folders
  FOR EACH ROW EXECUTE FUNCTION drop_chat_folder_grants();

-- Backfill: establish the invariant. Every existing folder starts
-- private (the column default), so every filed chat is aligned to
-- private and its per-chat grants are dropped. Nothing in production
-- has shared filed chats today; if one existed, its owner re-shares by
-- setting the folder's scope.
UPDATE chats c
SET visibility = f.visibility, access_mode = f.access_mode
FROM chat_folders f
WHERE c.folder_id = f.id
  AND (c.visibility <> f.visibility OR c.access_mode <> f.access_mode);

DELETE FROM team_resource_access tra
USING chats c
WHERE tra.resource_type = 'chat'
  AND tra.resource_id = c.id
  AND c.folder_id IS NOT NULL;

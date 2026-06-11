-- Teams: named member groups inside a workspace that carry resource access
-- grants for knowledge bases and workflows.
--
-- Access model:
--   * knowledge_bases.access_mode / workflows.access_mode:
--       'workspace' (default) -> every active member, level by role default
--       'teams'               -> only teams with a grant row (owner/admin and
--                                the resource creator always retain edit)
--   * team_resource_access holds per-team grants (read|edit); a member's
--     effective level on a teams-mode resource is the max across their teams.
--   * Enforcement happens in the service layer (all reads go through
--     supabaseAdmin). RLS on knowledge_bases/workflows is intentionally NOT
--     extended with team predicates in v1.
--
-- Also: last_seen_at activity tracking on workspace_members, and
-- workspace_invitation_teams so invites can pre-assign teams.
--
-- Additive and deploy-safe: access_mode defaults to 'workspace', so nothing
-- changes visibility until an admin explicitly scopes a resource.

-- 1. teams
CREATE TABLE IF NOT EXISTS teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description   TEXT,
  color         TEXT,
  icon          TEXT,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_workspace_name_key ON teams (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS teams_workspace_idx ON teams (workspace_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_member_select ON teams FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY teams_admin_write ON teams FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid(), 'admin'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'admin'));

-- 2. team_members
CREATE TABLE IF NOT EXISTS team_members (
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members (workspace_id, user_id);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_member_select ON team_members FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY team_members_admin_write ON team_members FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid(), 'admin'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'admin'));

-- 3. team_resource_access — per-team grants. resource_id is polymorphic
--    (knowledge_bases.id or workflows.id), consistency enforced by trigger.
CREATE TABLE IF NOT EXISTS team_resource_access (
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('knowledge_base','workflow')),
  resource_id   UUID NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('read','edit')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS team_resource_access_resource_idx
  ON team_resource_access (workspace_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS team_resource_access_team_idx
  ON team_resource_access (workspace_id, team_id);

ALTER TABLE team_resource_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_resource_access_member_select ON team_resource_access FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY team_resource_access_admin_write ON team_resource_access FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid(), 'admin'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'admin'));

-- 4. access_mode columns. DEFAULT 'workspace' is the backfill: nothing hides.
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'workspace'
  CHECK (access_mode IN ('workspace','teams'));
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'workspace'
  CHECK (access_mode IN ('workspace','teams'));

-- 5. last-active tracking
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 6. invitation -> team pre-assignment (junction, not uuid[]: deleted teams
--    cascade off pending invites automatically).
CREATE TABLE IF NOT EXISTS workspace_invitation_teams (
  invitation_id UUID NOT NULL REFERENCES workspace_invitations(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (invitation_id, team_id)
);
-- service-role only: RLS on, no policies.
ALTER TABLE workspace_invitation_teams ENABLE ROW LEVEL SECURITY;

-- 7. Consistency backstop triggers (pattern: assert_workflow_kb_workspace).
CREATE OR REPLACE FUNCTION assert_team_member_workspace() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE team_ws UUID;
BEGIN
  SELECT workspace_id INTO team_ws FROM teams WHERE id = NEW.team_id;
  IF team_ws IS NULL THEN
    RAISE EXCEPTION 'team_members: team % does not exist', NEW.team_id;
  END IF;
  IF team_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'team_members: workspace mismatch (junction=%, team=%)', NEW.workspace_id, team_ws;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = NEW.workspace_id
      AND m.user_id = NEW.user_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'team_members: user % is not an active member of workspace %', NEW.user_id, NEW.workspace_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS team_member_workspace_check ON team_members;
CREATE TRIGGER team_member_workspace_check BEFORE INSERT OR UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION assert_team_member_workspace();

CREATE OR REPLACE FUNCTION assert_team_grant_workspace() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE team_ws UUID; res_ws UUID;
BEGIN
  SELECT workspace_id INTO team_ws FROM teams WHERE id = NEW.team_id;
  IF NEW.resource_type = 'knowledge_base' THEN
    SELECT workspace_id INTO res_ws FROM knowledge_bases WHERE id = NEW.resource_id;
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
DROP TRIGGER IF EXISTS team_grant_workspace_check ON team_resource_access;
CREATE TRIGGER team_grant_workspace_check BEFORE INSERT OR UPDATE ON team_resource_access
  FOR EACH ROW EXECUTE FUNCTION assert_team_grant_workspace();

-- 8. Cleanup: member leaves workspace -> drop their team memberships.
--    (No FK between team_members and workspace_members; covers every delete
--    path, unlike the manual cleanup pattern used for workspace_resource_access.)
CREATE OR REPLACE FUNCTION delete_member_team_rows() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM team_members
   WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS member_removed_team_cleanup ON workspace_members;
CREATE TRIGGER member_removed_team_cleanup AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION delete_member_team_rows();

-- 9. Grant GC: workflows hard-delete -> purge their grants. KB soft-delete
--    intentionally does NOT purge grants (restore keeps access; rows are inert
--    while deleted_at is set because resolution joins live resources).
CREATE OR REPLACE FUNCTION delete_workflow_team_grants() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM team_resource_access
   WHERE resource_type = 'workflow' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS workflow_deleted_grant_cleanup ON workflows;
CREATE TRIGGER workflow_deleted_grant_cleanup AFTER DELETE ON workflows
  FOR EACH ROW EXECUTE FUNCTION delete_workflow_team_grants();

-- 10. Trigger functions never need direct EXECUTE from API roles
--     (delete_member_team_rows is SECURITY DEFINER — advisor 0028/0029).
REVOKE EXECUTE ON FUNCTION public.delete_member_team_rows() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_team_member_workspace() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_team_grant_workspace() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_workflow_team_grants() FROM anon, authenticated;

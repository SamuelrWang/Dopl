-- Team-aware SELECT policies for chats + chat_messages.
--
-- The original member-select policies (20260707170000_chats.sql) predate
-- team scoping: they let ANY workspace member read `visibility='public'`
-- rows even when `access_mode='teams'`, so a team-restricted transcript
-- leaks to non-granted members via direct PostgREST / realtime — bypassing
-- the service-layer `canSeeChat` gate (chats/server/service-shared.ts).
--
-- These policies mirror `canSeeChat` exactly:
--   * owner            -> always (kept in the separate chats_owner_select).
--   * workspace admin  -> always (is_workspace_member(..,'admin')).
--   * public+workspace -> any active member (is_workspace_member(..,'viewer')).
--   * public+teams     -> active member who belongs to a team holding a
--                         'chat' grant on the row (team_resource_access
--                         joined to team_members for auth.uid()).
-- The API-key conservatism in canSeeChat is service-layer only; RLS runs
-- under auth.uid() (session / realtime), which has no shared-credential path.

DROP POLICY IF EXISTS chats_member_select_public ON chats;
CREATE POLICY chats_member_select ON chats
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'admin')
    OR (
      visibility = 'public'
      AND access_mode = 'workspace'
      AND is_workspace_member(workspace_id, auth.uid(), 'viewer')
    )
    OR (
      visibility = 'public'
      AND access_mode = 'teams'
      AND is_workspace_member(workspace_id, auth.uid(), 'viewer')
      AND EXISTS (
        SELECT 1
        FROM team_resource_access tra
        JOIN team_members tm ON tm.team_id = tra.team_id
        WHERE tra.resource_type = 'chat'
          AND tra.resource_id = chats.id
          AND tm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_messages.chat_id
        AND (
          c.owner_id = auth.uid()
          OR is_workspace_member(c.workspace_id, auth.uid(), 'admin')
          OR (
            c.visibility = 'public'
            AND c.access_mode = 'workspace'
            AND is_workspace_member(c.workspace_id, auth.uid(), 'viewer')
          )
          OR (
            c.visibility = 'public'
            AND c.access_mode = 'teams'
            AND is_workspace_member(c.workspace_id, auth.uid(), 'viewer')
            AND EXISTS (
              SELECT 1
              FROM team_resource_access tra
              JOIN team_members tm ON tm.team_id = tra.team_id
              WHERE tra.resource_type = 'chat'
                AND tra.resource_id = c.id
                AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

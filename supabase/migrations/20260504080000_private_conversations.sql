-- Private conversations — dedicated /[workspaceSlug]/chat page.
--
-- The dedicated chat page is private to the calling user (other workspace
-- members must NOT see these conversations). Canvas chats stay
-- workspace-shared as today. We model the split with a `visibility`
-- column on the existing `conversations` table:
--
--   • visibility = 'workspace' (default, existing rows) — visible to any
--     workspace member with viewer+ role. Same behaviour as before.
--   • visibility = 'private' — visible/writable only to the row's
--     `user_id` (still scoped to a workspace, so deleting the workspace
--     cascades cleanly).
--
-- Private chats also carry an optional `scope_filters` jsonb so the
-- per-chat scope picker (which clusters / KBs / skills the assistant is
-- allowed to read) can be persisted per-conversation. NULL = search all.
--
-- chat_attachments mirrors visibility so per-attachment RLS matches.

-- ════════════════════════════════════════════════════════════════════
-- 1. conversations.visibility + scope_filters
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('workspace', 'private'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS scope_filters JSONB;

CREATE INDEX IF NOT EXISTS conversations_user_visibility_idx
  ON conversations (user_id, visibility)
  WHERE visibility = 'private';

-- ════════════════════════════════════════════════════════════════════
-- 2. RLS — replace the workspace-only policies with visibility-aware ones
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS conversations_member_select ON conversations;
DROP POLICY IF EXISTS conversations_editor_insert ON conversations;
DROP POLICY IF EXISTS conversations_editor_update ON conversations;
DROP POLICY IF EXISTS conversations_editor_delete ON conversations;

-- SELECT: workspace rows visible to any member; private rows visible
-- only to the owner (still scoped to the workspace so a non-member
-- can never read).
CREATE POLICY conversations_select ON conversations
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      visibility = 'workspace'
      OR (visibility = 'private' AND user_id = auth.uid())
    )
  );

-- INSERT: must be a workspace member, no impersonation. Private rows
-- can be created by any member (viewer+); workspace rows still require
-- 'member' (write role).
CREATE POLICY conversations_insert ON conversations
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      visibility = 'private'
      OR is_workspace_member(workspace_id, auth.uid(), 'member')
    )
  );

-- UPDATE: private rows by owner; workspace rows by 'member' role+.
CREATE POLICY conversations_update ON conversations
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      (visibility = 'private' AND user_id = auth.uid())
      OR (visibility = 'workspace'
          AND is_workspace_member(workspace_id, auth.uid(), 'member'))
    )
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      (visibility = 'private' AND user_id = auth.uid())
      OR (visibility = 'workspace'
          AND is_workspace_member(workspace_id, auth.uid(), 'member'))
    )
  );

-- DELETE: same shape as UPDATE.
CREATE POLICY conversations_delete ON conversations
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      (visibility = 'private' AND user_id = auth.uid())
      OR (visibility = 'workspace'
          AND is_workspace_member(workspace_id, auth.uid(), 'member'))
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 3. chat_attachments.visibility (mirror)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE chat_attachments
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('workspace', 'private'));

DROP POLICY IF EXISTS chat_attachments_member_select ON chat_attachments;
DROP POLICY IF EXISTS chat_attachments_editor_insert ON chat_attachments;
DROP POLICY IF EXISTS chat_attachments_editor_delete ON chat_attachments;

CREATE POLICY chat_attachments_select ON chat_attachments
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      visibility = 'workspace'
      OR (visibility = 'private' AND user_id = auth.uid())
    )
  );

CREATE POLICY chat_attachments_insert ON chat_attachments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      visibility = 'private'
      OR is_workspace_member(workspace_id, auth.uid(), 'member')
    )
  );

CREATE POLICY chat_attachments_delete ON chat_attachments
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (
      (visibility = 'private' AND user_id = auth.uid())
      OR (visibility = 'workspace'
          AND is_workspace_member(workspace_id, auth.uid(), 'member'))
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 4. canvas_panels — extend panel_type CHECK for the new 'artifact' type
-- ════════════════════════════════════════════════════════════════════
--
-- Promotion-to-canvas from the private chat lands as an 'artifact' panel
-- (rich-text markdown). Mirrors the workspace-shared visibility of every
-- other canvas panel.

ALTER TABLE canvas_panels
  DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;

ALTER TABLE canvas_panels
  ADD CONSTRAINT canvas_panels_panel_type_check
    CHECK (panel_type IN (
      'entry',
      'chat',
      'connection',
      'browse',
      'cluster-brain',
      'knowledge',
      'skills',
      'knowledge-base',
      'skill',
      'artifact'
    ));

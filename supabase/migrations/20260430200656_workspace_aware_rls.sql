-- Workspace-aware RLS + chat_attachments workspace scoping.
--
-- Pre-existing RLS on the data tables (clusters, canvas_panels, canvas_state,
-- conversations, cluster_brains, cluster_brain_memories) was based on
-- `user_id = auth.uid()` only, which means an invited workspace member
-- can't see another member's rows via direct DB reads or realtime
-- subscriptions. App code uses the service-role client so server-side
-- paths still worked, but client-side realtime didn't.
--
-- Replaces those policies with workspace-membership-aware ones, gated
-- by a `is_workspace_member(workspace_id, user_id, min_role)` helper.
-- Also denormalizes `workspace_id` onto `chat_attachments` so its
-- policies can use the same shape and so deletes can fan out by
-- workspace instead of user.

-- ════════════════════════════════════════════════════════════════════
-- 1. is_workspace_member helper
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_workspace_member(
  p_workspace_id UUID,
  p_user_id UUID,
  p_min_role TEXT DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = p_user_id
      AND m.status       = 'active'
      AND CASE m.role
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'editor' THEN 1
            WHEN 'viewer' THEN 0
            ELSE -1
          END
        >=
          CASE p_min_role
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'editor' THEN 1
            WHEN 'viewer' THEN 0
            ELSE -1
          END
  );
$$;

REVOKE ALL ON FUNCTION is_workspace_member(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_workspace_member(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION is_workspace_member(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_workspace_member(UUID, UUID, TEXT) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2. Drop all existing policies on the data tables
-- ════════════════════════════════════════════════════════════════════
--
-- This sweeps up the pre-existing duplicate policies on canvas_panels +
-- canvas_state at the same time as it removes the user_id-only checks.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'clusters',
        'canvas_panels',
        'canvas_state',
        'conversations',
        'cluster_brains',
        'cluster_brain_memories'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      r.policyname, r.tablename
    );
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Workspace-membership-aware policies
-- ════════════════════════════════════════════════════════════════════
--
-- Convention: SELECT requires viewer+. INSERT/UPDATE/DELETE require
-- editor+. Inserts also enforce `user_id = auth.uid()` as a no-
-- impersonation guard so a workspace member can't post-hoc claim
-- another member's row.

-- clusters
CREATE POLICY clusters_member_select ON clusters
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY clusters_editor_insert ON clusters
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND user_id = auth.uid()
  );
CREATE POLICY clusters_editor_update ON clusters
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY clusters_editor_delete ON clusters
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- canvas_panels
CREATE POLICY canvas_panels_member_select ON canvas_panels
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY canvas_panels_editor_insert ON canvas_panels
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND user_id = auth.uid()
  );
CREATE POLICY canvas_panels_editor_update ON canvas_panels
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY canvas_panels_editor_delete ON canvas_panels
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- canvas_state — single row per workspace; any editor can mutate it.
CREATE POLICY canvas_state_member_select ON canvas_state
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY canvas_state_editor_insert ON canvas_state
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND user_id = auth.uid()
  );
CREATE POLICY canvas_state_editor_update ON canvas_state
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY canvas_state_editor_delete ON canvas_state
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- conversations
CREATE POLICY conversations_member_select ON conversations
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY conversations_editor_insert ON conversations
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND user_id = auth.uid()
  );
CREATE POLICY conversations_editor_update ON conversations
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY conversations_editor_delete ON conversations
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- cluster_brains
CREATE POLICY cluster_brains_member_select ON cluster_brains
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY cluster_brains_editor_insert ON cluster_brains
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND user_id = auth.uid()
  );
CREATE POLICY cluster_brains_editor_update ON cluster_brains
  FOR UPDATE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
CREATE POLICY cluster_brains_editor_delete ON cluster_brains
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

-- cluster_brain_memories — additionally enforces scope=personal author check.
-- workspace memories are visible/editable to all editors. personal
-- memories are only visible/editable to their author.
CREATE POLICY cluster_brain_memories_member_select ON cluster_brain_memories
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (scope = 'workspace' OR (scope = 'personal' AND author_id = auth.uid()))
  );
CREATE POLICY cluster_brain_memories_editor_insert ON cluster_brain_memories
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND author_id = auth.uid()
  );
CREATE POLICY cluster_brain_memories_editor_update ON cluster_brain_memories
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (scope = 'workspace' OR author_id = auth.uid())
  );
CREATE POLICY cluster_brain_memories_editor_delete ON cluster_brain_memories
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (scope = 'workspace' OR author_id = auth.uid())
  );

-- ════════════════════════════════════════════════════════════════════
-- 4. chat_attachments — denorm workspace_id
-- ════════════════════════════════════════════════════════════════════
--
-- Existing rows are populated via the canvas_panels join (each
-- attachment lives on a panel which already carries workspace_id).
-- Orphan rows (panel deleted but attachment row left behind) get pruned.

ALTER TABLE chat_attachments ADD COLUMN IF NOT EXISTS workspace_id UUID;

UPDATE chat_attachments ca
   SET workspace_id = cp.workspace_id
  FROM canvas_panels cp
 WHERE ca.user_id     = cp.user_id
   AND ca.panel_id    = cp.panel_id
   AND ca.workspace_id IS NULL;

DELETE FROM chat_attachments WHERE workspace_id IS NULL;

ALTER TABLE chat_attachments ALTER COLUMN workspace_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_attachments_workspace_id_fkey'
  ) THEN
    ALTER TABLE chat_attachments
      ADD CONSTRAINT chat_attachments_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS chat_attachments_workspace_id_idx
  ON chat_attachments (workspace_id);

-- ════════════════════════════════════════════════════════════════════
-- 5. chat_attachments RLS
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_attachments'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.chat_attachments',
      r.policyname
    );
  END LOOP;
END $$;

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_attachments_member_select ON chat_attachments
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
CREATE POLICY chat_attachments_editor_insert ON chat_attachments
  FOR INSERT
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND user_id = auth.uid()
  );
CREATE POLICY chat_attachments_editor_delete ON chat_attachments
  FOR DELETE
  USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

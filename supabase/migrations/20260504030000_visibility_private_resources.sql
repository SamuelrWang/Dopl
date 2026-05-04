-- M-10 — Private knowledge bases & skills.
--
-- Adds a `visibility` flag to `knowledge_bases` and `skills`, extends the
-- existing RLS policies on those tables and their child tables
-- (knowledge_folders, knowledge_entries, skill_files) so private rows are
-- only visible to their owner, and installs a trigger that hard-deletes
-- private resources when their owner leaves the workspace.
--
-- Rules:
--   • Default for the column is 'public', so the migration leaves all
--     existing data untouched (every current row stays visible to every
--     workspace member).
--   • App code (`createBase` / `createSkill`) explicitly passes
--     'private' for new items so users start in draft mode and opt to
--     publish — the irreversible "Make public" button in settings is
--     the only way out of private.
--   • Once public, public forever: there's no `make_private` server
--     path. The UI doesn't expose one either.
--
-- Fix-up included: the editor → member rename migration
-- (20260502130000) updated the role values in workspace_members but
-- forgot to update the `is_workspace_member` SECURITY DEFINER function,
-- which still hard-coded 'editor' in its rank table. Members were
-- silently being denied by every RLS policy that passes 'editor' as
-- the min role. We fix it here so 'member' resolves to the same rank
-- as 'editor' did, and 'editor' stays as a legacy alias so existing
-- policies (which still pass 'editor') keep working.

-- 1. Fix is_workspace_member to recognize 'member' (and keep 'editor'
--    as an alias so the existing policies still work).
CREATE OR REPLACE FUNCTION public.is_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_min_role text DEFAULT 'viewer'::text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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
            WHEN 'member' THEN 1
            WHEN 'viewer' THEN 0
            ELSE -1
          END
        >=
          CASE p_min_role
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'member' THEN 1
            WHEN 'editor' THEN 1
            WHEN 'viewer' THEN 0
            ELSE -1
          END
  );
$$;

-- 2. Add visibility column to knowledge_bases + skills.
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));

-- 3. RLS — knowledge_bases.
-- Extend SELECT/UPDATE/DELETE so private rows are owner-only. INSERT
-- already requires created_by = auth.uid() so visibility is implicit
-- (the inserter is always the owner).
DROP POLICY IF EXISTS knowledge_bases_member_select ON knowledge_bases;
CREATE POLICY knowledge_bases_member_select ON knowledge_bases
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (visibility = 'public' OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS knowledge_bases_editor_update ON knowledge_bases;
CREATE POLICY knowledge_bases_editor_update ON knowledge_bases
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (visibility = 'public' OR created_by = auth.uid())
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (visibility = 'public' OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS knowledge_bases_editor_delete ON knowledge_bases;
CREATE POLICY knowledge_bases_editor_delete ON knowledge_bases
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (visibility = 'public' OR created_by = auth.uid())
  );

-- 4. RLS — knowledge_folders. Visibility lives on the parent KB, so
-- child rows need an EXISTS subquery.
DROP POLICY IF EXISTS knowledge_folders_member_select ON knowledge_folders;
CREATE POLICY knowledge_folders_member_select ON knowledge_folders
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_folders.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS knowledge_folders_editor_update ON knowledge_folders;
CREATE POLICY knowledge_folders_editor_update ON knowledge_folders
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_folders.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_folders.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS knowledge_folders_editor_delete ON knowledge_folders;
CREATE POLICY knowledge_folders_editor_delete ON knowledge_folders
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_folders.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  );

-- 5. RLS — knowledge_entries.
DROP POLICY IF EXISTS knowledge_entries_member_select ON knowledge_entries;
CREATE POLICY knowledge_entries_member_select ON knowledge_entries
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_entries.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS knowledge_entries_editor_update ON knowledge_entries;
CREATE POLICY knowledge_entries_editor_update ON knowledge_entries
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_entries.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_entries.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
    AND last_edited_by = auth.uid()
  );

DROP POLICY IF EXISTS knowledge_entries_editor_delete ON knowledge_entries;
CREATE POLICY knowledge_entries_editor_delete ON knowledge_entries
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_entries.knowledge_base_id
        AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
    )
  );

-- 6. RLS — skills.
DROP POLICY IF EXISTS skills_member_select ON skills;
CREATE POLICY skills_member_select ON skills
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND (visibility = 'public' OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS skills_editor_update ON skills;
CREATE POLICY skills_editor_update ON skills
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (visibility = 'public' OR created_by = auth.uid())
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (visibility = 'public' OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS skills_editor_delete ON skills;
CREATE POLICY skills_editor_delete ON skills
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND (visibility = 'public' OR created_by = auth.uid())
  );

-- 7. RLS — skill_files.
DROP POLICY IF EXISTS skill_files_member_select ON skill_files;
CREATE POLICY skill_files_member_select ON skill_files
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND EXISTS (
      SELECT 1 FROM skills s
      WHERE s.id = skill_files.skill_id
        AND (s.visibility = 'public' OR s.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS skill_files_editor_update ON skill_files;
CREATE POLICY skill_files_editor_update ON skill_files
  FOR UPDATE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM skills s
      WHERE s.id = skill_files.skill_id
        AND (s.visibility = 'public' OR s.created_by = auth.uid())
    )
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM skills s
      WHERE s.id = skill_files.skill_id
        AND (s.visibility = 'public' OR s.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS skill_files_editor_delete ON skill_files;
CREATE POLICY skill_files_editor_delete ON skill_files
  FOR DELETE
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND EXISTS (
      SELECT 1 FROM skills s
      WHERE s.id = skill_files.skill_id
        AND (s.visibility = 'public' OR s.created_by = auth.uid())
    )
  );

-- 8. Hard-delete trigger on workspace leave. When a member is removed
-- from a workspace (DELETE on workspace_members), wipe out every
-- private resource they own in that workspace. Plan-mandated semantics:
-- "private" outlives no membership boundary; no transfer-to-admin, no
-- soft-delete recovery. Cluster_knowledge_bases / cluster_skills
-- junction rows cascade via their existing FKs.
CREATE OR REPLACE FUNCTION public.delete_member_private_resources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM knowledge_bases
    WHERE workspace_id = OLD.workspace_id
      AND created_by   = OLD.user_id
      AND visibility   = 'private';

  DELETE FROM skills
    WHERE workspace_id = OLD.workspace_id
      AND created_by   = OLD.user_id
      AND visibility   = 'private';

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS workspace_member_leave_private_cleanup
  ON workspace_members;
CREATE TRIGGER workspace_member_leave_private_cleanup
AFTER DELETE ON workspace_members
FOR EACH ROW
EXECUTE FUNCTION delete_member_private_resources();

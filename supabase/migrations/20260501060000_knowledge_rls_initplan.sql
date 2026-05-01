-- Wrap auth.uid() in (SELECT auth.uid()) on all knowledge_* RLS policies.
-- Audit slug-finding S-18.
--
-- Postgres treats `auth.uid()` as a volatile call inside a row-level
-- predicate, so it gets re-evaluated for EVERY row scanned. Wrapping it
-- in a sub-SELECT lets the planner cache the result once per query
-- ("init-plan caching"), turning a per-row JIT call into a single
-- function invocation. Standard Supabase performance pattern; the
-- supabase advisor flags the unwrapped form as `auth_rls_initplan` —
-- 12 warnings on knowledge_bases / knowledge_folders / knowledge_entries.
--
-- Behavioral change: NONE. Same predicate, same authorization outcome.
-- Only the planner shape changes. Verified by listing policies before/
-- after — predicate text is identical mod the wrapping.

ALTER POLICY knowledge_bases_member_select ON knowledge_bases
  USING (is_workspace_member(workspace_id, (SELECT auth.uid()), 'viewer'));

ALTER POLICY knowledge_bases_editor_insert ON knowledge_bases
  WITH CHECK (
    is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor')
    AND created_by = (SELECT auth.uid())
  );

ALTER POLICY knowledge_bases_editor_update ON knowledge_bases
  USING      (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'));

ALTER POLICY knowledge_bases_editor_delete ON knowledge_bases
  USING (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'));

ALTER POLICY knowledge_folders_member_select ON knowledge_folders
  USING (is_workspace_member(workspace_id, (SELECT auth.uid()), 'viewer'));

ALTER POLICY knowledge_folders_editor_insert ON knowledge_folders
  WITH CHECK (
    is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor')
    AND created_by = (SELECT auth.uid())
  );

ALTER POLICY knowledge_folders_editor_update ON knowledge_folders
  USING      (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'));

ALTER POLICY knowledge_folders_editor_delete ON knowledge_folders
  USING (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'));

ALTER POLICY knowledge_entries_member_select ON knowledge_entries
  USING (is_workspace_member(workspace_id, (SELECT auth.uid()), 'viewer'));

ALTER POLICY knowledge_entries_editor_insert ON knowledge_entries
  WITH CHECK (
    is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor')
    AND created_by = (SELECT auth.uid())
  );

ALTER POLICY knowledge_entries_editor_update ON knowledge_entries
  USING      (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'))
  WITH CHECK (
    is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor')
    AND last_edited_by = (SELECT auth.uid())
  );

ALTER POLICY knowledge_entries_editor_delete ON knowledge_entries
  USING (is_workspace_member(workspace_id, (SELECT auth.uid()), 'editor'));

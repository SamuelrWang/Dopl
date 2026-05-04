-- Audit A-011 + A-018: extend the existing RLS policies on
-- workspace_resource_access (added in the
-- `enable_rls_workspace_resource_access_and_writeback_audits`
-- migration) with a narrow self-SELECT, and add cleanup triggers so
-- a deleted KB / skill doesn't leave orphan override rows.
--
-- Pre-state: RLS is enabled and two policies already exist —
--   • `admin_modify` (ALL) for workspace admins
--   • `member_select` (SELECT) for any active workspace viewer+
-- Both are workspace-scoped via `is_workspace_member`. They were
-- enough for the matrix UI but a future session caller bypassing
-- the matrix could still read every override in the workspace.
--
-- This migration adds:
--   1. `self_select` (SELECT) — a user can read THEIR OWN override
--      rows. Layered alongside `member_select`; doesn't replace it.
--   2. ON DELETE triggers on `knowledge_bases` and `skills` that
--      drop overrides pointing at the deleted resource. (FK can't
--      `ON DELETE CASCADE` because `resource_id` is polymorphic —
--      points at either KBs or skills depending on `resource_type`.)
--
-- Defensive RLS-enable in case the prior migration didn't run on
-- this database (audit V-001 — production has RLS on via the phantom
-- migration; fresh deploys without that migration get RLS on here).
-- The ENABLE statement is idempotent.

ALTER TABLE workspace_resource_access ENABLE ROW LEVEL SECURITY;

-- 1. Allow session callers to read THEIR OWN override rows.
DROP POLICY IF EXISTS workspace_resource_access_self_select
  ON workspace_resource_access;
CREATE POLICY workspace_resource_access_self_select
  ON workspace_resource_access
  FOR SELECT
  USING (user_id = auth.uid());

-- 2. Trigger: when a KB row is hard-deleted, drop overrides pointing
--    at it. Soft-deletes (deleted_at set) leave the row alive so we
--    don't fire here — only the actual DELETE FROM event matters
--    (workspace-leave trigger, purge, or explicit admin delete).
CREATE OR REPLACE FUNCTION public.cleanup_resource_access_on_kb_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM workspace_resource_access
   WHERE resource_type = 'knowledge_base'
     AND resource_id   = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_base_delete_cleanup_access
  ON knowledge_bases;
CREATE TRIGGER knowledge_base_delete_cleanup_access
AFTER DELETE ON knowledge_bases
FOR EACH ROW
EXECUTE FUNCTION cleanup_resource_access_on_kb_delete();

-- 3. Same for skills.
CREATE OR REPLACE FUNCTION public.cleanup_resource_access_on_skill_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM workspace_resource_access
   WHERE resource_type = 'skill'
     AND resource_id   = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS skill_delete_cleanup_access
  ON skills;
CREATE TRIGGER skill_delete_cleanup_access
AFTER DELETE ON skills
FOR EACH ROW
EXECUTE FUNCTION cleanup_resource_access_on_skill_delete();

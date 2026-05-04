-- Backfill: this migration was applied to the production DB on
-- 2026-05-03 but never landed on disk (drift between the local
-- migrations directory and the supabase_migrations.schema_migrations
-- tracking table — see F-018 follow-up in REFACTOR-FINDINGS.md).
-- Audit V-001: a fresh `supabase db reset` against the on-disk set
-- would otherwise leave both tables RLS-disabled, making the
-- self_select policy in 20260504050000 inert.
--
-- Reconstructed from `pg_get_expr` reads of the live policies:
--   • workspace_resource_access — RLS on, admin_modify (ALL) +
--     member_select (SELECT). The admin policy uses both USING and
--     WITH CHECK (admins manage every override row in their
--     workspace); members can read every override row in their
--     workspace via member_select. Owner-only narrowing was added
--     later as `workspace_resource_access_self_select` in 20260504050000.
--   • writeback_audits — RLS on, no policies. Internal audit data;
--     only the service-role bypass reaches it.
--
-- Idempotent: `IF NOT EXISTS`-style guards on every statement so
-- re-applying against a DB that's already in this state is a no-op.

ALTER TABLE workspace_resource_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_resource_access_admin_modify
  ON workspace_resource_access;
CREATE POLICY workspace_resource_access_admin_modify
  ON workspace_resource_access
  FOR ALL
  USING (is_workspace_member(workspace_id, auth.uid(), 'admin'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'admin'));

DROP POLICY IF EXISTS workspace_resource_access_member_select
  ON workspace_resource_access;
CREATE POLICY workspace_resource_access_member_select
  ON workspace_resource_access
  FOR SELECT
  USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));

ALTER TABLE writeback_audits ENABLE ROW LEVEL SECURITY;

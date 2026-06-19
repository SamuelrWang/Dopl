-- Security hardening: lock down anon/authenticated access surfaced by the
-- Supabase security advisor (2026-06-19). No behavior change for legit paths:
--   * The only direct RPC caller of check_and_record_rate_limit_subject is the
--     server via the service-role client (mcp-session.ts), which bypasses these
--     grants. increment_fork_count / increment_ingestion_count have no call
--     sites (orphaned with the removed ingestion/community features).
--   * The trigger functions fire from triggers (owner privileges) regardless of
--     EXECUTE grants; revoking only removes the unintended direct /rpc surface.
--   * The tables below have RLS enabled with no policy (deny-all to anon/auth);
--     revoking the default table grants is defense-in-depth so a stray RLS
--     toggle can't expose tokens/secrets.
-- is_workspace_member is intentionally left executable — RLS predicates call it.

-- 1. Directly-callable SECURITY DEFINER RPCs: keep them server-only.
revoke execute on function public.check_and_record_rate_limit_subject(text, integer, text) from public, anon, authenticated;
revoke execute on function public.increment_fork_count(uuid) from public, anon, authenticated;
revoke execute on function public.increment_ingestion_count(uuid) from public, anon, authenticated;

-- 2. Trigger-only SECURITY DEFINER functions: no legitimate direct-call surface.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.delete_member_private_resources() from public, anon, authenticated;
revoke execute on function public.delete_member_team_rows() from public, anon, authenticated;
revoke execute on function public.delete_workflow_team_grants() from public, anon, authenticated;
revoke execute on function public.cleanup_canvas_panels_on_kb_delete() from public, anon, authenticated;
revoke execute on function public.cleanup_canvas_panels_on_skill_delete() from public, anon, authenticated;
revoke execute on function public.cleanup_resource_access_on_canvas_delete() from public, anon, authenticated;
revoke execute on function public.cleanup_resource_access_on_kb_delete() from public, anon, authenticated;
revoke execute on function public.cleanup_resource_access_on_skill_delete() from public, anon, authenticated;

-- 3. Pin a non-mutable search_path on the functions the advisor flagged.
alter function public.increment_fork_count(uuid) set search_path = public;
alter function public.increment_ingestion_count(uuid) set search_path = public;
alter function public.cleanup_system_events() set search_path = public;

-- 4. Sensitive, server-only tables (RLS deny-all already): drop the default
--    anon/authenticated table grants so secrets can't leak if RLS is toggled.
revoke all on table
  public.mcp_tokens,
  public.oauth_clients,
  public.oauth_authorization_codes,
  public.conversion_events,
  public.system_events,
  public.mcp_events,
  public.rate_limit_events,
  public.webhook_events,
  public.knowledge_entry_chunks,
  public.workspace_join_links,
  public.workspace_join_requests,
  public.workspace_invitation_teams
from anon, authenticated;

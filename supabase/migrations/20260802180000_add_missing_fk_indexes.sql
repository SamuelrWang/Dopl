-- Add covering indexes for all unindexed foreign keys (Supabase performance
-- advisor, 2026-08-02; re-verified against pg_constraint the same day).
-- Purely additive: no behavior change, speeds FK-join reads and cascades.
-- Part of the desktop migration Phase 0 (docs/DESKTOP-MIGRATION-PLAN.md).
-- DB is small (~41MB) so plain CREATE INDEX lock time is negligible.

create index if not exists idx_channel_agents_engaged_by on public.channel_agents (engaged_by);
create index if not exists idx_channel_members_user_id on public.channel_members (user_id);
create index if not exists idx_channel_members_added_by on public.channel_members (added_by);
create index if not exists idx_channel_messages_author_user_id on public.channel_messages (author_user_id);
create index if not exists idx_channel_task_participants_added_by on public.channel_task_participants (added_by);
create index if not exists idx_chat_folders_user_id on public.chat_folders (user_id);
create index if not exists idx_mcp_tokens_client_id on public.mcp_tokens (client_id);
create index if not exists idx_oauth_authorization_codes_user_id on public.oauth_authorization_codes (user_id);
create index if not exists idx_oauth_authorization_codes_client_id on public.oauth_authorization_codes (client_id);
create index if not exists idx_ontology_clusters_created_by on public.ontology_clusters (created_by);
create index if not exists idx_ontology_objects_user_id on public.ontology_objects (user_id);
create index if not exists idx_ontology_objects_created_by on public.ontology_objects (created_by);
create index if not exists idx_skill_events_author_id on public.skill_events (author_id);
create index if not exists idx_system_events_user_id on public.system_events (user_id);
create index if not exists idx_team_members_added_by on public.team_members (added_by);
create index if not exists idx_teams_created_by on public.teams (created_by);
create index if not exists idx_workflow_knowledge_bases_added_by_user_id on public.workflow_knowledge_bases (added_by_user_id);
create index if not exists idx_workflow_skills_added_by_user_id on public.workflow_skills (added_by_user_id);
create index if not exists idx_workflows_user_id on public.workflows (user_id);
create index if not exists idx_workspace_invitation_teams_team_id on public.workspace_invitation_teams (team_id);
create index if not exists idx_workspace_invitations_invited_by on public.workspace_invitations (invited_by);
create index if not exists idx_workspace_invitations_accepted_by on public.workspace_invitations (accepted_by);
create index if not exists idx_workspace_join_links_created_by on public.workspace_join_links (created_by);
create index if not exists idx_workspace_join_requests_resolved_by on public.workspace_join_requests (resolved_by);
create index if not exists idx_workspace_members_invited_by on public.workspace_members (invited_by);

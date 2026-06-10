-- Workflow descriptions for clusters.
--
-- Clusters are now visual workflows on the canvas: each gets a
-- cluster-info panel showing an editable name + description. The
-- description is streamed to agents via the dopl_cluster MCP tool.
-- Length is capped at 300 chars (DESCRIPTION_MAX) at the API boundary.

alter table public.clusters
  add column if not exists description text;

comment on column public.clusters.description is
  'Agent-facing workflow description (API caps at 300 chars; surfaced via dopl_cluster).';

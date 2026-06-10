-- Workflow connector edges between canvas panels (node blocks).
--
-- Edges are workspace-shared workflow definition (NOT per-user UI
-- state), so they live in their own table rather than canvas_state.
-- panel ids are the client-side `panel-N` strings matching
-- canvas_panels.panel_id; cascade-on-panel-delete is added by the
-- 20260610030000_canvas_edges_panel_fk follow-up migration. No
-- realtime publication v1 — matches canvas_panels.

create table public.canvas_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_panel_id text not null,
  to_panel_id text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, from_panel_id, to_panel_id)
);

create index canvas_edges_workspace_idx on public.canvas_edges (workspace_id);

alter table public.canvas_edges enable row level security;

-- Same access shape as canvas_panels: any active workspace member can
-- read; writes go through the service role (API routes enforce roles).
create policy canvas_edges_select on public.canvas_edges
  for select using (
    public.is_workspace_member(workspace_id, auth.uid(), 'viewer')
  );

comment on table public.canvas_edges is
  'Workflow connector edges between canvas node panels (from → to).';

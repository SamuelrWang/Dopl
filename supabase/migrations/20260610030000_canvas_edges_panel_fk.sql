-- Make canvas_edges actually cascade with its endpoint panels.
--
-- The original canvas_edges migration's comment promised cascade-on-
-- panel-delete but shipped bare text columns: server-side panel
-- deletions orphaned edge rows forever, and an orphan occupying the
-- (workspace, from, to) unique key silently blocks re-creating the
-- same connection. Clean existing orphans, then add composite FKs to
-- canvas_panels(workspace_id, panel_id).

-- Orphan cleanup must precede FK validation.
delete from public.canvas_edges e
where not exists (
  select 1 from public.canvas_panels p
  where p.workspace_id = e.workspace_id and p.panel_id = e.from_panel_id
)
or not exists (
  select 1 from public.canvas_panels p
  where p.workspace_id = e.workspace_id and p.panel_id = e.to_panel_id
);

alter table public.canvas_edges
  add constraint canvas_edges_from_panel_fkey
    foreign key (workspace_id, from_panel_id)
    references public.canvas_panels (workspace_id, panel_id)
    on delete cascade,
  add constraint canvas_edges_to_panel_fkey
    foreign key (workspace_id, to_panel_id)
    references public.canvas_panels (workspace_id, panel_id)
    on delete cascade;

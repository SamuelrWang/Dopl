-- v1.7: a human-readable close summary carried on the task row.
-- Additive column on an existing table. No RLS/grant change: reads ride the
-- existing channel_tasks SELECT policy; writes stay service-role-only (base DML
-- already REVOKEd from authenticated/anon). channel_tasks is NOT in the realtime
-- publication (dropped in 20260728010000), so this adds zero WAL fan-out.
-- The channel_child_workspace_guard fires only on UPDATE OF workspace_id/channel_id,
-- so writing outcome_summary never re-trips it.
ALTER TABLE public.channel_tasks
  ADD COLUMN outcome_summary text;

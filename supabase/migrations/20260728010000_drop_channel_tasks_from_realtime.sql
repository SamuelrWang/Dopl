-- 2026-07-27 CPU incident follow-up: channel_tasks was added to the realtime
-- publication in the v1.5 round, but no client subscribes to it — the web UI
-- refetches tasks off channel_messages events. Publishing it was pure logical
-- decoding + per-subscription RLS cost on a shared-CPU instance. Drop it;
-- re-add deliberately if a subscriber ever ships.
ALTER PUBLICATION supabase_realtime DROP TABLE public.channel_tasks;

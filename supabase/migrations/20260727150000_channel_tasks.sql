-- Channels v15 — first-class tasks.
-- A task is a titled, mode-tagged unit of work inside a channel. Its transcript
-- rides on channel_messages (metadata.taskId = channel_tasks.id); this table is
-- the authoritative status/mode/title store. Writes are service-role only
-- (routes -> supabaseAdmin), mirroring channel_messages; RLS carries the read
-- model for direct PostgREST + Realtime.
CREATE TABLE public.channel_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID NOT NULL REFERENCES public.channels(id)    ON DELETE CASCADE,
  -- Denormalized for the Realtime workspace filter + the RLS fence + the guard.
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id)  ON DELETE CASCADE,
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed')),
  outcome         TEXT CHECK (outcome IN ('completed', 'failed')),
  mode            TEXT NOT NULL DEFAULT 'interactive'
                    CHECK (mode IN ('interactive', 'autonomous')),
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The member the task is addressed to (the responder). SET NULL on delete.
  target_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  CHECK ((status = 'closed') = (outcome IS NOT NULL))  -- closed <=> has outcome
);

CREATE INDEX channel_tasks_channel_idx   ON public.channel_tasks (channel_id, created_at DESC);
CREATE INDEX channel_tasks_workspace_idx ON public.channel_tasks (workspace_id);
CREATE INDEX channel_tasks_created_by_idx ON public.channel_tasks (created_by);
CREATE INDEX channel_tasks_target_idx    ON public.channel_tasks (target_user_id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the
-- parent channel's). UPDATE OF workspace_id, channel_id only, so a status/mode
-- bump never re-fires it.
DROP TRIGGER IF EXISTS channel_tasks_workspace_guard ON public.channel_tasks;
CREATE TRIGGER channel_tasks_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_tasks ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_tasks FROM authenticated, anon;

-- Read model mirrors channel_messages: workspace fence + (public channel OR
-- member).
CREATE POLICY channel_tasks_member_select ON public.channel_tasks
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (
      is_channel_member(channel_id)
      OR EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_tasks.channel_id
          AND c.visibility = 'public'::text
      )
    )
  );

-- Realtime publish (idempotent; copy of the 20260717 pattern).
DO $$
BEGIN
  IF to_regclass('public.channel_tasks') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename = 'channel_tasks'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_tasks;
  END IF;
END
$$;

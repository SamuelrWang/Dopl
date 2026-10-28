-- ============================================================================
-- CHANNEL TASKS (Samuel, 2026-10-26; docs/specs/channel-page-port/PLAN.md R5–R10).
--
-- A unit of work recognised in a channel's conversation: title, description,
-- status, who opened it, who it is assigned to, the thread or message it came
-- from, an ordered subtask breakdown and an append-only note log. An ACTOR is a
-- person (`*_agent` NULL) or one of that person's agents (`*_agent` = the
-- 8-character instance id); there is no kind column to disagree with that.
--
-- Writes go through `features/channels/server/service-tasks*.ts` on the admin
-- client; the channel's own read gate (`loadVisibleChannel`) is the fence.
-- RLS is on for all four tables. Only the parent has a policy, so realtime can
-- ring the doorbell (R6): every child write bumps `channel_tasks.updated_at`
-- through a trigger, so one published table carries every change.
--
-- ROLLBACK (prose, in a NEW migration): take `channel_tasks` out of the
-- `supabase_realtime` publication, return it to the default replica identity,
-- then drop the three child tables, the parent and the two trigger functions.
-- Nothing else references these tables.
-- ============================================================================

-- ── 1. channel_tasks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL
    CONSTRAINT channel_tasks_title_trimmed CHECK (title = btrim(title))
    CONSTRAINT channel_tasks_title_bounded CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT ''
    CONSTRAINT channel_tasks_description_bounded CHECK (length(description) <= 4000),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT channel_tasks_status_check CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_agent text
    CONSTRAINT channel_tasks_created_by_agent_shape CHECK (
      created_by_agent IS NULL OR created_by_agent ~ '^[a-z][a-z0-9]{7}$'
    ),
  -- SET NULL: a deleted thread or message leaves the task standing, unlinked.
  linked_thread_id uuid REFERENCES public.channel_threads(id) ON DELETE SET NULL,
  linked_message_id uuid REFERENCES public.channel_messages(id) ON DELETE SET NULL,
  due_at timestamptz,
  resolved_at timestamptz,
  -- SET NULL: the resolution survives the resolver's account.
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by_agent text
    CONSTRAINT channel_tasks_resolved_by_agent_shape CHECK (
      resolved_by_agent IS NULL OR resolved_by_agent ~ '^[a-z][a-z0-9]{7}$'
    ),
  client_msg_id text
    CONSTRAINT channel_tasks_client_msg_id_bounded CHECK (
      client_msg_id IS NULL OR length(client_msg_id) BETWEEN 1 AND 200
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_tasks_one_link CHECK (num_nonnulls(linked_thread_id, linked_message_id) <= 1),
  CONSTRAINT channel_tasks_resolved_shape CHECK (
    (status = 'resolved') = (resolved_at IS NOT NULL)
    AND (status = 'resolved' OR (resolved_by IS NULL AND resolved_by_agent IS NULL))
  )
);

COMMENT ON TABLE public.channel_tasks IS
  'A unit of work recognised in a channel. Children: channel_task_subtasks, channel_task_notes, channel_task_assignees. Service: features/channels/server/service-tasks.ts.';

-- The list read: one channel's tasks by status, most recently changed first.
CREATE INDEX IF NOT EXISTS channel_tasks_channel_status_idx
  ON public.channel_tasks (channel_id, status, updated_at DESC);

-- The replica identity (R6) and the workspace FK cover.
CREATE UNIQUE INDEX IF NOT EXISTS channel_tasks_workspace_id_key
  ON public.channel_tasks (workspace_id, id);

-- Author-scoped, for the reason `channel_artifacts_client_msg_author_key` is.
CREATE UNIQUE INDEX IF NOT EXISTS channel_tasks_client_msg_author_key
  ON public.channel_tasks (channel_id, client_msg_id, created_by)
  WHERE client_msg_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS channel_tasks_created_by_idx
  ON public.channel_tasks (created_by);
CREATE INDEX IF NOT EXISTS channel_tasks_resolved_by_idx
  ON public.channel_tasks (resolved_by);
CREATE INDEX IF NOT EXISTS channel_tasks_linked_thread_idx
  ON public.channel_tasks (linked_thread_id);
CREATE INDEX IF NOT EXISTS channel_tasks_linked_message_idx
  ON public.channel_tasks (linked_message_id);

DROP TRIGGER IF EXISTS channel_tasks_workspace_guard ON public.channel_tasks;
CREATE TRIGGER channel_tasks_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id
  ON public.channel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

CREATE OR REPLACE FUNCTION public.channel_tasks_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_tasks_touch ON public.channel_tasks;
CREATE TRIGGER channel_tasks_touch
  BEFORE UPDATE ON public.channel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.channel_tasks_touch_updated_at();

-- ── 2. channel_task_subtasks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_task_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.channel_tasks(id) ON DELETE CASCADE,
  position integer NOT NULL CONSTRAINT channel_task_subtasks_position_check CHECK (position >= 0),
  title text NOT NULL
    CONSTRAINT channel_task_subtasks_title_trimmed CHECK (title = btrim(title))
    CONSTRAINT channel_task_subtasks_title_bounded CHECK (length(title) BETWEEN 1 AND 200),
  detail text
    CONSTRAINT channel_task_subtasks_detail_bounded CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 300),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_agent_id text
    CONSTRAINT channel_task_subtasks_owner_agent_shape CHECK (
      owner_agent_id IS NULL OR owner_agent_id ~ '^[a-z][a-z0-9]{7}$'
    ),
  state text NOT NULL DEFAULT 'todo'
    CONSTRAINT channel_task_subtasks_state_check CHECK (state IN ('todo', 'in_progress', 'done')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_msg_id text
    CONSTRAINT channel_task_subtasks_client_msg_id_bounded CHECK (
      client_msg_id IS NULL OR length(client_msg_id) BETWEEN 1 AND 200
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_task_subtasks_task_idx
  ON public.channel_task_subtasks (task_id, position);
CREATE INDEX IF NOT EXISTS channel_task_subtasks_owner_idx
  ON public.channel_task_subtasks (owner_user_id);
CREATE INDEX IF NOT EXISTS channel_task_subtasks_created_by_idx
  ON public.channel_task_subtasks (created_by);
CREATE UNIQUE INDEX IF NOT EXISTS channel_task_subtasks_client_msg_author_key
  ON public.channel_task_subtasks (task_id, client_msg_id, created_by)
  WHERE client_msg_id IS NOT NULL;

DROP TRIGGER IF EXISTS channel_task_subtasks_touch ON public.channel_task_subtasks;
CREATE TRIGGER channel_task_subtasks_touch
  BEFORE UPDATE ON public.channel_task_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.channel_tasks_touch_updated_at();

-- ── 3. channel_task_notes (append-only: the service has no edit or delete) ───
CREATE TABLE IF NOT EXISTS public.channel_task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.channel_tasks(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_agent_id text
    CONSTRAINT channel_task_notes_author_agent_shape CHECK (
      author_agent_id IS NULL OR author_agent_id ~ '^[a-z][a-z0-9]{7}$'
    ),
  body text NOT NULL
    CONSTRAINT channel_task_notes_body_bounded CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  client_msg_id text
    CONSTRAINT channel_task_notes_client_msg_id_bounded CHECK (
      client_msg_id IS NULL OR length(client_msg_id) BETWEEN 1 AND 200
    ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_task_notes_task_idx
  ON public.channel_task_notes (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channel_task_notes_author_idx
  ON public.channel_task_notes (author_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS channel_task_notes_client_msg_author_key
  ON public.channel_task_notes (task_id, client_msg_id, author_user_id)
  WHERE client_msg_id IS NOT NULL;

-- ── 4. channel_task_assignees ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_task_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.channel_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id text
    CONSTRAINT channel_task_assignees_agent_shape CHECK (
      agent_id IS NULL OR agent_id ~ '^[a-z][a-z0-9]{7}$'
    ),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per actor: a person and each of their agents are distinct assignees.
CREATE UNIQUE INDEX IF NOT EXISTS channel_task_assignees_actor_key
  ON public.channel_task_assignees (task_id, user_id, agent_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS channel_task_assignees_user_idx
  ON public.channel_task_assignees (user_id);

-- ── 5. Child writes ring the parent's doorbell ──────────────────────────────
CREATE OR REPLACE FUNCTION public.channel_task_touch_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.channel_tasks SET updated_at = now() WHERE id = OLD.task_id;
  ELSE
    UPDATE public.channel_tasks SET updated_at = now() WHERE id = NEW.task_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS channel_task_subtasks_touch_parent ON public.channel_task_subtasks;
CREATE TRIGGER channel_task_subtasks_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.channel_task_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.channel_task_touch_parent();

DROP TRIGGER IF EXISTS channel_task_notes_touch_parent ON public.channel_task_notes;
CREATE TRIGGER channel_task_notes_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.channel_task_notes
  FOR EACH ROW EXECUTE FUNCTION public.channel_task_touch_parent();

DROP TRIGGER IF EXISTS channel_task_assignees_touch_parent ON public.channel_task_assignees;
CREATE TRIGGER channel_task_assignees_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.channel_task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.channel_task_touch_parent();

REVOKE EXECUTE ON FUNCTION public.channel_tasks_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.channel_task_touch_parent() FROM PUBLIC, anon, authenticated;

-- ── 6. Privileges and RLS ───────────────────────────────────────────────────
ALTER TABLE public.channel_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_task_subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_task_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_task_assignees ENABLE ROW LEVEL SECURITY;

-- The parent keeps SELECT for `authenticated` because realtime evaluates its
-- policy as the subscriber; every write is the service's.
REVOKE ALL ON public.channel_tasks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.channel_tasks FROM authenticated;
REVOKE ALL ON public.channel_task_subtasks FROM anon, authenticated;
REVOKE ALL ON public.channel_task_notes FROM anon, authenticated;
REVOKE ALL ON public.channel_task_assignees FROM anon, authenticated;

-- The arms of `20260826120000_guest_channel_realtime_rls.sql › channel_messages_member_select`.
DROP POLICY IF EXISTS channel_tasks_member_select ON public.channel_tasks;
CREATE POLICY channel_tasks_member_select ON public.channel_tasks
  FOR SELECT
  USING (
    (
      is_current_workspace_member(workspace_id, 'viewer')
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_tasks.channel_id
          AND c.deleted_at IS NULL
          AND (c.visibility = 'public' OR is_channel_member(c.id))
      )
    )
    OR (
      is_current_workspace_member(workspace_id, 'guest')
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_tasks.channel_id
          AND c.deleted_at IS NULL
          AND is_channel_member(c.id)
      )
    )
  );

-- ── 7. Realtime: INSERT and UPDATE doorbell; no route deletes a task (R10) ──
ALTER TABLE public.channel_tasks
  REPLICA IDENTITY USING INDEX channel_tasks_workspace_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'channel_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_tasks;
  END IF;
END
$$;

-- ── 8. Assert the outcome ───────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channel_tasks', 'channel_task_subtasks', 'channel_task_notes', 'channel_task_assignees'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      RAISE EXCEPTION 'ABORT: % has RLS off', t;
    END IF;
    IF NOT (has_table_privilege('service_role', format('public.%I', t), 'SELECT')
            AND has_table_privilege('service_role', format('public.%I', t), 'INSERT')
            AND has_table_privilege('service_role', format('public.%I', t), 'UPDATE')) THEN
      RAISE EXCEPTION 'ABORT: service_role cannot read or write %', t;
    END IF;
    IF has_table_privilege('anon', format('public.%I', t), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', t), 'INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 'ABORT: % is reachable by anon or writable by authenticated after the revoke', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['channel_task_subtasks', 'channel_task_notes', 'channel_task_assignees'] LOOP
    IF has_table_privilege('authenticated', format('public.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'ABORT: % is SELECT-able by authenticated; children are service-role only', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'ABORT: % has a policy; children are fenced by the service alone', t;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'channel_tasks') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'channel_tasks' AND cmd = 'SELECT'
          AND qual::text LIKE '%''viewer''%' AND qual::text LIKE '%''guest''%'
     ) THEN
    RAISE EXCEPTION 'ABORT: channel_tasks must carry exactly one SELECT policy with the viewer and guest arms';
  END IF;

  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.channel_tasks'::regclass) <> 'i' THEN
    RAISE EXCEPTION 'ABORT: channel_tasks replica identity is not USING INDEX (workspace_id, id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'channel_tasks'
  ) THEN
    RAISE EXCEPTION 'ABORT: channel_tasks is not in supabase_realtime';
  END IF;

  RAISE NOTICE 'channel_tasks + 3 children created; parent published with a member SELECT policy, children service-role only';
END $$;

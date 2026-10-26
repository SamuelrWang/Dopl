-- RENAME `task` TO `thread` IN STORAGE (Samuel, 2026-10-26).
--
-- Threads were stored under the name `task` (`channel_tasks`, `task_id`, the
-- `task_*` message kinds, `metadata.taskId`). Every one of them is renamed to
-- `thread` so that `task` is free for the channel tasks feature. No aliases, no
-- compatibility views: the desktop floor is raised in the same release
-- (`src/shared/version/desktop-floor.ts › DEFAULT_MIN_VERSION`).
--
--   1. TABLE channel_tasks -> channel_threads, with its constraints, indexes,
--      workspace-guard trigger and SELECT policy.
--   2. COLUMN task_id -> thread_id on channel_sessions, channel_agent_directions
--      and channel_launch_directives, with their FKs and indexes.
--   3. VIEW channel_tasks_activity -> channel_threads_activity, re-pointed at
--      `metadata.threadId`.
--   4. FUNCTION channel_tasks_stale(timestamptz, integer) DROPPED: no caller
--      since 2026-08-18 (F-207).
--   5. channel_messages: kinds task_started / task_progress / task_finished /
--      task_failed -> thread_*; metadata keys taskId / taskTitle / taskTarget /
--      taskCreatedBy / taskMode -> threadId / threadTitle / threadTarget /
--      threadCreatedBy / threadMode; legacy synthetic ids `task-<channel>-<seq>`
--      -> `thread-<channel>-<seq>` (in `threadId` and in `cites[].thread`);
--      opening-request keys `task-open-<id>` -> `thread-open-<id>`; the
--      thread-activity index rebuilt on `threadId`.
--   6. FUNCTION workspace_message_channel_tally: body comment names the
--      `thread_*` kinds (logic unchanged).
--
-- ⚠ Section 5 rewrites stored rows, so each touched `channel_messages` row
-- emits one realtime UPDATE. Clients refetch on the doorbell; nothing renders
-- the raw payload.
--
-- ROLLBACK, IN FULL (data first, then names):
--   ALTER TABLE public.channel_messages DROP CONSTRAINT channel_messages_kind_check;
--   UPDATE public.channel_messages SET kind = 'task_' || substr(kind, 8) WHERE kind LIKE 'thread\_%';
--   -- re-add channel_messages_kind_check over message, the four task_* kinds and system.
--   -- metadata: the inverse of section 5's key rename, value rewrites and client_msg_id rewrite.
--   DROP INDEX public.channel_messages_thread_activity_idx;
--   CREATE INDEX channel_messages_thread_activity_idx ON public.channel_messages (channel_id, (metadata ->> 'taskId'));
--   -- every RENAME below, reversed; the view body from 20260818120000; channel_tasks_stale
--   -- from 20260807160000; the tally body from 20261119120000.

-- ── 1. channel_threads ──────────────────────────────────────────────────────
ALTER TABLE public.channel_tasks RENAME TO channel_threads;

ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_pkey TO channel_threads_pkey;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_check TO channel_threads_check;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_title_check TO channel_threads_title_check;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_status_check TO channel_threads_status_check;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_outcome_check TO channel_threads_outcome_check;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_mode_check TO channel_threads_mode_check;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_channel_id_fkey TO channel_threads_channel_id_fkey;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_workspace_id_fkey TO channel_threads_workspace_id_fkey;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_created_by_fkey TO channel_threads_created_by_fkey;
ALTER TABLE public.channel_threads RENAME CONSTRAINT channel_tasks_target_user_id_fkey TO channel_threads_target_user_id_fkey;

ALTER INDEX public.channel_tasks_channel_idx RENAME TO channel_threads_channel_idx;
ALTER INDEX public.channel_tasks_workspace_idx RENAME TO channel_threads_workspace_idx;
ALTER INDEX public.channel_tasks_created_by_idx RENAME TO channel_threads_created_by_idx;
ALTER INDEX public.channel_tasks_target_idx RENAME TO channel_threads_target_idx;
ALTER INDEX public.channel_tasks_workspace_created_idx RENAME TO channel_threads_workspace_created_idx;
ALTER INDEX public.channel_tasks_client_msg_author_key RENAME TO channel_threads_client_msg_author_key;

ALTER TRIGGER channel_tasks_workspace_guard ON public.channel_threads RENAME TO channel_threads_workspace_guard;

DROP POLICY IF EXISTS channel_tasks_member_select ON public.channel_threads;

CREATE POLICY channel_threads_member_select ON public.channel_threads
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_threads.channel_id
        AND c.deleted_at IS NULL
        AND (
          c.visibility = 'public'::text
          OR is_channel_member(c.id)
        )
    )
  );

-- ── 2. thread_id on the session / direction / directive tables ─────────────
ALTER TABLE public.channel_sessions RENAME COLUMN task_id TO thread_id;
ALTER TABLE public.channel_sessions RENAME CONSTRAINT channel_sessions_task_id_fkey TO channel_sessions_thread_id_fkey;
ALTER INDEX public.channel_sessions_task_idx RENAME TO channel_sessions_thread_idx;

ALTER TABLE public.channel_agent_directions RENAME COLUMN task_id TO thread_id;
ALTER TABLE public.channel_agent_directions RENAME CONSTRAINT channel_agent_directions_task_id_fkey TO channel_agent_directions_thread_id_fkey;
ALTER INDEX public.channel_agent_directions_task_idx RENAME TO channel_agent_directions_thread_idx;

ALTER TABLE public.channel_launch_directives RENAME COLUMN task_id TO thread_id;
ALTER TABLE public.channel_launch_directives RENAME CONSTRAINT channel_launch_directives_task_id_fkey TO channel_launch_directives_thread_id_fkey;
ALTER INDEX public.channel_launch_directives_task_idx RENAME TO channel_launch_directives_thread_idx;

-- ── 3. channel_threads_activity ─────────────────────────────────────────────
-- Renamed in place so its grants (service_role SELECT only) and
-- `security_invoker` carry over; the body re-points at `threadId`.
ALTER TABLE public.channel_tasks_activity RENAME TO channel_threads_activity;

CREATE OR REPLACE VIEW public.channel_threads_activity
WITH (security_invoker = true) AS
  SELECT
    t.id,
    t.channel_id,
    t.workspace_id,
    t.title,
    t.status,
    t.outcome,
    t.mode,
    t.created_by,
    t.target_user_id,
    t.created_at,
    t.updated_at,
    t.closed_at,
    t.outcome_summary,
    t.client_msg_id,
    COALESCE(a.last_at, t.created_at) AS last_activity_at
  FROM public.channel_threads t
  CROSS JOIN LATERAL (
    SELECT max(m.created_at) AS last_at
    FROM public.channel_messages m
    WHERE m.channel_id = t.channel_id
      AND m.metadata ->> 'threadId' = t.id::text
      AND COALESCE(m.metadata ->> 'closeProposed', '') <> 'true'
  ) a;

COMMENT ON VIEW public.channel_threads_activity IS
  'channel_threads + last_activity_at derived from channel_messages. Read model for the thread list; service_role only.';

-- ── 4. the dead stale-sweep RPC (F-207) ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.channel_tasks_stale(timestamptz, integer);

-- ── 5. channel_messages: kinds, metadata keys, legacy ids ───────────────────
ALTER TABLE public.channel_messages DROP CONSTRAINT channel_messages_kind_check;

UPDATE public.channel_messages
   SET kind = 'thread_' || substr(kind, 6)
 WHERE kind IN ('task_started', 'task_progress', 'task_finished', 'task_failed');

ALTER TABLE public.channel_messages ADD CONSTRAINT channel_messages_kind_check
  CHECK (kind IN ('message', 'thread_started', 'thread_progress', 'thread_finished', 'thread_failed', 'system'));

DROP INDEX IF EXISTS public.channel_messages_thread_activity_idx;

UPDATE public.channel_messages m
   SET metadata = (m.metadata - ARRAY['taskId', 'taskTitle', 'taskTarget', 'taskCreatedBy', 'taskMode'])
       || jsonb_strip_nulls(jsonb_build_object(
            'threadId', m.metadata -> 'taskId',
            'threadTitle', m.metadata -> 'taskTitle',
            'threadTarget', m.metadata -> 'taskTarget',
            'threadCreatedBy', m.metadata -> 'taskCreatedBy',
            'threadMode', m.metadata -> 'taskMode'
          ))
 WHERE jsonb_typeof(m.metadata) = 'object'
   AND m.metadata ?| ARRAY['taskId', 'taskTitle', 'taskTarget', 'taskCreatedBy', 'taskMode'];

UPDATE public.channel_messages
   SET metadata = jsonb_set(metadata, '{threadId}', to_jsonb('thread-' || substr(metadata ->> 'threadId', 6)))
 WHERE metadata ->> 'threadId' LIKE 'task-%';

UPDATE public.channel_messages m
   SET metadata = jsonb_set(m.metadata, '{cites}', (
         SELECT jsonb_agg(
                  CASE WHEN c.value ->> 'thread' LIKE 'task-%'
                       THEN jsonb_set(c.value, '{thread}', to_jsonb('thread-' || substr(c.value ->> 'thread', 6)))
                       ELSE c.value END
                  ORDER BY c.ord)
           FROM jsonb_array_elements(m.metadata -> 'cites') WITH ORDINALITY AS c(value, ord)
       ))
 WHERE jsonb_typeof(m.metadata -> 'cites') = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(m.metadata -> 'cites') AS e(value)
      WHERE e.value ->> 'thread' LIKE 'task-%'
   );

UPDATE public.channel_messages
   SET client_msg_id = 'thread-open-' || substr(client_msg_id, 11)
 WHERE client_msg_id LIKE 'task-open-%';

CREATE INDEX channel_messages_thread_activity_idx
  ON public.channel_messages (channel_id, (metadata ->> 'threadId'));

-- ── 6. the message tally's comment ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.workspace_message_channel_tally(p_workspace_id uuid, p_since timestamp with time zone)
 RETURNS TABLE(billed_channel_id uuid, messages bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    m.channel_id     AS billed_channel_id,
    count(*)::bigint AS messages
  FROM public.channel_messages m
  WHERE
    -- 🔒 THE SAME THREE PREDICATES THE SCAN CARRIED, AND NO FOURTH. `kind` keeps
    -- the lifecycle rows (`thread_started`, `thread_progress`, …) out of a figure
    -- labelled "messages".
    m.workspace_id = p_workspace_id
    AND m.kind = 'message'
    AND m.created_at >= p_since
  GROUP BY 1;
$function$;

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.channel_tasks') IS NOT NULL
     OR to_regclass('public.channel_tasks_activity') IS NOT NULL THEN
    RAISE EXCEPTION 'a task-named relation survived the rename';
  END IF;
  IF to_regclass('public.channel_threads') IS NULL
     OR to_regclass('public.channel_threads_activity') IS NULL THEN
    RAISE EXCEPTION 'channel_threads or channel_threads_activity is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c
              WHERE c.relnamespace = 'public'::regnamespace AND c.relname ILIKE '%task%') THEN
    RAISE EXCEPTION 'a relation, index or sequence in public still names task';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE connamespace = 'public'::regnamespace AND conname ILIKE '%task%') THEN
    RAISE EXCEPTION 'a constraint in public still names task';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname ILIKE '%task%') THEN
    RAISE EXCEPTION 'a policy in public still names task';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
              WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
                AND t.tgname ILIKE '%task%') THEN
    RAISE EXCEPTION 'a trigger in public still names task';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace
                AND (proname ILIKE '%task%' OR prosrc ILIKE '%task%')) THEN
    RAISE EXCEPTION 'a function in public still names task';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND column_name ILIKE '%task%') THEN
    RAISE EXCEPTION 'a column in public still names task';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'thread_id'
         AND table_name IN ('channel_sessions', 'channel_agent_directions', 'channel_launch_directives')) <> 3 THEN
    RAISE EXCEPTION 'thread_id is missing from a session, direction or directive table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'channel_threads'
                    AND policyname = 'channel_threads_member_select' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'channel_threads lost its SELECT policy';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.channel_threads'::regclass) THEN
    RAISE EXCEPTION 'channel_threads lost row level security';
  END IF;
  IF has_table_privilege('authenticated', 'public.channel_threads_activity', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.channel_threads_activity', 'SELECT') THEN
    RAISE EXCEPTION 'channel_threads_activity grants changed (service_role SELECT only)';
  END IF;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint
                            WHERE conname = 'channel_messages_kind_check'
                              AND conrelid = 'public.channel_messages'::regclass)) ILIKE '%task%' THEN
    RAISE EXCEPTION 'channel_messages_kind_check still admits a task_* kind';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_messages WHERE kind ILIKE 'task%') THEN
    RAISE EXCEPTION 'a channel_messages row still carries a task_* kind';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_messages
              WHERE metadata ?| ARRAY['taskId', 'taskTitle', 'taskTarget', 'taskCreatedBy', 'taskMode']
                 OR metadata ->> 'threadId' LIKE 'task-%'
                 OR client_msg_id LIKE 'task-open-%') THEN
    RAISE EXCEPTION 'a channel_messages row still carries a task metadata key or id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_messages m,
                    jsonb_array_elements(CASE WHEN jsonb_typeof(m.metadata -> 'cites') = 'array'
                                              THEN m.metadata -> 'cites' ELSE '[]'::jsonb END) AS e(value)
              WHERE e.value ->> 'thread' LIKE 'task-%') THEN
    RAISE EXCEPTION 'a stored cite still names a task- id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'channel_messages_thread_activity_idx'
                    AND indexdef LIKE '%threadId%') THEN
    RAISE EXCEPTION 'channel_messages_thread_activity_idx is not on threadId';
  END IF;
END $$;

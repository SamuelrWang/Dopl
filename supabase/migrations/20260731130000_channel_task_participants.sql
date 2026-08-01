-- Channels multiplayer wave 1 — `channel_task_participants`.
--
-- A BREAKOUT ROOM is a thread with a participant set, not a sub-channel. This
-- is that set: one row per identity admitted to a thread, where an identity is
-- either a human member (`kind='user'`) or a summoned agent (`kind='agent'`).
-- It supersedes the pair-shaped `channel_tasks.created_by`/`target_user_id`
-- constraint for threads that have participants — the single piece of schema
-- ENGINEERING.md §8 names as genuinely two-party ("a participants join table
-- WOULD need one").
--
-- Storage keeps the `task` spelling on purpose (§8: `task` == `thread` at the
-- storage boundary); the domain type is `ThreadParticipant`.
--
-- Write model is the channels house model EXACTLY: base INSERT/UPDATE/DELETE
-- REVOKEd from authenticated + anon, NO write policy, service-role writes only.
-- NOT added to the realtime publication — a participant set changes rarely and
-- the web refetches it on thread events, so publishing it would only re-create
-- the F-072 read-amplification shape for no live benefit (same call as
-- 20260728010000, which pulled `channel_tasks` back out).
--
-- ADDITIVE ONLY: new table + new guard function, no existing table altered.
CREATE TABLE public.channel_task_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES public.channel_tasks(id)   ON DELETE CASCADE,
  -- Denormalized for the RLS fence + the guard (same reason as every other
  -- channel child row).
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id)      ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('user', 'agent')),
  user_id       UUID REFERENCES auth.users(id)                      ON DELETE CASCADE,
  agent_id      UUID REFERENCES public.channel_agents(id)           ON DELETE CASCADE,
  added_by      UUID REFERENCES auth.users(id)                      ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The discriminator is EXCLUSIVE in both directions: a 'user' row carries a
  -- user_id and no agent_id, an 'agent' row the reverse. Stated as two
  -- equivalences rather than two implications so neither column can ride along
  -- on the wrong kind.
  CONSTRAINT channel_task_participants_identity_shape CHECK (
    ((kind = 'user')  = (user_id  IS NOT NULL))
    AND ((kind = 'agent') = (agent_id IS NOT NULL))
  )
);

-- One row per (thread, identity). `coalesce(user_id, agent_id)` is safe as the
-- identity term because the shape CHECK above guarantees exactly one of the two
-- is non-null, and `kind` is in the key so a user-uuid could never collide with
-- an agent-uuid even if they somehow matched. Expression unique index because a
-- table constraint cannot hold a function call.
CREATE UNIQUE INDEX channel_task_participants_identity_key
  ON public.channel_task_participants (task_id, kind, coalesce(user_id, agent_id));

CREATE INDEX channel_task_participants_workspace_idx
  ON public.channel_task_participants (workspace_id);

CREATE INDEX channel_task_participants_user_idx
  ON public.channel_task_participants (user_id);

CREATE INDEX channel_task_participants_agent_idx
  ON public.channel_task_participants (agent_id);


-- ===========================================================================
-- Workspace-consistency guard — the task-parented variant
-- ===========================================================================
-- `channel_child_workspace_guard` resolves the parent through NEW.channel_id,
-- which this table does not have (its parent is a thread, not a channel). Same
-- invariant, one hop further out: the denormalized workspace_id MUST equal the
-- parent thread's, which the thread's own guard already pins to its channel's.
CREATE OR REPLACE FUNCTION public.channel_task_child_workspace_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $function$
DECLARE
  parent_ws uuid;
BEGIN
  SELECT t.workspace_id INTO parent_ws
  FROM public.channel_tasks t
  WHERE t.id = NEW.task_id;

  IF parent_ws IS NULL THEN
    RAISE EXCEPTION 'channel task % does not exist', NEW.task_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM parent_ws THEN
    RAISE EXCEPTION
      'channel task child workspace_id % does not match task % workspace %',
      NEW.workspace_id, NEW.task_id, parent_ws
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Inert PUBLIC EXECUTE on a trigger function trips the Supabase security
-- advisor; revoke it (trigger firing does not depend on the grant).
REVOKE EXECUTE ON FUNCTION public.channel_task_child_workspace_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS channel_task_participants_workspace_guard
  ON public.channel_task_participants;
CREATE TRIGGER channel_task_participants_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, task_id
  ON public.channel_task_participants
  FOR EACH ROW EXECUTE FUNCTION public.channel_task_child_workspace_guard();


ALTER TABLE public.channel_task_participants ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_task_participants
  FROM authenticated, anon;

-- Read model mirrors channel_tasks one hop out: workspace fence + (public
-- channel OR caller is a member of the thread's channel). Reads stay
-- channel-transparent by design — breakouts separate attention, not visibility
-- (§8: "a third member CAN read a pair's thread ... deliberate design").
CREATE POLICY channel_task_participants_member_select
  ON public.channel_task_participants
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND EXISTS (
      SELECT 1 FROM public.channel_tasks t
      WHERE t.id = channel_task_participants.task_id
        AND (
          is_channel_member(t.channel_id)
          OR EXISTS (
            SELECT 1 FROM public.channels c
            WHERE c.id = t.channel_id
              AND c.visibility = 'public'::text
          )
        )
    )
  );

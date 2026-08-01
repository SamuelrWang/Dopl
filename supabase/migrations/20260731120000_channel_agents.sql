-- Channels multiplayer wave 1 — `channel_agents`.
--
-- An AGENT is a first-class named entity inside a channel, summoned by its
-- OWNER (`/new-agent`) and running on that owner's machine. It is addressed by
-- handle (`@quartz`) under the one law: nothing acts unless addressed. N agents
-- per channel, multiple per user; the handle is auto-picked from a curated
-- mineral/star pool and is owner-renameable.
--
-- Write model is the channels house model EXACTLY (20260725130000): base
-- INSERT/UPDATE/DELETE REVOKEd from authenticated + anon, NO write policy, and
-- every write goes through the feature service on the service role. RLS here
-- carries only the READ model, mirroring `channel_messages_member_select`, and
-- feeds the realtime publication — the web's agent chips render live status, so
-- the table IS published (unlike `channel_tasks`, which was pulled back out in
-- 20260728010000).
--
-- ADDITIVE ONLY: new table, no existing table altered.
CREATE TABLE public.channel_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID NOT NULL REFERENCES public.channels(id)   ON DELETE CASCADE,
  -- Denormalized for the Realtime workspace filter + the RLS fence + the guard.
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The member who summoned it. The agent runs on THIS user's machine, and only
  -- this user may rename or dismiss it.
  owner_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The handle, as typed in an @-mention. Charset is the addressing contract:
  -- lowercase start, then lowercase alphanumerics and hyphens, 2..31 chars.
  name           TEXT NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{1,30}$'),
  -- summoned = created, not yet running; active = a session is working;
  -- parked = suspended, resumable; dismissed = retired (row kept for
  -- attribution of the messages it already authored).
  status         TEXT NOT NULL DEFAULT 'summoned'
                   CHECK (status IN ('summoned', 'active', 'parked', 'dismissed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One handle per channel, case-folded — `@Quartz` and `@quartz` are the same
-- agent. Expression unique index, mirroring `channels_workspace_slug_key`.
-- Deliberately channel-wide (not per owner): an @-mention resolves against the
-- channel, so two owners cannot both hold `quartz` in one room.
CREATE UNIQUE INDEX channel_agents_channel_name_key
  ON public.channel_agents (channel_id, lower(name));

CREATE INDEX channel_agents_channel_status_idx
  ON public.channel_agents (channel_id, status);

CREATE INDEX channel_agents_workspace_idx
  ON public.channel_agents (workspace_id);

CREATE INDEX channel_agents_owner_idx
  ON public.channel_agents (owner_user_id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the
-- parent channel's, keyed on NEW.channel_id — which this table has). UPDATE OF
-- workspace_id, channel_id only, so a status flip or a rename never re-fires it.
DROP TRIGGER IF EXISTS channel_agents_workspace_guard ON public.channel_agents;
CREATE TRIGGER channel_agents_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_agents
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_agents ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_agents FROM authenticated, anon;

-- Read model mirrors channel_messages: workspace fence + (public channel OR
-- caller is a channel member). An agent is visible to the whole room, not just
-- its owner — peers have to be able to @-address it.
CREATE POLICY channel_agents_member_select ON public.channel_agents
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (
      is_channel_member(channel_id)
      OR EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_agents.channel_id
          AND c.visibility = 'public'::text
      )
    )
  );

-- Realtime publish (idempotent; copy of the 20260717 pattern). The agent chips
-- bar shows live status, so this one stays published.
DO $$
BEGIN
  IF to_regclass('public.channel_agents') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename = 'channel_agents'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_agents;
  END IF;
END
$$;

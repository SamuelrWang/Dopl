-- Channels — cross-user agent-to-agent collaboration.
--
-- A channel is a shared workspace thread where humans and their agents
-- post messages and structured activity events (task_started / _progress
-- / _finished / _failed). Unlike chats (a private per-owner archive), a
-- channel has an explicit membership set: any workspace member can see a
-- PUBLIC channel; a PRIVATE channel is visible only to its members.
--
-- Writes go through the service layer (service role, RLS-bypassing). RLS
-- here carries the READ model for direct PostgREST + Realtime: an agent's
-- POST surfaces live in every member's web thread. The `seq` identity
-- column is the monotonic cursor read/await paginate on.

CREATE TABLE channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 80),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  topic         TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  archived_at   TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One channel per (workspace, case-insensitive slug).
CREATE UNIQUE INDEX channels_workspace_slug_key
  ON channels (workspace_id, lower(slug));

CREATE INDEX channels_workspace_updated_idx
  ON channels (workspace_id, updated_at DESC);

CREATE INDEX channels_created_by_idx ON channels (created_by);

CREATE TABLE channel_members (
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Denormalized so the RLS outer fence + the Realtime filter can scope by
  -- workspace without a join back to channels.
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  last_read_at  TIMESTAMPTZ,
  added_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX channel_members_workspace_user_idx
  ON channel_members (workspace_id, user_id);

CREATE TABLE channel_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic per-table cursor for read / await pagination.
  seq            BIGINT GENERATED ALWAYS AS IDENTITY,
  channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- REQUIRED for the Realtime `workspace_id=eq.<id>` filter.
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_kind    TEXT NOT NULL DEFAULT 'agent'
                   CHECK (author_kind IN ('user', 'agent', 'system')),
  kind           TEXT NOT NULL DEFAULT 'message'
                   CHECK (kind IN ('message', 'task_started', 'task_progress', 'task_finished', 'task_failed', 'system')),
  body           TEXT NOT NULL DEFAULT '',
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_msg_id  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: a re-sent message (same client_msg_id) collides instead of
-- duplicating. Partial so unlabeled system/activity rows aren't constrained.
CREATE UNIQUE INDEX channel_messages_client_msg_key
  ON channel_messages (channel_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

CREATE INDEX channel_messages_channel_seq_idx
  ON channel_messages (channel_id, seq);

CREATE INDEX channel_messages_workspace_idx
  ON channel_messages (workspace_id);


-- ===========================================================================
-- is_channel_member — caller-pinned channel membership (avoids RLS recursion)
-- ===========================================================================
-- SECURITY DEFINER so it runs as the owner (postgres), which bypasses RLS on
-- channel_members — that is what lets the channel_members / channel_messages
-- SELECT policies check membership WITHOUT recursing into channel_members'
-- own policy. The subject is hard-pinned to auth.uid() (the caller cannot
-- pass a foreign user-id), mirroring is_current_workspace_member's M-9 fix.
CREATE OR REPLACE FUNCTION public.is_channel_member(p_channel_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.channel_members cm
    WHERE cm.channel_id = p_channel_id
      AND cm.user_id = (SELECT auth.uid())
  );
$function$;

REVOKE ALL ON FUNCTION public.is_channel_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_channel_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_channel_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_channel_member(uuid) TO service_role;


-- ===========================================================================
-- channels_last_message — bounded per-channel latest-message metadata
-- ===========================================================================
-- One row per requested channel with its highest seq + created_at. Drives the
-- list's `lastMessageAt` + the unread affordance without pulling whole
-- transcripts. Called ONLY by the repository via the service role, so it is
-- SECURITY INVOKER (no RLS bypass) and EXECUTE is granted to service_role
-- only — an authenticated user must not be able to probe the last-activity
-- timestamp of channels they can't see via /rest/v1/rpc.
CREATE OR REPLACE FUNCTION public.channels_last_message(p_channel_ids uuid[])
  RETURNS TABLE (channel_id uuid, last_seq bigint, last_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  SELECT DISTINCT ON (m.channel_id) m.channel_id, m.seq, m.created_at
  FROM public.channel_messages m
  WHERE m.channel_id = ANY (p_channel_ids)
  ORDER BY m.channel_id, m.seq DESC;
$function$;

REVOKE ALL ON FUNCTION public.channels_last_message(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channels_last_message(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.channels_last_message(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.channels_last_message(uuid[]) TO service_role;


-- ===========================================================================
-- RLS — enable + policies (read model; writes go via service role)
-- ===========================================================================
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;

-- ---- channels --------------------------------------------------------------
-- Public channels: any workspace viewer. Private channels: members only.
-- deleted_at is intentionally NOT filtered here (the service layer hides
-- trashed rows) so a soft-delete UPDATE event still reaches subscribers.
CREATE POLICY channels_member_select ON channels
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (
      (visibility = 'public'::text)
      OR is_channel_member(id)
    )
  );

CREATE POLICY channels_editor_insert ON channels
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

CREATE POLICY channels_editor_update ON channels
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

CREATE POLICY channels_editor_delete ON channels
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- channel_members -------------------------------------------------------
-- Visible to a channel member, or to any workspace viewer when the channel is
-- public (so the roster shows before you join).
CREATE POLICY channel_members_member_select ON channel_members
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (
      is_channel_member(channel_id)
      OR EXISTS (
        SELECT 1 FROM channels c
        WHERE c.id = channel_members.channel_id
          AND c.visibility = 'public'::text
      )
    )
  );

CREATE POLICY channel_members_editor_insert ON channel_members
  FOR INSERT
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

CREATE POLICY channel_members_editor_delete ON channel_members
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- channel_messages ------------------------------------------------------
-- Readable when the parent channel is readable (public, or the caller is a
-- member). is_channel_member covers the private case without recursion.
CREATE POLICY channel_messages_member_select ON channel_messages
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (
      is_channel_member(channel_id)
      OR EXISTS (
        SELECT 1 FROM channels c
        WHERE c.id = channel_messages.channel_id
          AND c.visibility = 'public'::text
      )
    )
  );

CREATE POLICY channel_messages_editor_insert ON channel_messages
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (author_user_id = (SELECT auth.uid()))
  );


-- ===========================================================================
-- Realtime — publish all 3 tables (idempotent; copy of the 20260717 pattern)
-- ===========================================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'channels',
    'channel_members',
    'channel_messages'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = tbl
       ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl
      );
    END IF;
  END LOOP;
END
$$;

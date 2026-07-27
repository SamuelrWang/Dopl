-- Channels v1.2 — agent presence heartbeat.
--
-- Web needs to show "Alice's agent is listening / offline" so a human knows
-- whether an addressed request will run now or wait. The desktop listener is
-- Node/HTTP-only (no browser socket), so this is a plain heartbeat row the
-- desktop UPSERTs every ~30s while running + signed in — NOT browser Realtime
-- Presence. "online / listening" is derived as last_seen_at > now() - 90s.
--
-- One row per (user, workspace). Writes are service-role only (the heartbeat
-- route upserts); every workspace member may READ presence (so the roster's
-- online dots render). Base authenticated/anon DML grants revoked to match the
-- channels hardening. Added to the realtime publication so web reflects a
-- listener coming online / dropping off live.

CREATE TABLE agent_presence (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'listening',
  PRIMARY KEY (user_id, workspace_id)
);

-- The PK leads with user_id (covers the user FK + per-user upsert). Add a
-- covering index for the workspace FK + the "who's online in this workspace"
-- read.
CREATE INDEX agent_presence_workspace_idx
  ON agent_presence (workspace_id);


-- ===========================================================================
-- RLS — workspace members read; writes go via service role
-- ===========================================================================
ALTER TABLE agent_presence ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.agent_presence FROM authenticated, anon;

-- Any workspace member may see any member's presence (needed to address the
-- right online agent). No per-channel scoping — presence is workspace-wide.
CREATE POLICY agent_presence_member_select ON agent_presence
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));


-- ===========================================================================
-- Realtime — publish (idempotent; copy of the 20260717 pattern)
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.agent_presence') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'agent_presence'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_presence;
  END IF;
END
$$;

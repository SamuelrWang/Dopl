-- Channels rollback §3.5 (read-session-state) — `channel_sessions`.
--
-- WHY IT EXISTS. Named agents are gone (rollback §1); a SESSION is now the only
-- agent identity there is, and its live state ("working / idle / ended", plus
-- the friendly handle and the thread it is on) lives in the DESKTOP main
-- process (`dopl-desktop-app/main/session-summary.js`). The MCP server is
-- remote, so "what is flint doing?" asked from Claude Desktop has nowhere to
-- read that state FROM. This table is that place: one row per live session the
-- operator's desktop is running, so `dopl_channel(op="read_sessions")` can
-- answer it.
--
-- THE DELIVERY MODEL, AND WHY IT IS NOT agent_presence. `agent_presence`
-- heartbeats every ~30s per listener unconditionally (the quadratic always-on
-- term the rollback is shedding — plan §5). This table is the opposite: the
-- desktop writes a row only when a session's DERIVED state actually CHANGES
-- (`session-summary.js` already coalesces to a digest and fires only on a real
-- change), which is a handful of writes per session lifetime versus 120
-- heartbeats/hour. It carries the SAME projection the pills show — F-142's
-- rule that a session's state is derived ONCE and every consumer is handed the
-- result — so the server does no second derivation; it stores and returns.
--
-- NOT PUBLISHED TO REALTIME. The web pills read the desktop over IPC (F-142),
-- not this table; its one reader is the MCP op, on demand. A realtime doorbell
-- here would be a cost with no consumer.
--
-- ADDITIVE ONLY: new table, no existing table altered.
CREATE TABLE public.channel_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID NOT NULL REFERENCES public.channels(id)   ON DELETE CASCADE,
  -- Denormalized for the RLS fence + the workspace-consistency guard, the same
  -- as channel_agents.
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The member whose MACHINE is running this session. A session runs on exactly
  -- one member's machine, and read-session-state answers about the CALLER'S OWN
  -- sessions, so the read is scoped to this column.
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The desktop's stable session key (channel:thread). It survives the things
  -- that replace the session OBJECT while the operator's mental model does not
  -- change (an idle park + lazy resume, a crash resume), so it is the upsert
  -- key rather than the ephemeral internal session id.
  session_key    TEXT NOT NULL,
  -- The thread (task) the session is working, or NULL for a responder with no
  -- first-class thread. Wire/storage name `task` == domain name `thread`.
  task_id        UUID REFERENCES public.channel_tasks(id) ON DELETE SET NULL,
  -- The friendly handle the pills show (flint / onyx / …), from the surviving
  -- generator (`agent-names`). Charset-bounded like channel_agents.name so it
  -- cannot carry a newline into a rendered result.
  name           TEXT NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{1,30}$'),
  -- The reduced pill state. Closed set (CHECK): the desktop's session-summary
  -- vocabulary, and deliberately NO 'thinking' (it needs streaming, which is
  -- off — rollback §3.3).
  state          TEXT NOT NULL CHECK (state IN ('working', 'idle', 'ended')),
  -- Counterparty-influenced display text; the desktop neutralizes both before
  -- it writes them (session-summary `displayText`), and the read renders them
  -- inside the tool's untrusted-content discipline regardless.
  channel_name   TEXT,
  thread_title   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (member, session key) — the desktop upserts the whole live set on
-- every state change, keyed on this pair.
CREATE UNIQUE INDEX channel_sessions_user_key_key
  ON public.channel_sessions (user_id, session_key);

-- The read filter: the caller's own sessions, optionally narrowed to one
-- channel.
CREATE INDEX channel_sessions_user_channel_idx
  ON public.channel_sessions (user_id, channel_id);

CREATE INDEX channel_sessions_workspace_idx
  ON public.channel_sessions (workspace_id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the
-- parent channel's, keyed on NEW.channel_id). UPDATE OF workspace_id,
-- channel_id only, so a state flip never re-fires it.
DROP TRIGGER IF EXISTS channel_sessions_workspace_guard ON public.channel_sessions;
CREATE TRIGGER channel_sessions_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_sessions
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_sessions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_sessions FROM authenticated, anon;

-- Read model: OWN sessions only, within the workspace. Unlike channel_agents
-- (an agent was visible to the whole room so peers could @-address it), a
-- session belongs to one member and read-session-state answers about the
-- caller's own machine, so a peer has no business reading it. The service
-- (session-state-service) uses the RLS-bypassing admin client and enforces the
-- same user scope; this policy is the belt behind it.
CREATE POLICY channel_sessions_owner_select ON public.channel_sessions
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND user_id = (SELECT auth.uid())
  );

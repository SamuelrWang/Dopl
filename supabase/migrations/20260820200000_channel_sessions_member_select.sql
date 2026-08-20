-- 2026-08-20 — PEER AGENT VISIBILITY (Samuel's Agents-tab ruling): a channel's
-- MEMBERS may now read each other's session STATE rows for that channel.
--
-- WHAT CHANGED AND WHAT DID NOT. The owner-only SELECT policy shipped with the
-- table (20260805120000) because its one reader was `read_sessions`, the MCP op
-- answering about the CALLER'S OWN machine. The Agents tab now renders peer
-- cards — "Anthony's agent is working this thread" — which is exactly the
-- projection this table carries: name, state, thread. STATE ONLY: nothing in a
-- row exposes a session's transcript, tools, or tokens, and the write model is
-- untouched (service-role only; the desktop's own push).
--
-- The MEMBER fence is the channel's, not the workspace's: `is_channel_member`
-- is the caller-pinned SECURITY DEFINER helper every channels policy uses.
-- The owner policy is REPLACED by the wider one (a member is always able to
-- read their own rows — they are a member of their own channels).
DROP POLICY IF EXISTS channel_sessions_owner_select ON public.channel_sessions;
CREATE POLICY channel_sessions_member_select ON public.channel_sessions
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND is_channel_member(channel_id)
  );

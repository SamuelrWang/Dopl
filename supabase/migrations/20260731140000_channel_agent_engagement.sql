-- Channels multiplayer — AGENT ENGAGEMENT state on `channel_agents`.
--
-- THE MODEL. An agent is IDLE (it sees everything in the room and acts on
-- nothing) or ENGAGED (it also acts on UNTAGGED messages from HUMANS in that
-- channel). Tagging an agent — `to_agent` / `@handle` — ENGAGES it. An
-- AGENT-AUTHORED message never engages anyone: that is the loop brake, and it
-- is absolute, so the server refuses to stamp these columns from a post that
-- carries `metadata.author_agent_id` or an `agent` author kind.
--
-- WHAT THE SERVER PROMISES, EXACTLY. `engaged_at` is a FACT — the moment a
-- human last addressed this agent. EXPIRY IS A POLICY, and it is NOT enforced
-- here or in the service: no TTL sweep, no cron, no derived boolean. The
-- desktop applies `ENGAGEMENT_TTL_MS` (`src/features/channels/constants.ts`,
-- 60 min) against this timestamp and refreshes engagement by ACTING. The server
-- only records. Keeping the policy off the server is what lets the window
-- change without a migration, and what stops two machines disagreeing about
-- whether a row "is" engaged when only one of them swept it.
--
-- `engaged_by` is the human who engaged it: the audit trail ("who is this
-- listening for"), and the second person — beside the owner — permitted to
-- disengage it (`PATCH /agents/[agentId] {op:"disengage"}`).
--
-- ADDITIVE ONLY: two nullable columns on an existing table. No policy, grant,
-- trigger, publication or index semantics change. `channel_agents` is in the
-- realtime publication, so the columns ride the existing INSERT/UPDATE stream
-- to the web's agent chips with no publication edit. The workspace-consistency
-- guard is scoped `UPDATE OF workspace_id, channel_id`, so an engagement write
-- never re-fires it.
ALTER TABLE public.channel_agents
  ADD COLUMN IF NOT EXISTS engaged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engaged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.channel_agents.engaged_at IS
  'When a HUMAN last addressed this agent. A fact, not a state: expiry is the desktop''s policy (ENGAGEMENT_TTL_MS), never swept server-side. Never set from an agent-authored post.';

COMMENT ON COLUMN public.channel_agents.engaged_by IS
  'The human who engaged it. Audit trail, and the one non-owner allowed to disengage.';

-- The engaged set of a room is read per channel ("which of my agents is
-- listening"), and only ever the non-null rows — a partial index keeps it the
-- size of the live set rather than the roster.
CREATE INDEX IF NOT EXISTS channel_agents_engaged_idx
  ON public.channel_agents (channel_id, engaged_at)
  WHERE engaged_at IS NOT NULL;

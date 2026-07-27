-- Channels v1.2 — per-member responding-agent tool profile.
--
-- Each channel member controls the tool scope THEIR responding agent runs
-- with in this channel (the operator controls their own machine):
--   'full'      — no restriction (current behavior; the default so nothing
--                 tightens silently for existing members).
--   'dopl_only' — only the Dopl MCP tools + safe reads.
--   'read_only' — read / safe tools only (no Bash write, no Write / Edit).
-- The desktop maps this to the spawned agent's --allowedTools flags.
--
-- A plain per-row preference (no RLS / grant changes — writes stay
-- service-role, the only mutator is the member updating their OWN row via
-- PATCH /members). The channel_members workspace-guard trigger fires only on
-- UPDATE OF workspace_id/channel_id, so an agent_tool_profile UPDATE never
-- trips it — same as notify_scope. Default-tighten (e.g. to 'dopl_only') is
-- deferred as a future product decision.

ALTER TABLE public.channel_members
  ADD COLUMN IF NOT EXISTS agent_tool_profile TEXT NOT NULL DEFAULT 'full'
    CHECK (agent_tool_profile IN ('full', 'dopl_only', 'read_only'));

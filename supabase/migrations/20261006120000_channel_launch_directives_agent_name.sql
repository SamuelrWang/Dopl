-- ============================================================================
-- AN AGENT THAT LAUNCHES AN AGENT MUST NAME IT (Samuel, 2026-09-15)
-- ============================================================================
-- Verbatim: *"if agents are spinning up agents, they should be the ones that are
-- naming the agent. Shouldn't be a nameless agent. And certainly shouldn't be an
-- agent with the id as the name."*
--
-- ⚠ **THE CAPABILITY DID NOT EXIST, WHICH IS THE WHOLE DEFECT.** A launch filed
-- over MCP (`dopl_channel` op="manage" action="launch") could carry a goal, a
-- model, a template, a colour and a posture — and no name. There was no column to
-- put one in and no argument to send one with, so EVERY agent an agent launched
-- was nameless by construction, and rendered on every card as its own eight-
-- character instance id. `docs/specs/agent-id-visibility.md` carries the trace.
--
-- ⚠ **`target_name` COULD NOT BE REUSED, AND THE CONSTRAINT IS WHY.**
-- `20260907120000` §5 pins `target_name` to `kind='rename'` in both directions
-- (`kind <> 'rename' OR target_name IS NOT NULL` AND `kind = 'rename' OR
-- target_name IS NULL`), which is correct: that column is the RENAME's argument
-- and a launch carrying one would be a row two verbs could read. This is a second
-- named column for a second verb, on that migration's own reasoning against a
-- `payload JSONB` — the desktop's narrowing (`main/launch-directive-wire.js ›
-- directiveFrom`) is a LITERAL WHITELIST, and a blob passes a whitelist as one
-- opaque key.
--
-- ⚠ **NULLABLE AT REST, REQUIRED AT THE TOOL, AND THAT SPLIT IS DELIBERATE.**
--   · The DB admits NULL on a launch, because an OLDER `@dopl/mcp-server` build
--     in the field files rows this schema still has to accept (INVARIANTS §13 —
--     an older peer is a supported peer). Those rows are named `New Agent` by the
--     machine that claims them (`main/launch-directive-spawn.js`), which is the
--     same face every other unnamed agent wears.
--   · `packages/mcp-server/src/tools/channel-ops-launch.ts` REFUSES a nameless
--     launch, because that is the only layer that can say WHAT TO PASS INSTEAD. A
--     `NOT NULL` here would answer the same question with `23502`.
-- ⚠ **AND IT MAY NOT APPEAR ON ANY OTHER KIND**, which is the half a constraint
-- can carry: an `end` or a `set_agent_mode` carrying an agent name is a row whose
-- verb and whose argument disagree, and the whitelist on the far side would read
-- it anyway.
--
-- ⚠ THE CHARSET IS `20260907120000` §3's `target_name` RULE, CHARACTER FOR
-- CHARACTER, for that rule's own reasons: 60 is `main/agent-names.js › MAX_NAME`
-- (the store that will actually hold it, not `agent_templates.name`'s 120), and
-- control / zero-width / bidi characters are REFUSED rather than stripped —
-- stripping stores something other than what was sent and says nothing about it,
-- a bidi override renders a card that reads backwards, and this string is echoed
-- into an MCP result where a newline can forge a line in that result.
-- ⚠ **AND `''` IS NOT LEGAL HERE, WHERE IT IS ON `target_name`.** An empty rename
-- means CLEAR — a real gesture with a real outcome. An empty launch name means
-- the caller sent a field and said nothing in it, and the honest answer to that
-- is a refusal, not a nameless agent.

-- ===========================================================================
-- 1. THE COLUMN
-- ===========================================================================
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_agent_name_charset_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_agent_name_charset_check
  CHECK (
    agent_name IS NULL OR (
      char_length(agent_name) BETWEEN 1 AND 60
      AND agent_name = btrim(agent_name)
      AND agent_name !~ '[​-‏ - ⁠-⁯﻿]'
      AND agent_name !~ '[​-‏ - ⁠-⁯﻿]'
    )
  );

-- ===========================================================================
-- 2. IT BELONGS TO `launch` AND TO NOTHING ELSE
-- ===========================================================================
-- ⚠ ONE DIRECTION ONLY — "not on another kind" — where `target_name` is pinned in
-- BOTH. The other direction ("a launch must carry one") is the `NOT NULL` this
-- migration's header declines: an older client's row must still land.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_agent_name_kind_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_agent_name_kind_check
  CHECK (kind = 'launch' OR agent_name IS NULL);

COMMENT ON COLUMN public.channel_launch_directives.agent_name IS
  'What to call the agent this LAUNCH creates (Samuel 2026-09-15). Required by the MCP tool, nullable here so an older client''s row still lands; a NULL one is named "New Agent" by the claiming machine. Never set on any other kind.';

-- ===========================================================================
-- 3. `applied_agent_name` — WHAT THE AGENT IS ACTUALLY CALLED
-- ===========================================================================
-- ⚠ **TWO COLUMNS BECAUSE THEY ARE TWO FACTS, EXACTLY AS `start_*` AND `applied_*` ARE.**
-- `agent_name` is what the caller ASKED for; this is what the machine STORED. They differ
-- whenever the uniqueness rule fires — Samuel, 2026-09-15: *"If a user launches an agent with the
-- same name, let's just have the name auto-renamed to that name and -1 … it will automatically
-- auto-resolve to coder-1 … coder-2 and so on and so forth."*
--
-- ⚠ **WITHOUT IT THE LAUNCHER CANNOT LEARN THE NAME IT MUST NOW USE TO ADDRESS THE AGENT.** The
-- whole point of the ruling is that `@coder` is the address; an orchestrator that asked for
-- "Coder", got "Coder-1", and was told only its id would tag the WRONG agent on its next post.
-- Echoing the REQUEST would be right whenever nothing collided and confidently wrong exactly when
-- it mattered — which is the argument `20260910120000` makes for the posture echo, applied again.
--
-- ⚠ **WRITTEN BY THE DECIDE, NEVER BY THE CREATE**, and `NULL` on `done` / `refused` for the
-- reason the posture echo gives: a retried decide must not leave a stale name standing beside a
-- refusal. ⚠ `NULL` on a LAUNCHED row is an older desktop that did not report one — "not
-- reported", never "unnamed".
--
-- ⚠ THE CHARSET IS `agent_name`'s, character for character, and for the same reasons.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_agent_name TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_agent_name_charset_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_agent_name_charset_check
  CHECK (
    applied_agent_name IS NULL OR (
      char_length(applied_agent_name) BETWEEN 1 AND 60
      AND applied_agent_name = btrim(applied_agent_name)
      AND applied_agent_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
      AND applied_agent_name !~ '[​-‏ - ⁠-⁯﻿]'
    )
  );

-- ⚠ THE KIND FENCE IS `agent_name`'s TOO — only a launch has an agent to name.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_agent_name_kind_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_agent_name_kind_check
  CHECK (kind = 'launch' OR applied_agent_name IS NULL);

COMMENT ON COLUMN public.channel_launch_directives.applied_agent_name IS
  'What the agent is ACTUALLY called, reported by the machine that launched it (Samuel 2026-09-15). Differs from agent_name when the uniqueness rule appended -1/-2. NULL on a non-launch kind, on a refusal, and on a desktop older than this wave.';

-- ===========================================================================
-- 4. NO GRANT, NO POLICY, NO INDEX
-- ===========================================================================
-- ⚠ STATED RATHER THAN OMITTED, on `20260928130000`'s rule: an unstated absence
-- is indistinguishable from a forgotten one. This column rides an EXISTING row
-- that already carries its own RLS and its own operator fence
-- (`operator_user_id`); it is read only by the operator whose machine claims the
-- directive, never filtered on, and never joined — so there is nothing to grant
-- that the row does not already grant and nothing to index.

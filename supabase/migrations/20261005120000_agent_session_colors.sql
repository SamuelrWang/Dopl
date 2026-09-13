-- AGENT COLOURS — one colour per LIVE agent per CHANNEL, unique across MEMBERS
-- (Samuel, 2026-09-13; docs/specs/agent-colors.md).
--
-- His words: *"each channel can have its own set of colors. We have to make sure
-- that there aren't the same colors in a channel. … If my agent is a specific
-- shade of red, then the other user should not be able to launch an agent with
-- that specific color of red either. … once the agent has ended, that color needs
-- to be returned to the color bank to be used again."*
--
-- ── WHY THE COLUMN IS ON THIS TABLE AND NOT ON `channel_agents` OR A NEW ONE ──
--
-- A colour belongs to a SESSION IN A CHANNEL, which is exactly this row's
-- identity (`(user_id, session_key)`, and `session_key` is `<channel>:<thread>:
-- <agent>`). `channel_sessions` is also the ONE place both halves of the rule can
-- be evaluated at once: it holds EVERY member's live sessions for a channel, so
-- "no two agents in this room share a colour" is a constraint over one table
-- rather than a cross-machine agreement nobody can enforce. A side table would
-- need its own lifecycle, and the lifecycle is the hard half — see the next
-- block.
--
-- ── THE LIVE PREDICATE IS `state <> 'ended'`, AND THERE IS NO `ended_at` ──
--
-- ⚠ **THIS TABLE HAS NO SOFT-DELETE AND MUST NOT GROW ONE.** The desktop pushes
-- its WHOLE live set (`main/session-state-push.js`) and the server's reconcile
-- DELETES BY OMISSION (`repository-sessions.ts › replaceSessionStates`), so an
-- ended session's row is gone rather than flagged — and `main/session-state-push-
-- wire.js › liveForWire` drops `state: 'ended'` before it ever reaches the wire.
-- So "returned to the bank" needs no sweep, no cron and no application code: the
-- row leaves, and the partial index below stops counting it in the same
-- statement. The `state <> 'ended'` half of the predicate is the belt for the one
-- row shape that can still be at rest with that value — a row written by a
-- desktop older than `liveForWire`.
--
-- ⚠ **AND THAT IS WHY "ENDED AGENTS KEEP THEIR OLD POSTS, WITHOUT A COLOUR" IS
-- FREE.** The transcript resolves a post's colour from the LIVE projection at
-- render (`view-model.ts › AuthorIndex.agents`); with the row gone there is no
-- colour to resolve and `message-box-agent.tsx` draws the neutral box. Nothing
-- rewrites a message, and nothing stores a colour on one.
--
-- ── THE UNIQUENESS IS THE DATABASE'S, WHICH IS THE WHOLE POINT ──
--
-- ⚠ **TWO MEMBERS' DESKTOPS CANNOT AGREE ABOUT ANYTHING.** They do not talk, they
-- push independently, and neither can see the other's registry — so a colour
-- picker that enforced uniqueness in the UI would be advisory at best, and the
-- first simultaneous launch would produce two red agents in one room. The index
-- below is the only statement of the rule that both machines pass through.
-- `src/features/channels/server/session-colors.ts` assigns the FIRST FREE key
-- against it; the launch-directive lane answers 409 with the free set when the
-- caller named a taken one.
--
-- ⚠ **RLS IS UNTOUCHED, DELIBERATELY.** The column rides the row: the owner
-- SELECT policy (`20260820200000`) and the channel-scoped admin read both carry
-- it with no change, and a colour is the LEAST private thing on this row — it is
-- drawn on every member's transcript by design, which is why it is emitted by
-- `collab-dto.ts › mapPeerSessionStateRow` and NOT in
-- `OPERATOR_ONLY_SESSION_COLUMNS`.
--
-- ⚠ **NO GRANT STATEMENT, AND THAT IS NOT AN OMISSION.** `20260822150000` took
-- column privileges away from `authenticated` for the operator-only block; a
-- column added by `ALTER TABLE` inherits nothing from a column-level GRANT list,
-- so this one is simply not in it, and every read that renders it runs on the
-- admin client behind a service fence.
--
-- ADDITIVE ONLY. Rollback:
--   DROP INDEX IF EXISTS public.channel_sessions_channel_color_live_key;
--   ALTER TABLE public.channel_sessions DROP CONSTRAINT IF EXISTS channel_sessions_color_check;
--   ALTER TABLE public.channel_sessions DROP COLUMN IF EXISTS color;

ALTER TABLE public.channel_sessions
  ADD COLUMN IF NOT EXISTS color TEXT;

-- ⚠ THE KEY SET, AS A REGEX OVER `agent-01 … agent-16` RATHER THAN A 16-ITEM
-- `IN` LIST. The anchored pattern says "two digits, 01 through 16" in one place,
-- which is the same shape `channel_sessions.name`'s own CHECK uses, and it cannot
-- acquire a duplicate or lose a member in a hand-typed list.
-- ⚠ NULL IS LEGITIMATE AND IS THE ORDINARY VALUE ON EVERY EXISTING ROW: a desktop
-- older than this wave reports no colour, and a session that never got one (the
-- bank was full — 17 live agents in one channel) is uncoloured rather than
-- refused. The CHECK's own `IS NULL` branch is what keeps that legal.
-- ⚠ SEPARATE `ADD CONSTRAINT` STATEMENT so a re-run over a tree where the column
-- already exists still lands the constraint — the `ADD COLUMN IF NOT EXISTS`
-- above would otherwise skip an inline CHECK with it. Same two-step
-- `20260909120000` uses, for the same reason.
ALTER TABLE public.channel_sessions
  DROP CONSTRAINT IF EXISTS channel_sessions_color_check;
ALTER TABLE public.channel_sessions
  ADD CONSTRAINT channel_sessions_color_check
  CHECK (color IS NULL OR color ~ '^agent-(0[1-9]|1[0-6])$');

-- 🔒 **THE RULE ITSELF.** One colour, one channel, one LIVE agent — across every
-- member of the room.
--
-- ⚠ **PARTIAL ON BOTH ARMS, AND EACH ARM DOES DIFFERENT WORK.** `color IS NOT
-- NULL` is what lets an unlimited number of uncoloured sessions coexist (NULLs are
-- distinct in a unique index anyway, but stating it keeps the index off every row
-- that has no colour). `state <> 'ended'` is the LIVE half — the colour returns to
-- the bank the instant the session stops, without anybody clearing the column.
-- ⚠ **`channel_id` FIRST**, so the index also serves the taken-set read
-- (`repository-session-colors.ts`), which filters on channel and projects colour.
-- ⚠ **NOT SCOPED TO `user_id`.** Scoping it there is the same index with the rule
-- deleted: two members could each hold `agent-01` in one room, which is precisely
-- what Samuel ruled against.
DROP INDEX IF EXISTS public.channel_sessions_channel_color_live_key;
CREATE UNIQUE INDEX channel_sessions_channel_color_live_key
  ON public.channel_sessions (channel_id, color)
  WHERE color IS NOT NULL AND state <> 'ended';

COMMENT ON COLUMN public.channel_sessions.color IS
  'AGENT COLOUR KEY — one of agent-01..agent-16, the CSS token set --agent-color-NN '
  '(src/app/globals.css + apps/desktop-ui/src/styles/tokens.css). UNIQUE per channel '
  'among LIVE sessions (channel_sessions_channel_color_live_key), across members: two '
  'people cannot run the same colour in one room. NULL = none assigned (a desktop '
  'older than 2026-09-13, or a channel whose 16 keys were all taken). Peer-visible by '
  'design — it is drawn on every member''s transcript — so it is NOT in '
  'collab-dto.ts OPERATOR_ONLY_SESSION_COLUMNS. Freed by the row LEAVING: the desktop '
  'push replaces its whole live set and the reconcile deletes by omission, so nothing '
  'clears this column and no sweep exists.';

-- ── THE LAUNCH LANE'S HALF: THE COLOUR AN MCP LAUNCH **ASKED** FOR ──────────
--
-- ⚠ **A SECOND TABLE IN ONE MIGRATION, AND THE JOIN IS NOT ARITHMETIC.** Without
-- this column `dopl_channel(op="manage", action="launch", color=…)` would be
-- accepted, validated, answered — and then silently dropped on the way to the
-- machine that starts the agent, because a directive is the ONLY thing that
-- crosses to a desktop on that lane. A parameter the server takes and the spawn
-- cannot see is worse than no parameter, so the two columns ship together or
-- neither does.
--
-- ⚠ **IT IS A REQUEST, NOT THE ASSIGNMENT.** The assignment is
-- `channel_sessions.color` above, and the unique index there is the only
-- authority. This records what the caller named (or what the server picked as
-- FIRST FREE when they named nothing) at the moment the directive was filed; by
-- the time the machine claims it, seconds or minutes later, another member may
-- have taken it — in which case the push resolves the collision and the agent
-- wears the next free key. **The 409 at create time is a courtesy, never a
-- reservation**, exactly like the posture pair beside it: the server cannot hold
-- a colour for a spawn that may never happen.
--
-- ⚠ **NO INDEX AND NO UNIQUENESS HERE.** Two pending directives naming one
-- colour is a legitimate state (only one of them will ever spawn), and a unique
-- index on a REQUEST would refuse the second of two retries.
-- ⚠ SAME CHECK AS THE SESSION COLUMN, character for character — a value legal on
-- one and refused by the other is a directive that can never be honoured.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS color TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_color_check;
ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_color_check
  CHECK (color IS NULL OR color ~ '^agent-(0[1-9]|1[0-6])$');

COMMENT ON COLUMN public.channel_launch_directives.color IS
  'THE AGENT COLOUR THIS LAUNCH ASKED FOR — agent-01..agent-16, or NULL for "did not '
  'ask". A REQUEST, never a reservation: the only authority is '
  'channel_sessions.color''s per-channel live unique index, and the machine''s push '
  'resolves a collision to the next free key. NULL on every kind except launch, and '
  'on every directive filed by a caller that named no colour.';

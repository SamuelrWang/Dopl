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
  -- Counterparty-influenced display text.
  --
  -- BOUNDED HERE, F-145. These two shipped as unbounded TEXT with no CHECK while
  -- every sibling column on this table and on `channels` is constrained, and the
  -- comment that stood here justified it by saying the desktop neutralizes them
  -- before writing — which is a claim about a WRITER THAT DOES NOT EXIST YET
  -- (F-144 flags the desktop push as the delivery gap). The first code to write
  -- these columns will be written after this file, by someone reading this file,
  -- so the constraint has to lead rather than follow. They are peer-influenced
  -- strings that render into a `dopl_channel` result, so the class is the one
  -- 20260731100000_channels_name_topic_bounds.sql sets: length, trimmed, no
  -- control characters, no zero-width / bidi / line-separator characters. NULL
  -- is legitimate (a session with no channel name resolved, a responder with no
  -- thread), so each predicate carries its own NULL branch.
  --
  -- Bounds match what the value MIRRORS: `channels.name` is 1..120 and
  -- `channel_tasks.title` is 1..200. Not stricter than either, so a legitimate
  -- name or title can never be refused on the way into this projection.
  channel_name   TEXT CHECK (
                   channel_name IS NULL OR (
                     char_length(channel_name) BETWEEN 1 AND 120
                     AND channel_name = btrim(channel_name)
                     AND channel_name !~ '[[:cntrl:]]'
                     AND channel_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
                   )
                 ),
  thread_title   TEXT CHECK (
                   thread_title IS NULL OR (
                     char_length(thread_title) BETWEEN 1 AND 200
                     AND thread_title = btrim(thread_title)
                     AND thread_title !~ '[[:cntrl:]]'
                     AND thread_title !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
                   )
                 ),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── INDEXES, and the rule that decided this set (F-145) ─────────────────────
--
-- This table sits between two migrations that pull in opposite directions:
-- 20260731150000 DROPPED `channel_agents_engaged_idx` because an index with no
-- query behind it is pure write amplification, and 20260802180000 ADDED a
-- covering index for every unindexed foreign key because a cascade without one
-- is a sequential scan (and the `unindexed_foreign_keys` advisor lint it keeps
-- at zero).
--
-- THEY DO NOT ACTUALLY CONFLICT: a foreign key IS a query. The engaged index was
-- a PARTIAL index on a non-FK column that no statement named; an FK-covering
-- index is named by every `DELETE FROM workspaces` / `DELETE FROM channels` /
-- `DELETE FROM channel_tasks`. So the rule is: an index exists here only if a
-- named statement uses it, and an FK cascade counts as one. That yields exactly
-- four, one per reason, with all four FK columns covered as a LEADING column
-- (which is what the advisor checks) and nothing spare on the upsert path.
--
-- WHAT CHANGED against the first cut: `channel_sessions_user_channel_idx
-- (user_id, channel_id)` is GONE and `(channel_id)` takes its place. The old one
-- served the narrowed read but covered NO foreign key — `user_id` leads it, and
-- `user_id` is already led by the unique key below — so `channel_id`'s cascade
-- had no index at all. The narrowed read loses nothing measurable: it enters on
-- the unique index's `user_id`, and one member's live sessions are bounded by
-- the desktop's own window budget (MAX_SESSION_WINDOWS), so the channel
-- narrowing filters a handful of rows rather than scanning a table.

-- One row per (member, session key) — the desktop upserts the whole live set on
-- every state change, keyed on this pair. ALSO the read's entry point
-- (`WHERE user_id = … AND workspace_id = …`) and the `user_id` FK cover.
CREATE UNIQUE INDEX channel_sessions_user_key_key
  ON public.channel_sessions (user_id, session_key);

-- FK cover: `channels(id) ON DELETE CASCADE`. Also the column the read narrows
-- on when `?channelId=` is passed.
CREATE INDEX channel_sessions_channel_idx
  ON public.channel_sessions (channel_id);

-- FK cover: `workspaces(id) ON DELETE CASCADE`. NOT a read index — no statement
-- filters on workspace_id alone — and it stays for the cascade alone.
CREATE INDEX channel_sessions_workspace_idx
  ON public.channel_sessions (workspace_id);

-- FK cover: `channel_tasks(id) ON DELETE SET NULL`. It had none, which is the
-- exact lint 20260802180000 exists to keep at zero; a thread delete would have
-- scanned the whole table to null out its sessions.
CREATE INDEX channel_sessions_task_idx
  ON public.channel_sessions (task_id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the
-- parent channel's, keyed on NEW.channel_id). UPDATE OF workspace_id,
-- channel_id only, so a state flip never re-fires it.
DROP TRIGGER IF EXISTS channel_sessions_workspace_guard ON public.channel_sessions;
CREATE TRIGGER channel_sessions_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id ON public.channel_sessions
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

-- ── `updated_at` IS THE DATABASE'S, NOT THE WRITER'S (F-145) ────────────────
--
-- The read is `ORDER BY updated_at DESC`, so this column is not decoration: it
-- is the ordering, and "newest change first" is the whole shape of the answer.
-- Everywhere else in this schema the service sets `updated_at` explicitly, and
-- everywhere else that is fine because the writer already exists and is
-- reviewed. Here the writer is the FLAGGED GAP (F-144): the first code to
-- UPDATE this table has not been written, and an upsert that omits the column
-- leaves the row's original value in place — after which every session's state
-- keeps changing while the order silently freezes at whatever it was on insert.
-- That failure produces no error and no empty result; it produces a plausible,
-- stale, wrongly-ordered list. So the stamp is taken off the writer entirely.
--
-- Table-scoped on purpose: this repo has no generic `set_updated_at()` and this
-- migration is not the place to introduce a schema-wide convention. The
-- function does one thing for one table, and its name says so.
CREATE OR REPLACE FUNCTION public.channel_sessions_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_sessions_touch ON public.channel_sessions;
CREATE TRIGGER channel_sessions_touch
  BEFORE UPDATE ON public.channel_sessions
  FOR EACH ROW EXECUTE FUNCTION public.channel_sessions_touch_updated_at();

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

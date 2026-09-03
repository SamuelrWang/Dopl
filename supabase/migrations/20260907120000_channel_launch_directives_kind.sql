-- `channel_launch_directives` — THE DIRECTIVE **KIND** (2026-09-01, Samuel's
-- ruling: "dopl mcp being able to end agents. Dopl MCP need to be able to do all
-- that stuff").
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory). Applied is
-- a MEASUREMENT — `supabase migration list --linked` joined on the NAME, plus a
-- look at the live columns (§12, F-304's re-stamp).
--
-- ⚠ READ `20260822160000_channel_launch_directives.sql` FIRST, then
-- `20260823140000_channel_launch_directives_template.sql`. This file is an
-- ADDITIVE extension of that table and repeats none of their reasoning: the
-- mailbox shape, the owner-only SELECT with no write policy at all, the lazy
-- expiry, the claim CAS and — loudest — the REPLICA IDENTITY rule are stated
-- there and still govern here.
--
-- ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
--
-- `end_agent` and `rename_agent` existed only INSIDE a desktop-spawned session
-- (`dopl-desktop-app/main/agent-self-ops.js`, 2026-08-31), so an operator's
-- EXTERNAL agent — the Claude Desktop / Claude Code session holding their own
-- Dopl credential over `dopl_channel` — could START agents and never stop or
-- label them. The external MCP cannot reach the desktop main process; the ONE
-- lane that already crosses that gap is this mailbox. So the verbs ride it.
--
-- ⚠ **ONE TABLE, NOT THREE, AND THE ROW SHAPE IS WHY.** Every column an end or a
-- rename needs is already here and means the same thing: the workspace and
-- channel fence, `operator_user_id` (whose machine), the pending → claimed →
-- terminal lifecycle, the claim CAS, `expires_at`'s lazy expiry, and a closed
-- refusal vocabulary. A sibling table would restate all of that and then need its
-- own realtime binding, its own replica identity, its own backstop route and its
-- own desktop watcher — four mechanisms cloned so that one discriminator column
-- could be a table name instead. ⚠ The DIRECTION lane
-- (`20260903120000_channel_agent_directions.sql`) IS a separate table and that
-- was right for a different reason: it carries a `reply`, its TTL is a TURN's
-- rather than a process start's, and its rows hold a private answer. An end and a
-- rename carry neither.
--
-- ── ⚠ THE CONSENT DIFFERENCE, RECORDED HERE BECAUSE THE COLUMN IS WHERE A
--    READER WILL ASK ─────────────────────────────────────────────────────────
--
-- The LAUNCH kind is gated by the per-machine `orchestratorLaunchEnabled` toggle
-- ("THE TOGGLE IS THE CONSENT", INVARIANTS §6/§11). `end` and `rename` are NOT,
-- and that is a ruling this file records rather than an omission: they are the
-- STOP verb and the DISPLAY verb, and `main/agent-self-ops.js`'s header already
-- carries the whole argument for why those two need no gate — neither can start
-- a query, wake a shell, grant a tool or post, so the failure direction of an
-- abused call is an agent that stops or a card that reads differently, on the
-- machine of the operator whose agents they all are. The toggle exists to gate
-- LOCAL COMPUTE being spent, and these two spend none.
-- ⚠ **THE DATABASE DOES NOT ENFORCE THAT AND CANNOT** — the toggle is an
-- `electron-store` boolean the server never sees. This paragraph is here so the
-- next person to read the CHECK does not conclude the lane grew a gate.

-- ===========================================================================
-- 1. `kind` — WHICH VERB THIS DIRECTIVE ASKS FOR.
-- ===========================================================================
-- ⚠ `DEFAULT 'launch'` AND `NOT NULL` TOGETHER ARE WHAT MAKES THIS BACKWARD
-- COMPATIBLE IN BOTH DIRECTIONS. Every row already in the table is a launch, and
-- an OLDER SERVER build that still inserts without naming a kind writes a launch
-- — which is what it meant. §13's rule is that an older peer is supported, and on
-- this lane the older peer is a deployment mid-rollout.
-- ⚠ THE CLOSED SET IS THE POINT. A `kind` the desktop has no branch for would be
-- claimed and then answered with nothing; the CHECK is what stops a fourth word
-- being storable before a machine exists that can act on it.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'launch';

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_kind_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_kind_check
  CHECK (kind IN ('launch', 'end', 'rename'));

-- ===========================================================================
-- 2. `target_agent_id` — WHICH AGENT the verb acts on.
-- ===========================================================================
-- ⚠ **NOT `agent_id`, AND THE TWO MUST NEVER BE MERGED.** `agent_id` is an
-- OUTPUT: the instance a LAUNCH produced, written by the desktop at decide time.
-- This is an INPUT: the instance an END or a RENAME names, written by the
-- orchestrator at create time. One column carrying both would make "which agent
-- did this row produce" and "which agent did this row aim at" indistinguishable
-- on a table whose whole purpose is to be read back as a record of what was
-- asked.
-- ⚠ SAME SHAPE CHECK AS `agent_id`, character for character
-- (`main/agent-id.js › AGENT_ID_RE`, `schema-launch.ts`'s zod, and the render
-- that prints it as `@agent-<id>`): a value that is not an instance id must be a
-- 400 that NAMES the field, never a constraint violation surfacing as a 500.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS target_agent_id TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_target_agent_id_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_target_agent_id_check
  CHECK (target_agent_id IS NULL OR target_agent_id ~ '^[a-z][a-z0-9]{7}$');

-- ===========================================================================
-- 3. `target_name` — THE RENAME'S NEW DISPLAY NAME.
-- ===========================================================================
-- ⚠ **A TYPED COLUMN, DELIBERATELY, WHERE A `payload JSONB` WAS THE OBVIOUS
-- MOVE.** The desktop's narrowing (`main/launch-directive-wire.js ›
-- directiveFrom`) is a LITERAL WHITELIST, and that whitelist is the reason a
-- widened table cannot start influencing that machine by accident. A JSONB blob
-- passes the whitelist as one opaque key and then carries whatever it likes into
-- main — which is exactly the property the whitelist exists to deny. A named
-- column with a CHECK is refusable AT REST; a JSON field is refusable only by
-- whoever remembers to look.
--
-- ⚠ **AN EMPTY STRING IS LEGAL AND MEANS "CLEAR IT".** `sessions:rename` and
-- `mcp__dopl_agents__rename_agent` both take empty as "go back to Agent #<id>",
-- and a separate `unname` kind would be a second way to say one thing. So the
-- rename arm requires the column to be NOT NULL (§5 below) while the CHECK admits
-- ''.
-- ⚠ 60, NOT 120: this is `main/agent-names.js › MAX_NAME` — Samuel's number, the
-- one that fits a card's title line — not `agent_templates.name`'s. A name legal
-- on this lane must be a name the desktop will actually store, or the orchestrator
-- gets a 200 and a refusal it cannot explain.
-- ⚠ CONTROL, ZERO-WIDTH AND BIDI CHARACTERS ARE REFUSED, NOT STRIPPED, matching
-- `sanitizeName` exactly. A bidi override in an agent name renders a card that
-- reads backwards and a zero-width joiner makes two names look identical; and
-- this string is echoed into an MCP result, where a newline in your own result
-- can forge a line in your own result.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS target_name TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_target_name_charset_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_target_name_charset_check
  CHECK (
    target_name IS NULL OR (
      char_length(target_name) <= 60
      AND target_name = btrim(target_name)
      AND target_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
      AND target_name !~ '[​-‏ - ⁠-⁯﻿]'
    )
  );

-- ===========================================================================
-- 4. THE STATUS VOCABULARY GAINS `done`.
-- ===========================================================================
-- ⚠ **`launched` IS NOT REUSED FOR AN END, AND THAT IS THE WHOLE REASON THIS
-- SECTION EXISTS.** Reusing it would have cost no columns and no code — and it
-- would put the word "launched" on the row that RECORDS AN AGENT BEING STOPPED.
-- This table is read back by the orchestrator that filed the row and rendered
-- into an agent-facing sentence; a status that means the opposite of what
-- happened is the single most expensive kind of wrong here, because nothing
-- downstream can detect it.
-- ⚠ `done` IS TERMINAL EXACTLY AS `launched` IS: the decide CAS refuses to move a
-- row out of it, the MCP hold stops on it, and lazy expiry never touches it.
-- ⚠ AND IT IS KIND-SCOPED BY §5's CHECK — a launch can never be `done` and an
-- end can never be `launched`, so no reader has to ask which meaning it is
-- looking at.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_status_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_status_check
  CHECK (status IN ('pending', 'claimed', 'launched', 'done', 'refused', 'expired'));

-- ===========================================================================
-- 5. THE TERMINAL SHAPE, NOW KIND-AWARE.
-- ===========================================================================
-- ⚠ THE ORIGINAL THREE CLAUSES ARE UNCHANGED IN MEANING and are restated rather
-- than edited, because a CHECK cannot be ALTERed and a partially-rewritten one is
-- how a clause quietly disappears:
--   • a `refused` row must say WHY;
--   • a `launched` row must name the agent it started;
--   • any decided row must carry `decided_at`.
-- WHAT IS ADDED is the kind's own shape, and each clause closes a way for a row
-- to be internally incoherent at rest:
--   • an END or a RENAME must NAME ITS TARGET. Without this a directive could be
--     claimed with nothing to act on, and the desktop's only honest answer would
--     be a refusal for a request that was never expressible.
--   • a RENAME must carry a `target_name` (possibly ''), and NOTHING ELSE may.
--     `target_name IS NULL` on a rename is not "clear the name" — '' is — so
--     admitting it would make the clear gesture ambiguous with a dropped column.
--   • `launched` belongs to `launch` and `done` to the other two. See §4.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_terminal_shape;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_terminal_shape
  CHECK (
    (status <> 'refused' OR refusal_reason IS NOT NULL)
    AND (status <> 'launched' OR agent_id IS NOT NULL)
    AND (status NOT IN ('launched', 'done', 'refused') OR decided_at IS NOT NULL)
    AND (kind = 'launch' OR target_agent_id IS NOT NULL)
    AND (kind <> 'rename' OR target_name IS NOT NULL)
    AND (kind = 'rename' OR target_name IS NULL)
    AND (kind = 'launch' OR status <> 'launched')
    AND (kind <> 'launch' OR status <> 'done')
  );

-- ===========================================================================
-- 6. THE REFUSAL VOCABULARY GOES TO NINE.
-- ===========================================================================
-- ⚠ SEVEN WORDS WERE ALL ABOUT STARTING SOMETHING and none of them fits either
-- new verb's real failure. The two added are the ones the in-process server
-- already answers for these exact verbs (`main/agent-self-ops.js`), lifted onto
-- the wire so the same fact reads the same way from outside:
--   `no-session` — no LIVE session of this operator's carries that agent id on
--                  the machine that claimed the row. ⚠ It is also the DIRECTION
--                  lane's first word (`service-directions.ts ›
--                  DIRECTION_REFUSAL_REASONS`), deliberately the same spelling
--                  for the same fact — two vocabularies disagreeing about how to
--                  say "that agent is not here" is how a render learns to guess.
--                  ⚠ IT IS NOT AN ERROR: an agent that finished is the ordinary
--                  cause, and the sentence must say so.
--   `bad-name`   — the rename's string was refused by the LOCAL sanitizer
--                  (`agent-names.js › sanitizeName`: 1-60 visible characters on
--                  one line; control, zero-width and bidi refused, not stripped).
--                  ⚠ It exists even though §3's CHECK admits only names that
--                  sanitizer would take, because the two are separate statements
--                  on separate machines and the desktop's is the authority. A
--                  refusal with no word for it would arrive as `no-bridge`, which
--                  reads to an orchestrator as the operator having turned the
--                  lane off — the single most misleading answer available.
-- ⚠ NINE IS A SCHEMA CHANGE IN BOTH TREES, as seven was. The TS side
-- (`types-launch.ts`, `schema-launch.ts`, `service-launch.ts`,
-- `packages/dopl-client/src/launch-types.ts`) and
-- `main/launch-directive-wire.js › REFUSAL_REASONS` land in the SAME wave as this
-- file and as the producer, for the reason 2026-08-23 wrote down at length: a
-- decide carrying a word this CHECK lacks passes zod, passes the route, and is
-- refused AT REST — a 500 on the one write whose whole job is to report honestly.
-- ⚠ **`'template-approval'` IS STILL NOT ADMITTED AND MUST NEVER BE.** §7 keeps
-- the negative pin. It is the desktop's word to its OWN renderer for a first-use
-- click, this lane has no human at the keyboard, and a column that could store it
-- would tell a future reader the lane has an approval gate it does not have.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_refusal_reason_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_refusal_reason_check
  CHECK (
    refusal_reason IS NULL OR refusal_reason IN (
      'cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
      'no-template',
      -- ⚠ THE EIGHTH AND NINTH, 2026-09-01 (external end/rename). See the block
      -- above; both have a producer in this same wave.
      'no-session', 'bad-name'
    )
  );

COMMENT ON COLUMN public.channel_launch_directives.kind IS
  'Which verb this directive asks for: launch (the default, and every pre-2026-09-01 row), end, or rename. The desktop dispatches on it. launch is gated by the machine-local orchestratorLaunchEnabled toggle; end and rename are NOT — they are the stop verb and the display verb and widen nothing (main/agent-self-ops.js carries the argument).';

COMMENT ON COLUMN public.channel_launch_directives.target_agent_id IS
  'Which agent an end/rename acts on — an INPUT, written by the orchestrator at create. Never merge with agent_id, which is the OUTPUT a launch produced. NULL on a launch, NOT NULL on every other kind.';

COMMENT ON COLUMN public.channel_launch_directives.target_name IS
  'The rename''s new display name. NOT NULL on kind=rename and NULL on every other kind; the EMPTY STRING is legal and means "clear it, back to Agent #<id>". Bounded at 60 — main/agent-names.js MAX_NAME, the store that actually holds it — not at agent_templates.name''s 120.';

-- ===========================================================================
-- 7. Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE
  def TEXT;
  kdef TEXT;
BEGIN
  -- ── The refusal vocabulary: both new words in, and the forbidden one out ──
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_refusal_reason_check';

  IF def IS NULL THEN
    RAISE EXCEPTION
      'ABORT: the refusal_reason CHECK is gone — an unknown word could then be stored and rendered into an MCP result as itself';
  END IF;

  IF position('no-session' IN def) = 0 OR position('bad-name' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the refusal_reason CHECK does not admit no-session / bad-name — the external end and rename producers ship in this same wave and their commonest refusals would be constraint violations';
  END IF;

  IF position('no-template' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the refusal_reason CHECK lost no-template — this file rewrites that constraint whole, and dropping a word another lane still produces is exactly the failure a rewrite invites';
  END IF;

  -- ⚠ THE NEGATIVE PIN, CARRIED FORWARD FROM 20260823140000 AND STILL THE
  -- SHARPER OF THE TWO. `template-approval` is IPC-only (the renderer's first-use
  -- click on a FOREIGN template); the directive lane has no human, so it can
  -- never be produced here and must never be storable here.
  IF position('template-approval' IN def) > 0 THEN
    RAISE EXCEPTION
      'ABORT: template-approval reached the DIRECTIVE refusal vocabulary — it is the desktop-to-renderer word for a first-use approval click, and this lane has no human at the keyboard';
  END IF;

  -- ── The kind, and its default ────────────────────────────────────────────
  SELECT pg_get_constraintdef(oid) INTO kdef FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_kind_check';

  IF kdef IS NULL THEN
    RAISE EXCEPTION
      'ABORT: the kind CHECK is missing — a kind no desktop has a branch for could then be claimed and never answered';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_launch_directives'
       AND column_name = 'kind'
       AND is_nullable = 'NO'
       AND column_default LIKE '%launch%'
  ) THEN
    RAISE EXCEPTION
      'ABORT: kind is nullable or has lost its launch DEFAULT — every existing row IS a launch and an older server build inserts without naming one';
  END IF;

  -- ── The two target columns must stay OPTIONAL at the column level. The
  --    kind-scoped requirement is the terminal-shape CHECK's job; a NOT NULL here
  --    would make a plain launch unwritable. ──────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_launch_directives'
       AND column_name IN ('target_agent_id', 'target_name')
       AND (column_default IS NOT NULL OR is_nullable = 'NO')
  ) THEN
    RAISE EXCEPTION
      'ABORT: a target column carries a DEFAULT or NOT NULL — a LAUNCH directive names no target and must be able to say so as NULL on both';
  END IF;

  -- ── The terminal shape must still carry the kind clauses ─────────────────
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_terminal_shape';

  IF def IS NULL OR position('target_agent_id' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the terminal-shape CHECK does not require a target on a non-launch kind — an end with nothing to end would be claimable and unanswerable';
  END IF;

  -- ── The replica identity is not touched by this file; assert it survived
  --    anyway, because losing it makes every claim and every decide fail
  --    outright (20260822160000 states the rule at length). ──────────────────
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_index ix ON ix.indrelid = c.oid AND ix.indisreplident
     WHERE c.relname = 'channel_launch_directives'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_launch_directives has no replica-identity index — every UPDATE frame would stop reaching the desktop';
  END IF;

  -- ── And the owner-only, SELECT-only policy set is unchanged. This file adds
  --    columns to a table whose ENTIRE authorization story is "no write policy
  --    exists"; a policy appearing here would be the quietest possible
  --    regression. ──────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'channel_launch_directives'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: a non-SELECT policy exists on channel_launch_directives — writes are service-role-only by design and the operator_user_id argument in repository-launch.ts IS the fence';
  END IF;
END $$;

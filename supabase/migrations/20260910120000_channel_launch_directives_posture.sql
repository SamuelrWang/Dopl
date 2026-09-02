-- `channel_launch_directives` — **THE POSTURE A DIRECTIVE ASKS FOR** (2026-09-01,
-- the agent-efficiency wave: T24 "a launch may ask for a posture and a chain",
-- plus the `set_agent_mode` kind "re-posture a RUNNING agent").
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED.** Docker is unavailable in the
-- environment this was authored in, so `supabase db reset` has NOT been run
-- against it and this file has executed NOWHERE. Do not read the absence of an
-- error as evidence that it works; the first run is still ahead.
-- ⚠ RE-DERIVE RATHER THAN TRUSTING THIS LINE, AND JOIN ON THE NAME:
-- `supabase migration list --linked` (or MCP `list_migrations`) plus a look at
-- the live columns. INVARIANTS §12, F-304's re-stamp — a precedent on this very
-- table claimed "not applied" for a fortnight after it was live.
--
-- ⚠ READ `20260822160000_channel_launch_directives.sql`, then
-- `20260823140000_channel_launch_directives_template.sql`, then
-- `20260907120000_channel_launch_directives_kind.sql`. THE LAST ONE IS THE DIRECT
-- PRECEDENT and this file follows its structure deliberately: the mailbox shape,
-- the owner-only SELECT with no write policy at all, the lazy expiry, the claim
-- CAS and the REPLICA IDENTITY rule are stated there and still govern here, and
-- none of them is repeated.
--
-- ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
--
-- A directive could say WHAT to do (goal, model, template) and never HOW MUCH
-- ROOM the agent doing it gets. The operator's two permission axes — tools
-- (`manual` → `bypass`) and messages (`ask` → `auto_both`) — plus "may this agent
-- launch workers" were spawn-time facts read from that machine's own settings,
-- with no way for the orchestrator that filed the row to ask for anything else,
-- and no verb at all for moving a RUNNING agent.
--
-- ⚠ **THESE COLUMNS ARE A REQUEST. THEY DECIDE NOTHING, AND EVERY READER OF THIS
-- FILE HAS TO CARRY THAT.** `dopl-desktop-app/main/launch-posture.js` is the
-- authority and its header carries the whole argument: the pair is CLAMPED to the
-- operator's own stored channel posture (`channel-prefs.js › getLaunchPosture`),
-- never widened, and the ticket's "unless the caller is the operator" carve-out
-- was REFUSED because every caller on this lane already IS the operator's own
-- account (INVARIANTS §11). ⚠ **AND THE CHAIN IS THE ASYMMETRY**: a posture wider
-- than the ceiling is clamped, a chain the channel forbids is REFUSED up front —
-- a clamped posture still does the asked-for work under more supervision, while a
-- clamped chain produces an agent that hits a bound it was told it did not have,
-- mid-run, after workers were already promised.
--
-- ⚠ **THE DATABASE ENFORCES NEITHER THE CLAMP NOR THE REFUSAL AND CANNOT.** The
-- ceiling is an `electron-store` record the server never sees. Every CHECK below
-- is about a row being COHERENT AT REST — never about a row being allowed.
--
-- ── ⚠ THE ECHO TRIO, AND THE ONE WAY TO READ IT WRONG ───────────────────────
--
-- `applied_tool_mode` / `applied_message_mode` / `applied_chain` exist to close
-- the other tier's open finding: *a CLAMPED posture directive has no way to tell
-- the caller it was clamped.* `launch-posture.js › resolveLaunch` already computes
-- `clamped`; nothing carries it back.
--
-- ⚠ **THIS FILE ADDS THE COLUMNS AND NOTHING WRITES THEM YET.** The desktop's
-- decide body (`main/launch-directive-wire.js › decideBody`) has no field for
-- them, so on EVERY LIVE ROW all three are NULL.
-- ⚠ **NULL MEANS "NOT REPORTED". IT DOES NOT MEAN "UNCLAMPED", AND IT IS NEVER
-- THE REQUESTED VALUE ECHOED BACK.** Rendering it as either would tell an
-- orchestrator that the posture it asked for is the posture it got, on the
-- strength of a column no machine has filled in — and it would then hand the
-- agent work sized for room it may not have. Every render site says "not
-- reported" in as many words; `packages/mcp-server/src/tools/channel-ops-launch.ts
-- › postureLine` is the one statement of that, and its suite drives it.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Written as PROSE rather than as commented-out SQL, because
-- `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this directory
-- WITHOUT stripping comments and a commented-out revert reads to that parser as a
-- real one.
-- The eight columns are ADDITIVE and NULLABLE with no defaults, so nothing needs
-- them dropped: an older server ignores them and `select("*")` keeps working. If
-- they genuinely must go, drop them in a NEW migration and REVERT THE WRITERS
-- FIRST — `server/repository-launch.ts` names them by column on the insert, so
-- dropping them under a live writer 400s every create, unretryably.
-- The two value CHECKs added below drop by name on their own and are safe to drop
-- alone. The two constraints this file RE-CREATES WHOLE (`..._kind_check` and
-- `..._terminal_shape`) must be reverted by re-stating the PREVIOUS text in full,
-- which is `20260907120000_channel_launch_directives_kind.sql` §1 and §5 verbatim
-- — a CHECK cannot be ALTERed, and a partially-rewritten one is how a clause
-- quietly disappears.
--
-- ── NO INDEX, AND THAT IS DELIBERATE ───────────────────────────────────────
-- Nothing queries on any of these eight. The two reads on this table are BY ID
-- and BY (operator, workspace, status) — both already served — and every one of
-- the new columns is read only AFTER a row has been found, as a property of it. A
-- directive lives two minutes and the pending set is bounded at 100, so a filter
-- on a posture would scan nothing worth an index anyway. An index here would be
-- write cost on the hottest path this table has (the claim CAS) bought for no
-- reader.

-- ===========================================================================
-- 1. `kind` GAINS A FOURTH VALUE.
-- ===========================================================================
-- ⚠ RE-CREATED WHOLE, NOT EDITED. A CHECK cannot be ALTERed; DROP and re-CREATE
-- is the only move, and restating every member is what stops one vanishing in the
-- rewrite. The three existing words are unchanged in meaning.
-- ⚠ **`set_agent_mode` IS THE ONLY NON-LAUNCH KIND THAT STAYS BEHIND THE
-- MACHINE'S LAUNCH-CONSENT TOGGLE, AND THAT IS A RULING THIS FILE RECORDS.**
-- `20260907120000` recorded the opposite for `end` and `rename`: a STOP verb and
-- a DISPLAY verb widen nothing, so the toggle — which exists to gate LOCAL
-- COMPUTE BEING SPENT — buys nothing over them. A POSTURE does the opposite. Axis
-- A at `bypass` pre-approves work tools on hardware the operator pays for, which
-- is exactly what `channel-prefs.js › getOrchestratorLaunch` exists to gate, so
-- the desktop lists it in `KINDS_NEEDING_LAUNCH_CONSENT` beside `launch`.
-- ⚠ **THE DATABASE DOES NOT ENFORCE THAT AND CANNOT** — the toggle is an
-- `electron-store` boolean no server sees. Reading the three non-launch kinds as
-- one class is the mistake this paragraph exists to stop.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_kind_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_kind_check
  CHECK (kind IN ('launch', 'end', 'rename', 'set_agent_mode'));

-- ===========================================================================
-- 2. THE COLUMNS. Eight, additive, NULLABLE, NO DEFAULTS.
-- ===========================================================================
-- ⚠ **NULLABLE WITH NO DEFAULT IS THE WHOLE COMPATIBILITY STORY, IN BOTH
-- DIRECTIONS.** Every row already in this table asked for no posture, and an
-- OLDER SERVER build that inserts without naming one still means exactly that.
-- ⚠ AND A DEFAULT WOULD BE A LIE ON EVERY AXIS: a default `'manual'` would read
-- as "this caller asked for the narrowest tools" when it asked for nothing, and
-- the desktop's narrowing turns "not asked" into "use the operator's own stored
-- value" — the pre-T24 behaviour, byte for byte. §5's assertions pin both.
--
-- ⚠ **TYPED COLUMNS, NOT A `payload JSONB`, FOR `20260907120000` §3'S REASON.**
-- `main/launch-directive-wire.js › directiveFrom` is a LITERAL WHITELIST, and
-- that whitelist is why a widened table cannot start influencing that machine by
-- accident. A JSONB blob passes the whitelist as one opaque key and then carries
-- whatever it likes into main.

-- ── 2a. THE LAUNCH'S REQUEST — what posture a NEW session starts on (T24). ──
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS start_tool_mode TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS start_message_mode TEXT;

-- ⚠ NULLABLE, AND THE NULL IS LOAD-BEARING. `true` is "this agent needs to be
-- able to launch workers"; NULL is "I did not ask", which inherits the channel's
-- own setting silently as every launch did before T24. Collapsing the two would
-- turn every ordinary launch into a request, and a request the channel denies is
-- a REFUSAL (`launch-posture.js › resolveChain`), so the collapse would refuse
-- launches that asked for nothing.
-- ⚠ **MEASURED MISMATCH, RECORDED HERE RATHER THAN DESIGNED AROUND (2026-09-01):
-- `false` IS STORABLE AND THE DESKTOP CANNOT TELL IT FROM NULL.**
-- `main/launch-directive-wire.js › directiveFrom` narrows this column as
-- `r.chain === true || r.chain === 'true' ? true : null`, so a stored `false`
-- arrives as "did not ask" and the session inherits the channel setting — which
-- may be ON. **`false` is therefore NOT a way to turn chaining off**, and no copy
-- on this lane may say it is (`packages/mcp-server/src/tools/channel-schema.ts ›
-- chain` states that to callers). The column stays BOOLEAN rather than a
-- CHECK-forced `true`-or-NULL because the day the desktop learns to honour
-- `false` should not be a migration in three trees; admitting a value that
-- currently resolves the way NULL does costs nothing at rest.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS chain BOOLEAN;

-- ── 2b. THE SET-MODE REQUEST — what posture a RUNNING session moves to. ─────
-- ⚠ **SEPARATE COLUMNS FROM `start_*`, AND THEY MUST STAY SO.** One names the
-- posture a NEW session starts on, the other the posture a RUNNING one moves to.
-- Merging them would let a `set_agent_mode` be answered by a launch's fields on a
-- row that carried both — and §4's clauses exist precisely so no row ever does.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS target_tool_mode TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS target_message_mode TEXT;

-- ── 2c. THE ECHO TRIO — what the machine SAYS it applied. ───────────────────
-- ⚠ **NOTHING WRITES THESE YET. NULL ON EVERY LIVE ROW MEANS "NOT REPORTED",
-- NEVER "UNCLAMPED" AND NEVER THE REQUESTED VALUE.** The header carries the whole
-- argument; it is restated here because this is the column a reader is looking at
-- when they decide what a NULL means.
-- ⚠ THEY ARE NOT KIND-SCOPED BY §4. A clamp can happen on a launch (the `start_*`
-- pair, plus the chain) and on a `set_agent_mode` (the `target_*` pair), so the
-- echo is legal on both and a clause restricting it to one would have to be
-- rewritten by whichever lane reported first.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_tool_mode TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_message_mode TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_chain BOOLEAN;

-- ===========================================================================
-- 3. THE VALUE CHECKS — NULL, or a member of that axis's enum.
-- ===========================================================================
-- ⚠ **THE MEMBERS ARE WRITTEN OUT HERE, AND THIS IS THE **THIRD** STATEMENT OF
-- EACH SET.** The other two are `src/features/channels/schema-launch.ts ›
-- LAUNCH_TOOL_MODES` / `LAUNCH_MESSAGE_MODES` (which `closedEnum` holds against
-- the TS union, so the compiler covers that pair) and
-- `dopl-desktop-app/main/launch-directive-wire.js › TOOL_MODES` / `MESSAGE_MODES`.
-- **No TypeScript can reach this one** — it is exactly the caveat
-- `LaunchRefusalReasonSchema` carries, on a new pair of sets. A fifth mode is a
-- schema change in all three places, in one wave, or a request carrying it passes
-- zod, passes the route, and is refused AT REST.
--
-- ⚠ **ONE CONSTRAINT PER AXIS, NOT PER COLUMN, AND THAT IS THE POINT.** The enum
-- belongs to the AXIS; three columns happen to carry it. Six per-column CHECKs
-- would be six places a fifth mode has to be added and five places it can be
-- forgotten. ⚠ The cost is that a violation names the axis rather than the field —
-- acceptable because the 400 that NAMES the field is the route's zod, and a
-- constraint violation on this lane is already the "should not happen" path.
--
-- ⚠ **THE ORDER OF THE MEMBERS IS NOT ENFORCED HERE AND IS STILL LOAD-BEARING.**
-- `IN` is a set test. The CLAMP is an INDEX COMPARISON over the desktop's
-- narrowest-first arrays (`launch-posture.js › narrowTo`), so re-ordering those
-- silently inverts the bound with this CHECK still passing. Listed
-- narrowest-first below anyway, so the two read alike.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_tool_modes_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_tool_modes_check
  CHECK (
    (start_tool_mode IS NULL OR start_tool_mode IN ('manual', 'accept_edits', 'auto', 'bypass'))
    AND (target_tool_mode IS NULL OR target_tool_mode IN ('manual', 'accept_edits', 'auto', 'bypass'))
    AND (applied_tool_mode IS NULL OR applied_tool_mode IN ('manual', 'accept_edits', 'auto', 'bypass'))
  );

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_message_modes_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_message_modes_check
  CHECK (
    (start_message_mode IS NULL OR start_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
    AND (target_message_mode IS NULL OR target_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
    AND (applied_message_mode IS NULL OR applied_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
  );

-- ===========================================================================
-- 4. THE TERMINAL SHAPE, NOW POSTURE-AWARE.
-- ===========================================================================
-- ⚠ RE-CREATED WHOLE. Every clause `20260907120000` §5 wrote is restated below
-- UNCHANGED — a CHECK cannot be ALTERed and a partially-rewritten one is how a
-- clause quietly disappears. For what those eight say and why, read that file;
-- this comment covers only what is ADDED.
--
-- WHAT IS ADDED, and each clause closes a way for a row to be incoherent at rest:
--
--   • **A `set_agent_mode` MUST ASK FOR AT LEAST ONE AXIS.** Without this a row
--     could be claimed with nothing to apply, and the machine's only honest
--     answer would be a refusal for a request that was never expressible — the
--     same argument §5 makes for `target_name` on a rename, and the same one
--     `main/directive-agent-ops.js › setAgentMode` implements as its `no-bridge`
--     branch. ⚠ The two statements are BOTH wanted: this one makes the row
--     unwritable, that one answers the case where a mode this build does not
--     recognise was narrowed away to nothing on the machine.
--
--   • **`target_*` APPEARS ONLY ON `set_agent_mode`.** A posture stapled to a
--     launch row would be read by whichever lane looked first.
--
--   • **`start_*` AND `chain` APPEAR ONLY ON `launch`.** Same reason, other
--     direction. ⚠ `chain` is included in the negative clause deliberately: it is
--     the field with a plausible-sounding meaning on an `end` ("stop its
--     workers too"), which is a feature nobody built.
--
-- ⚠ **NO CLAUSE IS ADDED FOR `set_agent_mode`'S STATUS, BECAUSE TWO EXISTING
-- CLAUSES ALREADY COVER IT — CHECKED, NOT ASSUMED.** `(kind = 'launch' OR status
-- <> 'launched')` forbids a `set_agent_mode` row from ever being `launched`, and
-- `(kind <> 'launch' OR status <> 'done')` leaves `done` available to every
-- non-launch kind, which is the success word this one uses. Both are phrased over
-- "launch vs not", so the fourth kind inherited the right pairing on the day it
-- was minted. A third clause restating it would be law that guards nothing and
-- would have to be maintained beside the two that do.
-- ⚠ THE SAME IS TRUE OF THE TARGET: `(kind = 'launch' OR target_agent_id IS NOT
-- NULL)` already requires a `set_agent_mode` to NAME the agent it re-postures.
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
    AND (
      kind <> 'set_agent_mode'
      OR target_tool_mode IS NOT NULL
      OR target_message_mode IS NOT NULL
    )
    AND (
      kind = 'set_agent_mode'
      OR (target_tool_mode IS NULL AND target_message_mode IS NULL)
    )
    AND (
      kind = 'launch'
      OR (start_tool_mode IS NULL AND start_message_mode IS NULL AND chain IS NULL)
    )
  );

COMMENT ON COLUMN public.channel_launch_directives.start_tool_mode IS
  'T24: the TOOL posture a LAUNCH asks its new session to start on. NULL means not asked, which resolves to the operator''s own stored channel value — the pre-T24 behaviour exactly. A REQUEST, never a grant: dopl-desktop-app/main/launch-posture.js CLAMPS it to that operator''s ceiling and never widens. NULL on every kind but launch.';

COMMENT ON COLUMN public.channel_launch_directives.start_message_mode IS
  'T24: the MESSAGE posture a LAUNCH asks its new session to start on. NULL means not asked. Clamped to the operator''s ceiling and then FLOORED by the windowless message rule, in that order — flooring first would let a clamped ask come back out looking as though the ceiling had allowed it. NULL on every kind but launch.';

COMMENT ON COLUMN public.channel_launch_directives.chain IS
  'T24: may the launched agent launch further agents? TRUE asks for it; NULL did not ask (and inherits the channel setting). ⚠ Unlike the two posture axes this is REFUSED rather than clamped when the channel forbids it — a clamped chain produces an agent that hits a bound it was told it did not have, mid-run, after workers were already promised. ⚠ FALSE is storable and the desktop cannot tell it from NULL (its narrower reads only true), so FALSE is NOT a way to turn chaining off. NULL on every kind but launch.';

COMMENT ON COLUMN public.channel_launch_directives.target_tool_mode IS
  'The TOOL posture a set_agent_mode asks a RUNNING agent to move to. NULL means that axis was not requested, which is ordinary — a directive may move one axis and leave the other. NOT NULL on set_agent_mode unless target_message_mode is; NULL on every other kind. Clamped, never widened.';

COMMENT ON COLUMN public.channel_launch_directives.target_message_mode IS
  'The MESSAGE posture a set_agent_mode asks a RUNNING agent to move to. NULL means that axis was not requested. At least one of the two target modes must be present on a set_agent_mode row — a directive that asks for nothing is a request whose only honest answer is a refusal for something never expressible.';

COMMENT ON COLUMN public.channel_launch_directives.applied_tool_mode IS
  'ECHO: the TOOL mode the machine says it actually applied, after its clamp. ⚠ NULL MEANS NOT REPORTED — never "unclamped" and never the requested value echoed back. No writer exists yet, so it is NULL on every live row; a render that reads NULL as agreement would tell an orchestrator its posture landed on the strength of a column nobody filled in.';

COMMENT ON COLUMN public.channel_launch_directives.applied_message_mode IS
  'ECHO: the MESSAGE mode the machine says it actually applied, after its clamp and the windowless floor. ⚠ NULL MEANS NOT REPORTED — see applied_tool_mode.';

COMMENT ON COLUMN public.channel_launch_directives.applied_chain IS
  'ECHO: whether the launched session may launch further agents, as the machine settled it. ⚠ NULL MEANS NOT REPORTED, not false — a render that read NULL as "no chaining" would be wrong in the direction that makes an orchestrator do the work itself for no reason.';

-- ===========================================================================
-- 5. Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE
  def TEXT;
  missing TEXT;
BEGIN
  -- ── All eight columns exist, are NULLABLE, and carry NO DEFAULT ──────────
  -- ⚠ NULLABILITY AND THE ABSENCE OF A DEFAULT ARE THE SAME ASSERTION AS "not
  -- asked for is expressible". A NOT NULL would make a plain launch unwritable;
  -- a DEFAULT would make every pre-existing row claim to have requested
  -- something.
  SELECT string_agg(c.name, ', ' ORDER BY c.name) INTO missing
    FROM (VALUES
      ('start_tool_mode'), ('start_message_mode'), ('chain'),
      ('target_tool_mode'), ('target_message_mode'),
      ('applied_tool_mode'), ('applied_message_mode'), ('applied_chain')
    ) AS c(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'channel_launch_directives'
        AND column_name = c.name
        AND is_nullable = 'YES'
        AND column_default IS NULL
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: posture columns missing, NOT NULL, or carrying a DEFAULT (%) — a launch that asked for no posture must be writable, and a DEFAULT would make every existing row claim to have requested one', missing;
  END IF;

  -- ── The kind CHECK admits the fourth word and kept the other three ───────
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_kind_check'
     AND convalidated;

  IF def IS NULL THEN
    RAISE EXCEPTION
      'ABORT: the kind CHECK is missing or NOT VALIDATED — a kind no desktop has a branch for could then be claimed and never answered';
  END IF;

  IF position('set_agent_mode' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the kind CHECK does not admit set_agent_mode — its producer ships in this same wave and every create would be a constraint violation';
  END IF;

  IF position('''end''' IN def) = 0 OR position('''rename''' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the kind CHECK lost end or rename — this file rewrites that constraint WHOLE, and dropping a word another lane still produces is exactly the failure a rewrite invites';
  END IF;

  -- ── The two axis CHECKs, and both must name their whole enum ─────────────
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_tool_modes_check'
     AND convalidated;

  IF def IS NULL
     OR position('manual' IN def) = 0 OR position('accept_edits' IN def) = 0
     OR position('auto' IN def) = 0 OR position('bypass' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the tool-mode CHECK is missing, unvalidated, or does not name all four modes — a mode outside the enum would be storable and would reach a reducer that coerces it without saying so';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_message_modes_check'
     AND convalidated;

  IF def IS NULL
     OR position('ask' IN def) = 0 OR position('auto_inbound' IN def) = 0
     OR position('auto_outbound' IN def) = 0 OR position('auto_both' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the message-mode CHECK is missing, unvalidated, or does not name all four modes';
  END IF;

  -- ── The terminal shape kept every earlier clause AND gained the new ones ─
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_terminal_shape'
     AND convalidated;

  IF def IS NULL THEN
    RAISE EXCEPTION
      'ABORT: the terminal-shape CHECK is gone or NOT VALIDATED — every incoherence it closes becomes storable at once';
  END IF;

  IF position('refusal_reason' IN def) = 0
     OR position('target_agent_id' IN def) = 0
     OR position('target_name' IN def) = 0
     OR position('decided_at' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the terminal-shape CHECK lost a clause from 20260907120000 — this file restates it WHOLE, which is precisely when a clause disappears';
  END IF;

  IF position('target_tool_mode' IN def) = 0
     OR position('target_message_mode' IN def) = 0
     OR position('start_tool_mode' IN def) = 0
     OR position('chain' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the terminal-shape CHECK does not scope the posture columns to their kinds — a set_agent_mode asking for nothing, or a launch carrying a target posture, would be claimable and unanswerable';
  END IF;

  -- ⚠ THE ECHO TRIO MUST **NOT** BE KIND-SCOPED. A clamp can be reported on a
  -- launch and on a set_agent_mode alike, so a clause naming applied_* in the
  -- shape constraint would refuse the honest report from one of the two lanes.
  IF position('applied_tool_mode' IN def) > 0
     OR position('applied_message_mode' IN def) > 0
     OR position('applied_chain' IN def) > 0 THEN
    RAISE EXCEPTION
      'ABORT: an applied_* column is kind-scoped by the terminal shape — both lanes can be clamped, so scoping the echo to one refuses the other machine''s honest report';
  END IF;

  -- ── Unchanged by this file, asserted anyway: losing either makes every claim
  --    and every decide fail outright (20260822160000 states both rules). ────
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_index ix ON ix.indrelid = c.oid AND ix.indisreplident
     WHERE c.relname = 'channel_launch_directives'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_launch_directives has no replica-identity index — every UPDATE frame would stop reaching the desktop';
  END IF;

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

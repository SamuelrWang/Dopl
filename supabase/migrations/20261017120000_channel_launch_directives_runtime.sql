-- ============================================================================
-- AN MCP LAUNCH MAY NAME ITS RUNTIME — AND THE ROW RECORDS BOTH THE REQUEST
-- AND WHAT ACTUALLY RAN (2026-09-21, U9 of the Codex runtime-parity plan)
-- ============================================================================
-- 🔒 **THE DEFECT, VERBATIM FROM THE PLAN**: *a live MCP launch carrying
-- `model: "codex"` was accepted but started a Claude Sonnet agent, because the
-- MCP contract has no runtime field and an unknown model falls through to the
-- default adapter.* Both halves were true and both are closed together — this
-- migration is the storage half.
--
-- ⚠ **A MODEL NAME MUST NEVER DOUBLE AS A RUNTIME SELECTOR** (the plan's Key
-- Technical Decision #4). `runtime` chooses the ADAPTER; `model` beside it
-- chooses a model INSIDE that adapter. Nothing on this lane derives one from the
-- other, in either direction, and a NULL `runtime` is never read as any
-- particular vendor — it means the operator's machine applies its documented
-- chain (the channel's stored runtime, then the registry default).
--
-- ── ⚠ WHY THERE ARE TWO COLUMNS AND NOT ONE ─────────────────────────────────
-- `runtime` is what the CALLER ASKED FOR. `applied_runtime` is what the MACHINE
-- STARTED ON. They are two facts, exactly as `start_*` and `applied_*` are
-- (`20260910120000` §3, whose argument this follows), and here the gap is the
-- ORDINARY case rather than the exception: every launch that names no runtime
-- has a NULL request and a real applied value. An audit row carrying only one of
-- them cannot answer "which vendor ran" — which is precisely the question the
-- original reproduction could not answer.
--
-- ── ⚠ AND WHY THERE IS NO `resolved_runtime` ────────────────────────────────
-- The posture has THREE groups because the SERVER can clamp a request against a
-- ceiling it holds. It holds no runtime roster. The only enumeration of what
-- exists is `dopl-desktop-app/main/runtime/index.js`'s REGISTRY, which lives on
-- the operator's machine and moves with a DESKTOP release — so a server-side
-- "resolution" would be a guess about a list it cannot see. Two groups, and
-- nothing in between.
--
-- ── ⚠ NO VALUE `CHECK`, AND THAT IS THE SAME DECISION ───────────────────────
-- `start_tool_mode` has a value CHECK because the four modes are OURS. The
-- runtime roster is not: a `CHECK (runtime IN ('claude','codex','cursor'))`
-- would refuse a row a NEWER desktop can honour, and this table would then be
-- the thing blocking a runtime that already ships. What IS enforced is the
-- GRAMMAR — an anchored lowercase slug, which is what stops an arbitrary string
-- from a widened client reaching a spawn argument.
-- ⚠ **THE REFUSAL IS THE MACHINE'S, AND IT REALLY IS A REFUSAL.** An explicit
-- runtime the operator's machine does not have registered, or has and cannot
-- start, is answered `no-sdk` by
-- `dopl-desktop-app/main/launch-directive-spawn.js › resolveRuntime` — never
-- swapped for another vendor. That is the whole point of the field.
--
-- ⚠ **ADDITIVE, NULLABLE, NO BACKFILL, AND AN OLDER DESKTOP KEEPS WORKING.**
-- Every existing row reads NULL on all three, which is exactly right: NULL on
-- `runtime` is "did not ask" (every row written before this wave), and NULL on
-- the two `applied_*` columns is "NOT REPORTED" — the echo trio's rule, because
-- a desktop older than this wave posts a decide carrying neither key and must
-- still be able to decide (INVARIANTS §13 — an older peer is a supported peer).
-- ⚠ **NULL IS NEVER "THE DEFAULT RUNTIME".** A render that read it that way
-- would name a vendor on the strength of a column nobody filled in, which is the
-- reading `20260910120000` already forbids for `applied_tool_mode`.

-- ===========================================================================
-- 1. `runtime` — WHAT THE CALLER ASKED FOR
-- ===========================================================================
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS runtime TEXT;

-- ⚠ THE GRAMMAR, HAND-MIRRORED IN THREE OTHER TREES AND STATED HERE AS THE ONE
-- THING THIS DATABASE CAN ENFORCE:
--   `src/features/channels/schema-launch-modes.ts › LAUNCH_RUNTIME_ID_RE`
--   `dopl-desktop-app/main/launch-directive-vocab.js › RUNTIME_ID_RE`
--   `packages/mcp-server/src/tools/channel-schema-launch-fields.ts › runtime`
-- ⚠ ANCHORED IN BOTH DIRECTIONS. An unanchored pattern would admit a newline,
-- and this value is echoed into an MCP result line whose whole format is
-- `key=value` pairs separated by spaces.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_runtime_shape_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_runtime_shape_check
  CHECK (runtime IS NULL OR runtime ~ '^[a-z][a-z0-9_-]{0,31}$');

-- ⚠ ONE DIRECTION ONLY — "not on another kind" — matching `agent_name`'s fence
-- in `20261006120000` §2. The other direction ("a launch must carry one") is
-- exactly what this lane must NOT say: omitting it is the documented default
-- path and is what every older client sends.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_runtime_kind_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_runtime_kind_check
  CHECK (kind = 'launch' OR runtime IS NULL);

COMMENT ON COLUMN public.channel_launch_directives.runtime IS
  'WHICH RUNTIME this launch ASKED for (U9, 2026-09-21) — the request, never the outcome. NULL is "did not ask", which means the machine''s documented chain (channel runtime, then registry default); it is NOT "claude" and is NEVER inferred from the model column. An explicit runtime the operator''s machine cannot start is REFUSED (no-sdk), never swapped. Read it beside applied_runtime.';

-- ===========================================================================
-- 2. `applied_runtime` / `applied_model` — WHAT THE MACHINE ACTUALLY RAN
-- ===========================================================================
-- ⚠ **WRITTEN BY THE DECIDE, NEVER BY THE CREATE**, and NULL on `done` /
-- `refused` — the echo trio's rule verbatim (`20260910120000` §3): a create that
-- could stamp these would let the requester write its own confirmation, and a
-- retried decide must not leave a stale runtime standing beside a refusal.
--
-- ⚠ **`applied_model` IS NOT `resolved_model`.** That column is the SERVER's
-- create-time echo of a model id IT recognised, off a Claude-shaped table, and
-- is `null` for anything else. This is what the MACHINE settled on inside the
-- RESOLVED runtime. ⚠ **NULL HERE HAS A SECOND, LEGITIMATE MEANING BESIDES "not
-- reported": "no model argument at all", i.e. that runtime's own default** —
-- which is exactly what a cross-vendor model correctly becomes once the
-- directive lane drops it rather than smuggling it into another adapter.
--
-- ⚠ 120 IS `model`'s OWN BOUND on this lane (`schema-launch.ts › model` uses
-- `safeLabel("Model", 120)`). A model id legal to ASK for must be legal to
-- REPORT, or a machine that ran one cannot say so.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_runtime TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_model TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_runtime_shape_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_runtime_shape_check
  CHECK (applied_runtime IS NULL OR applied_runtime ~ '^[a-z][a-z0-9_-]{0,31}$');

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_model_shape_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_model_shape_check
  CHECK (
    applied_model IS NULL OR (
      char_length(applied_model) BETWEEN 1 AND 120
      AND applied_model = btrim(applied_model)
      AND applied_model !~ '[[:cntrl:]]'
    )
  );

-- ⚠ THE KIND FENCE, ONE DIRECTION, LIKE §1 — only a launch starts a session on
-- a runtime. An `end`, a `rename` or a `set_agent_mode` reporting one would be a
-- row asserting a fact about a session it did not start.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_runtime_kind_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_runtime_kind_check
  CHECK (kind = 'launch' OR (applied_runtime IS NULL AND applied_model IS NULL));

COMMENT ON COLUMN public.channel_launch_directives.applied_runtime IS
  'WHICH RUNTIME the operator''s machine actually started this session on (U9, 2026-09-21) — written by the DECIDE, never the create. NULL means NOT REPORTED (a desktop older than this wave, or a non-launch kind) and never "the default runtime". Read it beside the runtime column: they agree on an honoured explicit request and differ on every launch that asked for nothing.';

COMMENT ON COLUMN public.channel_launch_directives.applied_model IS
  'WHICH MODEL the machine settled on INSIDE applied_runtime (U9, 2026-09-21). NOT resolved_model, which is the server''s create-time echo off a Claude-shaped table. NULL means either "not reported" or "no model argument at all — that runtime''s own default", which is what a cross-vendor model becomes once the directive lane drops it rather than handing it to another adapter.';

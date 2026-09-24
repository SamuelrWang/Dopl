// U9 (2026-09-21) — A LAUNCH DIRECTIVE MAY NAME ITS RUNTIME, AND AN EXPLICIT ONE IS **REFUSED**
// RATHER THAN SWAPPED FOR ANOTHER VENDOR.
//
// ── 🔒 THE DEFECT, VERBATIM FROM THE PLAN ───────────────────────────────────────────────
// *A live MCP launch carrying `model: "codex"` was accepted but started a Claude Sonnet agent,
// because the MCP contract has no runtime field and an unknown model falls through to the
// default adapter.*
//
// Both halves were real and this file drives both:
//   · there was NO runtime field anywhere on the lane, so nothing could say which vendor to use;
//   · `session-model.js › chainModel` answers `''` for an id it does not know, so `codex` in the
//     MODEL slot read as "no opinion" and the chain fell through to the identity's and then the
//     channel's model — both Claude ids — which were handed to whatever adapter ran.
//
// ── THE ORDER (Samuel ruling R5) ────────────────────────────────────────────────────────
// The launch runtime is `runtime/launch-default.js › resolveLaunchRuntime` (C3, a1's contract,
// stubbed here at its seam): the directive's pick → the identity's runtime → the channel's → the
// registry default. The registry walk (membership before `acquire`) is that function's, and its
// own suite pins it; this file pins what the DIRECTIVE LANE does with each answer.
//
// ── ⚠ AND WHY THE WORD IS `no-sdk` RATHER THAN AN ELEVENTH ──────────────────────────────
// The refusal vocabulary is CLOSED in four places (`launch-directive-vocab.js`,
// `schema-launch-modes.ts`, the column CHECK, and the MCP `RETRY_ADVICE` map). `no-sdk` already
// means *"there is no such agent runtime on this Mac"*, which is the true statement in both
// refusal arms, and its retry advice is already `no`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boot, decidePosts, row, wire, HERE, WS, DID,
} from "./_launch-directive-harness.mjs";

const launchRow = (over = {}) => row({ goal: "do the thing", ...over });
const decided = (h) => decidePosts(h).map((p) => p.body);
/** The runtime id the lane handed the spawn funnel. ⚠ `''` is a REAL value — the default. */
const handedRuntime = (h) => (h.cfg.lastSpec || {}).runtime;
const handedModes = (h) => (h.cfg.lastSpec || {}).startModes;
const handedModel = (h) => (h.cfg.lastSpec || {}).model;

// ── 1. THE WIRE NARROWING ────────────────────────────────────────────────────────────────

test("WIRE: both spellings are read — the CLAIM's DTO (camel) and the realtime row (snake)", () => {
  assert.equal(wire.directiveFrom(launchRow({ runtime: "codex" }), WS).runtime, "codex");
  assert.equal(wire.directiveFrom(launchRow({ runtimeId: "codex" }), WS).runtime, "codex");
});

test("WIRE: a missing runtime is `''` — DID NOT ASK, never a vendor", () => {
  assert.equal(wire.directiveFrom(launchRow(), WS).runtime, "");
  assert.equal(wire.directiveFrom(launchRow({ runtime: null }), WS).runtime, "");
});

// 🔒 DECISION #4, AS A TEST. A model name must never double as a runtime selector, and this is
// the exact payload that produced the shipped defect.
test("WIRE: the runtime is NEVER inferred from the model — `model: \"codex\"` asks for nothing", () => {
  const d = wire.directiveFrom(launchRow({ model: "codex" }), WS);
  assert.equal(d.model, "codex");
  assert.equal(d.runtime, "", "a model name is not a runtime request, in either direction");
});

test("WIRE: a value outside the runtime-id grammar is dropped, not carried into main", () => {
  for (const bad of ["Codex", "co dex", "1codex", "codex\nrm -rf /", "x".repeat(40), 42, {}]) {
    assert.equal(wire.directiveFrom(launchRow({ runtime: bad }), WS).runtime, "",
      `'${String(bad).slice(0, 20)}' must not reach a spawn argument`);
  }
});

// ⚠ THE GRAMMAR IS HAND-COPIED IN FOUR TREES (main cannot import from `src/`), so the copy is
// driven against the web's own SOURCE rather than against this file's memory of it.
test("WIRE: `RUNTIME_ID_RE` is character-for-character the web's `LAUNCH_RUNTIME_ID_RE`", () => {
  const web = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "schema-launch-modes.ts"), "utf8");
  const m = /export const LAUNCH_RUNTIME_ID_RE = (\/.*\/);/.exec(web);
  assert.ok(m, "the web still declares LAUNCH_RUNTIME_ID_RE");
  assert.equal(String(wire.RUNTIME_ID_RE), m[1]);
});

// ⚠ AND AGAINST THE COLUMN CHECK, which is the third statement and the only one TypeScript can
// never reach. A grammar the database refuses is a decide that 400s for a launch that happened.
test("WIRE: the migration's CHECK admits exactly the same grammar", () => {
  const sql = readFileSync(
    join(HERE, "..", "..", "supabase", "migrations",
      "20261017120000_channel_launch_directives_runtime.sql"), "utf8");
  assert.match(sql, /runtime ~ '\^\[a-z\]\[a-z0-9_-\]\{0,31\}\$'/);
  assert.match(sql, /applied_runtime ~ '\^\[a-z\]\[a-z0-9_-\]\{0,31\}\$'/);
  // ⚠ ADDITIVE AND NULLABLE, so an older desktop keeps working: no NOT NULL, no backfill.
  assert.match(sql, /ADD COLUMN IF NOT EXISTS runtime TEXT;/);
  assert.doesNotMatch(sql, /runtime TEXT NOT NULL/);
  assert.doesNotMatch(sql, /UPDATE public\.channel_launch_directives/);
});

// ── 2. PRECEDENCE ────────────────────────────────────────────────────────────────────────

test("PRECEDENCE: no ask and no channel pick → the registry default, and it is REPORTED", async () => {
  const h = boot();
  await h.api.handle(launchRow(), WS);
  assert.equal(handedRuntime(h), "claude", "C3 names the registry default");
  assert.equal(decided(h)[0].appliedRuntime, "claude",
    "the ordinary launch must still SAY which vendor ran — silence is what U9 removes");
});

test("PRECEDENCE: no ask but a channel pick → the channel's runtime, unchanged from before U9", async () => {
  const h = boot({ channelRuntime: "codex" });
  await h.api.handle(launchRow(), WS);
  assert.equal(handedRuntime(h), "codex");
  assert.equal(decided(h)[0].appliedRuntime, "codex");
});

test("PRECEDENCE: an explicit runtime BEATS the channel's pick", async () => {
  const h = boot({ channelRuntime: "codex" });
  await h.api.handle(launchRow({ runtime: "cursor" }), WS);
  assert.equal(handedRuntime(h), "cursor");
  assert.equal(decided(h)[0].appliedRuntime, "cursor");
});

test("PRECEDENCE: `runtime: claude` still launches Claude", async () => {
  const h = boot({ channelRuntime: "codex" });
  await h.api.handle(launchRow({ runtime: "claude" }), WS);
  assert.equal(handedRuntime(h), "claude");
  assert.equal(decided(h)[0].appliedRuntime, "claude");
});

// ── 3. THE REFUSALS — the half the ticket exists for ─────────────────────────────────────

test("REFUSE: an UNREGISTERED runtime is refused — it never falls through to the default", async () => {
  const h = boot();
  await h.api.handle(launchRow({ runtime: "borg", identity_id: "77777777-7777-4777-8777-777777777777" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-sdk" }]);
  assert.equal(h.cfg.lastSpec, undefined, "and NOTHING was launched");
  assert.deepEqual(h.resolves, [], "an explicit pick is answered BEFORE any identity fetch");
  assert.deepEqual(h.acquires, [], "C3's membership test answered BEFORE acquire");
});

test("REFUSE: a REGISTERED runtime this Mac cannot start is refused, with the runtime named", async () => {
  const h = boot({ runtimeUnavailable: ["codex"] });
  await h.api.handle(launchRow({ runtime: "codex" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-sdk" }]);
  assert.equal(h.cfg.lastSpec, undefined);
  assert.deepEqual(h.acquires, ["codex"], "it really asked the adapter's own availability gate");
  assert.ok(h.logged.some((l) => l.includes("codex") && l.includes("REFUSING")),
    "the diagnostic NAMES the runtime — a generic no-sdk is what U9 replaces");
});

test("REFUSE: an unavailable CLAUDE is refused too — the rule is not Codex-specific", async () => {
  const h = boot({ runtimeUnavailable: ["claude"] });
  await h.api.handle(launchRow({ runtime: "claude" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-sdk" }]);
});

// ⚠ THE OTHER DIRECTION OF THE ASYMMETRY, AND IT IS DELIBERATE. An UNKNOWN value in the CHANNEL's
// stored pick fails OPEN (`getChannelRuntime` normalizes it to `''`), because a downgrade must
// not strand a room. Only the EXPLICIT ask fails closed.
test("REFUSE: only the EXPLICIT ask fails closed — an unreachable CHANNEL pick still launches", async () => {
  const h = boot({ channelRuntime: "" }); // what `getChannelRuntime` answers for an unknown id
  await h.api.handle(launchRow(), WS);
  assert.equal(decided(h)[0].status, "launched");
});

// ── 4. THE MODEL, INSIDE THE RESOLVED RUNTIME ────────────────────────────────────────────

test("MODEL: the pick is handed on as given — the funnel resolves it on the live roster", async () => {
  const h = boot();
  await h.api.handle(launchRow({ model: "claude-opus-5" }), WS);
  assert.equal(handedModel(h), "claude-opus-5");
  assert.deepEqual(h.rosters, [], "and it never spends a roster read to do it");
});

// 🔒 THE SECOND HALF OF THE ORIGINAL DEFECT. Before U9 this launch handed the CHANNEL's Claude
// model to a non-Claude adapter, because every link of the chain resolved against Claude's table.
test("MODEL: a non-default runtime is NEVER handed the Claude chain's model", async () => {
  const h = boot({ channelRuntime: "codex" });
  await h.api.handle(launchRow({ model: "" }), WS);
  assert.equal(handedModel(h), "",
    "no model argument at all — the funnel spends codex's own default");
});

// The runtime default is the FUNNEL's (`session-launch.js › launch` → `withRuntimeDefault`), and
// the model it launched with is what `appliedModel` reports.
test("MODEL: a no-pick Codex launch reports the default the FUNNEL launched with", async () => {
  const h = boot({ channelRuntime: "codex",
    launch: async () => ({ agentId: "a1b2c3d4", sessionId: "s1", model: "gpt-6-sol" }) });
  await h.api.handle(launchRow({ model: "" }), WS);
  assert.equal(handedModel(h), "", "the lane names none; the funnel fills the default");
  assert.equal(decided(h)[0].appliedModel, "gpt-6-sol");
});

// 🔒 P3-09: a pick on a NON-default runtime is no longer checked against a fresh `runtime.models()`
// spawn (a Codex app-server per launch). It goes to the funnel, whose check reads the cached
// catalog (`model-catalog.js › settle`) — the same path every other lane takes.
test("MODEL: a pick on a non-default runtime spends NO roster read of its own", async () => {
  const h = boot({ channelRuntime: "codex",
    rosters: { codex: { source: "live", ids: ["gpt-6-astra"], aliases: [] } } });
  await h.api.handle(launchRow({ model: "gpt-6-astra" }), WS);
  assert.equal(handedModel(h), "gpt-6-astra");
  assert.deepEqual(h.rosters, [], "no per-launch roster spawn — the funnel's cached check decides");
});

// ⚠ REFUSED — NEVER RE-ROUTED. The funnel refuses an id the runtime's catalog lacks (`no-model`);
// the runtime is never changed by a model it cannot run.
test("MODEL: a CLAUDE model on a CODEX launch is REFUSED and the runtime is untouched", async () => {
  const h = boot({
    channelRuntime: "codex",
    // what `session-launch.js › refuseUnknownModel` answers for an id Codex's catalog lacks
    launch: async () => ({ skipped: "no-model" }),
  });
  await h.api.handle(launchRow({ model: "claude-opus-5" }), WS);
  assert.equal(handedRuntime(h), "codex", "the runtime is NOT changed by a model it cannot run");
  assert.equal(handedModel(h), "claude-opus-5", "handed on so the funnel can refuse it with a sentence");
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-model" }]);
});

// 🔒 P3-09: an unreadable roster used to DROP the launcher's explicit pick here (the MCP Codex lane
// silently launched the default) while every other lane failed open. The pick now always reaches
// the funnel, whose check fails open on an unreadable roster.
test("MODEL: an unreachable roster never drops the launcher's explicit pick", async () => {
  const h = boot({ channelRuntime: "codex", rosterThrows: true });
  await h.api.handle(launchRow({ model: "gpt-6-astra" }), WS);
  assert.equal(handedModel(h), "gpt-6-astra");
  assert.equal(decided(h)[0].status, "launched", "a roster outage is not a launch refusal");
});

// ── 5. REQUESTED vs APPLIED, AS AN AUDIT RECORD ──────────────────────────────────────────

test("AUDIT: the decide reports the APPLIED runtime and model, never the requested ones", async () => {
  const h = boot({ channelRuntime: "codex" });
  await h.api.handle(launchRow({ runtime: "codex", model: "" }), WS);
  const body = decided(h)[0];
  assert.equal(body.appliedRuntime, "codex");
  // ⚠ ABSENT: the directive asked for no model and Codex's own default ran. The request is on the
  // ROW; this body is what the machine did. (A model the roster lacks is now REFUSED — above — so
  // "asked X, applied nothing" can no longer be a LAUNCHED body at all.)
  assert.ok(!("appliedModel" in body), "no model argument was applied, so none is reported");
});

test("AUDIT: the wire refuses to REPORT a runtime outside the grammar", () => {
  const body = wire.decideBody(DID, { agentId: "a1b2c3d4", appliedRuntime: "NOPE nope" });
  assert.ok(!("appliedRuntime" in body),
    "a value the column CHECK would refuse must not be posted — that is a decide 400 for a "
    + "launch that really happened");
});

test("AUDIT: an empty applied pair is OMITTED, because omitted is `not reported`", () => {
  const body = wire.decideBody(DID, { agentId: "a1b2c3d4", appliedRuntime: "", appliedModel: "" });
  assert.deepEqual(body, { directiveId: DID, status: "launched", agentId: "a1b2c3d4" },
    "`''` would be this machine claiming to report and reporting nothing");
});

// ── 6. IDEMPOTENCY AND BACKWARD COMPATIBILITY ────────────────────────────────────────────

// ⚠ **ONE AGENT PER DIRECTIVE, NOT ONE PER RUNTIME.** The dedupe ledger is keyed on the DIRECTIVE
// ID and the idempotency key's uniqueness is `(channel, operator, client_msg_id)` — neither
// mentions the runtime, and neither may start to. A retry that names a different runtime is still
// the same request.
test("IDEMPOTENT: the same directive re-delivered launches ONCE, whatever runtime it names", async () => {
  const h = boot({ channelRuntime: "codex" });
  const frame = launchRow({ runtime: "codex" });
  await h.api.handle(frame, WS);
  await h.api.handle(frame, WS);
  await h.api.handle(launchRow({ runtime: "cursor" }), WS); // same id, different runtime
  assert.equal(decided(h).length, 1, "one directive id, one agent — never one per runtime");
});

// ⚠ §13 — AN OLDER PEER IS A SUPPORTED PEER. A row written before the column existed carries no
// `runtime` at all, and must follow the documented default path rather than being refused.
test("COMPAT: a row written before the column existed launches on the default path", async () => {
  const h = boot();
  const old = launchRow();
  delete old.runtime;
  await h.api.handle(old, WS);
  assert.equal(decided(h)[0].status, "launched");
  assert.equal(decided(h)[0].appliedRuntime, "claude");
});

// ── 7. THE LAUNCH RUNTIME'S OWN RECORD AND WORDS (rulings R3/R5; P3-03, P3-04, P3-07) ─────

// 🔒 P3-04 + P3-03: the ceiling AND the native bag are read for the LAUNCH runtime, not the
// channel's selected one — a Codex pick on a Claude channel used to get Claude's posture and no
// sandbox, i.e. Codex's `workspace-write` default: WIDER than the button lane's `read-only`.
test("RECORD: a Codex launch reads the CODEX record — its sandbox reaches the spawn", async () => {
  const h = boot({ ceilings: {
    claude: { tools: "bypass", messages: "auto_both" },
    codex: { tools: "on-request", messages: "auto_both", native: { sandbox_mode: "read-only" } },
  } });
  await h.api.handle(launchRow({ runtime: "codex" }), WS);
  assert.deepEqual(h.ceilingAsks, ["codex"], "C1: the ceiling is the LAUNCH runtime's record");
  assert.deepEqual(h.startAsks, ["codex"], "…and so is the native bag");
  assert.deepEqual(handedModes(h),
    { tools: "on-request", messages: "auto_both", native: { sandbox_mode: "read-only" } });
  assert.equal(decided(h)[0].appliedTools, "on-request", "the echo is a CODEX word (C5)");
});

// 🔒 P3-07: Claude's clamp order on a Codex launch turned an ask for the NARROWEST into the WIDEST.
test("WORDS: a Codex launch asking `untrusted` against a `never` ceiling gets `untrusted`", async () => {
  const h = boot({ channelRuntime: "codex", ceilings: { codex: { tools: "never", messages: "auto_both" } } });
  await h.api.handle(launchRow({ start_tool_mode: "untrusted" }), WS);
  assert.equal(handedModes(h).tools, "untrusted");
  assert.deepEqual(handedModes(h).pinned, { tools: true, messages: false },
    "only the ASKED axis sticks as the session's own pick; messaging follows the channel (C2)");
  assert.equal(decided(h)[0].appliedTools, "untrusted");
});

test("PIN: a directive asking only MESSAGING pins only messaging; the tool axis follows the channel", async () => {
  const h = boot({ channelRuntime: "codex", ceilings: { codex: { tools: "never", messages: "auto_both" } } });
  await h.api.handle(launchRow({ start_message_mode: "auto_inbound" }), WS);
  assert.deepEqual(handedModes(h).pinned, { tools: false, messages: true });
});

test("MODEL: a model id up to the server's 120-character bound reaches the funnel untruncated", async () => {
  const id = "m" + "x".repeat(99);
  const h = boot();
  await h.api.handle(launchRow({ model: id }), WS);
  assert.equal(handedModel(h), id);
});

test("WORDS: a wider Codex ask clamps in CODEX order to the Codex ceiling", async () => {
  const h = boot({ channelRuntime: "codex", ceilings: { codex: { tools: "granular", messages: "auto_both" } } });
  await h.api.handle(launchRow({ start_tool_mode: "never" }), WS);
  assert.equal(handedModes(h).tools, "granular");
});

// C5: a word the launch runtime does not offer is NOT applied — that axis launches at the channel
// posture and the echo says what actually runs.
test("WORDS: a Claude word on a Codex launch is not applied — the channel posture runs", async () => {
  const h = boot({ channelRuntime: "codex", ceilings: { codex: { tools: "on-request", messages: "auto_both" } } });
  await h.api.handle(launchRow({ start_tool_mode: "bypass" }), WS);
  assert.deepEqual(handedModes(h), { tools: "on-request", messages: "auto_both", native: {} },
    "nothing asked that this runtime speaks → nothing pinned");
  assert.equal(decided(h)[0].appliedTools, "on-request");
  assert.ok(h.logged.some((l) => l.includes("bypass") && l.includes("codex")));
});

// Ruling R5: with no pick, the IDENTITY's runtime beats the channel's.
test("ORDER: no pick → the identity's runtime, ahead of the channel's", async () => {
  const h = boot({
    channelRuntime: "claude",
    resolve: { ok: true, identity: { name: "Coder", model: null, runtime: "codex" } },
  });
  await h.api.handle(launchRow({ identity_id: "77777777-7777-4777-8777-777777777777" }), WS);
  assert.equal(handedRuntime(h), "codex");
  assert.equal(decided(h)[0].appliedRuntime, "codex");
  assert.deepEqual(h.runtimeAsks.map((a) => a.pick), [""], "asked once, after the identity resolved");
  assert.equal(h.runtimeAsks[0].identity.runtime, "codex");
});

test("ORDER: an explicit pick beats the identity's runtime", async () => {
  const h = boot({ resolve: { ok: true, identity: { name: "Coder", model: null, runtime: "codex" } } });
  await h.api.handle(launchRow({ runtime: "cursor", identity_id: "77777777-7777-4777-8777-777777777777" }), WS);
  assert.equal(handedRuntime(h), "cursor");
});

test("ORDER: an identity runtime this Mac cannot run is REFUSED, never swapped", async () => {
  const h = boot({
    runtimeUnavailable: ["codex"],
    resolve: { ok: true, identity: { name: "Coder", model: null, runtime: "codex" } },
  });
  await h.api.handle(launchRow({ identity_id: "77777777-7777-4777-8777-777777777777" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-sdk" }]);
  assert.equal(h.cfg.lastSpec, undefined);
});

// The echo's `appliedModel` is the FUNNEL's model (its runtime default filled in), so the funnel
// must answer it — a foreign one-field hunk on `session-launch.js › launch`'s success return.
test("FUNNEL: a successful launch answers the model it launched with", () => {
  const src = readFileSync(join(HERE, "..", "main", "session-launch.js"), "utf8");
  // ⚠ `agentName` joined it (DMP-005): the STORED name, which the directive echo reports.
  assert.match(src, /return \{ sessionId: s\.sessionId, agentId: agentId, model, agentName \};/);
});

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
//     MODEL slot read as "no opinion" and the chain fell through to the template's and then the
//     channel's model — both Claude ids — which were handed to whatever adapter ran.
//
// ── ⚠ THE ONE TRAP A REVIEWER SHOULD LOOK FOR FIRST ─────────────────────────────────────
// `main/runtime/index.js › resolve` **FAILS OPEN to the default adapter for an unknown id.** That
// is correct where it lives (a stored session record written by a build that knew a runtime this
// one does not must still be endable) and it is exactly wrong for a request somebody just made —
// `acquire('nonsense')` SUCCEEDS, by acquiring Claude. So the membership test against `ids()`
// MUST run before `acquire`, and the case below named "an unregistered runtime is REFUSED" is
// the one that fails if anybody reorders them.
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
  assert.equal(handedRuntime(h), "", "'' is how this lane spells the default adapter downstream");
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

// 🔒 THE REORDERING GUARD. `resolve()` fails OPEN, so `acquire('borg')` returns CLAUDE. Only the
// `ids()` membership test standing FIRST makes this a refusal instead of a silent Claude launch.
test("REFUSE: an UNREGISTERED runtime is refused — it never falls through to the default", async () => {
  const h = boot();
  await h.api.handle(launchRow({ runtime: "borg" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-sdk" }]);
  assert.equal(h.cfg.lastSpec, undefined, "and NOTHING was launched");
  assert.deepEqual(h.acquires, [], "the membership test answered BEFORE acquire — do not reorder");
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

test("MODEL: the default adapter keeps the Claude chain — the pick handed on as given", async () => {
  const h = boot();
  await h.api.handle(launchRow({ model: "claude-opus-5" }), WS);
  // 2026-09-22: resolved on the LIVE roster at the launch spec, not aliased here.
  assert.equal(handedModel(h), "claude-opus-5");
  assert.deepEqual(h.rosters, [], "and it never spends a roster read to do it");
});

// 🔒 THE SECOND HALF OF THE ORIGINAL DEFECT. Before U9 this launch handed the CHANNEL's Claude
// model to a non-Claude adapter, because every link of the chain resolved against Claude's table.
test("MODEL: a non-default runtime is NEVER handed the Claude chain's model", async () => {
  const h = boot({ channelRuntime: "codex" });
  await h.api.handle(launchRow({ model: "" }), WS);
  assert.equal(handedModel(h), "",
    "no model argument at all — codex's own default, never claude-sonnet-5 off channel-prefs");
});

test("MODEL: a model IN the resolved runtime's roster is passed through raw", async () => {
  const h = boot({
    channelRuntime: "codex",
    rosters: { codex: { source: "live", ids: ["gpt-6-astra"], aliases: ["", "gpt-6-astra"] } },
  });
  await h.api.handle(launchRow({ model: "gpt-6-astra" }), WS);
  assert.equal(handedModel(h), "gpt-6-astra");
  assert.deepEqual(h.rosters, ["codex"], "asked the RESOLVED runtime, not the default one");
});

// ⚠ REFUSED — NEVER RE-ROUTED, AND SINCE 2026-09-22 NEVER DROPPED EITHER. A roster that ANSWERED
// and lacks the id is definitive, so the pick goes on to the funnel and the funnel refuses it
// (`no-model`); launching on the platform default instead is the silent substitution this wave
// removes. The runtime is still never changed by a model it cannot run.
test("MODEL: a CLAUDE model on a CODEX launch is REFUSED and the runtime is untouched", async () => {
  const h = boot({
    channelRuntime: "codex",
    rosters: { codex: { source: "live", ids: ["gpt-6-astra"], aliases: ["", "gpt-6-astra"] } },
    // what `session-launch.js › refuseUnknownModel` answers for an id Codex's catalog lacks
    launch: async () => ({ skipped: "no-model" }),
  });
  await h.api.handle(launchRow({ model: "claude-opus-5" }), WS);
  assert.equal(handedRuntime(h), "codex", "the runtime is NOT changed by a model it cannot run");
  assert.equal(handedModel(h), "claude-opus-5", "handed on so the funnel can refuse it with a sentence");
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-model" }]);
  assert.ok(h.logged.some((l) => l.includes("will be refused (no-model)")));
});

// ⚠ R11: A CATALOG FAILURE MUST NOT SUBSTITUTE ANOTHER RUNTIME'S MODELS. The honest answer is the
// platform default, which is what `''` means.
test("MODEL: an unreachable roster drops the model — it never guesses and never refuses", async () => {
  const h = boot({ channelRuntime: "codex", rosterThrows: true });
  await h.api.handle(launchRow({ model: "gpt-6-astra" }), WS);
  assert.equal(handedModel(h), "");
  assert.equal(decided(h)[0].status, "launched", "a roster outage is not a launch refusal");
});

// ── 5. REQUESTED vs APPLIED, AS AN AUDIT RECORD ──────────────────────────────────────────

test("AUDIT: the decide reports the APPLIED runtime and model, never the requested ones", async () => {
  const h = boot({
    channelRuntime: "codex",
    rosters: { codex: { source: "live", ids: ["gpt-6-astra"], aliases: ["", "gpt-6-astra"] } },
  });
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

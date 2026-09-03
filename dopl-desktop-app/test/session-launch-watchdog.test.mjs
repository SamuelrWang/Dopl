// C-4 — A LAUNCH THAT NEVER EMITS `system/init` MUST NOT JAM ITS SLOT FOREVER.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-4). `startSession` built the session with
// `idleTimer: null` and never armed one. The timer is armed ONLY by reducer effects that
// require the `launched` event, and `launched` is dispatched ONLY by the SDK's `system/init`.
// So a child that boots and never speaks — a hung MCP handshake, a wedged model start, a
// binary that starts and stalls — sat at phase 'launching' with no watchdog of any kind:
//   · `hasLiveSession` stays true, so every later request into that (channel, thread) slot
//     answers `{skipped:'busy'}` and the peer is told to resend, forever;
//   · the slot counts against MAX_WINDOWS, so six of them and the desktop opens nothing;
//   · no `task_started` was ever posted, so the requester has nothing to look at either.
// There was no path out of it short of quitting the app.
//
// WHAT THIS FILE PINS:
//   1. THE BOUND IS ARMED, through the ONE timer decision (`session-state.idleTimeout`)
//      rather than a second timer beside it.
//   2. THE NUMBER IS EVIDENCE, not a guess — asserted as RELATIONS against the constants in
//      this tree that bracket it, so moving any of them fails here rather than drifting
//      silently (the test/mcp-client-timeout.test.mjs precedent).
//      ⚠ ONE OF THE THREE BRACKETS WAS DELETED 2026-08-20 (Samuel's headless ruling):
//      `session-spawner.MAX_RUNTIME_MS`, the lane that gave this number its value. The relation
//      became a PROVENANCE assertion rather than a comparison — see the case that says so.
//      The other two (MCP_CLIENT_TIMEOUT_MS below it, DEFAULT_IDLE_MS / ABANDONED_MS above)
//      are untouched and still bracket it from both sides.
//   3. A REAL LAUNCH CANCELS IT. `launched` re-arms the ordinary idle TTL, so the watchdog
//      can only ever fire on a session that never started.
//   4. EXPIRY SETTLES IT THE WAY EVERY OTHER TERMINAL PATH DOES — it posts, and it frees
//      the slot (see session-inactive-notice.test.mjs for the message itself).
//
// Run: `node --test dopl-desktop-app/test/session-launch-watchdog.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const QUERY = M("session-query.js");
const ENGINE = M("session-engine.js");
const STATE = M("session-state.js");

const {
  initialSessionState, sessionReducer, idleTimeout, LAUNCHING_MS, DEFAULT_IDLE_MS, ABANDONED_MS,
} = loadReducer();

const launching = (opts) => initialSessionState(opts);
const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;

// ── 1. THE BOUND IS ARMED, THROUGH THE ONE TIMER DECISION ────────────────────────────

test("a LAUNCHING session's timer is the launch bound, not the idle TTL", () => {
  assert.deepEqual(idleTimeout(launching()), { ms: LAUNCHING_MS, type: "inactive" });
});

test("…and the launching branch is checked FIRST, because the other two would both claim it", () => {
  // A launching state has `parked: false` and `activity: 'working'`, so without the new
  // branch it fell through to the fifteen-minute idle TTL — which is what a session that
  // has ALREADY started gets, and is exactly the wrong answer for one that never did.
  const s = launching();
  assert.equal(s.phase, "launching");
  assert.equal(s.parked, false);
  assert.equal(s.activity, "working");
  assert.notEqual(idleTimeout(s).ms, DEFAULT_IDLE_MS);
});

test("there is ONE timer, so the watchdog cannot leak beside the idle one", () => {
  // session-state.idleTimeout is the whole timer decision (bound + event) and the engine's
  // scheduleIdle is one clearTimeout + one setTimeout over it. A second timer would be a
  // second thing to clear on settle.
  assert.equal((ENGINE.match(/setTimeout\(/g) || []).length, 1, "one arming site in the engine");
  assert.match(ENGINE, /s\.idleTimer = setTimeout\(\(\) => \{ if \(!s\.settled\) dispatch\(s, \{ type: t\.type \}\); \}, t\.ms\);/);
});

// ── 2. THE NUMBER IS EVIDENCE ────────────────────────────────────────────────────────

function constFrom(src, name) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(src);
  assert.ok(m, `${name} not found`);
  return new Function(`return (${m[1]});`)();
}

test("the launch bound sits ABOVE this process's own MCP client abort", () => {
  // 290s is the longest a single MCP request may hold before `mcp-config` aborts it. Declaring
  // a launch dead UNDER that would kill a session while the transport's own abort was still
  // the thing about to unstick it.
  const mcpClient = constFrom(M("mcp-config.js"), "MCP_CLIENT_TIMEOUT_MS");
  assert.equal(mcpClient, 290_000, "if this moved, re-derive the launch bound rather than this line");
  assert.ok(LAUNCHING_MS > mcpClient, `${LAUNCHING_MS} must exceed ${mcpClient}`);
});

test("…and its derivation still CITES the headless answer it was matched to", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This read "…and it
  // MATCHES the headless lane's answer to the same question" and asserted
  // `LAUNCHING_MS === constFrom(M("session-spawner.js"), "MAX_RUNTIME_MS")` — this tree's
  // existing statement that a `claude` child which has produced nothing in five minutes has
  // failed. ONE answer, BOTH lanes, which was the whole argument: the number was not chosen, it
  // was inherited.
  //
  // `MAX_RUNTIME_MS` is deleted with the `claude -p` executor — `session-spawner.js` is now a
  // 46-line re-export facade — so the comparison has nothing on its right-hand side and the
  // `constFrom` regex would throw on a missing const.
  //
  // ⚠ THE NUMBER IS NOT ORPHANED, AND THAT IS WHY THIS IS REWRITTEN RATHER THAN DROPPED. This
  // file's whole point (item 2 of the header) is that 300_000 is EVIDENCE rather than a guess,
  // held by RELATIONS to other constants so that moving any of them fails here instead of
  // drifting silently. Losing one of three relations to a deletion would quietly reduce it back
  // toward a bare literal. The provenance is asserted directly instead: `session-state.js` must
  // still cite where the value came from, and the value must still BE that value — the last lane
  // that answered this question is gone, so the derivation comment is now the only record of why
  // five minutes, and it has to stay legible.
  assert.equal(LAUNCHING_MS, 5 * 60 * 1000, "five minutes — the headless lane's MAX_RUNTIME_MS, inherited");
  const at = STATE.indexOf("const LAUNCHING_MS");
  assert.notEqual(at, -1, "LAUNCHING_MS not found — the anchors below would be vacuous");
  assert.ok(STATE.slice(Math.max(0, at - 1800), at).includes("MAX_RUNTIME_MS"),
    "the derivation must keep naming the constant it was matched to, even though that constant " +
      "is deleted — a number whose provenance is unwritten is a number the next person re-guesses");
  // …and the deleted lane must not have quietly grown a second answer somewhere.
  assert.ok(!/MAX_RUNTIME_MS\s*=/.test(M("session-spawner.js")),
    "session-spawner.js is a re-export facade now — a runtime bound reappearing there is a second executor");
});

test("…and it is many times the repo's own price for the handshake it is waiting on", () => {
  // HOLD_MARGIN_MS is documented as what the MCP route needs for "auth + MCP boot + the
  // workspace handshake" — precisely the work between spawning the child and `system/init`.
  const BUDGET = readFileSync(
    join(HERE, "..", "..", "packages", "mcp-server", "src", "tools", "channel-hold-budget.ts"),
    "utf8"
  );
  const m = /export const HOLD_MARGIN_MS = ([\d_]+);/.exec(BUDGET);
  assert.ok(m, "HOLD_MARGIN_MS not found");
  const margin = Number(m[1].replace(/_/g, ""));
  assert.ok(LAUNCHING_MS >= 5 * margin, `${LAUNCHING_MS} should be well above ${margin}`);
});

test("…and it is comfortably UNDER the idle TTL, so the two can never be confused", () => {
  assert.ok(LAUNCHING_MS < DEFAULT_IDLE_MS);
  assert.ok(LAUNCHING_MS < ABANDONED_MS);
  assert.equal(LAUNCHING_MS * 3, DEFAULT_IDLE_MS, "one third — stated in the source, pinned here");
});

test("the bound is documented where it is defined, not left as a bare literal", () => {
  const at = STATE.indexOf("const LAUNCHING_MS");
  const preamble = STATE.slice(Math.max(0, at - 1800), at);
  for (const cited of ["MCP_CLIENT_TIMEOUT_MS", "HOLD_MARGIN_MS", "MAX_RUNTIME_MS"]) {
    assert.ok(preamble.includes(cited), `the derivation must cite ${cited}`);
  }
});

// ── 3. A REAL LAUNCH CANCELS IT ──────────────────────────────────────────────────────

test("`launched` re-arms the ORDINARY idle TTL over the watchdog", () => {
  const r = sessionReducer(launching(), { type: "launched", payload: { type: "init" } });
  assert.ok(r.effects.some((e) => e.type === "scheduleIdle"), "the launch re-arms the one timer");
  assert.deepEqual(idleTimeout(r.state), { ms: DEFAULT_IDLE_MS, type: "idle_timeout" },
    "…and it now measures idleness, which is what it always meant");
});

test("every later arming site reads a NON-launching phase, so none of them re-arms the watchdog", () => {
  const s = running();
  for (const ev of [
    { type: "result", turnCostUsd: 0 },
    { type: "steer", text: "go" },
    { type: "permission_request", requestId: "r1", name: "Bash", payload: {} },
  ]) {
    const next = sessionReducer(s, ev);
    assert.ok(next.effects.some((e) => e.type === "scheduleIdle"), ev.type);
    assert.notEqual(idleTimeout(next.state).type, "inactive", `${ev.type} must not re-arm the watchdog`);
  }
});

// ── 4. EXPIRY SETTLES IT LIKE EVERY OTHER TERMINAL PATH ──────────────────────────────

test("the watchdog's event ENDS the session — abort, post, settle, slot freed", () => {
  const r = sessionReducer(launching(), { type: "inactive" });
  assert.equal(r.state.phase, "ended", "terminal at the top of the reducer");
  const types = r.effects.map((e) => e.type);
  assert.deepEqual(types, ["abortQuery", "lifecycle", "emit", "settle"],
    "the SAME shape every other real end produces — no second teardown path");
  assert.ok(r.effects.some((e) => e.type === "settle" && e.outcome === "ended"),
    "settle is what deletes the registry entry, which is what frees the MAX_WINDOWS slot");
});

test("…and the ended session really is inert: nothing can wake the jammed slot back up", () => {
  const ended = sessionReducer(launching(), { type: "inactive" }).state;
  for (const ev of [{ type: "steer", text: "hi" }, { type: "inbound_arrived", message: "hi", authorName: "B" },
    { type: "launched", payload: {} }, { type: "result", turnCostUsd: 0 }]) {
    assert.deepEqual(sessionReducer(ended, ev).effects, [], `${ev.type} cannot revive it`);
  }
});

// ── THE ARMING SEAM ──────────────────────────────────────────────────────────────────

test("startQuery arms it, which is what covers the post-sign-in relaunch too", () => {
  // HERE rather than in startSession deliberately: `startQuery` is the ONE deferred launch
  // (H1's supersede-before-relaunch), so a session held by the Q6 credential preflight and
  // relaunched after sign-in — which re-enters with phase reset to 'launching' — is covered by
  // the same line rather than by a second one somebody has to remember.
  const body = QUERY.slice(QUERY.indexOf("async function startQuery("));
  assert.match(body, /deps\.scheduleIdle\(s\)/, "the watchdog is armed inside startQuery");
  // ⚠ 2026-08-31 (runtime-adapter port): the query is started through the runtime rather than a
  // platform handle held here. The ORDER this pins is unchanged and is the whole point.
  assert.ok(body.indexOf("rt.start(buildLaunchSpec(s))") < body.indexOf("deps.scheduleIdle(s)"),
    "armed AFTER the query exists, so a throwing assembly leaves no orphan timer");
  assert.match(ENGINE, /sessionQuery\.bind\(\{ dispatch, emitQuiet, scheduleIdle \}\)/,
    "and the engine hands its OWN scheduleIdle in — never a second timer implementation");
  assert.match(M("session-auth.js"), /await deps\.startQuery\(s, rt\);/,
    "the sign-in relaunch goes through that same startQuery");
});

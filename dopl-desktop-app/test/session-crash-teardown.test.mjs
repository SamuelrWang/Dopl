// C3 (CRITICAL) — a crash must not orphan a live `claude` process.
//
// THE BUG. The reducer's `crash` branch settles the session (settle -> lifecycle -> error
// emit) and, unlike every other end, does NOT abort the query first: `endEffects` and
// `close_task` both emit `abortQuery`, `idle_timeout` parks with denyPending + abortQuery,
// but a crash emitted neither. `settle` only dropped the handles. So the SDK child kept
// running with its prompt iterator open and every awaited canUseTool promise unresolved —
// the process could go on working, and posting into the channel, with the window destroyed
// and nothing left on screen to show it or to stop it.
//
// THE FIX, settle side (this file): settle DENIES every awaited permission fail-closed,
// CLOSES the push iterator, and ABORTS the controller before it drops the handles, so the
// teardown holds whichever branch reached it.
//
// THE FIX, reducer side (HANDOFF, session-reducer.js — the other agent's file): put
// `{ type: 'abortQuery' }` FIRST in the crash branch's effect list, and re-pin
// test/session-reducer.test.mjs's crash assertion to
//   ["abortQuery", "settle", "lifecycle", "emit"].
// That test currently pins ["settle","lifecycle","emit"] — it pins the bug.
//
// Both modules are electron-bound, so `settle` and `denyPendingPermissions` are source-extracted
// and driven with fakes (the idiom the rest of this directory uses).
//
// ⚠ `settle` MOVED TO `main/session-teardown.js` ON 2026-08-22 (the §2 500-line cap; the engine
// sat exactly on it and the spawn-idle wake rule needed three fields in that file). NOTHING it
// pins changed: same order, same C3 sweep, same history freeze before the registry delete. What
// changed is HOW it reaches its world — the engine injects the registry, the durable projection,
// the permission sweep and the tray refresh through `bind()`, so the harness below hands in a
// `deps` object where it used to hand in four free vars. `denyPendingPermissions` STAYED in the
// engine (the effect table calls it directly on the park path too) and is still sliced from
// there, which is why this file reads two sources.
//
// ⚠ EVERY C3 RULE IN THIS FILE IS LIVE AND EVERY ONE OF THEM STILL RUNS. The 2026-08-20
// session-window retirement (F-228) broke this suite WITHOUT touching a single thing it pins:
// the extraction slices `settle` by naming its NEXT NEIGHBOUR as the end marker, that neighbour
// was `getSessionBySender` — deleted with the window model, since it resolved a session from a
// window's webContents — and a slice whose end marker is absent takes `indexOf() === -1` and
// asserts out. The marker is now `setLifecycleHandlers`, which really does follow `settle`.
// ⚠ THE LESSON IS ABOUT THE IDIOM, NOT ABOUT THIS FILE: a source slice keyed on a NEIGHBOUR is
// coupled to code it makes no claim about, and it fails LOUDLY but points at the wrong module.
// Nothing here was rewritten, weakened or removed — the harness was wrong, not the contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
const TEARDOWN = readFileSync(join(HERE, "..", "main", "session-teardown.js"), "utf8");
// ⚠ `denyPendingPermissions` MOVED AGAIN IN THE SAME WAVE — to `main/session-permissions.js`,
// which owns how a held `canUseTool` promise is resolved AND what the agent is told when the
// answer is no (a windowless auto-deny is not a decision, so it may not say "Denied by operator").
// The C3 sweep it performs is byte-unchanged; only its address is.
const PERMS = readFileSync(join(HERE, "..", "main", "session-permissions.js"), "utf8");

const cutFrom = (src, from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to);
  assert.ok(a !== -1 && b > a, `slice ${from} not found`);
  return src.slice(a, b);
};
const cut = (from, to) => cutFrom(ENGINE, from, to);
const cutPerms = (from, to) => cutFrom(PERMS, from, to);
const cutTeardown = (from, to) => cutFrom(TEARDOWN, from, to);

// The REAL settle + the REAL denyPendingPermissions, evaluated verbatim with fakes for the
// leaf deps (store / sessions / refreshTray / baseRecord).
function harness(over = {}) {
  const calls = { saved: [], clearedSdk: [], destroyed: 0, tray: 0 };
  const sessions = new Map();
  const store = {
    saveRecord: (r) => calls.saved.push(r),
    clearSdkSessionId: (k) => calls.clearedSdk.push(k),
  };
  // §3.3: settle also hands the ended session to the pill projection, which decides whether
  // a pill survives it (only where the WINDOW does — the abandonment case). The fake records
  // the call so the tests below can pin that `keepWindow` is what is passed through.
  const sessionSummary = {
    ended: [],
    noteEnded(s, keepWindow) { this.ended.push({ key: s.key, keepWindow }); return keepWindow; },
  };
  // ⚠ TWO MORE FREE VARS JOINED `settle` ON 2026-08-22 (Samuel's ended-agent ruling): it FREEZES
  // the agent's history before dropping the registry entry, because the narration ring lives on
  // the session object and that is the last moment it exists. Faked here so these cases stay
  // about the TEARDOWN contract; `test/agent-retention.test.mjs` owns the retention rule, and
  // `test/agent-ended-is-dead.test.mjs` pins the ORDER (freeze, then delete).
  const agentHistory = { frozen: [], record(r) { this.frozen.push(r); return true; } };
  const sessionMetrics = { metrics: () => ({ contextUsed: null, contextWindow: null, tokensSpent: null, startedAt: null, lastActivityAt: null }) };
  const api = new Function(
    "store", "deps", "sessionSummary",
    "agentHistory", "sessionMetrics", "sessionNarration", "diag",
    `${cutPerms("function denyPendingPermissions(s, message) {", "// Returns TRUE only when")}
     ${cutTeardown("function settle(s, outcome, keepWindow) {", "// THE WORK LANE FOR ONE ADDRESS")}
     return { settle, denyPendingPermissions };`
  )(
    store,
    // The engine's `sessionTeardown.bind({...})` payload, faked. `denyPendingPermissions` is the
    // REAL one, sliced above — the C3 sweep is what these cases are about, so it must not be a stub.
    {
      sessions,
      baseRecord: (s) => ({ key: s.key, phase: s.state.phase }),
      denyPendingPermissions: (s, msg) => denyPendingPermissionsRef(s, msg),
      refreshTray: () => { calls.tray += 1; },
      sessionOn: () => null,
    },
    sessionSummary, agentHistory, sessionMetrics, { ringFor: () => [] }, () => {}
  );
  // ⚠ The real sweep, wired through the injected handle: `settle` calls it as
  // `deps.denyPendingPermissions`, and the function it must call is the engine's own.
  function denyPendingPermissionsRef(s, msg) { return api.denyPendingPermissions(s, msg); }
  calls.ended = sessionSummary.ended;
  calls.frozen = agentHistory.frozen;

  const settled = [];
  const s = {
    key: "ch1:t1",
    state: { phase: "running" },
    settled: false,
    idleTimer: null,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pushIterator: { closed: false, close() { this.closed = true; } },
    abortController: { aborted: false, abort() { this.aborted = true; } },
    win: { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; calls.destroyed += 1; } },
    ...over,
  };
  s.pendingPermissions.set("r1", (v) => settled.push(v));
  s.pendingNames.set("r1", "mcp__dopl__dopl_channel#post");
  sessions.set(s.key, s);
  return { ...api, s, sessions, calls, settled };
}

test("C3: settle DENIES every awaited canUseTool promise (fail closed)", () => {
  const h = harness();
  h.settle(h.s, "interrupted");
  assert.deepEqual(h.settled, [{ behavior: "deny", message: "Session ended" }],
    "an unanswered post must resolve DENY, never hang the SDK child");
  assert.equal(h.s.pendingPermissions.size, 0);
  assert.equal(h.s.pendingNames.size, 0, "both maps clear together");
});

test("C3: settle CLOSES the push iterator and ABORTS the query", () => {
  const h = harness();
  h.settle(h.s, "interrupted");
  assert.equal(h.s.pushIterator.closed, true, "the prompt stream must end, or the child keeps waiting for turns");
  assert.equal(h.s.abortController.aborted, true, "and the query itself is aborted");
});

test("C3: the rest of the terminal contract is unchanged", () => {
  const h = harness();
  h.settle(h.s, "interrupted");
  assert.equal(h.s.settled, true);
  assert.equal(h.sessions.size, 0, "the registry slot is freed");
  // ⚠ AND THE LINE WENT, SO THIS WENT WITH IT (2026-08-20, F-234). This asserted
  // `h.calls.destroyed === 1` over `settle`'s `if (!keepWindow && s.win && …) s.win.destroy()`.
  // The previous pass KEPT it on the §14 grounds that a live line needs a rule even when
  // production cannot reach it, and said outright: "it goes when the line goes, in the same
  // change." F-234 is that change — the destroy is deleted, because `s.win` is null on every
  // session and the flag now means one thing only (retain the ENDED PILL). The replacement
  // rule is an ABSENCE and lives with the rest of F-234:
  // `session-summary-retention.test.mjs › the dead window DESTROY is gone from settle`.
  assert.equal(h.calls.destroyed, 0, "settle no longer destroys anything — there is no window");
  assert.deepEqual(h.calls.clearedSdk, [], "an interrupted end KEEPS the sdkSessionId (FIX #7)");
  assert.equal(h.calls.saved.length, 1, "the full record still persists");
  // A completed/failed end still drops the resume entry.
  const done = harness();
  done.settle(done.s, "completed");
  assert.deepEqual(done.calls.clearedSdk, ["ch1:t1"]);
});

test("C3: settle stays idempotent — a second call denies nothing twice", () => {
  const h = harness();
  h.settle(h.s, "interrupted");
  const before = h.settled.length;
  h.settle(h.s, "interrupted");
  assert.equal(h.settled.length, before, "already settled -> no second teardown");
});

test("C3: a session with no live handles settles without throwing (parked shell / eviction)", () => {
  const h = harness({ pushIterator: null, abortController: null });
  assert.doesNotThrow(() => h.settle(h.s, "interrupted"));
});

test("C3: the shipped settle really runs the teardown BEFORE it drops the handles", () => {
  const body = cutTeardown("function settle(s, outcome, keepWindow) {", "// THE WORK LANE FOR ONE ADDRESS");
  const order = ["deps.denyPendingPermissions(s, 'Session ended')", "s.pushIterator.close()", "s.abortController.abort()", "deps.sessions.delete(s.key)"];
  let at = -1;
  for (const needle of order) {
    const i = body.indexOf(needle);
    assert.ok(i > at, `${needle} must come after the previous step`);
    at = i;
  }
});

test("C3 HANDOFF: the reducer's crash branch still needs abortQuery FIRST", () => {
  // Documented, not enforced here: session-reducer.js belongs to the concurrent A/B/D work.
  // When that lands, test/session-reducer.test.mjs's crash case must be re-pinned to
  // ["abortQuery", "settle", "lifecycle", "emit"]. Until then settle's own abort (above) is
  // what keeps a crashed session from orphaning its child process.
  const REDUCER = readFileSync(join(HERE, "..", "main", "session-reducer.js"), "utf8");
  assert.match(REDUCER, /if \(type === 'crash'\)/, "the crash branch is where that effect goes");
});

// A5 (contract v3.0) — "OPEN SESSION" OPENS THE WINDOW AND STARTS NOTHING.
//
// The web session card's button is now called "Open session": it opens THIS member's own
// window on a shared THREAD. It has never started the agent, and this round renames copy
// only, so the v2.3 / v2.5 LAZY-RESUME semantics must not drift a single step. That
// behaviour is spread across four files with no single test naming it, which is exactly
// how a rename round loses it:
//
//   renderer/preload.js  sessions.reopen ->  main/channel-dir-ipc.js 'sessions:reopen'
//     -> session-engine.reopenByTask -> session-reopen.reopenByTask
//        · a LIVE session  -> win.show() + win.focus(), nothing else
//        · no live session -> session-park.recreateParkedShell -> startSession({parkedShell:true})
//          -> session-engine returns BEFORE startQuery; session-park.emitParkedShell paints
//             a header + a calm note + the Paused pill
//   and the shell then sits there until the REDUCER sees a wake trigger:
//        · steer (the operator typed)                 -> resumeQuery
//        · inbound_accept / _for_task / _released     -> resumeQuery
//        · everything else, inbound_arrived + decline included, leaves it parked
//
// Same source-extraction idiom as session-reopen / session-park / session-reducer: the
// three PURE blocks are sliced from the shipping files and driven with fakes, so this
// pins the real code, and a structural read of session-engine.js pins the one branch that
// is not extractable (the parkedShell early return).
//
// WHY IT MATTERS: an "Open session" that started a query would silently spend tokens (and
// run gated tools) on every click from the web card, for a thread the operator only wanted
// to LOOK at, on a machine they may have walked away from.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "..", "main", name), "utf8");

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

const REOPEN = slice(read("session-reopen.js"), "SESSION-REOPEN-PURE");
const PARK = slice(read("session-park.js"), "SESSION-PARK-PURE");
// §2 SPLIT: the effect builders moved to session-effects.js; the reducer block calls them
// as free vars, so the two slices must be evaluated together (effects FIRST).
const REDUCER = slice(read("session-effects.js"), "SESSION-EFFECTS") + "\n" + slice(read("session-reducer.js"), "SESSION-REDUCER");
const ENGINE = read("session-engine.js");

// ── the reopen bridge: a LIVE window is SHOWN, never driven ───────────────────────

function reopenHarness(recreate) {
  const calls = { show: 0, focus: 0, recreate: [], refreshTray: 0 };
  const store = { sessionKey: (c, t) => `${c}:${t}` };
  const api = new Function("store", `${REOPEN}\n return { bind, reopenByTask };`)(store);
  const sessions = new Map();
  api.bind({
    sessions,
    refreshTray: () => { calls.refreshTray++; },
    recreateParkedShell: recreate ? (a) => { calls.recreate.push(a); return recreate(a); } : null,
  });
  return { ...api, sessions, calls };
}

test("A5: Open session on a LIVE session ONLY shows the window (no query, no turn, no dispatch)", () => {
  const h = reopenHarness(() => ({ ok: true }));
  // A session object with every field a query would need. If the button drove the agent it
  // would have to reach one of these; the fake explodes if it does.
  const s = {
    settled: false, windowHidden: true, context: {}, sessionId: "s-1",
    win: { isDestroyed: () => false, show() { h.calls.show++; }, focus() { h.calls.focus++; } },
    get query() { throw new Error("Open session must not touch the SDK query"); },
    get pushIterator() { throw new Error("Open session must not push a turn"); },
    get firstTurn() { throw new Error("Open session must not build a first turn"); },
  };
  h.sessions.set("c1:t1", s);
  assert.deepEqual(h.reopenByTask({ channelId: "c1", taskId: "t1" }), { ok: true });
  assert.equal(h.calls.show, 1, "the window is revealed");
  assert.equal(h.calls.focus, 1, "and fronted");
  assert.equal(s.windowHidden, false);
  assert.equal(h.calls.recreate.length, 0, "a live session never recreates a shell either");
});

test("A5: Open session with no live session recreates a PARKED shell, never a running one", async () => {
  const h = reopenHarness(() => ({ ok: true }));
  assert.deepEqual(await h.reopenByTask({ channelId: "c1", taskId: "t1" }), { ok: true });
  // Q6b: `fromChannel` marks this as an operator CLICK, which is the ONLY caller allowed to open
  // a shell for a thread with no durable record here. The inbound gate never sets it.
  assert.deepEqual(h.calls.recreate, [{ channelId: "c1", taskId: "t1", fromChannel: true }],
    "the ONLY fallback is the parked-shell builder — there is no 'reopen and resume' path");
});

// ── the recreate itself: a shell, an empty header, and NOTHING running ────────────

function parkHarness(record) {
  const calls = { startSession: [], query: [], consume: [], dispatch: [], emit: [] };
  const sessions = new Map();
  const io = {
    makePushIterator: () => ({ pushed: [], push(m) { this.pushed.push(m); }, close() {} }),
    frameContinuation: () => { throw new Error("a recreate must not frame a turn"); },
    noteGatedBody: (s, b) => { (s.gatedBodies = s.gatedBodies || []).push(b); },
  };
  const store = { sessionKey: (c, t) => `${c}:${t}`, getRecord: () => record, getSdkSessionId: () => "sdk-1" };
  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${PARK}\n return { bind, recreateParkedShell, emitParkedShell };`
  )(io, store, { randomBytes: () => ({ toString: () => "dead" }) }, null, () => {});
  api.bind({
    sessions,
    getSdk: async () => ({ query: (a) => { calls.query.push(a); return {}; } }),
    buildSdkOptions: () => { throw new Error("a parked shell assembles no SDK options"); },
    consume: (...a) => calls.consume.push(a),
    dispatch: (...a) => calls.dispatch.push(a),
    startSession: async (spec) => { calls.startSession.push(spec); const s = { key: spec.key, settled: false, ...spec }; sessions.set(spec.key, s); return s; },
    hasLiveSession: () => false,
    emit: (s, p) => calls.emit.push(p),
    windowFactoryReady: () => true,
    atWindowCap: () => false,
    settleSession: () => {},
  });
  return { ...api, sessions, calls };
}

const REC = { channelId: "c1", taskId: "t1", workspaceId: "w1", side: "responder", profile: "full", mode: "interactive" };

test("A5: recreateParkedShell asks for parkedShell:true with NO first turn of any kind", async () => {
  const h = parkHarness(REC);
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: true });
  const spec = h.calls.startSession[0];
  assert.equal(spec.parkedShell, true, "the shell flag is what suppresses startQuery");
  assert.equal(spec.rawFirstTurn, undefined, "no resume nudge is smuggled in");
  assert.equal(spec.firstMessage, undefined, "and no request body either");
  // Nothing downstream of the window was touched: no SDK, no consumer loop, no dispatch.
  assert.deepEqual(h.calls.query, [], "no sdk.query");
  assert.deepEqual(h.calls.consume, [], "no consumer loop");
  assert.deepEqual(h.calls.dispatch, [], "and no event dispatched into the reducer");
});

test("A5: the shell paints init + a calm note + the Paused pill, and emits nothing else", () => {
  const h = parkHarness(REC);
  h.emitParkedShell({ sessionId: "s1", side: "responder", profile: "full", mode: "interactive", context: {} });
  assert.deepEqual(h.calls.emit.map((p) => p.type), ["init", "notice", "status"]);
  assert.equal(h.calls.emit[0].model, null, "no model: nothing is running");
  assert.equal(h.calls.emit[2].phase, "parked");
  // The note is the operator-facing statement of exactly this behaviour.
  assert.match(h.calls.emit[1].text, /Nothing is running yet/);
});

// ── the engine's one non-extractable branch: return BEFORE startQuery ─────────────

test("A5: startSession returns on a parkedShell BEFORE it can reach startQuery", () => {
  assert.match(ENGINE, /if \(spec\.parkedShell\) \{ sessionPark\.emitParkedShell\(s\); return s; \}/,
    "the early return is the guard; deleting it turns every Open session into a launch");
  const guard = ENGINE.indexOf("if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }");
  const start = ENGINE.indexOf("await startQuery(s, sdk);", guard);
  assert.ok(start > guard, "startQuery is only reachable AFTER the parked-shell branch returns");
  // And the turn it would have pushed is empty for a shell, so even a regression here has
  // nothing to say. (session-engine builds `firstTurn` before the branch.)
  assert.match(ENGINE, /const firstTurn = spec\.parkedShell \? ''/);
});

// ── the wake triggers: ONLY a steer or an ACCEPTED inbound resumes ────────────────

const { initialSessionState, sessionReducer } = new Function(
  `${REDUCER}\n return { initialSessionState, sessionReducer };`
)();

// The state an opened shell is in: parked, nothing running (session-engine stamps exactly
// these three fields on a parkedShell spec).
const parked = () => ({ ...initialSessionState(), phase: "parked", parked: true, activity: "parked" });
const effTypes = (r) => r.effects.map((e) => e.type);

test("A5: a STEER (the operator typed) is a wake trigger", () => {
  const r = sessionReducer(parked(), { type: "steer", text: "carry on" });
  assert.ok(effTypes(r).includes("resumeQuery"), "typing is what starts the agent, not opening");
  assert.equal(r.state.parked, false);
  assert.deepEqual(effTypes(r).slice(0, 2), ["resumeQuery", "pushTurn"], "wake FIRST, then the turn");
});

test("A5: an ACCEPTED inbound is the other wake trigger (all three accept spellings)", () => {
  for (const type of ["inbound_accept", "inbound_accept_for_task", "inbound_released"]) {
    const r = sessionReducer(parked(), { type, pendingId: "p1", message: "hi", authorName: "David" });
    assert.ok(effTypes(r).includes("resumeQuery"), `${type} wakes the shell`);
    assert.equal(r.state.parked, false, type);
  }
});

test("A5: an inbound that only ARRIVES is HELD — the shell stays parked, no query", () => {
  const r = sessionReducer(parked(), { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "David" });
  assert.ok(!effTypes(r).includes("resumeQuery"), "a message waiting is not an operator decision");
  assert.ok(!effTypes(r).includes("pushInbound"), "and it never reaches the agent");
  assert.equal(r.state.parked, true, "still parked, now showing a card");
  assert.equal(r.state.hasPendingInbound, true);
});

test("A5: a DECLINE is not a wake trigger either", () => {
  const held = sessionReducer(parked(), { type: "inbound_arrived", pendingId: "p1", message: "hi" }).state;
  const r = sessionReducer(held, { type: "inbound_decline", pendingId: "p1" });
  assert.ok(!effTypes(r).includes("resumeQuery"));
  assert.equal(r.state.parked, true);
  assert.equal(r.state.phase, "parked");
});

test("A5: the SDK tail of the torn-down query cannot wake an opened shell", () => {
  // FIX #5: a late assistant/tool/result from the query that was aborted at park must be
  // inert. Otherwise "Open session" plus one straggler message would look like a resume.
  for (const type of ["assistant", "tool_use", "tool_result", "result", "permission_request", "outbound_post"]) {
    const r = sessionReducer(parked(), { type, text: "x", requestId: "r1" });
    assert.deepEqual(r.effects, [], `${type} must produce no effects on a parked shell`);
    assert.equal(r.state.parked, true, type);
  }
});

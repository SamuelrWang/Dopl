// Shared source-extraction harness for the reopen-in-place suite (no tests of its own).
//
// FOUR real blocks wired to each other exactly as the app wires them, so a test can assert on
// the WHOLE trace of one inbound message rather than on one predicate in the middle of it:
//   listener-messages.js   dispatchMessage — the real body, routes then classify then verdicts.
//   session-dispatch.js    SESSION-DISPATCH-PURE — the six routes, including (6), the reopen.
//   session-gate.js        SESSION-GATE-PURE — feedInboundForTask: recreate, then HOLD.
//   session-park.js        SESSION-PARK-PURE — recreateParkedShell + the window-budget eviction.
// Plus the REAL targeting module (classify and the tag readers), the REAL session-io FIFO and
// the REAL reducer, so "held" vs "fed" is decided by the shipped state machine.
//
// FAKES ONLY AT THE LEAVES: the durable store, the window factory (startSession) and the OS
// notification. Nothing here can open a window, start a query or touch disk.
//
// Each harness() call evaluates all three blocks afresh, so the module state inside them cannot
// leak between tests. The one exception is the REAL targeting module (its legacy-thread registry
// is module state) — every fixture below carries a thread tag, which noteMyLegacyThread refuses
// to record ("openers only"), so no test can write to it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer } from "../_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "..", "main", p), "utf8");

export const LISTENER = M("listener-messages.js");
export const DISPATCH = M("session-dispatch.js");
export const GATE = M("session-gate.js");
export const PARK = M("session-park.js");

// targeting.js is dependency-free, so classify AND the tag readers route (6) uses are the REAL
// ones here — a legacy id this file and the shipped minter disagreed about is exactly the class
// of bug the route exists to fix.
export const targeting = require("../../main/targeting.js");
const realIo = require("../../main/session-io.js"); // the REAL inbound FIFO + gated-body recorder
const { initialSessionState, sessionReducer } = loadReducer();

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels missing or out of order`);
  return src.slice(from, to);
}

// `dispatchMessage` is an `async function`, so the keyword comes along with the body.
function extractAsyncFn(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.notEqual(at, -1, `async function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", at);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(at, i);
}

export const DISPATCH_BLOCK = slice(DISPATCH, "SESSION-DISPATCH-PURE");
const GATE_BLOCK = slice(GATE, "SESSION-GATE-PURE");
const PARK_BLOCK = slice(PARK, "SESSION-PARK-PURE");

export const ME = "11111111-1111-1111-1111-111111111111";
export const PEER = "22222222-2222-2222-2222-222222222222";
export const THIRD = "33333333-3333-3333-3333-333333333333";
export const CHAN = "dba90694-1111-4222-8333-444444444444";
export const OTHER_CHAN = "eeeeeeee-1111-4222-8333-444444444444";
export const UUID_THREAD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
export const AGENT_ROW = "a9a9a9a9-4f89-41d3-9a0c-0305e82c3301";
export const LEGACY = targeting.legacyThreadId(CHAN, 440); // the tag this machine minted for #440
export const BODY = "one more thing — can you also check the staging config?";

export function harness(over = {}) {
  const cfg = { windowMode: true, records: {}, sdkIds: {}, capAt: null, messageMode: "ask", ...over };
  const calls = {
    trigger: [], fyi: [], taskNotify: [], escalate: [], launch: [], arm: [],
    startSession: [], recordReads: [], history: [], notices: [], effects: [], evicted: [], diag: [],
  };
  const sessions = new Map();

  // The durable store, faked at the leaf. Both readers (route 6 and recreateParkedShell) go
  // through it, so a test can say WHICH key a lookup used.
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
    getRecord: (key) => { calls.recordReads.push(key); return cfg.records[key] || null; },
    getSdkSessionId: (key) => cfg.sdkIds[key] || null,
  };

  // ── the REAL park block (recreateParkedShell) ──────────────────────────────────
  const park = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${PARK_BLOCK}\n return { bind, recreateParkedShell, evictIdleShell, emitParkedShell };`
  )(
    { makePushIterator: () => ({ push() {}, close() {} }), noteGatedBody: realIo.noteGatedBody },
    store, {}, null, (...a) => calls.diag.push(a.join(" "))
  );
  park.bind({
    sessions,
    windowFactoryReady: () => true,
    atWindowCap: () => cfg.capAt != null && sessions.size >= cfg.capAt,
    settleSession: (s) => { calls.evicted.push(s.key); s.settled = true; sessions.delete(s.key); },
    hasLiveSession: (a) => { const s = sessions.get(store.slotKey(a)); return !!(s && !s.settled); },
    emit: () => {},
    // The window factory, faked — but the STATE it builds is the shipped shape: the real
    // initialSessionState plus session-engine's own parked-shell stamping (phase/parked/
    // activity). Nothing here can start a query, and `parkedShell` is recorded so a test can
    // assert the flag that suppresses one was actually passed.
    startSession: async (spec) => {
      calls.startSession.push(spec);
      const state = initialSessionState({ mode: spec.mode, side: spec.side, messageMode: cfg.messageMode });
      state.turns = Number(spec.turns) || 0;
      state.costUsd = Number(spec.costUsd) || 0;
      if (spec.parkedShell) { state.phase = "parked"; state.parked = true; state.activity = "parked"; }
      const s = {
        ...spec, key: spec.key, settled: false, pendingInbound: [], gatedBodies: [], state,
        counterpartyId: spec.counterpartyId || null, win: null,
      };
      sessions.set(spec.key, s);
      return s;
    },
    loadHistory: async (s) => { calls.history.push(s.key); },
  });

  // ── the REAL gate block (feedInboundForTask -> recreate + hold) ────────────────
  let pid = 0;
  class FakeNotification {
    constructor(opts) { calls.notices.push(opts); }
    static isSupported() { return true; }
    on() {}
    show() {}
  }
  const gate = new Function(
    "crypto", "Notification", "io", "store", "sessionPark", "diag",
    `${GATE_BLOCK}\n return { bind, feedInbound, feedInboundForTask, decideInbound };`
  )(
    { randomUUID: () => `pid-${++pid}` }, FakeNotification,
    { queueInbound: realIo.queueInbound, shiftInbound: realIo.shiftInbound, noteGatedBody: realIo.noteGatedBody },
    store, park, (...a) => calls.diag.push(a.join(" "))
  );
  // The REAL reducer is the dispatch, so "held" vs "fed" is decided by the shipped state
  // machine and not by an assertion about it.
  gate.bind({
    sessions,
    dispatch: (s, ev) => {
      const r = sessionReducer(s.state, ev);
      s.state = r.state;
      for (const e of r.effects) calls.effects.push(e);
      return true;
    },
  });

  // ── the REAL routing block ─────────────────────────────────────────────────────
  const sessionEngine = {
    hasLiveSession: (a) => { const s = sessions.get(store.slotKey(a)); return !!(s && !s.settled); },
    counterpartyFor: (a) => { const s = sessions.get(store.slotKey(a)); return (s && s.counterpartyId) || null; },
    feedInbound: (a) => gate.feedInbound(a),
    feedInboundForTask: (a) => gate.feedInboundForTask(a),
    launchRequesterSession: async (a) => { calls.launch.push(a); return { sessionId: "sess-1" }; },
    // 2026-08-05 (rollback §3.4): the requester SHELL is gone. The operator's typed request
    // now takes the SAME launch a spawned session's create takes, and arms the display-only
    // request strip on top of it.
    armRequestStatus: (a) => { calls.arm.push(a); return true; },
    noteRequestStatus: () => false,
  };
  const routes = new Function(
    "settings", "targeting", "sessionEngine", "io", "roster", "store", "notifyLocal", "diag",
    `${DISPATCH_BLOCK}
     return { feedLiveSession, maybeOpenRequesterSession, maybeSurfaceRequesterReply,
              noteRequestLifecycle, maybeReopenAddressedThread,
              exchangeTag, reopenableRecord };`
  )(
    { getWindowMode: () => cfg.windowMode }, targeting, sessionEngine,
    { displayNameFor: (id) => `name:${id}` },
    { authorLabel: (c, m) => (m.authorKind === "agent" ? `agent-of:${m.authorUserId}` : `name:${m.authorUserId}`) },
    store, () => {}, (...a) => calls.diag.push(a.join(" "))
  );

  // ── the REAL listener body ─────────────────────────────────────────────────────
  const api = new Function(
    "versionSkew", "channelAgents", "sessionDispatch", "targeting", "trigger", "taskNotify", "diag",
    `${extractAsyncFn(LISTENER, "dispatchMessage")}\n return { dispatchMessage };`
  )(
    { observe: () => {} },
    { routeAddressedAgent: async () => "", handleFor: () => null },
    routes, targeting,
    { handleTrigger: async (e, m) => calls.trigger.push(m.seq), sendFyi: (e, m) => calls.fyi.push(m.seq) },
    {
      notifyTaskReply: (e, m) => calls.taskNotify.push(m.seq),
      notifyAgentEscalation: (e, m) => calls.escalate.push(m.seq),
      notifyAgentDismissed: () => {},
    },
    (...a) => calls.diag.push(a.join(" "))
  );

  return {
    dispatch: (entry, m) => api.dispatchMessage(entry, m, ME),
    routes, sessions, store, calls, cfg,
    shellFor: (key) => sessions.get(key),
  };
}

/** The DM the incident happened in: two members, the server auto-addresses every post. */
export const dm = (over = {}) => ({
  channel: { id: CHAN, name: "David", memberCount: 2, isMember: true, isDirect: true, ...over },
  workspaceId: "w1", rosterKnown: true, teamAgents: 0,
});

/** The peer's follow-up: their agent, addressed back to me, carrying the exchange's tag. */
export const followUp = (tag, over = {}) => {
  const { metadata, ...rest } = over;
  return {
    kind: "message", seq: 443, authorUserId: PEER, authorKind: "agent", body: BODY,
    metadata: { to_user_id: ME, taskId: tag, ...(metadata || {}) },
    ...rest,
  };
};

/** The durable record the settled pair session left behind. */
export const record = (over = {}) => ({
  key: `${CHAN}:${LEGACY}`, sessionId: "s-440", sdkSessionId: null,
  channelId: CHAN, taskId: LEGACY, workspaceId: "w1",
  side: "responder", profile: "full", mode: "interactive", phase: "ended", startedAt: 1,
  counterpartyId: PEER, direct: true, bind: "pair", agentId: null,
  counterpartyName: "David", channelName: "David", taskTitle: "the staging ask",
  turns: 3, costUsd: 0.21, model: "default", ...over,
});

/** A harness whose durable store holds exactly this one record. */
export const withRecord = (rec, over = {}) => harness({ records: { [rec.key]: rec }, ...over });

/** The turns that actually reached the agent. */
export const pushed = (calls) => calls.effects.filter((e) => e.type === "pushInbound");

export { assert };

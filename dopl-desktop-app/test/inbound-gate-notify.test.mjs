// Tests for the inbound gate's OS NOTIFICATION path (main/session-gate.js).
//
// Split out of test/session-gate.test.mjs to keep both files under the §2 500-line cap;
// same SOURCE EXTRACTION with INJECTION idiom, so the notification decision under test is
// the one that ships. Covers:
//   the banner is SUPPRESSED when the operator ALREADY had the window in front of them;
//   FIX #8 — it is NOT suppressed when the DISPATCH itself reshows + focuses a hidden
//     window. session-engine's emit() pops a hidden window on `inbound_pending`, so reading
//     win.isFocused() after the dispatch killed the banner in exactly the case that needs
//     it (the window popped because the operator was somewhere else entirely). Visibility
//     is captured BEFORE the dispatch and passed in;
//   the click handler shows + focuses the window and clears the hidden flag;
//   an unsupported platform is a no-op, and the copy is one-lined, bounded, em-dash-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-gate.js"), "utf8");

const from = SRC.indexOf("// \u2500\u2500\u2500 BEGIN SESSION-GATE-PURE");
const to = SRC.indexOf("// \u2500\u2500\u2500 END SESSION-GATE-PURE");
assert.ok(from !== -1 && to > from, "SESSION-GATE-PURE sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

// The REAL queue helpers — session-io.js imports nothing electron-bound.
const realIo = require(join(HERE, "..", "main", "session-io.js"));

const KEY = "c1:t1";

function harness(over = {}) {
  const cfg = { notifySupported: true, ...over };
  const calls = { dispatch: [], notices: [], handlers: [] };

  const crypto = { randomUUID: (() => { let n = 0; return () => `pid-${++n}`; })() };
  class FakeNotification {
    constructor(opts) { this.opts = opts; calls.notices.push(opts); }
    static isSupported() { return cfg.notifySupported; }
    on(evt, fn) { if (evt === "click") calls.handlers.push(fn); }
    show() { this.shown = true; }
  }
  const io = {
    queueInbound: realIo.queueInbound,
    shiftInbound: realIo.shiftInbound,
    noteGatedBody: realIo.noteGatedBody,
  };
  const sessions = new Map();
  // D2: the gate keys on store.slotKey now — (channel, agent) for a TEAM session,
  // (channel, thread) for every other — so the fake mirrors both builders.
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
  const sessionPark = { recreateParkedShell: async () => ({ ok: false }) };
  const diag = () => {};

  const api = new Function(
    "crypto", "Notification", "io", "store", "sessionPark", "diag",
    `${BLOCK}\n return { bind, inboundNotice, windowHasFocus, feedInbound, decideInbound };`
  )(crypto, FakeNotification, io, store, sessionPark, diag);
  api.bind({
    sessions,
    dispatch: (s, ev) => {
      calls.dispatch.push(ev);
      if (ev.type === "inbound_accept_for_task" && s && s.state) s.state.inboundForTask = true;
    },
  });
  return { ...api, sessions, calls, cfg };
}

// A session object shaped like the engine's: reducer state + the pending FIFO + a window.
function fakeSession(over = {}) {
  const state = { messageMode: "ask", inboundForTask: false, mode: "interactive", ...(over.state || {}) };
  const focused = over.focused === true;
  return {
    key: KEY, settled: false, pendingInbound: [], state, windowHidden: false,
    win: { isDestroyed: () => false, isFocused: () => focused, show() { this.shown = true; }, focus() { this.focused = true; } },
    ...over, state,
  };
}

const reply = (over = {}) => ({ channelId: "c1", taskId: "t1", message: "ping", authorName: "David", ...over });
const evTypes = (calls) => calls.dispatch.map((e) => e.type);

test("the OS notification is SUPPRESSED while the session window has focus", () => {
  const h = harness();
  h.sessions.set(KEY, fakeSession({ focused: true }));
  h.feedInbound(reply());
  assert.equal(h.calls.notices.length, 0, "the operator is already looking at the card");
  assert.deepEqual(evTypes(h.calls), ["inbound_arrived"], "the gate card still renders");
});

// ── FIX #8: the pop must not eat its own notification ─────────────────────────────
// session-engine's emit() RESHOWS and focuses a hidden window on `inbound_pending`, so
// asking win.isFocused() AFTER the dispatch suppressed the banner in exactly the case that
// needs it: the window popped from hidden because the operator was somewhere else. The
// visibility is therefore read BEFORE the dispatch.

test("FIX #8: a HIDDEN window that the dispatch reshows still gets its OS notification", () => {
  const h = harness();
  const s = fakeSession({ windowHidden: true });
  h.sessions.set(KEY, s);
  // Re-bind with a dispatch that performs the engine's reshow, exactly as emit() does.
  h.bind({
    sessions: h.sessions,
    dispatch: (sess, ev) => {
      h.calls.dispatch.push(ev);
      if (ev.type === "inbound_arrived") { sess.win.show(); sess.win.focus(); sess.windowHidden = false; }
    },
  });
  assert.equal(h.feedInbound(reply()), true);
  assert.equal(s.win.shown, true, "the window really did pop during the dispatch");
  assert.equal(s.win.focused, true, "and it took focus, which used to suppress the banner");
  assert.equal(h.calls.notices.length, 1, "the operator is told, because they were NOT looking before");
  assert.equal(h.calls.notices[0].title, "Message from David");
});

test("FIX #8: the next card in the queue gets the same pre-dispatch reading", () => {
  const h = harness();
  const s = fakeSession({ windowHidden: true });
  h.sessions.set(KEY, s);
  h.bind({
    sessions: h.sessions,
    dispatch: (sess, ev) => {
      h.calls.dispatch.push(ev);
      if (ev.type === "inbound_accept_for_task" && sess.state) sess.state.inboundForTask = true;
      if (ev.type === "inbound_arrived") { sess.win.show(); sess.win.focus(); sess.windowHidden = false; }
    },
  });
  h.feedInbound(reply({ message: "first" }));
  h.feedInbound(reply({ message: "second" }));
  s.windowHidden = true; // the operator closed it again while the first card waited
  h.calls.notices.length = 0;
  h.decideInbound(s, "pid-1", "accept");
  assert.equal(h.calls.notices.length, 1, "the re-surfaced card notifies too");
});

test("FIX #8: windowHasFocus treats a HIDDEN window as unfocused, and junk as unfocused", () => {
  const h = harness();
  assert.equal(h.windowHasFocus(fakeSession({ focused: true })), true);
  assert.equal(h.windowHasFocus(fakeSession({ focused: false })), false);
  assert.equal(h.windowHasFocus(fakeSession({ focused: true, windowHidden: true })), false,
    "an OS that still reports focus on a hidden window must not suppress the banner");
  assert.equal(h.windowHasFocus(null), false);
  assert.equal(h.windowHasFocus({ win: { isDestroyed: () => true } }), false);
  assert.equal(h.windowHasFocus({ win: { isDestroyed: () => { throw new Error("gone"); } } }), false);
});

test("clicking the notification shows + focuses the window and clears the hidden flag", () => {
  const h = harness();
  const s = fakeSession({ windowHidden: true });
  h.sessions.set(KEY, s);
  h.feedInbound(reply());
  assert.equal(h.calls.handlers.length, 1, "a click handler is wired");
  h.calls.handlers[0](); // exactly what Electron does on a click
  assert.equal(s.win.shown, true);
  assert.equal(s.win.focused, true);
  assert.equal(s.windowHidden, false);
});

test("no notification is attempted when the platform does not support them", () => {
  const h = harness({ notifySupported: false });
  h.sessions.set(KEY, fakeSession());
  assert.equal(h.feedInbound(reply()), true, "the gate still holds the reply");
  assert.equal(h.calls.notices.length, 0);
});


// ── notification copy ────────────────────────────────────────────────────────────

test("inboundNotice: plain one-line copy, bounded, with calm fallbacks and no em dash", () => {
  const long = "x".repeat(500);
  const n = harness().inboundNotice({ authorName: "David Chen", message: "line one\nline two" });
  assert.equal(n.title, "Message from David Chen");
  assert.equal(n.body, "line one line two", "collapsed to one line");
  const bounded = harness().inboundNotice({ authorName: long, message: long });
  assert.ok(bounded.title.length <= "Message from ".length + 60, "the name is capped");
  assert.ok(bounded.body.length <= 120, "the body is capped");
  const bare = harness().inboundNotice({});
  assert.equal(bare.title, "New channel message");
  assert.equal(bare.body, "Open the session window to accept or decline it.");
  for (const s of [n.title, n.body, bare.title, bare.body]) assert.ok(!s.includes("—"), "no em dash in copy");
});

// THE PINNED SHELL ITSELF — session-park.openRequesterShell + the lifecycle strip it arms.
//
// The v3.0 law is "opening a session window never starts the agent", and the requester shell has
// to obey it exactly like the reopen path does: a window, the thread's transcript, and NO query.
// It is deliberately built on the SAME machinery (startSession with `parkedShell: true`, which is
// the one flag session-engine returns before startQuery on) rather than a new shell kind, so this
// file pins the two things that would silently make it a launch: the spec it hands startSession,
// and the fact that nothing downstream of the window is touched.
//
// It also pins the two properties the window BUDGET depends on — the shell goes through the same
// atCapAfterEvict relief every other shell does, and it is itself reclaimable by evictIdleShell
// while the operator has not touched it — because a machine that opens one window per sent
// request and never gives one back would starve real inbound triggers at MAX_WINDOWS.
//
// SOURCE EXTRACTION with INJECTION, the session-park.test idiom: the BEGIN/END SESSION-PARK-PURE
// block is sliced from the shipping file, proven electron-free, and driven with fakes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");
const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-PARK-PURE block must not reference ${banned}`);
}

const CHANNEL = "cccccccc-1111-2222-3333-444444444444";
const TASK = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PEER = "22222222-2222-2222-2222-222222222222";

function harness(over = {}) {
  const cfg = { windowReady: true, atCap: false, historyFails: false, startsNothing: false, ...over };
  const calls = { startSession: [], query: [], consume: [], dispatch: [], emit: [], history: [], settled: [] };
  const sessions = new Map();
  const io = {
    makePushIterator: () => ({ push() {}, close() {} }),
    frameContinuation: () => { throw new Error("a shell must not frame a turn"); },
    noteGatedBody: () => {},
  };
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
    getRecord: () => null,
    getSdkSessionId: () => null,
  };
  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, openRequesterShell, noteRequestStatus, evictIdleShell, atCapAfterEvict, recreateParkedShell };`
  )(io, store, { randomBytes: () => ({ toString: () => "beef" }) }, null, () => {});
  api.bind({
    sessions,
    getSdk: async () => ({ query: (a) => { calls.query.push(a); return {}; } }),
    buildSdkOptions: () => { throw new Error("a pinned shell assembles no SDK options"); },
    consume: (...a) => calls.consume.push(a),
    dispatch: (...a) => calls.dispatch.push(a),
    // The real startSession stamps state.parked/activity from the parkedShell flag and sets the
    // Map entry SYNCHRONOUSLY (before its own first await); the fake mirrors both.
    startSession: async (spec) => {
      calls.startSession.push(spec);
      if (cfg.startsNothing) return null;
      const s = { key: spec.key, settled: false, startedAt: calls.startSession.length,
        state: spec.parkedShell ? { parked: true, phase: "parked" } : { parked: false, phase: "running" }, ...spec };
      sessions.set(spec.key, s);
      return s;
    },
    hasLiveSession: (a) => { const s = sessions.get(store.slotKey(a)); return !!(s && !s.settled); },
    emit: (s, payload) => calls.emit.push({ key: s.key, payload }),
    windowFactoryReady: () => cfg.windowReady,
    atWindowCap: () => cfg.atCap === true || (cfg.capAt != null && sessions.size >= cfg.capAt),
    loadHistory: async (s) => { calls.history.push(s.key); if (cfg.historyFails) throw new Error("fetch failed"); },
    settleSession: (s) => { calls.settled.push(s.key); s.settled = true; sessions.delete(s.key); },
    resolveChannelContext: async () => ({ workspaceId: "w1", channelName: "Ops", counterpartyId: null, direct: false }),
  });
  return { ...api, sessions, calls, cfg, store };
}

const openArgs = (over = {}) => ({
  channelId: CHANNEL, taskId: TASK, workspaceId: "w1", counterpartyId: PEER, direct: false,
  context: { channelName: "Ops", taskTitle: "Deploy check", authorName: "Dana", channelId: CHANNEL, workspaceId: "w1", taskId: TASK },
  ...over,
});

// ── the shell starts NOTHING ────────────────────────────────────────────────────

test("openRequesterShell asks for parkedShell:true with NO first turn of any kind", async () => {
  const h = harness();
  assert.deepEqual(await h.openRequesterShell(openArgs()), { ok: true });
  const spec = h.calls.startSession[0];
  assert.equal(spec.parkedShell, true, "the shell flag is what suppresses startQuery");
  assert.equal(spec.rawFirstTurn, undefined, "no resume nudge is smuggled in");
  assert.equal(spec.firstMessage, undefined, "and the request body is NOT replayed at the agent");
  assert.equal(spec.resumeSdkId, null, "nothing to resume: this thread is seconds old");
  // Nothing downstream of the window was touched.
  assert.deepEqual(h.calls.query, [], "no sdk.query");
  assert.deepEqual(h.calls.consume, [], "no consumer loop");
  assert.deepEqual(h.calls.dispatch, [], "and no event dispatched into the reducer");
});

test("the engine's parkedShell early return is what enforces it, and it is still there", () => {
  // The one branch that cannot be extracted. Pinned here as well as in open-session-no-query,
  // because the requester shell now depends on it for a second reason.
  assert.match(ENGINE, /if \(spec\.parkedShell\) \{ sessionPark\.emitParkedShell\(s\); return s; \}/);
  const guard = ENGINE.indexOf("if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }");
  assert.ok(ENGINE.indexOf("await startQuery(s, sdk);", guard) > guard);
});

test("the shell is a REQUESTER, read_only, and bound to the member the request names", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  const spec = h.calls.startSession[0];
  assert.equal(spec.side, "requester", "the operator's own goal, addressed outward");
  assert.equal(spec.profile, "read_only", "FAIL RESTRICTIVE: a thread this new has no stored profile");
  assert.equal(spec.mode, "interactive");
  assert.equal(spec.counterpartyId, PEER, "FIX L1: only this peer's replies may ever feed it");
  assert.equal(spec.key, `${CHANNEL}:${TASK}`, "the ordinary (channel, thread) slot, not an agent slot");
  assert.deepEqual([spec.turns, spec.costUsd], [0, 0], "a fresh budget for a fresh thread");
});

test("the DM flag rides through, so the outbound card can name the recipient", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs({ direct: true }));
  assert.equal(h.calls.startSession[0].direct, true);
  const g = harness();
  await g.openRequesterShell(openArgs({ direct: undefined }));
  assert.equal(g.calls.startSession[0].direct, false, "absent degrades to the channel wording, never a guess");
});

test("the thread's transcript is painted, and a failed fetch still leaves the shell open", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  assert.deepEqual(h.calls.history, [`${CHANNEL}:${TASK}`], "the history read is AWAITED, like the reopen path");
  const failed = harness({ historyFails: true });
  assert.deepEqual(await failed.openRequesterShell(openArgs()), { ok: true }, "a calm failure, not a dead end");
});

test("one shell per thread: a second open on a live session opens no second window", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  assert.deepEqual(await h.openRequesterShell(openArgs()), { ok: true });
  assert.equal(h.calls.startSession.length, 1, "the Map hit answers ok WITHOUT a second window");
});

test("a window factory that is not wired yet fails closed", async () => {
  const h = harness({ windowReady: false });
  assert.deepEqual(await h.openRequesterShell(openArgs()), { ok: false });
  assert.deepEqual(h.calls.startSession, []);
  const dead = harness({ startsNothing: true });
  assert.deepEqual(await dead.openRequesterShell(openArgs()), { ok: false }, "and a failed window is not ok");
});

// ── the window budget ───────────────────────────────────────────────────────────

test("the shell goes through the SAME cap relief every other shell does", async () => {
  const h = harness({ atCap: true });
  assert.deepEqual(await h.openRequesterShell(openArgs()), { ok: false, reason: "busy" });
  assert.deepEqual(h.calls.startSession, [], "at the cap with nothing to free, no window is opened");
});

test("a sent request does NOT permanently eat a slot: its shell is evictable while untouched", async () => {
  // The property the budget depends on. A pinned shell has no live agent, so it is exactly the
  // dormant window evictIdleShell exists to reclaim.
  const h = harness();
  await h.openRequesterShell(openArgs());
  const s = h.sessions.get(`${CHANNEL}:${TASK}`);
  assert.equal(s.state.parked, true, "it really is dormant");
  assert.equal(h.evictIdleShell(), true, "and the LRU relief can take it");
  assert.deepEqual(h.calls.settled, [`${CHANNEL}:${TASK}`]);

  // ...but never once the operator has touched it, or while a message is waiting on it.
  const touched = harness();
  await touched.openRequesterShell(openArgs());
  touched.sessions.get(`${CHANNEL}:${TASK}`).operatorTouched = true;
  assert.equal(touched.evictIdleShell(), false, "never close a window the operator used");

  const holding = harness();
  await holding.openRequesterShell(openArgs());
  holding.sessions.get(`${CHANNEL}:${TASK}`).state.hasPendingInbound = true;
  assert.equal(holding.evictIdleShell(), false, "nor one holding an unanswered reply");
});

test("at the cap, an idle requester shell is what a REAL trigger reclaims", async () => {
  // The starvation case stated end to end: two sent requests fill a two-window budget, and the
  // third open frees the oldest untouched shell instead of refusing.
  const h = harness({ capAt: 2 });
  await h.openRequesterShell(openArgs({ taskId: "t-a" }));
  await h.openRequesterShell(openArgs({ taskId: "t-b" }));
  assert.equal(h.sessions.size, 2);
  assert.deepEqual(await h.openRequesterShell(openArgs({ taskId: "t-c" })), { ok: true });
  assert.deepEqual(h.calls.settled, [`${CHANNEL}:t-a`], "the least-recently-created untouched shell went");
});

// ── the lifecycle strip ─────────────────────────────────────────────────────────

const strips = (h) => h.calls.emit.filter((e) => e.payload.type === "request_status").map((e) => e.payload.status);

test("opening the shell arms the strip at 'sent' — the request is already on the wire", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  assert.deepEqual(strips(h), ["sent"]);
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).requestStatus, "sent");
  // THE WIRE CARRIES A FACT, NOT COPY: the renderer owns the words, so nothing here can put a
  // string of somebody else's choosing on the screen.
  const payload = h.calls.emit.find((e) => e.payload.type === "request_status").payload;
  assert.deepEqual(Object.keys(payload).sort(), ["status", "type"]);
});

test("the strip advances sent -> accepted -> replied, emitting once per move", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "accepted"), true);
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "replied"), true);
  assert.deepEqual(strips(h), ["sent", "accepted", "replied"]);
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).requestStatus, "replied");
});

test("a decline is a terminal outcome too, reachable from sent or accepted", async () => {
  const direct = harness();
  await direct.openRequesterShell(openArgs());
  assert.equal(direct.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "declined"), true);
  assert.deepEqual(strips(direct), ["sent", "declined"]);

  const late = harness();
  await late.openRequesterShell(openArgs());
  late.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "accepted");
  assert.equal(late.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "declined"), true);
  assert.deepEqual(strips(late), ["sent", "accepted", "declined"]);
});

test("MONOTONIC: an out-of-order milestone never walks the strip backwards", async () => {
  // Messages are read a page at a time, so a task_started can be seen after the reply that
  // followed it. "Reply received" must not become "Request accepted" again.
  const h = harness();
  await h.openRequesterShell(openArgs());
  h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "replied");
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "accepted"), false);
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "sent"), false);
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "replied"), false, "and a repeat is not a move");
  assert.deepEqual(strips(h), ["sent", "replied"]);
});

test("ARMED, NOT AMBIENT: a session that never sent a request has no strip to move", async () => {
  // Every responder, every summoned team shell and every plain reopen reads undefined here.
  const h = harness();
  await h.recreateParkedShell({ channelId: CHANNEL, taskId: TASK, fromChannel: true });
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).requestStatus, undefined);
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "accepted"), false);
  assert.deepEqual(strips(h), [], "and nothing is painted into a window that has no line");
});

test("an unknown status, an unknown thread and a settled session all change nothing", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  for (const bad of ["", "SENT", "acknowledged", null, undefined, 3, {}, "constructor", "toString"]) {
    assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, bad), false, JSON.stringify(bad));
  }
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: "other" }, "accepted"), false);
  assert.equal(h.noteRequestStatus(null, "accepted"), false);
  h.sessions.get(`${CHANNEL}:${TASK}`).settled = true;
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "accepted"), false);
  assert.deepEqual(strips(h), ["sent"]);
});

test("moving the strip dispatches NOTHING — it can never wake the shell it sits on", async () => {
  const h = harness();
  await h.openRequesterShell(openArgs());
  h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "accepted");
  h.noteRequestStatus({ channelId: CHANNEL, taskId: TASK }, "replied");
  assert.deepEqual(h.calls.dispatch, [], "no reducer event, so no resumeQuery and no pushTurn");
  assert.deepEqual(h.calls.query, [], "and no query, however the strip moves");
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).state.parked, true, "still parked");
});

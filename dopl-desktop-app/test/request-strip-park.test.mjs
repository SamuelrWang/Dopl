// THE REQUEST LIFECYCLE STRIP — session-park.armRequestStatus + noteRequestStatus.
//
// WHAT IT IS. One line in the requester window's chrome saying what happened to the request the
// operator TYPED: Sent -> Accepted / Declined / Replied. It exists because those outcomes are
// invisible to the running agent — the peer's Accept and Decline arrive as `task_started` /
// `task_failed` MILESTONES and every listener route gates on `kind === 'message'`, so nothing
// feeds them to the session. Only the strip can say them.
//
// IT OUTLIVED THE SHELL IT SHIPPED ON (2026-08-05, rollback plan §3.4). The strip was armed by
// `session-park.openRequesterShell`, which opened a DORMANT window for the operator's typed
// request because that post carried no runtime stamp and could not be told from an external
// agent's create. `main/ui-bridge.js` stamps `desktop-ui` now, so that request opens a FULL
// requester session and the shell entry point is DELETED — with it, this file's old coverage of
// the shell spec, the window budget and the LRU eviction, all of which were properties of the
// shared parked-shell machinery and are pinned by session-park.test.mjs and
// main-audit-window-budget.test.mjs on their own terms.
//
// SO ARMING IS SLOT-KEYED NOW. Its one caller is the requester route (session-dispatch), which
// holds the (channel, thread) slot rather than the registry entry, and it must be idempotent:
// a message read twice must not walk an 'accepted' line back to 'sent'.
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
const DISPATCH = readFileSync(join(HERE, "..", "main", "session-dispatch.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-PARK-PURE block must not reference ${banned}`);
}

const CHANNEL = "cccccccc-1111-2222-3333-444444444444";
const TASK = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SLOT = { channelId: CHANNEL, taskId: TASK };

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
    `${BLOCK}\n return { bind, armRequestStatus, noteRequestStatus, recreateParkedShell };`
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
  // The requester session the route just launched, as the registry sees it. NOT a parked shell:
  // this window has a running agent, which is the whole point of §3.4.
  function live(key = `${CHANNEL}:${TASK}`) {
    const s = { key, settled: false, state: { parked: false, phase: "running" } };
    sessions.set(key, s);
    return s;
  }
  return { ...api, sessions, calls, cfg, store, live };
}

const strips = (h) => h.calls.emit.filter((e) => e.payload.type === "request_status").map((e) => e.payload.status);

// ── the shell entry point is gone ───────────────────────────────────────────────

test("session-park no longer opens a requester SHELL, and nothing asks it to", () => {
  assert.ok(!SRC.includes("async function openRequesterShell"), "the function is deleted");
  assert.ok(!ENGINE.includes("openRequesterShell:"), "the engine re-export is gone with it");
  assert.ok(!DISPATCH.includes("openRequesterShell"), "and no route calls it");
  // ...and the strip's ONE arming path is the requester route's `desktop-ui` arm.
  assert.match(DISPATCH, /if \(targeting\.requesterTypedByOperator\(m\)\) \{/);
  assert.match(DISPATCH, /sessionEngine\.armRequestStatus\(\{ channelId: entry\.channel\.id, taskId \}\);/);
});

test("the engine's parkedShell early return is untouched by the deletion", () => {
  // The requester shell was one of its dependants; the reopen / team / resume paths are the
  // others and they are unchanged, so the branch has to still be there.
  assert.match(ENGINE, /if \(spec\.parkedShell\) \{ sessionPark\.emitParkedShell\(s\); return s; \}/);
  const guard = ENGINE.indexOf("if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }");
  assert.ok(ENGINE.indexOf("await startQuery(s, sdk);", guard) > guard);
});

// ── arming ──────────────────────────────────────────────────────────────────────

test("arming opens the strip at 'sent' on the session in that slot", () => {
  const h = harness();
  h.live();
  assert.equal(h.armRequestStatus(SLOT), true);
  assert.deepEqual(strips(h), ["sent"]);
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).requestStatus, "sent");
  // THE WIRE CARRIES A FACT, NOT COPY: the renderer owns the words, so nothing here can put a
  // string of somebody else's choosing on the screen.
  const payload = h.calls.emit.find((e) => e.payload.type === "request_status").payload;
  assert.deepEqual(Object.keys(payload).sort(), ["status", "type"]);
});

test("arming is IDEMPOTENT: a message read twice never walks the line backwards", () => {
  const h = harness();
  h.live();
  h.armRequestStatus(SLOT);
  h.noteRequestStatus(SLOT, "accepted");
  assert.equal(h.armRequestStatus(SLOT), false, "already armed, and already past 'sent'");
  assert.deepEqual(strips(h), ["sent", "accepted"]);
});

test("arming fails closed on a slot with no live session", () => {
  const h = harness();
  assert.equal(h.armRequestStatus(SLOT), false, "no window, nothing to put a line on");
  assert.equal(h.armRequestStatus(null), false);
  const settled = harness();
  settled.live().settled = true;
  assert.equal(settled.armRequestStatus(SLOT), false);
  assert.deepEqual(strips(h), []);
});

test("arming starts NOTHING — it is a display payload, not a reducer event", () => {
  const h = harness();
  h.live();
  h.armRequestStatus(SLOT);
  assert.deepEqual(h.calls.dispatch, [], "no reducer event");
  assert.deepEqual(h.calls.query, [], "and no query");
  assert.deepEqual(h.calls.startSession, [], "arming does not open a window of its own");
});

// ── advancing ───────────────────────────────────────────────────────────────────

test("the strip advances sent -> accepted -> replied, emitting once per move", () => {
  const h = harness();
  h.live();
  h.armRequestStatus(SLOT);
  assert.equal(h.noteRequestStatus(SLOT, "accepted"), true);
  assert.equal(h.noteRequestStatus(SLOT, "replied"), true);
  assert.deepEqual(strips(h), ["sent", "accepted", "replied"]);
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).requestStatus, "replied");
});

test("a decline is a terminal outcome too, reachable from sent or accepted", () => {
  const direct = harness();
  direct.live();
  direct.armRequestStatus(SLOT);
  assert.equal(direct.noteRequestStatus(SLOT, "declined"), true);
  assert.deepEqual(strips(direct), ["sent", "declined"]);

  const late = harness();
  late.live();
  late.armRequestStatus(SLOT);
  late.noteRequestStatus(SLOT, "accepted");
  assert.equal(late.noteRequestStatus(SLOT, "declined"), true);
  assert.deepEqual(strips(late), ["sent", "accepted", "declined"]);
});

test("MONOTONIC: an out-of-order milestone never walks the strip backwards", () => {
  // Messages are read a page at a time, so a task_started can be seen after the reply that
  // followed it. "Reply received" must not become "Request accepted" again.
  const h = harness();
  h.live();
  h.armRequestStatus(SLOT);
  h.noteRequestStatus(SLOT, "replied");
  assert.equal(h.noteRequestStatus(SLOT, "accepted"), false);
  assert.equal(h.noteRequestStatus(SLOT, "sent"), false);
  assert.equal(h.noteRequestStatus(SLOT, "replied"), false, "and a repeat is not a move");
  assert.deepEqual(strips(h), ["sent", "replied"]);
});

test("ARMED, NOT AMBIENT: a session that never sent a request has no strip to move", async () => {
  // Every responder, every summoned team shell, every plain reopen — and, since §3.4, every
  // requester session a SPAWNED session's create opened — reads undefined here.
  const h = harness();
  await h.recreateParkedShell({ channelId: CHANNEL, taskId: TASK, fromChannel: true });
  assert.equal(h.sessions.get(`${CHANNEL}:${TASK}`).requestStatus, undefined);
  assert.equal(h.noteRequestStatus(SLOT, "accepted"), false);
  assert.deepEqual(strips(h), [], "and nothing is painted into a window that has no line");
});

test("an unknown status, an unknown thread and a settled session all change nothing", () => {
  const h = harness();
  h.live();
  h.armRequestStatus(SLOT);
  for (const bad of ["", "SENT", "acknowledged", null, undefined, 3, {}, "constructor", "toString"]) {
    assert.equal(h.noteRequestStatus(SLOT, bad), false, JSON.stringify(bad));
  }
  assert.equal(h.noteRequestStatus({ channelId: CHANNEL, taskId: "other" }, "accepted"), false);
  assert.equal(h.noteRequestStatus(null, "accepted"), false);
  h.sessions.get(`${CHANNEL}:${TASK}`).settled = true;
  assert.equal(h.noteRequestStatus(SLOT, "accepted"), false);
  assert.deepEqual(strips(h), ["sent"]);
});

test("moving the strip dispatches NOTHING — it can never wake the session it sits on", () => {
  const h = harness();
  h.live();
  h.armRequestStatus(SLOT);
  h.noteRequestStatus(SLOT, "accepted");
  h.noteRequestStatus(SLOT, "replied");
  assert.deepEqual(h.calls.dispatch, [], "no reducer event, so no resumeQuery and no pushTurn");
  assert.deepEqual(h.calls.query, [], "and no query, however the strip moves");
});

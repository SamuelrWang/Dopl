// ENDED IS DEAD: NO REVIVAL, ON ANY PATH (2026-08-22, Samuel's ruling).
//
// ⚠ THE PROPERTY IS ALREADY TRUE AND IT IS TRUE BY CONSTRUCTION, WHICH IS EXACTLY WHY IT NEEDS
// PINNING. `session-engine.js › settle` does `sessions.delete(s.key)`, and EVERY wake path in
// the tree resolves against that one registry — so an ended agent is unreachable not because
// five call sites each check for it, but because there is nothing left to find. That is the
// strongest shape available and the most fragile to a well-meaning edit: the day somebody
// "helpfully" keeps an ended session in the Map so its card can render, all five paths quietly
// come back to life at once. The retained CARD is a durable record in `agent-history.js`,
// deliberately NOT a registry entry, for this reason.
//
// THE FIVE PATHS, each driven here against the real shipped code:
//   1. the fan-out feed          `session-dispatch.js › feedLiveSession`
//   2. the @agent-id parse       `session-dispatch.js › mentionedAgentIds`
//   3. the 1:1 lane              `session-reopen.js › messageByTask`
//   4. reopen / pause / end      `session-reopen.js › reopenByTask` / `controlByTask`
//   5. a spawn-idle wake         `session-gate.js › feedInbound`
//
// ⚠ AND ONE BELT BEHIND THEM: the reducer's own first line refuses every event on a settled
// state (`if (state.phase === 'ended') return { state, effects: [] }`), so even a caller that
// somehow held a stale session OBJECT dispatches nothing into it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TASK = "11111111-2222-3333-4444-555555555555";
const AGENT = "a1b2c3d4";
const KEY = `${CH}:${TASK}:${AGENT}`;
const ME = "me-user";

const store = {
  sessionKey: (c, t, a) => `${c}:${t}:${a || ""}`,
  slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
  threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:`,
};

/** A session object as the registry holds one. `settled: true` is the state `settle` leaves
 *  behind for anything still holding a reference to it. */
const sess = (over = {}) => ({
  key: KEY, agentId: AGENT, channelId: CH, taskId: TASK,
  settled: false, state: {}, context: {}, nonce: "n0nce",
  ownPostIds: new Set(), pendingInbound: [],
  ...over,
});

// ── the registry reads every wake path resolves through ──────────────────────

function registry(sessions) {
  return new Function(
    "deps", "store",
    `${fnOf(read("session-registry.js"), "liveOnThread")}\n` +
      `${fnOf(read("session-registry.js"), "sessionOn")}\n` +
      ` return { liveOnThread, sessionOn };`
  )({ sessions }, store);
}

test("REGISTRY: a settled session is invisible to BOTH addressing reads", () => {
  // The `settled` flag is the belt; `settle` also deletes the key, which is the braces.
  const stale = new Map([[KEY, sess({ settled: true })]]);
  const r = registry(stale);
  assert.deepEqual(r.liveOnThread({ channelId: CH, taskId: TASK }), [], "not on the thread");
  assert.equal(r.sessionOn({ channelId: CH, taskId: TASK }), null, "unnamed resolves nothing");
  assert.equal(r.sessionOn({ channelId: CH, taskId: TASK, agentId: AGENT }), null, "…named too");
  // …and after `settle`'s delete there is not even a stale object.
  const gone = registry(new Map());
  assert.deepEqual(gone.liveOnThread({ channelId: CH, taskId: TASK }), []);
  assert.equal(gone.sessionOn({ channelId: CH, taskId: TASK, agentId: AGENT }), null);
});

// ── 1 + 2. the fan-out feed, and the @-mention that cannot revive one ────────

function dispatch(agents) {
  const SRC = read("session-dispatch.js");
  const BLOCK = SRC.slice(
    SRC.indexOf("// ─── BEGIN SESSION-DISPATCH-PURE"),
    SRC.indexOf("// ─── END SESSION-DISPATCH-PURE")
  );
  const fed = [];
  const engine = {
    liveOnThread: () => agents,
    feedInbound: (a) => { fed.push(a); return true; },
  };
  const api = new Function(
    "targeting", "sessionEngine", "io", "diag",
    `${BLOCK}\n return { feedLiveSession, mentionedAgentIds };`
  )(
    { firstClassTaskId: (m) => m.taskId || "" },
    engine,
    { displayNameFor: (id) => `name:${id}` },
    () => {}
  );
  return { ...api, fed };
}

const entry = { channel: { id: CH, name: "General" }, workspaceId: "w1" };
const msg = (over = {}) => ({
  kind: "message", authorUserId: "peer", body: "carry on", taskId: TASK, seq: 7, ...over,
});

test("FEED: an ENDED agent is not fed and not queued — the message simply passes it by", () => {
  // The engine's read hands back only LIVE sessions, so an ended agent is not in the loop at
  // all. Nothing is dropped on the floor either: a live sibling still takes the turn.
  const only = dispatch([]); // the thread's one agent ended
  assert.equal(only.feedLiveSession(entry, msg(), ME), false, "nothing took it");
  assert.deepEqual(only.fed, [], "…and nothing was queued for later");

  const withSibling = dispatch([{ agentId: "z9y8x7w6", ownPostIds: new Set() }]);
  assert.equal(withSibling.feedLiveSession(entry, msg(), ME), true);
  assert.deepEqual(withSibling.fed.map((f) => f.agentId), ["z9y8x7w6"], "the LIVE one, only");
});

test("@-MENTION: naming an ended agent's id addresses nobody and wakes nothing", () => {
  // ⚠ THE PARSE IS INTERSECTED WITH THE LIVE ROSTER, which is what makes this true rather than
  // a check somebody remembered to write. A dead id is not in the roster, so it resolves to
  // nothing — and the sibling that DOES receive the message is told nobody was addressed, not
  // that it should stand down for an agent that no longer exists.
  const h = dispatch([{ agentId: "z9y8x7w6", ownPostIds: new Set() }]);
  assert.deepEqual(h.mentionedAgentIds(`@${AGENT} please continue`, ["z9y8x7w6"]), []);
  h.feedLiveSession(entry, msg({ body: `@${AGENT} please continue` }), ME);
  assert.equal(h.fed.length, 1);
  assert.equal(h.fed[0].addressing, null, "no live agent was addressed");
});

// ── 3 + 4. the 1:1 lane, reopen, pause and end ───────────────────────────────

function reopen(sessions) {
  const SRC = read("session-reopen.js");
  const BLOCK = SRC.slice(
    SRC.indexOf("// ─── BEGIN SESSION-REOPEN-PURE"),
    SRC.indexOf("// ─── END SESSION-REOPEN-PURE")
  );
  const dispatched = [];
  const api = new Function(
    "store", "framing", "floorWindowlessMessage", "privateTurn",
    `${BLOCK}\n return { bind, reopenByTask, controlByTask, setModeByTask, messageByTask };`
  )(
    store,
    require(join(MAIN, "session-seed.js")),
    (m) => m,
    // The REAL private-turn window (2026-08-22): `messageByTask` opens it before dispatching.
    require(join(MAIN, "session-private.js"))
  );
  api.bind({
    sessions,
    refreshTray: () => {},
    dispatch: (s, e) => dispatched.push([s, e]),
    openAgentWindow: () => ({ ok: true }),
  });
  return { ...api, dispatched };
}

test("OPS: every op naming an ENDED agent answers `no-session`, and dispatches nothing", () => {
  // ⚠ INCLUDING WHEN THE CALLER NAMES THE AGENT EXACTLY. The ambiguity fallback (an unnamed op
  // takes the oldest LIVE agent) must not become a revival path either — there is no live one.
  for (const sessions of [new Map(), new Map([[KEY, sess({ settled: true })]])]) {
    const r = reopen(sessions);
    const addr = { channelId: CH, taskId: TASK, agentId: AGENT };
    assert.deepEqual(r.messageByTask({ ...addr, text: "are you there" }), { ok: false, reason: "no-session" });
    assert.deepEqual(r.reopenByTask({ ...addr, segment: "acme" }), { ok: false, reason: "no-session" });
    assert.deepEqual(r.controlByTask({ ...addr, action: "pause" }), { ok: false, reason: "no-session" });
    assert.deepEqual(r.controlByTask({ ...addr, action: "end" }), { ok: false, reason: "no-session" });
    assert.deepEqual(r.setModeByTask({ ...addr, axis: "tools", mode: "bypass" }), { ok: false, reason: "no-session" });
    assert.deepEqual(r.dispatched, [], "nothing reached a reducer");
    // …and the same ops with NO agent named resolve nothing rather than the dead one.
    const pair = { channelId: CH, taskId: TASK };
    assert.deepEqual(r.messageByTask({ ...pair, text: "hello" }), { ok: false, reason: "no-session" });
  }
});

test("OPS: a 1:1 send IN FLIGHT when the agent ends REFUSES rather than throwing", () => {
  // The edge case: the operator hit send, the agent settled between the click and main
  // resolving it. `messageByTask` re-resolves against the registry at call time — it holds no
  // captured session — so the answer is an honest refusal the composer can word.
  const sessions = new Map([[KEY, sess()]]);
  const r = reopen(sessions);
  const addr = { channelId: CH, taskId: TASK, agentId: AGENT, text: "one more thing" };
  assert.deepEqual(r.messageByTask(addr), { ok: true }, "…it lands while the agent is live");
  sessions.get(KEY).settled = true; // it ends mid-flight
  assert.doesNotThrow(() => r.messageByTask(addr));
  assert.deepEqual(r.messageByTask(addr), { ok: false, reason: "no-session" });
  assert.equal(r.dispatched.length, 1, "exactly the one turn that was live when it was sent");
});

// ── 5. the inbound gate, and the reducer belt behind everything ──────────────

test("GATE: `feedInbound` refuses a settled session — nothing is enqueued for a resume", () => {
  const SRC = read("session-gate.js");
  const BLOCK = SRC.slice(
    SRC.indexOf("// ─── BEGIN SESSION-GATE-PURE"),
    SRC.indexOf("// ─── END SESSION-GATE-PURE")
  );
  const built = new Function(
    "crypto", "io", "store", "diag",
    `${BLOCK}\n return { bind, feedInbound };`
  )(require("node:crypto"), require(join(MAIN, "session-io.js")), store, () => {});
  const ended = sess({ settled: true });
  built.bind({ sessions: new Map([[KEY, ended]]), dispatch: () => { throw new Error("dispatched into a dead session"); } });
  assert.equal(
    built.feedInbound({ channelId: CH, taskId: TASK, agentId: AGENT, message: "hi", seq: 8 }),
    false
  );
  assert.deepEqual(ended.pendingInbound, [], "not queued either — a dead agent has no later");
});

test("REDUCER: a settled state refuses EVERY event, which is the belt behind all five", () => {
  const { sessionReducer } = require(join(MAIN, "session-reducer.js"));
  const ended = { phase: "ended", activity: "idle", parked: false, pendingPermissions: [] };
  for (const type of [
    "inbound_arrived", "inbound_accept", "steer", "launched", "result",
    "idle_timeout", "abandon_timeout", "interrupt", "end", "crash", "auth_release",
  ]) {
    const out = sessionReducer(ended, { type, message: "x", text: "x" });
    assert.equal(out.state, ended, `${type} must not move a settled state`);
    assert.deepEqual(out.effects, [], `${type} must produce no effect`);
  }
});

// ── the structural guard: the card is a RECORD, never a registry entry ───────

// ── …AND WHAT AN ENDED AGENT'S WINDOW IS STILL ALLOWED TO SHOW (2026-08-22) ──
//
// ⚠ DEAD IS NOT BLANK, AND FOR ONE WAVE IT WAS. `settle` freezes the narration ring into
// `agent-history.js` precisely so the window keeps working for seven days — and
// `session-engine.js › narrationFor` resolved ONLY through `sessionOn`, the live-registry read
// the test above proves answers `null` for an ended agent. So the ended card opened onto nothing
// while `agent-history.js › historyFor`, written for exactly this read, had ZERO callers in the
// tree. The fallback is the READ side of the same ruling this file's other cases enforce: an
// ended agent cannot be woken, fed or messaged, and it can still be READ.

function narration(sessions, history) {
  const ENGINE = read("session-engine.js");
  const registryApi = registry(sessions);
  return new Function(
    "sessionOn", "sessionNarration", "agentHistory", "store",
    `${fnOf(ENGINE, "narrationFor")}\n return narrationFor;`
  )(
    registryApi.sessionOn,
    require(join(MAIN, "session-narration.js")),
    { historyFor: (key) => history.get(key) || null },
    store
  );
}

const FROZEN = [{ at: 1, kind: "assistant", text: "read the invoice" }, { at: 2, kind: "post", text: "sent" }];

test("NARRATION: an ENDED agent's window reads the FROZEN ring, not an empty one", () => {
  // The key is the one `settle` wrote — `store.slotKey`, all three parts.
  const nf = narration(new Map(), new Map([[KEY, { key: KEY, entries: FROZEN }]]));
  assert.deepEqual(nf({ channelId: CH, taskId: TASK, agentId: AGENT }), FROZEN);
  // A COPY: the caller must not be handed the durable record's own array to mutate.
  const out = nf({ channelId: CH, taskId: TASK, agentId: AGENT });
  out.push({ kind: "junk" });
  assert.equal(nf({ channelId: CH, taskId: TASK, agentId: AGENT }).length, FROZEN.length);
});

test("NARRATION: a LIVE agent still answers from the registry, never from the history", () => {
  const live = sess({ narration: [{ at: 9, kind: "assistant", text: "still working" }] });
  const nf = narration(new Map([[KEY, live]]), new Map([[KEY, { key: KEY, entries: FROZEN }]]));
  assert.deepEqual(nf({ channelId: CH, taskId: TASK, agentId: AGENT }), live.narration);
});

test("NARRATION: an address naming NO agent gets the live answer alone", () => {
  // `<channel>:<thread>:` matches no frozen record by construction (every history key carries an
  // agent id), so the ambiguity fallback cannot resolve a DEAD agent it was never handed.
  const nf = narration(new Map(), new Map([[KEY, { key: KEY, entries: FROZEN }]]));
  assert.deepEqual(nf({ channelId: CH, taskId: TASK }), []);
});

test("NARRATION: no history and no session is `[]`, never a throw", () => {
  const nf = narration(new Map(), new Map());
  assert.deepEqual(nf({ channelId: CH, taskId: TASK, agentId: AGENT }), []);
  assert.deepEqual(nf({}), []);
  // A record whose `entries` did not survive the disk is UNKNOWN, and unknown renders empty
  // rather than throwing inside the bridge.
  const bad = narration(new Map(), new Map([[KEY, { key: KEY, entries: null }]]));
  assert.deepEqual(bad({ channelId: CH, taskId: TASK, agentId: AGENT }), []);
});

test("STRUCTURE: `settle` deletes the registry entry, and freezes the history BEFORE it", () => {
  // ⚠ ORDER IS THE WHOLE THING. The narration ring lives on the session object; freezing it
  // after the delete would capture nothing, and keeping the object to avoid that would be the
  // revival path this file exists to prevent.
  const ENGINE = read("session-engine.js");
  const settle = fnOf(ENGINE, "settle");
  const froze = settle.indexOf("agentHistory.record(");
  const deleted = settle.indexOf("sessions.delete(s.key)");
  assert.ok(froze !== -1, "settle freezes the history");
  assert.ok(deleted !== -1, "settle drops the registry entry");
  assert.ok(froze < deleted, "the ring is captured while the object still exists");
  // The retained card must never be a session: nothing may put an ended key back in the Map.
  assert.ok(!/sessions\.set\([^)]*ended/i.test(ENGINE), "no path re-registers an ended session");
});

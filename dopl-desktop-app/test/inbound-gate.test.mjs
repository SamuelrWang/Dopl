// The INBOUND FEED transitions in the pure session reducer (main/session-reducer.js). SAME
// source-extraction idiom as session-reducer(-park): slice the BEGIN/END sentinel block and evaluate
// it verbatim, so these can never drift from what ships.
//
// The contract since inbound consent was retired (2026-08-22) and its hold deleted (2026-09-25,
// Samuel's ruling 5): a counterparty message is FED on arrival, in every posture, waking a parked
// session first. Nothing holds it, nothing accepts or declines it; a session held on its sign-in is
// never woken by one. The axes still survive a park and never reach disk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer, REDUCER_SRC } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { initialSessionState, sessionReducer } = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const effTypes = (effects) => effects.map((e) => e.type);
const arrive = { type: "inbound_arrived", message: "can you ship it?", authorName: "David" };

test("FEED: every posture feeds an arriving message as the next turn — nothing holds it", () => {
  const postures = [
    {}, { messageMode: "ask" }, { messageMode: "auto_inbound" }, { messageMode: "auto_outbound" },
    { messageMode: "auto_both" }, { toolMode: "bypass" },
  ];
  for (const p of postures) {
    const r = sessionReducer({ ...running(), ...p }, arrive);
    assert.deepEqual(effTypes(r.effects), ["pushInbound", "scheduleIdle"], JSON.stringify(p));
    assert.equal(r.effects[0].message, "can you ship it?");
    assert.equal(r.state.phase, "running");
    assert.equal(r.state.activity, "working");
  }
});

test("PARKED: an arriving message wakes the session first (resumeQuery), then feeds it", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, arrive);
  assert.deepEqual(effTypes(r.effects), ["resumeQuery", "pushInbound", "scheduleIdle"]);
  assert.equal(r.state.parked, false);
});

test("AUTH HOLD: an arriving message neither wakes nor claims a held session (the belt)", () => {
  const held = sessionReducer(running(), { type: "auth_hold" }).state;
  const r = sessionReducer(held, arrive);
  assert.equal(r.state, held, "same object: untouched");
  assert.deepEqual(r.effects, []);
});

test("the hold is gone: no accept / decline arm, no pending flag, no standing grant", () => {
  for (const word of ["inbound_accept", "inbound_decline", "inbound_released", "hasPendingInbound", "inboundForTask", "awaiting_inbound"]) {
    assert.ok(!REDUCER_SRC.includes(word), `${word} is not in the reducer`);
  }
  const st = initialSessionState({});
  assert.equal("inboundForTask" in st, false);
  assert.equal("hasPendingInbound" in st, false);
  // An old caller's accept is an unknown event: a no-op, never a feed.
  const s = running();
  assert.deepEqual(sessionReducer(s, { type: "inbound_accept", message: "x" }), { state: s, effects: [] });
});

// M2 (2026-08-05): a posture the operator set holds for the session across a park; the away threat is
// bought by the ABANDONMENT END instead (session-state.ABANDONED_MS).
test("M2: a park keeps BOTH axes", () => {
  const parked = sessionReducer({ ...running(), toolMode: "bypass", messageMode: "auto_both" }, { type: "idle_timeout" }).state;
  assert.equal(parked.toolMode, "bypass", "AXIS A is the operator's for the session");
  assert.equal(parked.messageMode, "auto_both", "and so is AXIS B");
});

test("FIX #10 (v2.9): an axis change on a PARKED session does not claim it is running", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "set_message_mode", mode: "auto_both" });
  assert.equal(r.state.messageMode, "auto_both", "the value still lands");
  assert.equal(r.state.phase, "parked", "a query-less session is not running");
  assert.equal(r.state.activity, "parked");
  assert.deepEqual(r.effects, [], "and nothing is resumed by a select");
  const live = sessionReducer(running(), { type: "set_tool_mode", mode: "auto" });
  assert.equal(live.state.phase, "running", "an axis change is not a lifecycle event");
});

test("v2.9: an axis change NEVER drains the pending permission dock (THE INVARIANT)", () => {
  // pendingPermissions holds requestIds only, so a blanket drain would let the TOOL axis answer a
  // queued message op. Anything already waiting keeps its buttons.
  const live = { ...running(), pendingPermissions: ["r1"] };
  for (const ev of [{ type: "set_tool_mode", mode: "bypass" }, { type: "set_message_mode", mode: "auto_both" }]) {
    const r = sessionReducer(live, ev);
    assert.deepEqual(r.state.pendingPermissions, ["r1"], "the queued request is untouched");
    assert.ok(!r.effects.some((e) => e.type === "resolvePermission"), "and nothing is auto-answered");
  }
});

test("FIX #17: re-parking is idempotent (the guard reads `parked`, not `phase`)", () => {
  const r = sessionReducer(running(), { type: "idle_timeout" });
  assert.equal(r.state.phase, "parked");
  const again = sessionReducer(r.state, { type: "idle_timeout" });
  assert.equal(again.state, r.state, "same object: a no-op");
  assert.deepEqual(again.effects, []);
});

test("no posture is ever persisted: the durable record carries neither axis nor the tool grants", () => {
  const io = require(join(HERE, "..", "main", "session-io.js"));
  const rec = io.baseRecord({
    key: "c1:t1", sessionId: "s1", channelId: "c1", taskId: "t1", workspaceId: "w1",
    side: "responder", profile: "full", mode: "interactive", startedAt: 1,
    state: { ...running(), toolMode: "bypass", messageMode: "auto_both", turns: 2, costUsd: 0.1 },
  });
  assert.equal(rec.toolMode, undefined, "AXIS A is memory-only, never persisted");
  assert.equal(rec.messageMode, undefined, "and so is AXIS B");
  assert.equal(rec.allowForTask, undefined, "so is the tool grant set");
});

// FIX F3 — the OUTBOUND-POST correction in the pure session reducer
// (main/session-reducer.js). Split out of session-reducer.test.mjs to keep BOTH files
// under the §2 500-line cap. SAME source-extraction idiom: slice the reducer's BEGIN/END
// sentinel block and evaluate it verbatim, so these can never drift from what ships.
//
// THE BUG: session-io emits `outbound_post` (and the reducer sets postedThisTurn) while
// the assistant's tool_use STREAMS — before canUseTool resolves. So a post the operator
// DENIED still rendered "Sent to peer" and the turn still ended `awaiting_peer`
// ("Waiting for reply") on a message that never left this machine. The failing
// tool_result the SDK feeds back after a deny is the correction, and this is where it
// lands: the post is un-counted by tool_use id, so postedThisTurn only stays true when
// something actually went out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer, REDUCER_SRC } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// §2 SPLIT (H1): the pure block now spans session-effects.js + session-reducer.js;
// test/_reducer-block.mjs slices BOTH sentinel pairs and evaluates them as one program.
const { initialSessionState, sessionReducer, nextIdleMs, turnCapReached, costCapReached,
        DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD } = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const effTypes = (effects) => effects.map((e) => e.type);

const postEv = (id) => ({ type: "outbound_post", payload: { type: "outbound_post", toolUseId: id, to: "Bob", text: "draft" } });
const resultEv = (id, ok) => ({ type: "tool_result", payload: { type: "tool_result", toolUseId: id, ok } });

test("a fresh state has no streamed posts recorded", () => {
  assert.deepEqual(initialSessionState().postedToolUseIds, []);
  assert.equal(initialSessionState().postedThisTurn, false);
});

test("FIX F3: a FAILING tool_result for a streamed post clears postedThisTurn", () => {
  const posted = sessionReducer(running(), postEv("t1")).state;
  assert.equal(posted.postedThisTurn, true);
  assert.deepEqual(posted.postedToolUseIds, ["t1"]);
  const r = sessionReducer(posted, resultEv("t1", false));
  assert.equal(r.state.postedThisTurn, false, "nothing left this machine");
  assert.deepEqual(r.state.postedToolUseIds, []);
  assert.deepEqual(effTypes(r.effects), ["emit"], "the renderer still gets the result (it flips the bubble)");
  // And the turn therefore ends IDLE, never "Waiting for reply".
  const end = sessionReducer(r.state, { type: "result", turnCostUsd: 0 });
  assert.equal(end.state.activity, "idle");
  assert.notEqual(end.state.activity, "awaiting_peer");
});

test("FIX F3: a SUCCESSFUL post still ends the turn awaiting_peer", () => {
  const posted = sessionReducer(running(), postEv("t1")).state;
  const ok = sessionReducer(posted, resultEv("t1", true));
  assert.equal(ok.state, posted, "a successful result changes nothing");
  const end = sessionReducer(ok.state, { type: "result", turnCostUsd: 0 });
  assert.equal(end.state.activity, "awaiting_peer");
  assert.deepEqual(end.state.postedToolUseIds, [], "the per-turn set resets at turn end");
});

test("FIX F3: with TWO posts this turn, denying one keeps the other counted", () => {
  let s = sessionReducer(running(), postEv("t1")).state;
  s = sessionReducer(s, postEv("t2")).state;
  assert.deepEqual(s.postedToolUseIds, ["t1", "t2"]);
  const r = sessionReducer(s, resultEv("t1", false));
  assert.equal(r.state.postedThisTurn, true, "t2 did go out");
  assert.deepEqual(r.state.postedToolUseIds, ["t2"]);
  assert.equal(sessionReducer(r.state, { type: "result", turnCostUsd: 0 }).state.activity, "awaiting_peer");
});

test("FIX F3: a failing tool_result for an ORDINARY tool changes no state", () => {
  const posted = sessionReducer(running(), postEv("t1")).state;
  const r = sessionReducer(posted, resultEv("bash-9", false));
  assert.equal(r.state, posted, "only a post's own id un-counts a post");
  assert.equal(r.state.postedThisTurn, true);
});

test("FIX F3: a post with NO tool_use id is still counted, and no id can un-count it", () => {
  const posted = sessionReducer(running(), { type: "outbound_post", payload: { type: "outbound_post", to: "Bob" } }).state;
  assert.equal(posted.postedThisTurn, true);
  assert.deepEqual(posted.postedToolUseIds, []);
  const r = sessionReducer(posted, resultEv(undefined, false));
  assert.equal(r.state, posted, "a result with no id patches nothing");
});

test("a PARKED session stays inert to a late tool_result (v2.3 FIX #5 preserved)", () => {
  const parked = { ...running(), parked: true, postedThisTurn: true, postedToolUseIds: ["t1"] };
  const r = sessionReducer(parked, resultEv("t1", false));
  assert.equal(r.state, parked, "no state change on a parked session");
  assert.deepEqual(r.effects, [], "and nothing is emitted to a query-less window");
});

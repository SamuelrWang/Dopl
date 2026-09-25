// "USE MY TOOLS" (Samuel, 2026-09-25): the launch scope, the per-turn state, the gate's step 1.6, and
// the peer window a production-shaped fan-out opens. The two electron-bound reads `operator-tools.js`
// makes lazily (the listener's roster, the toggle's store) are faked through the module cache.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { harness, peerMsg, entry, agent, ME, A1 } from "./_wake-dispatch-harness.mjs";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);

const room = { memberCount: 1, toggle: false };
const fake = (file, exports) => {
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
};
fake(M("channel-listener.js"), { watchedChannel: (id) => (id ? { id, memberCount: room.memberCount } : null) });
fake(M("channel-prefs.js"), { getUseMyTools: () => room.toggle });

const ops = require(M("operator-tools.js"));
const { grantDecisionDetail, grantKeyFor } = require(M("session-profiles.js"));
const priv = require(M("session-private.js"));
const { denyMessageFor } = require(M("session-permissions.js"));

const CHROME = "mcp__claude-in-chrome__navigate";
const set = (memberCount, toggle) => { room.memberCount = memberCount; room.toggle = toggle; };
const gate = (over) => grantDecisionDetail({ profile: "full", channelId: "c1", toolMode: "bypass", toolName: CHROME, ...over });

test("an operator tool is any non-Dopl MCP tool or a native built-in; Dopl, agent-ops and classified built-ins are not", () => {
  for (const name of [CHROME, "mcp__claude_ai_Slack__send_message", "mcp__supabase__execute_sql", "Agent", "Skill"]) {
    assert.equal(ops.isOperatorTool(name), true, name);
  }
  for (const name of ["mcp__dopl__dopl_channel", "mcp__dopl_agents__rename_agent", "Bash", "Read", "", null]) {
    assert.equal(ops.isOperatorTool(name), false, String(name));
  }
});

test("launch scope: private always, shared only with the toggle, an unknown roster is shared", () => {
  set(1, false);
  assert.equal(ops.launchScope("c1", "full"), "private");
  assert.equal(ops.launchScope("c1", "read_only"), "", "a restricted Tool access stays whole");
  assert.equal(ops.launchScope("c1", "dopl_only"), "");
  set(2, false);
  assert.equal(ops.launchScope("c1", "channel_agent"), "");
  set(2, true);
  assert.equal(ops.launchScope("c1", "channel_agent"), "shared");
  set(undefined, false);
  assert.equal(ops.launchScope("c1", "full"), "", "no memberCount is not solo");
  assert.equal(ops.launchScope("", "full"), "");
});

test("turn state is read live: a peer joining drops the tools, the toggle and the turn's origin decide", () => {
  const s = { operatorTools: "private", channelId: "c1", state: { activity: "idle" } };
  set(1, false);
  assert.equal(ops.turnState(s), "on");
  set(2, false);
  assert.equal(ops.turnState(s), "off", "launched private, now shared, toggle off");
  set(2, true);
  assert.equal(ops.turnState(s), "on", "the operator's own turn");
  priv.openPeerTurn(s, false, "peer words");
  assert.equal(ops.turnState(s), "off", "a turn another member started");
  priv.closePeerTurn(s);
  assert.equal(ops.turnState(s), "on", "its result closes the window");
  set(1, false);
  priv.openPeerTurn(s, false);
  assert.equal(ops.turnState(s), "on", "a private channel has no peers to guard against");
  priv.resetPeerTurn(s);
  assert.equal(ops.turnState({ operatorTools: "", channelId: "c1" }), "", "a session that loaded none");
});

test("gate step 1.6: Full runs it, below Full asks, an off turn denies ahead of any grant", () => {
  assert.equal(gate({ operatorTools: "on" }).decision, "allow");
  assert.equal(gate({ operatorTools: "on", runtime: "codex", toolMode: "never" }).decision, "allow");
  const asked = gate({ operatorTools: "on", toolMode: "auto" });
  assert.equal(asked.decision, "gate");
  assert.notEqual(asked.reason, "unclassified-tool");
  assert.equal(gate({ operatorTools: "on", toolName: "Agent", toolMode: "manual" }).decision, "gate");
  const grant = grantKeyFor(CHROME, {}, "c1");
  const off = gate({ operatorTools: "off", allowForTask: [grant] });
  assert.deepEqual(off, { decision: "deny", reason: "operator-tools-off" });
  assert.match(denyMessageFor(off.reason), /operator's own tools are off for this turn/);
  // Dopl's own surface and the classified built-ins are untouched by an off turn.
  assert.notEqual(gate({ operatorTools: "off", toolName: "mcp__dopl__dopl_search" }).decision, "deny");
  assert.equal(gate({ operatorTools: "off", toolName: "Edit" }).decision, "allow");
  // A session that loaded none keeps the ordinary ask for an unclassified name.
  assert.deepEqual(gate({ operatorTools: "" }), { decision: "gate", reason: "unclassified-tool" });
});

test("fan-out: only the operator's own HUMAN post is operator-originated", async () => {
  const cases = [
    [peerMsg(), false],
    [peerMsg({ authorUserId: ME, authorKind: "user" }), true],
    [peerMsg({ authorUserId: ME, authorKind: "agent" }), false],
    [peerMsg({ authorUserId: ME }), false], // a row with no author kind proves nothing
  ];
  for (const [m, want] of cases) {
    const h = harness({ agents: [agent(A1)] });
    assert.equal(await h.feedLiveSession(entry, m, ME), true);
    assert.equal(h.calls.feedInbound[0].fromOperator, want, JSON.stringify(m));
  }
});

// The engine's funnel, sliced verbatim with the real reducer and the real windows.
const ENGINE = readFileSync(M("session-engine.js"), "utf8");
const RED = loadReducer();
const funnel = new Function(
  "sessionReducer", "sessionSummary", "sessionNarration", "sessionDirected", "sessionPrivate", "runEffect",
  `${ENGINE.slice(ENGINE.indexOf("function dispatch(s, event) {"), ENGINE.indexOf("function runEffect(s, eff) {"))}
   return dispatch;`
)(RED.sessionReducer, { noteActivity() {} }, { note() {} }, { observe() {} }, priv, () => undefined);

function running() {
  const s = { state: RED.initialSessionState({ messageMode: "auto_inbound" }) };
  s.state = RED.sessionReducer(s.state, { type: "launched", payload: { type: "init" } }).state;
  return s;
}

test("fan-out → gate → reducer: the operator's own post keeps BOTH its reply address and its origin", async () => {
  const h = harness({ agents: [agent(A1)] });
  await h.feedLiveSession(entry, peerMsg({ authorUserId: ME, authorKind: "user" }), ME);
  const fed = h.calls.feedInbound[0];
  assert.deepEqual([fed.replyTo, fed.fromOperator], [ME, true]);
  assert.match(readFileSync(M("session-gate.js"), "utf8"), /replyTo: item\.replyTo, fromOperator: a\.fromOperator === true/);
  const push = RED.sessionReducer(running().state, { type: "inbound_arrived", ...fed }).effects.find((e) => e.type === "pushInbound");
  assert.deepEqual([push.replyTo, push.fromOperator], [ME, true]);
});

test("engine: a peer's fed message opens the window for its turn; the operator's does not", () => {
  const s = running();
  funnel(s, { type: "inbound_arrived", message: "mine", authorName: "Me", fromOperator: true });
  assert.equal(priv.isPeerTurn(s), false);
  funnel(s, { type: "result", payload: {} });
  funnel(s, { type: "inbound_arrived", message: "theirs", authorName: "Peer" });
  assert.equal(priv.isPeerTurn(s), true);
  funnel(s, { type: "result", payload: {} });
  assert.equal(priv.isPeerTurn(s), false, "the turn's result closes it");
});

test("engine: a peer message joining an operator turn taints the rest of it, and the join pays back", () => {
  const s = running();
  funnel(s, { type: "inbound_arrived", message: "mine", authorName: "Me", fromOperator: true });
  funnel(s, { type: "inbound_arrived", message: "theirs", authorName: "Peer" });
  assert.equal(priv.isPeerTurn(s), true, "mid-turn: their words are in context now");
  priv.peerPushJoined(s, "…Peer replied… theirs …");
  assert.equal(priv.isPeerTurn(s), true, "still the same turn");
  funnel(s, { type: "result", payload: {} });
  assert.equal(priv.isPeerTurn(s), false, "one result answered both: nothing left over");
});

test("engine: a direction from another session is not the operator; a panel message is", () => {
  const s = running();
  funnel(s, { type: "steer", text: "framed", private: true, directed: true, priority: "next" });
  assert.equal(priv.isPeerTurn(s), true);
  priv.resetPeerTurn(s);
  funnel(s, { type: "steer", text: "framed", private: true, directed: false, priority: "next" });
  assert.equal(priv.isPeerTurn(s), false);
});

test("the first pushed turn and every teardown are wired to the window", () => {
  const query = readFileSync(M("session-query.js"), "utf8");
  assert.match(query, /s\.pushIterator\.push\(io\.userMessage\(s\.firstTurn\)\);[\s\S]*peerTurn\.resetPeerTurn\(s\);\s*peerTurn\.openPeerTurn\(s, false\);/);
  assert.equal((ENGINE.match(/sessionPrivate\.resetPeerTurn\(s\);/g) || []).length, 2, "abortQuery + denyPending");
  assert.match(readFileSync(M("session-park.js"), "utf8"), /privateTurn\.resetPeerTurn\(s\);/);
  assert.match(readFileSync(M("session-directed.js"), "utf8"), /windows\.peerPushJoined\(s, pushedText\);/);
});

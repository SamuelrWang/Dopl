// DMP-005 — THE TWO LAUNCH-CONTEXT FIELDS, WIRED FOR EVERY PRODUCTION LANE.
//
// The audit's finding: `prompt-framing-self.js` renders `ctx.agentName` and `room-roster.js`
// excludes the operator by `selfUserId`, but no production lane supplied either — every existing
// test hand-completed the renderer's context. So each case here enters through the LANE's own
// entry point with the payload that lane really builds (`trigger.js › launchResponderSession`,
// `launch-directive-spawn.js › spawn` over a `directiveFrom` row, `session-launch-op.js ›
// launchFromButton` + the rename the SPA sends), runs the REAL engine, and reads the text the
// runtime was actually handed.
//
// Faked: the engine harness's leaves, the channel-listener's watched DTO, and the roster's two
// reads (`listener-io.js › apiFetch`, which `room-roster.js` looks up at call time).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { engine, rt, STORE, settle, registryReads, MAIN, CHANNEL, WORKSPACE, ME } from "./_engine-harness.mjs";

const require_ = createRequire(import.meta.url);
const M = (p) => join(MAIN, p);

const PEER = "99999999-8888-4777-8666-555555555555";
const TASK = "33333333-4444-4555-8666-777777777777";
const WATCHED = { id: CHANNEL, name: "Ops", toolProfile: "channel_agent", memberCount: 2, isDirect: false };

// The listener's watched-channel DTO (the containment input every lane reads).
const listenerPath = require_.resolve(M("channel-listener.js"));
require_.cache[listenerPath] = {
  id: listenerPath, filename: listenerPath, loaded: true, children: [], paths: [],
  exports: { watchedChannel: (id) => (id === CHANNEL ? WATCHED : null) },
};

// The roster's two server reads. The OPERATOR is on both — as a member and as the owner of an agent
// on another machine — which is exactly what the roster must not list as somebody else.
const listenerIo = require_(M("listener-io.js"));
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
listenerIo.apiFetch = async (path) => {
  if (path.endsWith("/members")) {
    return json({ members: [
      { userId: ME, displayName: "Sam Operator" },
      { userId: PEER, displayName: "Pat Peer" },
    ] });
  }
  if (path.endsWith("/sessions")) {
    return json({ sessions: [
      { userId: ME, name: "opother1", displayName: "Mine Elsewhere", state: "idle" },
      { userId: PEER, name: "peerbot1", displayName: "Peer Bot", state: "working" },
    ] });
  }
  return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
};
listenerIo.displayNameFor = (id) => (id === PEER ? "Pat Peer" : id === ME ? "Sam Operator" : "A teammate");

// The engine's operator identity, as `channel-listener.js › reconcile` sets it — the ONE source the
// funnel now reads for every lane.
engine.setSelfIdentity(ME);

const trigger = require_(M("trigger.js"));
const spawnLane = require_(M("launch-directive-spawn.js"));
const wire = require_(M("launch-directive-wire.js"));
const buttonLane = require_(M("session-launch-op.js"));
const commit = require_(M("agent-identity-commit.js"));

/** The first user turn a runtime handle received, as text. */
function firstTurnOf(h) {
  const m = h && h.pushed[0];
  const c = m && m.message && m.message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.text) || "").join("");
  return JSON.stringify(m);
}

/** The roster block, alone — the operator's own name must be absent from THIS part. */
function rosterOf(turn) {
  const from = turn.indexOf("IN THIS ROOM as of launch");
  assert.ok(from !== -1, "the roster block is rendered");
  return turn.slice(from, turn.indexOf("\n\n", from) === -1 ? undefined : turn.indexOf("\n\n", from));
}

function assertOperatorExcluded(turn) {
  const roster = rosterOf(turn);
  assert.match(roster, /@pat-peer/, "the peer member is listed");
  assert.doesNotMatch(roster, /@sam-operator/, "the OPERATOR is not listed among the people");
  assert.match(roster, /@peer-bot · Pat Peer's/, "the peer's agent is listed as the peer's");
  assert.doesNotMatch(roster, /mine-elsewhere/, "the operator's own remote agent is not a peer agent");
}

const directiveRow = (over = {}) => ({
  id: "66666666-6666-4666-8666-666666666666",
  workspace_id: WORKSPACE,
  channel_id: CHANNEL,
  task_id: "",
  operator_user_id: ME,
  goal: "Draft the release notes",
  status: "pending",
  kind: "launch",
  agent_name: "Coder",
  ...over,
});

test("RESPONDER lane: the first turn carries the agent's id, and the roster excludes the operator", async () => {
  const before = rt.handles.length;
  const entry = { channel: { ...WATCHED }, workspaceId: WORKSPACE, workspaceSegment: null };
  const m = { seq: 7, body: "Can you check the build?", authorUserId: PEER, authorKind: "human", metadata: {} };
  assert.equal(await trigger.launchResponderSession(entry, m, { taskId: TASK, toolProfile: "channel_agent", requesterName: "Pat Peer" }), true);
  await settle();
  const turn = firstTurnOf(rt.handles[before]);
  // Before DMP-005 the eager first turn was built from a context with NO agent id, so the self
  // block — the id line, the tagging rule, the roster — was missing from it entirely.
  assert.match(turn, /YOUR AGENT ID IS [0-9a-z]{8}\./);
  assert.doesNotMatch(turn, /YOU ARE "/, "a responder is launched unnamed, so it claims no name");
  assertOperatorExcluded(turn);
});

test("DIRECTIVE lane (goal): the FINAL unique name is in the first turn, and the echo reports the same name", async () => {
  const first = rt.handles.length;
  const deps = { launch: (spec) => engine.launchRequesterSession(spec), watchedChannel: (id) => (id === CHANNEL ? WATCHED : null) };
  const a = await spawnLane.spawn(wire.directiveFrom(directiveRow(), WORKSPACE), deps);
  await settle();
  assert.ok(a.agentId, `launched: ${JSON.stringify(a)}`);
  assert.equal(a.appliedAgentName, "Coder");
  const turnA = firstTurnOf(rt.handles[first]);
  assert.match(turnA, new RegExp(`YOU ARE "Coder"\\. YOUR AGENT ID IS ${a.agentId}\\.`));
  assertOperatorExcluded(turnA);

  // A second "Coder" in the same room is suffixed by the uniqueness rule — and it is the SUFFIXED
  // name the agent is told, before its first model turn, not the one that was asked for.
  const second = rt.handles.length;
  const b = await spawnLane.spawn(wire.directiveFrom(directiveRow({ id: "66666666-6666-4666-8666-666666666667" }), WORKSPACE), deps);
  await settle();
  assert.ok(b.agentId && b.agentId !== a.agentId);
  assert.notEqual(b.appliedAgentName, "Coder");
  assert.match(b.appliedAgentName, /^Coder-\d+$/);
  const turnB = firstTurnOf(rt.handles[second]);
  assert.ok(turnB.includes(`YOU ARE "${b.appliedAgentName}". YOUR AGENT ID IS ${b.agentId}.`), turnB.slice(0, 1200));
  // …and the first agent is in the second one's roster by its own handle, as the operator's.
  assert.match(rosterOf(turnB), /@coder · yours/);
});

test("NEW AGENT lane: the rename the SPA sends after launch is in the first (wake) turn, and survives a later rename", async () => {
  const before = rt.handles.length;
  const res = await buttonLane.launchFromButton({ channelId: CHANNEL, taskId: null, workspaceId: WORKSPACE, channelName: "Ops", runtime: "claude" });
  assert.equal(res.ok, true, JSON.stringify(res));
  // `use-agent-launch-run.ts › launchWithIdentity` renames straight after the idle launch.
  assert.equal(commit.commitRename(res.agentId, "Reviewer").ok, true);
  assert.equal(rt.handles.length, before, "spawn-idle: no runtime started yet");
  assert.deepEqual(engine.messageByTask({ channelId: CHANNEL, taskId: "", agentId: res.agentId, text: "start" }), { ok: true });
  await settle();
  const h = rt.handles[before];
  const turn = firstTurnOf(h);
  assert.match(turn, new RegExp(`YOU ARE "Reviewer"\\. YOUR AGENT ID IS ${res.agentId}\\.`));
  assertOperatorExcluded(turn);

  // CONTEXT REFRESH: every push re-stamps the context from the rename store, so a rename (or a
  // park + resume, which rebuilds from a record that carries no name) lands on the current name.
  const s = registryReads.sessionOn({ channelId: CHANNEL, taskId: "", agentId: res.agentId });
  assert.equal(s.context.agentName, "Reviewer");
  assert.equal(commit.commitRename(res.agentId, "Lead Reviewer").ok, true);
  assert.deepEqual(engine.messageByTask({ channelId: CHANNEL, taskId: "", agentId: res.agentId, text: "next" }), { ok: true });
  await settle();
  assert.equal(s.context.agentName, "Lead Reviewer");
  assert.equal(commit.commitRename(res.agentId, "").ok, true, "the clear gesture");
  assert.deepEqual(engine.messageByTask({ channelId: CHANNEL, taskId: "", agentId: res.agentId, text: "again" }), { ok: true });
  await settle();
  assert.equal(s.context.agentName, undefined, "a cleared name is not left stale on the context");
});

test("RESUME: a record rebuilt at boot is stamped with its stored name on its first push", async () => {
  const AGENT = "r3sum3d1";
  const KEY = `${CHANNEL}::${AGENT}`;
  STORE.agentNames = { ...(STORE.agentNames || {}), [AGENT]: { name: "Night Shift", at: Date.now() } };
  STORE.sessionRecords = {
    ...(STORE.sessionRecords || {}),
    [KEY]: {
      key: KEY, sessionId: "11111111-2222-3333-4444-666666666666", channelId: CHANNEL, taskId: "",
      workspaceId: WORKSPACE, side: "requester", profile: "channel_agent", mode: "interactive",
      phase: "parked", startedAt: Date.now() - 60000, parkedAt: Date.now() - 1000, agentId: AGENT,
      turns: 2, ownPostSeq: 1, runtimeId: "claude", usageBaseline: "resets",
    },
  };
  STORE.sessionIds = { ...(STORE.sessionIds || {}), [KEY]: "sdk-parked-resume" };
  await engine.init();
  const s = registryReads.sessionOn({ channelId: CHANNEL, taskId: "", agentId: AGENT });
  assert.ok(s, "re-parked");
  assert.deepEqual(engine.messageByTask({ channelId: CHANNEL, taskId: "", agentId: AGENT, text: "continue" }), { ok: true });
  await settle();
  assert.equal(s.context.agentId, AGENT);
  assert.equal(s.context.agentName, "Night Shift");
});

test("the funnel reads the operator from the ENGINE, never from a caller's payload", async () => {
  const before = rt.handles.length;
  // A payload claiming another user is ignored: the roster still excludes the real operator and
  // still lists the peer (it would drop the peer if the payload's id were believed).
  const res = await engine.launchResponderSession({
    windowless: true, channelId: CHANNEL, taskId: "44444444-5555-4666-8777-888888888888", workspaceId: WORKSPACE,
    runtime: "claude", message: "hi", counterpartyId: PEER, direct: false,
    context: { channelName: "Ops", channelId: CHANNEL, workspaceId: WORKSPACE, taskId: "44444444-5555-4666-8777-888888888888" },
    toolProfile: "channel_agent", mode: "autonomous", selfUserId: PEER,
    startModes: { tools: "manual", messages: "ask" },
  });
  assert.ok(res && res.sessionId, JSON.stringify(res));
  await settle();
  // The agent list is full of this file's own agents by now (five listed, own first), so the
  // PEOPLE line is the witness: believing the payload would drop @pat-peer and list @sam-operator.
  const roster = rosterOf(firstTurnOf(rt.handles[before]));
  assert.match(roster, /- people: @pat-peer$/m);
  assert.doesNotMatch(roster, /@sam-operator/);
});

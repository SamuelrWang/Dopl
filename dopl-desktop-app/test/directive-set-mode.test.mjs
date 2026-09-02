// THE `set_agent_mode` DIRECTIVE KIND — an operator's EXTERNAL agent moving one of their own
// RUNNING agents' two permission axes (2026-09-01, the agent-efficiency wave).
//
// ⚠ SPLIT FROM `launch-directive-agent-ops.test.mjs` BY WHAT THE CASES ARE ABOUT, the same rule
// that file follows against the watcher suite, and the same shared machinery. That file is about
// `end` and `rename`; this one is about the kind whose whole design question is different —
// those two WIDEN NOTHING, and this one is a POSTURE.
//
// ── THE TWO THINGS EVERY CASE HERE IS REALLY ABOUT ──────────────────────────────────────
//
//  1. **NOTHING AN ORCHESTRATOR WRITES MAY WIDEN CONTAINMENT.** `launch-directives.js`'s header
//     states it in capitals for the launch branch, and the same sentence has to survive a verb
//     that exists to change a posture. It does, two ways: the requested pair is CLAMPED to the
//     operator's own durable channel posture (`channel-prefs.js › getLaunchPosture`), and the
//     kind is behind the machine-wide consent toggle, unlike its two non-launch siblings.
//  2. **IT IMPLEMENTS NOTHING.** The apply is `session-engine.js › setModeByTask` — the same op
//     `sessions:setMode` and `channel-dir-ipc.js › applyPostureToLive` call, where the windowless
//     message floor and the reducer's fail-closed coercion already live. A second writer to those
//     two fields is how two readers come to disagree about one posture.

import test from "node:test";
import assert from "node:assert/strict";
import {
  boot, decidePosts, row, wire, WS, CH, DID,
} from "./_launch-directive-harness.mjs";

/** A live-registry row, as `session-engine.js › listLiveSessions` projects one. */
const liveRow = (agentId, over = {}) => ({
  sessionId: "s1", key: `${CH}::${agentId}`, channelId: CH, workspaceId: WS,
  taskId: "", agentId, channelName: "General", taskTitle: null, status: "running", hidden: false,
  ...over,
});

/** A pending set_agent_mode directive, as the server would write it. */
const modeRow = (over = {}) => row({
  kind: "set_agent_mode", task_id: null, goal: null, model: null,
  target_agent_id: "a1b2c3d4", ...over,
});

const decided = (h) => decidePosts(h).map((p) => p.body);
const live = () => [liveRow("a1b2c3d4")];

// ── 1. THE WIRE ──────────────────────────────────────────────────────────────────────────

test("WIRE: the two axes survive the narrowing, in BOTH spellings", () => {
  // ⚠ TWO ROADS, TWO NAMES — a realtime frame is the raw row and the CLAIM's answer is the
  // server DTO. `directiveFrom` is where a field silently never arrives, so both are driven.
  const raw = wire.directiveFrom(
    modeRow({ target_tool_mode: "auto", target_message_mode: "auto_both" }), WS);
  assert.equal(raw.targetToolMode, "auto");
  assert.equal(raw.targetMessageMode, "auto_both");
  const dto = wire.directiveFrom(
    modeRow({ targetToolMode: "bypass", targetMessageMode: "auto_inbound" }), WS);
  assert.equal(dto.targetToolMode, "bypass");
  assert.equal(dto.targetMessageMode, "auto_inbound");
});

test("WIRE: a mode this build does not recognise collapses to `''`, not to a coercion", () => {
  // ⚠ THE SAFE DIRECTION. A value outside the frozen enum must not be carried toward a reducer
  // that would coerce it to the most restrictive member with nobody saying so — the caller
  // treats `''` as "this axis was not requested", which is a REAL and common value.
  for (const junk of ["god_mode", "", null, undefined, 7, {}, "AUTO"]) {
    const d = wire.directiveFrom(modeRow({ target_tool_mode: junk, target_message_mode: junk }), WS);
    assert.equal(d.targetToolMode, "", String(junk));
    assert.equal(d.targetMessageMode, "", String(junk));
  }
});

test("WIRE: the two enums are `session-profiles.js`'s own, narrowest first", async () => {
  // ⚠ THE RESTATEMENT IS FORCED (the wire block is pure and may hold no require), so it is
  // DRIVEN against the authority rather than trusted. ⚠ NARROWEST FIRST IS LOAD-BEARING: the
  // clamp is an INDEX COMPARISON over these arrays, so re-ordering either silently inverts it.
  const profiles = await import("node:module")
    .then((m) => m.createRequire(import.meta.url))
    .then((r) => r(new URL("../main/session-profiles.js", import.meta.url).pathname));
  assert.deepEqual(wire.MESSAGE_MODES, profiles.MESSAGE_MODES);
  assert.deepEqual(wire.TOOL_MODES, profiles.TOOL_MODES);
  assert.equal(wire.TOOL_MODES[0], "manual", "[0] is the fail-closed member");
  assert.equal(wire.TOOL_MODES[wire.TOOL_MODES.length - 1], "bypass", "the last is the widest");
});

// ── 2. THE CONSENT ASYMMETRY ─────────────────────────────────────────────────────────────

test("CONSENT: it is BEHIND the toggle, where `end` and `rename` are not", async () => {
  // ⚠ THE ASYMMETRY IS THE RULING. A STOP verb and a DISPLAY verb widen nothing, so they ride
  // free; a POSTURE at Axis A `bypass` PRE-APPROVES work tools on hardware this operator pays
  // for, which is LOCAL COMPUTE BEING SPENT — the one thing the toggle exists for.
  const off = boot({ enabled: false, live: live() });
  await off.api.handle(modeRow({ target_tool_mode: "auto" }), WS);
  assert.deepEqual(decidePosts(off), [], "nothing decided — the row expires, silently");
  assert.deepEqual(off.modes, [], "and nothing was applied");
  // …and the free half is unchanged in the same harness, which is what makes this a comparison.
  const end = boot({ enabled: false, live: live(), control: { ok: true } });
  await end.api.handle(row({ kind: "end", task_id: null, goal: null, model: null,
    target_agent_id: "a1b2c3d4" }), WS);
  assert.equal(decidePosts(end).length, 1, "an END still answers with the toggle off");
});

test("CONSENT: the gate is the DATA list, not a condition a fifth kind could slip past", () => {
  assert.deepEqual(wire.KINDS_NEEDING_LAUNCH_CONSENT, ["launch", "set_agent_mode"]);
});

// ── 3. THE APPLY ─────────────────────────────────────────────────────────────────────────

test("APPLY: both axes reach `setModeByTask`, addressed by the RESOLVED registry row", async () => {
  const h = boot({ live: live() });
  await h.api.handle(modeRow({ target_tool_mode: "auto", target_message_mode: "auto_both" }), WS);
  assert.deepEqual(h.modes, [
    { axis: "tools", mode: "auto", channelId: CH, taskId: "", agentId: "a1b2c3d4" },
    { axis: "messages", mode: "auto_both", channelId: CH, taskId: "", agentId: "a1b2c3d4" },
  ]);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
});

test("APPLY: ONE axis is a legal directive — the other is left alone", async () => {
  const h = boot({ live: live() });
  await h.api.handle(modeRow({ target_tool_mode: "auto" }), WS);
  assert.equal(h.modes.length, 1);
  assert.equal(h.modes[0].axis, "tools");
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
});

test("APPLY: it is PER AGENT — a sibling on the same thread is not touched", async () => {
  // ⚠ Multiplayer is the normal case. Addressing by (channel, thread) would take the oldest
  // agent on the thread and silently skip its siblings, which is most of the room.
  const h = boot({ live: [liveRow("zzzz1111"), liveRow("a1b2c3d4")] });
  await h.api.handle(modeRow({ target_tool_mode: "auto" }), WS);
  assert.deepEqual(h.modes.map((m) => m.agentId), ["a1b2c3d4"]);
});

// ── 4. THE CLAMP — "nothing an orchestrator writes can widen it" ─────────────────────────

test("CLAMP: a request WIDER than the operator's channel posture lands at the ceiling", async () => {
  const h = boot({ live: live(), ceiling: { tools: "auto", messages: "auto_inbound" } });
  await h.api.handle(modeRow({ target_tool_mode: "bypass", target_message_mode: "auto_both" }), WS);
  assert.deepEqual(h.modes.map((m) => m.mode), ["auto", "auto_inbound"],
    "the operator's own durable pair is the ceiling on both axes");
  // ⚠ IT CLAMPS, IT DOES NOT REFUSE — `setModeByTask`'s own rule for the windowless floor one
  // layer down, and the right trade for the same reason: refusing would apply nothing when part
  // of what was asked for was legal. The clamp is recorded in the diag rather than hidden.
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
  assert.ok(h.logged.some((l) => l.includes("CLAMPED") && l.includes("auto/auto_inbound")));
});

test("CLAMP: a request NARROWER than the ceiling is applied as asked", async () => {
  const h = boot({ live: live(), ceiling: { tools: "bypass", messages: "auto_both" } });
  await h.api.handle(modeRow({ target_tool_mode: "manual", target_message_mode: "ask" }), WS);
  assert.deepEqual(h.modes.map((m) => m.mode), ["manual", "ask"]);
  assert.ok(!h.logged.some((l) => l.includes("CLAMPED")));
});

test("CLAMP: an UNSET channel posture is the restrictive default, so nothing widens", async () => {
  // ⚠ `getLaunchPosture` never answers null — an unset or unreadable record IS manual/ask — so a
  // channel the operator has never configured cannot be widened by a directive at all.
  const h = boot({ live: live(), ceiling: { tools: "manual", messages: "ask" } });
  await h.api.handle(modeRow({ target_tool_mode: "bypass", target_message_mode: "auto_both" }), WS);
  assert.deepEqual(h.modes.map((m) => m.mode), ["manual", "ask"]);
});

test("CLAMP: the comparison is an index, so an unknown CEILING clamps to itself", async () => {
  // ⚠ A ceiling this build does not know indexes to -1, which is narrower than every real mode,
  // so every request is clamped to it — and the reducer then coerces the unknown value
  // fail-closed. Two layers, both failing in the same direction, which is the only direction a
  // posture may fail in.
  const h = boot({ live: live(), ceiling: { tools: "from_the_future", messages: "ask" } });
  await h.api.handle(modeRow({ target_tool_mode: "auto" }), WS);
  assert.deepEqual(h.modes.map((m) => m.mode), ["from_the_future"]);
});

// ── 5. THE REFUSALS, IN THE CLOSED WIRE VOCABULARY ───────────────────────────────────────

test("REFUSE: no live session is `no-session`, and it is the ordinary answer", async () => {
  // ⚠ A posture lives on `s.state`, so there is nothing to move on an agent that has finished
  // and no durable record to move it in. Same sentence `endAgent` writes.
  const h = boot({ live: [] });
  await h.api.handle(modeRow({ target_tool_mode: "auto" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-session" }]);
  assert.deepEqual(h.modes, []);
});

test("REFUSE: a directive naming NO axis this build knows is `no-bridge`, not `done`", async () => {
  // ⚠ REPORTING `done` FOR A NO-OP would tell an orchestrator its posture landed when nothing
  // moved. `no-bridge` is "this machine could not take it", which is exactly true of a mode a
  // newer server offers and this build has never heard of.
  const h = boot({ live: live() });
  await h.api.handle(modeRow({ target_tool_mode: "god_mode" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-bridge" }]);
  assert.deepEqual(h.modes, []);
});

test("REFUSE: no target agent id is `no-session` — there is no oldest-agent fallback", async () => {
  const h = boot({ live: live() });
  await h.api.handle(modeRow({ target_agent_id: null, target_tool_mode: "auto" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-session" }]);
});

test("REFUSE: the session settling mid-flight is `no-session`, not a false `done`", async () => {
  const h = boot({ live: live(), setMode: { ok: false, reason: "no-session" } });
  await h.api.handle(modeRow({ target_tool_mode: "auto", target_message_mode: "auto_both" }), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-session" }]);
});

test("REFUSE: every path out of a CLAIMED row writes a verdict", async () => {
  // ⚠ A claimed directive nobody decides is the ONE outcome the orchestrator cannot act on.
  for (const over of [
    { target_tool_mode: "auto" },
    { target_tool_mode: "god_mode" },
    { target_agent_id: null },
  ]) {
    const h = boot({ live: [] });
    await h.api.handle(modeRow(over), WS);
    assert.equal(decidePosts(h).length, 1, JSON.stringify(over));
  }
});

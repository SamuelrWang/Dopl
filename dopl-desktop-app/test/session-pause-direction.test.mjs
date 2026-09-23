// P4-08 — PAUSING A DIRECTED TURN LAPSES THE DIRECTION; NO PARTIAL REPLY IS REPORTED.
//
// Pause interrupts the running turn, and both runtimes still emit a `result` for it. Without a
// reset, that `result` closed the directed capture and the half-written text was reported to the
// orchestrator as `delivered`. Driven through the real engine: launch, direct, pause.

import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, rt, requests, frames, launchArgs, settle, CHANNEL, WORKSPACE, ME } from "./_engine-harness.mjs";

const DECIDE = "/api/channels/agent-directions/decide";
const reportsFor = (id) => requests.filter((r) => r.path === DECIDE && JSON.stringify(r.body || {}).includes(id));

/** A live, idle agent: launched, its first turn run to a `result`. */
async function liveAgent() {
  const before = rt.handles.length;
  const res = await engine.launchResponderSession(launchArgs());
  await settle();
  const h = rt.handles[before];
  h.feed(frames.init(`sdk-${res.agentId}`));
  h.feed(frames.say("ready"));
  h.feed(frames.result());
  await settle();
  return { agentId: res.agentId, h };
}

function direct(agentId, id) {
  return engine.messageByTask({
    channelId: CHANNEL, taskId: "", agentId, text: "status?",
    directed: { id, workspaceId: WORKSPACE, operatorUserId: ME },
  });
}

engine.setSelfIdentity(ME);

test("control: a directed turn that runs to its end reports its final text", async () => {
  const { agentId, h } = await liveAgent();
  const id = "d0000000-0000-4000-8000-000000000001";
  assert.deepEqual(direct(agentId, id), { ok: true });
  h.feed(frames.say("all green"));
  h.feed(frames.result());
  await settle();
  assert.equal(reportsFor(id).length, 1);
  assert.match(JSON.stringify(reportsFor(id)[0].body), /all green/);
});

test("pause mid-directed-turn: the interrupted turn's result reports nothing", async () => {
  const { agentId, h } = await liveAgent();
  const id = "d0000000-0000-4000-8000-000000000002";
  assert.deepEqual(direct(agentId, id), { ok: true });
  h.feed(frames.say("half an ans"));
  await settle();
  assert.deepEqual(engine.controlByTask({ channelId: CHANNEL, taskId: "", agentId, action: "pause" }), { ok: true });
  assert.equal(h.interrupts, 1, "the pause reached the runtime");
  h.feed(frames.result());
  await settle();
  assert.deepEqual(reportsFor(id), [], "the direction lapses rather than carrying a partial reply");
  // …and the next turn, whatever it answers, is not attributed to it either.
  h.feed(frames.say("an unrelated reply"));
  h.feed(frames.result());
  await settle();
  assert.deepEqual(reportsFor(id), []);
});

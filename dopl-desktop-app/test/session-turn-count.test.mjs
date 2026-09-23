// P4-10 — ONE TURN COUNTER, AND THE CARD'S SURVIVES A RESTART.
//
// The card read `s.turns` (bumped per `result` in session-io, never persisted or rehydrated) while
// the reducer's `state.turns` was persisted and rehydrated and read by nothing. After a restart an
// agent that had run 7 turns showed none, then 1. Driven through the real engine: a stored parked
// record re-parked at boot, woken, and run one turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, rt, STORE, frames, settle, registryReads, summary, CHANNEL, WORKSPACE, ME } from "./_engine-harness.mjs";

const AGENT = "y1uun32v";
const KEY = `${CHANNEL}::${AGENT}`;

STORE.sessionRecords = {
  [KEY]: {
    key: KEY, sessionId: "11111111-2222-3333-4444-555555555555", channelId: CHANNEL, taskId: "",
    workspaceId: WORKSPACE, side: "responder", profile: "channel_agent", mode: "interactive",
    phase: "parked", startedAt: Date.now() - 60000, parkedAt: Date.now() - 1000, agentId: AGENT,
    turns: 7, ownPostSeq: 3, runtimeId: "claude", usageBaseline: "resets",
  },
};
STORE.sessionIds = { [KEY]: "sdk-parked" };
engine.setSelfIdentity(ME);

const live = () => registryReads.sessionOn({ channelId: CHANNEL, taskId: "", agentId: AGENT });

test("boot re-parks the record and the card shows the turns it had already run", async () => {
  await engine.init();
  const s = live();
  assert.ok(s, "re-parked, not dropped");
  assert.equal(summary.liveSummary(s).turns, 7);
});

test("the next turn after the resume counts on from there", async () => {
  assert.deepEqual(engine.messageByTask({ channelId: CHANNEL, taskId: "", agentId: AGENT, text: "continue" }), { ok: true });
  await settle();
  const h = rt.handles[rt.handles.length - 1];
  assert.equal(h && h.via, "resume");
  h.feed(frames.init("sdk-resumed"));
  h.feed(frames.say("done"));
  h.feed(frames.result());
  await settle();
  assert.equal(summary.liveSummary(live()).turns, 8);
  // The record is written at the next park or settle, with the same counter.
  assert.deepEqual(engine.controlByTask({ channelId: CHANNEL, taskId: "", agentId: AGENT, action: "end" }), { ok: true });
  await settle();
  assert.equal(STORE.sessionRecords[KEY].turns, 8);
});

// A MAIN-ROOM STANDBY AGENT IS NOT DRIVING A THREAD (2026-09-25).
//
// New Agent and a channel-level directive launch on the requester side with `scope: 'channel'` and no
// thread. They got the requester opening ("DRIVING a thread you opened … STOP and report to your
// operator"), which nudged a standby agent to answer its operator privately. The standby opening says
// what the agent is for: it waits in the room, answers what is addressed to it there, and ends its turn.
// Built the way production builds it: the real launch goal (`session-launch-op.js › defaultGoal`) through
// `session-seed.js › withSeed` on a fresh shell.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const seed = require(join(MAIN, "session-seed.js"));
const { defaultGoal } = require(join(MAIN, "session-launch-op.js"));
const { VOCABULARY, MAIN_ROOM_VOCABULARY } = require(join(MAIN, "prompt-framing-text.js"));

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const TASK = "cccccccc-3333-4ddd-8eee-ffffffffffff";

// The shell `sessions:launch` registers (`session-launch-op.js`), fresh, so its first turn is framed.
const firstTurn = (channelLevel, toolSet) => {
  const taskId = channelLevel ? "" : TASK;
  return seed.withSeed({
    side: "requester", nonce: "n1", freshFraming: true, doplToolSet: toolSet,
    launchGoal: defaultGoal(channelLevel, channelLevel ? "" : "Q3 report"),
    context: { channelName: "AI Glasses MCP", taskTitle: channelLevel ? null : "Q3 report", channelId: CH, workspaceId: WS, taskId, scope: channelLevel ? "channel" : "thread" },
  }, "");
};

test("STANDBY: a channel-level launch opens standing by in the main room, not driving a thread", () => {
  for (const toolSet of [undefined, "granular"]) {
    const turn = firstTurn(true, toolSet);
    assert.match(turn, /^You are a Dopl agent STANDING BY in the main room of the shared channel "AI Glasses MCP", for your operator\./);
    assert.match(turn, /Answer what is addressed to you IN THE ROOM, by posting, then end your turn to wait\./);
    for (const gone of [/DRIVING a thread/, /report to your operator/, /the peer/, /thread goal DATA/, /MILESTONES/]) {
      assert.ok(!gone.test(turn), `standby turn still says ${gone}`);
    }
    // The delivery call is the room's, named in the session's tool set.
    const call = toolSet === "granular" ? "mcp__dopl__dopl_send_message MCP tool." : "mcp__dopl__dopl_channel MCP tool.";
    assert.ok(turn.includes(`DELIVERY: post into this channel with the ${call}`));
    assert.match(turn, /That is how the room receives you; there is no other capture\./);
    // A main-room send is refused without its to=, so the line never promises a call "exactly like this".
    assert.ok(turn.includes(`Make the call like this, adding the to= each message you are sent names:`));
    assert.ok(!turn.includes("Make the call exactly like this"));
    // Its room IS its lane: the thread session's "post to the channel RARELY" brake is left out.
    assert.ok(!turn.includes("RARELY"));
    assert.ok(turn.includes(defaultGoal(true, "")), "the operator's goal still rides the fence");
  }
});

test("STANDBY: the main-room vocabulary is the thread vocabulary minus the channel-posts brake", () => {
  assert.ok(VOCABULARY.length > MAIN_ROOM_VOCABULARY.length);
  assert.deepEqual(VOCABULARY.filter((l) => MAIN_ROOM_VOCABULARY.includes(l)), MAIN_ROOM_VOCABULARY);
});

test("REQUESTER: a thread-driving launch keeps its opening, delivery and milestone lines", () => {
  const turn = firstTurn(false, "granular");
  assert.match(turn, /^You are a Dopl agent DRIVING a thread you opened in the shared channel "AI Glasses MCP": "Q3 report"\./);
  assert.match(turn, /Respond and loop until the goal is met, then STOP and report to your operator\./);
  assert.ok(turn.includes("Deliver every message to the peer by posting into this channel with the mcp__dopl__dopl_send_message MCP tool."));
  assert.ok(turn.includes(`Make the call exactly like this: channel "${CH}", container "${WS}", thread "${TASK}".`));
  assert.match(turn, /That is how the peer's agent receives you\./);
  assert.match(turn, /MILESTONES \(optional/);
  assert.match(turn, /as the thread goal DATA/);
  assert.ok(turn.includes("RARELY"));
});

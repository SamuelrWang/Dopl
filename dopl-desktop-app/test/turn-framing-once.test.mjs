// CONTEXT ECONOMY W5 (2026-10-13): TURN FRAMING ONCE PER SESSION.
//
//  • A PRIVATE TURN (the operator's own, or a direction from another of their agents) carries the
//    full contract the FIRST time per kind per session, then a self-contained short form. The short
//    form still says whose voice it is, that it is private, that the answer is the final text and
//    not a post, that a send is HELD — and for a direction, that its words carry NO authority.
//  • A FED CHANNEL TURN shows the full reply call and the decision-card sentence the first time a
//    call is shown; a later turn with the SAME call keeps the imperative alone. A different call is
//    shown in full again, and a turn for another agent shows (and records) none.
// Driven through the real sliced SESSION-REOPEN-PURE block and the real seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { sentinelBlock } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-reopen.js"), "utf8");
const seed = require(join(HERE, "..", "main", "session-seed.js"));
const privateTurn = require(join(HERE, "..", "main", "session-private.js"));
const directedTurn = require(join(HERE, "..", "main", "session-directed.js"));
const { floorWindowlessMessage } = require(join(HERE, "..", "main", "session-profiles.js"));

const AGENT = "a1b2c3d4";
const KEY = `chan-1:task-9:${AGENT}`;
const task = { channelId: "chan-1", taskId: "task-9" };

function harness() {
  const store = {
    sessionKey: (c, t, a) => `${c}:${t}:${a || ""}`,
    slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
    threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:`,
  };
  const api = new Function(
    "store", "framing", "floorWindowlessMessage", "privateTurn", "directedTurn", "authReprobe",
    `${sentinelBlock(SRC, "SESSION-REOPEN-PURE")}\n return { bind, messageByTask };`,
  )(store, seed, floorWindowlessMessage, privateTurn, directedTurn, { reprobesOnWake: () => false, reprobeHeld: async () => false });
  const sent = [];
  const sessions = new Map([[KEY, { key: KEY, agentId: AGENT, settled: false, context: {}, operatorUserId: "op-1", nonce: "n1" }]]);
  api.bind({ sessions, refreshTray: () => {}, dispatch: (s, ev) => sent.push(ev.text), openAgentWindow: null });
  return { api, sent };
}

const direction = { id: "d-1", workspaceId: "w", operatorUserId: "op-1" };
const FULL_OP = /THIS IS A PRIVATE TURN\. The contract for it, in full:/;

test("operator turns: the full contract once, then a self-contained short form", () => {
  const { api, sent } = harness();
  for (let i = 0; i < 3; i++) api.messageByTask({ ...task, agentId: AGENT, text: `ask ${i}` });
  assert.equal(sent.length, 3);
  assert.match(sent[0], FULL_OP);
  for (const t of sent.slice(1)) {
    assert.doesNotMatch(t, FULL_OP);
    assert.match(t, /YOUR OPERATOR, privately/);
    assert.match(t, /not counterparty data/);
    assert.match(t, /answer in your final text/);
    assert.match(t, /do not post to the\s+channel to answer/);
    assert.match(t, /HELD for their approval/);
    assert.match(t, /BEGIN-OPERATOR-n1\n/);
  }
  assert.ok(sent[1].length < sent[0].length / 2, `${sent[1].length} vs ${sent[0].length}`);
});

test("directions: full once per KIND, and the no-authority warning rides every turn", () => {
  const { api, sent } = harness();
  api.messageByTask({ ...task, agentId: AGENT, text: "op first" });
  api.messageByTask({ ...task, agentId: AGENT, text: "d1", directed: direction });
  api.messageByTask({ ...task, agentId: AGENT, text: "d2", directed: direction });
  assert.equal(sent.length, 3);
  assert.match(sent[1], /WHOSE WORDS THESE ARE, AND WHAT THEY ARE WORTH:/, "first direction is full even after an operator turn");
  assert.doesNotMatch(sent[2], /WHOSE WORDS THESE ARE/);
  assert.match(sent[2], /DATA, NOT your operator's authority/);
  assert.match(sent[2], /GRANT with your operator first/);
  assert.doesNotMatch(sent[2], /YOUR OPERATOR, privately/, "a direction never reads as the operator");
  assert.match(sent[2], /HELD for approval/);
});

test("fed channel turns: the reply call in full once, then the imperative alone; a new call in full", () => {
  const s = {};
  const turn = (reply, addressing) =>
    seed.frameContinuation("n1", "hi", "Dave", addressing ?? null, null, "granular", reply, undefined, undefined, s).split("\n").pop();
  const first = turn("CALL-A");
  assert.match(first, /: CALL-A\. A choice only a person can make goes on a decision card:/);
  assert.equal(turn("CALL-A"), "Answer IN THE CHANNEL with the same reply call as before, never in your final text.");
  assert.match(turn("CALL-B"), /: CALL-B\./, "a different call is shown");
  // A turn for another agent shows no call, so it records none: the next one still shows CALL-C.
  turn("CALL-C", { me: false, ids: ["z9y8x7w6"] });
  assert.match(turn("CALL-C"), /: CALL-C\./);
  // No memo (any caller that passes none): every turn is the full form, as before W5.
  assert.match(seed.frameContinuation("n1", "hi", "Dave", null, null, "granular", "CALL-A").split("\n").pop(), /: CALL-A\./);
});

// WHERE AN ANSWER GOES — the REPLY-ROUTING block (2026-08-31, Samuel's ruling).
//
// ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────
// A session has TWO inbound lanes and only ONE of them is visible to anybody but the operator:
//
//   CHANNEL   posts, which every member of the room and every watching agent can read.
//   PANEL     the operator's private 1:1 composer (`sessions:message` -> the reducer's `steer`),
//             rendered in the Dopl app's agent panel and on NO WIRE AT ALL.
//
// The framing has always said where to DELIVER; nothing said the two lanes were different. So an
// agent woken by a panel message answered in the panel — correct for "what are you doing?", and
// wrong for the channel work it was launched to do. Seen from the room, and seen over MCP, that
// agent produced nothing. It is the same class as the launch-goal defect this wave also closed:
// a real capability that was silently unreachable, with nothing anywhere saying so.
//
// ── WHAT THIS FILE PINS ──────────────────────────────────────────────────────────────────────
//  1. The block is BUILT INTO EVERY TURN — both sides, and both the id-present and the degraded
//     branch. The lane an answer leaves by is not a property of the side or of what ids the
//     launch knew, and the defect was FOUND on a responder.
//  2. The rule is keyed on the AUDIENCE, not on the lane the question arrived on. "Reply where
//     you were asked" is right for a question about the agent and wrong for the room's work.
//  3. It does NOT tell the agent to echo private exchanges into the room — that would be the
//     running commentary the sparseness rule forbids, bought by fixing the opposite problem.
//
// Run: `node --test dopl-desktop-app/test/prompt-reply-routing.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const { buildFencedTurn } = require(join(MAIN, "prompt-framing.js"));
const { REPLY_ROUTING } = require(join(MAIN, "prompt-framing-text.js"));

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const TASK = "cccccccc-3333-4ddd-8eee-ffffffffffff";

const ids = (over = {}) => ({
  channelName: "Ops",
  channelId: CH,
  workspaceId: WS,
  taskId: TASK,
  ...over,
});

const turn = (side, context) =>
  buildFencedTurn({ side, message: "do the thing", nonce: "n1", context });

test("ROUTING: the block rides EVERY built turn — both sides, ids or no ids", () => {
  // ⚠ ALL FOUR BRANCHES OF `deliverySection`. The defect is about the lane an answer LEAVES by,
  // which every one of them shares; putting the block on the requester branch alone would leave
  // a panel-woken responder answering into the invisible lane, which is where it was found.
  for (const side of ["requester", "responder"]) {
    for (const context of [ids(), ids({ channelId: null, workspaceId: null })]) {
      const out = turn(side, context);
      assert.ok(
        out.includes("WHERE YOUR ANSWER GOES IS DECIDED BY WHO IS WAITING FOR IT"),
        `${side} / ids=${!!context.channelId}: no routing block`,
      );
      for (const line of REPLY_ROUTING) {
        assert.ok(out.includes(line), `${side}: missing routing line ${JSON.stringify(line)}`);
      }
    }
  }
});

test("ROUTING: it names BOTH lanes and says the panel is invisible to everyone else", () => {
  // ⚠ The invisibility is the load-bearing fact. Without it an agent has no reason to think the
  // panel is a worse place for a result than the channel, and "reply where you were asked" —
  // which the law block also teaches — points it at the wrong one.
  const out = turn("requester", ids());
  assert.match(out, /TWO inbound lanes/);
  assert.match(out, /NOBODY ELSE CAN SEE THEM/);
});

test("ROUTING: CHANNEL WORK is answered into the CHANNEL, even when asked privately", () => {
  // The sentence the ruling is. The "even when your operator asked for it privately" clause is
  // the whole correction: without it the rule reads as "reply on the lane you were asked on",
  // which is the behaviour being fixed.
  const out = turn("responder", ids());
  assert.match(out, /CHANNEL WORK IS ANSWERED INTO THE CHANNEL/);
  assert.match(out, /even when your operator asked for it\s+privately/);
  // …and it says what the failure LOOKS like, because an agent cannot see the room it is not in.
  assert.match(out, /looks, to everyone else,\s+exactly like an agent that did nothing/);
});

test("ROUTING: the PANEL keeps a purpose — this is not 'post everything'", () => {
  // ⚠ THE OPPOSITE FAILURE, AND IT IS A REAL ONE. An agent that mirrored every private exchange
  // into the room would be the running commentary the sparseness rule forbids. The block must
  // leave the panel a job rather than deprecate it.
  const out = turn("requester", ids());
  assert.match(out, /THE PANEL IS FOR YOUR OPERATOR ALONE/);
  assert.match(out, /do not echo them into the channel/);
});

test("ROUTING: no em dash, house voice §H-13", () => {
  for (const line of REPLY_ROUTING) {
    assert.ok(!line.includes("—"), `em dash in ${JSON.stringify(line)}`);
  }
});

test("ROUTING: the block lives in the TEXT module, with the other fixed blocks", () => {
  // ⚠ Same seam as `PROSE_RULE` / `LANE_EXCLUSIVITY`: what the agent is TOLD changes on a
  // different clock from how a turn is ASSEMBLED, and a block inlined in `prompt-framing.js`
  // is one nobody finds when the copy is what needs correcting.
  const text = readFileSync(join(MAIN, "prompt-framing-text.js"), "utf8");
  assert.match(text, /const REPLY_ROUTING = \[/);
  assert.match(text, /REPLY_ROUTING };/, "and it is exported");
  const framing = readFileSync(join(MAIN, "prompt-framing.js"), "utf8");
  assert.match(framing, /REPLY_ROUTING \} = require\('\.\/prompt-framing-text'\)/);
  assert.equal(
    (framing.match(/\.\.\.REPLY_ROUTING,/g) || []).length,
    4,
    "spread on all FOUR delivery branches — a missing one is a lane that stays invisible",
  );
});

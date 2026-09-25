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
//  2. A message that ARRIVED in the channel is answered in the channel, the operator's own included
//     (2026-09-25). The 08-31 wording keyed on the audience ("anything the room does not need"), and
//     an agent filed its operator's channel ask as panel business: the reverse of the same defect.
//     Channel work asked for privately is still posted.
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

test("ROUTING: the block rides EVERY built turn, both sides, ids or no ids", () => {
  // ALL FOUR BRANCHES OF `deliverySection`: the lane an answer LEAVES by is shared by every one.
  for (const side of ["requester", "responder"]) {
    for (const context of [ids(), ids({ channelId: null, workspaceId: null })]) {
      const out = turn(side, context);
      for (const line of REPLY_ROUTING) {
        assert.ok(out.includes(line), `${side} / ids=${!!context.channelId}: missing ${JSON.stringify(line)}`);
      }
    }
  }
});

test("ROUTING: a CHANNEL message is answered in the CHANNEL, the operator's own included (2026-09-25)", () => {
  // The defect: "anything the room does not need" let an agent file its OPERATOR's channel ask as
  // panel business. The lane the message arrived on decides, whoever wrote it.
  const out = turn("requester", ids()).replace(/\s+/g, " ");
  assert.match(out, /A message that arrived IN THE CHANNEL is answered IN THE CHANNEL, by posting, including when it is from your operator\./);
  assert.match(out, /Your final text is not a post: nobody in the room sees it\./);
  assert.ok(!/anything the room does not need/.test(out), "the ambiguous clause is gone");
});

test("ROUTING: the PANEL keeps its job, private and never echoed", () => {
  const out = turn("responder", ids()).replace(/\s+/g, " ");
  assert.match(out, /The panel is only for turns your operator sent you privately in the panel, and for status about yourself they asked for there\./);
  assert.match(out, /NOBODY ELSE CAN SEE THOSE TURNS: do not echo them into the channel\./);
  // The 2026-08-31 correction survives: channel work asked for privately still lands in the room.
  assert.match(out, /Channel work they ask for there is still posted\./);
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
  assert.match(text, /module\.exports = \{[^}]*\bREPLY_ROUTING\b/, "and it is exported");
  const framing = readFileSync(join(MAIN, "prompt-framing.js"), "utf8");
  // ⚠ MATCHED INSIDE THE DESTRUCTURE, NOT AT ITS END (2026-09-07): the list grows, and a pin on
  // "REPLY_ROUTING is the last name before the brace" fails on the next block that joins it —
  // reporting a missing import that is right there.
  assert.match(framing, /const \{[^}]*\bREPLY_ROUTING\b[^}]*\} = require\('\.\/prompt-framing-text'\)/);
  // ⚠ ONE spread since 2026-09-25: `deliverySection` has a single return every side shares, so no
  // branch can drop the block (the first test drives all of them).
  assert.equal((framing.match(/\.\.\.REPLY_ROUTING\]/g) || []).length, 1, "spread once, on the shared return");
});

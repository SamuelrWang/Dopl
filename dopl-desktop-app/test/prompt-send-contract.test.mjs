// THE SEND CONTRACT INSIDE A SPAWNED TURN — `prompt-framing.js › deliverySection` and the
// `ADDRESSING` block it carries (2026-09-18, Samuel's structural ruling).
//
// ⚠ ITS OWN FILE for `addressing-framing.test.mjs`'s reason, stated there: `prompt-framing.test.mjs`
// stands within a few lines of the 500-line cap `test/**` is linted under, and the seam is real.
// That suite is about how a TURN IS ASSEMBLED; this one is about WHAT THE TURN PROMISES ABOUT THE
// SEND CALL — the argument name it teaches, and the two states a send may be in.
//
// ⚠ BOTH CASES HERE GUARD A SHIPPED STRING THAT WOULD TEACH A DEFECT IF IT WENT STALE:
//   · `container=` — `workspace=` is a deprecated alias published with NO description, and this
//     module is the one surface that could make a deprecation window permanent by re-teaching the
//     dead spelling on every spawn.
//   · ADDRESS-OR-RECORD — the structure is the MCP tool's refusal; this block is what stops an
//     agent learning it by being refused, and it carries the half the refusal cannot (that an
//     @handle in a BODY reaches no agent, while @-tagging a PERSON still works).
//
// `.mjs` (ESM) for the shared eslint config; `createRequire` loads the CJS module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildFencedTurn } = require(
  fileURLToPath(new URL("../main/prompt-framing.js", import.meta.url))
);

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const ids = (over = {}) => ({ channelName: "Ops", authorName: "Alice", channelId: CH, workspaceId: WS, ...over });

test("the ADDRESS ARGUMENT is `container`, never the deprecated `workspace` alias", () => {
  // ⚠ **2026-09-18.** `workspace=` is a DEPRECATED ALIAS kept for one release and published with
  // NO DESCRIPTION at all (`packages/mcp-server/src/workspace-arg.ts`), and a caller that sends it
  // gets a deprecation line back on every result. This module was teaching it to every channel
  // agent on every spawn, which is the one surface that can make a deprecation window permanent.
  // ⚠ THE VALUE IS UNCHANGED — `container` takes a slug, an id or `home`, and the id is what the
  // spawn context carries. Driven over BOTH sides, because the delivery section has four branches.
  for (const side of ["requester", "responder"]) {
    const out = buildFencedTurn({ side, message: "x", nonce: "n-c", context: ids() });
    assert.ok(out.includes(`container "${WS}"`), `${side}: the container argument`);
    assert.ok(!/workspace "/.test(out), `${side}: no deprecated alias anywhere in the turn`);
  }
});

test("the turn teaches ADDRESS-OR-RECORD, and that a body handle reaches no agent", () => {
  // ⚠ **THE STRUCTURE IS THE REFUSAL** (`channel-ops-write.js › unaddressedRefusal`); this block
  // is what stops an agent LEARNING it by being refused, which costs a round trip every time.
  // ⚠ AND IT CARRIES THE HALF THE REFUSAL CANNOT: an @handle in a BODY reaches no agent, while
  // @-tagging a PERSON still works. The two look identical on the page and only one still does
  // anything, so an agent told neither keeps writing handoffs into prose.
  // ⚠ ON EVERY DELIVERY BRANCH, on `REPLY_ROUTING`'s precedent (2026-08-31): the rule is about
  // what the agent WRITES, which every side and every id-availability case shares.
  for (const side of ["requester", "responder"]) {
    for (const context of [ids(), {}]) {
      const out = buildFencedTurn({ side, message: "x", nonce: "n-a", context });
      assert.ok(out.includes("EVERY MESSAGE YOU SEND IS ADDRESSED OR IT IS A RECORD"), `${side}`);
      assert.ok(out.includes('kind="record"'), `${side}: the second state, by name`);
      assert.ok(out.includes("AN @HANDLE IN YOUR BODY REACHES NO AGENT"), `${side}`);
      assert.ok(out.includes("comma separated"), `${side}: the list, not one name`);
    }
  }
});

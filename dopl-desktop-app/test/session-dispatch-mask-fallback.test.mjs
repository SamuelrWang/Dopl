// 🔒 THE BODY PARSE RUNS ONLY ON A ROW NO SERVER EVER RULED ON (2026-09-07).
//
// ⚠ WHAT THIS PINS, AND WHY IT IS NOT A STYLE FIX. The server resolves handles through
// `mentionTokensOf`, which MASKS code and markup (`src/features/channels/lib/mentions.ts`, rules 6
// and 7): a handle in backticks is quoted text and tags NOBODY. That rule was bought after two
// agents writing documentation ABOUT @-tagging put backticked handles in their bodies and tagged
// both operators for real (channel seqs 647 / 653, 2026-08-21). `session-dispatch.js ›
// mentionedAgentIds` masks nothing — it is a bare regex over the raw body — and it used to run
// whenever `recipientAgentIds` was absent. So a row the server DID rule on, but on which nothing
// resolved, fell through to the unmasked parse and a fenced handle woke an agent. The masks were
// bought once and this path quietly unbought them.
//
// ⚠ THE FIX IS A NARROWING AND NOT A SECOND MASKER, WHICH IS THE HALF WORTH REMEMBERING. Porting
// the masks into this tree is the obvious move and it is the drift `lib/mentions.ts` exists to
// forbid — the rule would live twice, in two languages. A row the server ruled on is ALREADY
// masked by the one parser; the only rows that need a local parse are the ones no current server
// wrote.
//
// ⚠ BOTH DIRECTIONS ARE PINNED ON PURPOSE. A narrowing that also killed the fallback's legitimate
// case would be a worse bug than the one it fixed, and it would look identical from the first
// test alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, agent, entry, peerMsg, verdictMsg, ME, A1 } from "./_wake-dispatch-harness.mjs";

// ⚠ THE HANDLE IS INSIDE BACKTICKS. This is the shape the masks exist for, and it is ordinary
// traffic in a room whose subject IS addressing: quote one live agent, name one that has stopped.
const FENCED = "see `@agent-a1b2c3d4` for the convention, and @agent-deadbee1 is gone";

test("a verdict-bearing row does NOT fall through to the unmasked parse", async () => {
  const h = harness({ agents: [agent(A1)] });
  // ⚠ `recipientAgentIds` ABSENT, verdict PRESENT — the server ran and could not name anybody.
  // `verdictMsg` defaults the key to `[]`, which is a DIFFERENT fact (an explicit "nobody"), so
  // this case builds the row by hand rather than overriding it into existence.
  const ruled = peerMsg({ wakeVerdict: "none", recipientUserIds: [], body: FENCED });
  await h.feedLiveSession(entry, ruled, ME);
  assert.deepEqual(
    h.calls.feedInbound.map((c) => c.agentId),
    [],
    "the fenced handle must wake nobody: the server already masked this body"
  );
});

test("an OLD row with no verdict still falls through — the fallback's real case survives", async () => {
  const h = harness({ agents: [agent(A1)] });
  await h.feedLiveSession(entry, peerMsg({ body: FENCED }), ME);
  assert.deepEqual(
    h.calls.feedInbound.map((c) => c.agentId),
    [A1],
    "no server ruled on this row, so this machine's own parse is all there is"
  );
  // ⚠ AND IT IS STILL THE UNMASKED PARSE ON THAT PATH, which is not a second defect: an old row
  // was never masked by anybody, so a local answer is strictly better than none. The narrowing
  // does not pretend to fix compatibility rows; it stops them being the excuse for current ones.
  assert.deepEqual(h.calls.feedInbound[0].addressing, { me: true, ids: [A1] });
});

test("a verdict-bearing row that NAMES an agent is unaffected", async () => {
  // The authoritative path, unchanged — the narrowing must not touch what the server did resolve.
  const h = harness({ agents: [agent(A1)] });
  await h.feedLiveSession(entry, verdictMsg("agent", { recipientAgentIds: [A1] }), ME);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
});

test("a verdict-bearing row with an explicit empty answer still names nobody", async () => {
  // `[]` and absent were always meant to be different facts; after the narrowing they finally
  // ROUTE the same, which is the point — both mean "the server answered, and it answered nobody".
  const h = harness({ agents: [agent(A1)] });
  await h.feedLiveSession(entry, verdictMsg("none", { body: FENCED }), ME);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), []);
});

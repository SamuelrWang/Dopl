// THE SESSION-DISPATCH ROUTING HARNESS — shared by `test/session-dispatch.test.mjs` (the
// delivery truth table) and `test/wake-routing.test.mjs` (the wake truth table).
//
// ⚠ ITS OWN FILE BECAUSE THERE ARE TWO TABLES AND ONE ROUTE (2026-08-28, the §2 500-line cap).
// Both files drive the SAME sliced `SESSION-DISPATCH-PURE` block with the SAME fakes; a copy in
// each would be two harnesses to keep in step, and the day they drifted one table would be
// measuring a route the app does not run. This is the `_ipc-harness.mjs` / `_reducer-block.mjs`
// idiom.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const SRC = readFileSync(join(HERE, "..", "main", "session-dispatch.js"), "utf8");

// ⚠ THE REAL SLUG RULE, NOT A FAKE (2026-08-28, F-350). The name door is a CONVENTION shared
// with the renderer, so a stub here would let the two trees drift and every table below
// would still pass. `handleIndexFor` takes its name resolver by argument, so the real module
// needs no electron and no disk.
const agentHandles = require(join(HERE, "..", "main", "agent-handles.js"));
// ⚠ THE REAL RECEIPT VOCABULARY (2026-09-02, A9) — `delivery-ack.js` is pure above its buffer,
// and `verdictFor` is the one place the four outcome words are ordered.
const realDeliveryAck = require(join(HERE, "..", "main", "delivery-ack.js"));

const BEGIN = "// \u2500\u2500\u2500 BEGIN SESSION-DISPATCH-PURE";
const END = "// \u2500\u2500\u2500 END SESSION-DISPATCH-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-DISPATCH-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-DISPATCH-PURE sentinel missing");
assert.ok(to > from, "session-dispatch sentinels out of order");
export const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-DISPATCH-PURE block must not reference ${banned}`);
}

// ⚠ THE CODE, WITHOUT THE PROSE. The source-level pins ask whether a deleted name still EXISTS in
// this module, and the module's header docblock names all four deleted routes and their
// window-mode gate on purpose — that record is the point of the docblock. Scanning raw SRC for
// them would therefore be permanently red against a correct file, which is the failure mode where
// somebody deletes the pin instead of the code.
export const CODE = SRC.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

export const ME = "me-user";
export const PEER = "peer-user";
export const TASK = "11111111-2222-3333-4444-555555555555";
export const A1 = "a1b2c3d4";
export const A2 = "z9y8x7w6";
export const A3 = "q1w2e3r4";

export const entry = { channel: { id: "c1", name: "General" }, workspaceId: "w1" };
// ⚠ **NO `wakeVerdict`, DELIBERATELY.** A row without one is what an OLD SERVER writes, and the
// machine answers it with its own body parse and the 2026-08-21 fan-out — so every case built on
// this fixture drives the COMPATIBILITY path. `verdictMsg` below is the narrowed one.
export const peerMsg = (over = {}) => ({ kind: "message", authorUserId: PEER, body: "reply body", taskId: TASK, seq: 7, meta: {}, ...over });

// A message carrying the server's stored resolution — the shape every current server writes.
// ⚠ `recipientAgentIds` DEFAULTS TO `[]`, NOT ABSENT: `[]` is the server ANSWERING "this body
// names no agent", and absent is it declining to answer. A fixture that blurred the two would
// let a narrowed case pass on the fallback path.
export const verdictMsg = (verdict, over = {}) => peerMsg({
  wakeVerdict: verdict, recipientUserIds: [], recipientAgentIds: [], ...over,
});

// A fresh harness per test: configurable fakes + recorded calls.
//
// ⚠ THREE INJECTIONS, NOT SEVEN. This used to plumb `settings`, `store` and `notifyLocal` in
// beside them, for routes (2), (3) and (5). The block binds none of the three any more, and a
// fake for a dependency the source has dropped is how a harness quietly keeps testing a
// product that is gone.
// `agents` is the LIVE ROSTER on the thread — the multiplayer shape. Each entry is a session
// object as the engine's registry holds one: an `agentId` and the `ownPostIds` Set that lets it
// recognise its own words coming back off the wire.
// ⚠ `key` IS ON THE FIXTURE BECAUSE THE RECEIPT NAMES IT (2026-09-02, review D3). The dispatch
// carries `s.key` onto every ack — it never composes one — and the server skips an ack whose
// key is not in this machine's own live set, so a fixture without it would drive a route that
// files nothing.
export const agent = (id, ownPostIds = []) => ({
  agentId: id, key: `c1:${TASK}:${id}`, ownPostIds: new Set(ownPostIds),
});

export function harness(over = {}) {
  const calls = { feedInbound: [], acks: [] };
  const cfg = {
    agents: [],
    feedInboundReturn: true,
    displayName: (id) => `name:${id}`,
    ...over,
  };
  const targeting = {
    firstClassTaskId: (m) => m.taskId || "",
  };
  // ⚠ TWO METHODS, NOT THREE (2026-09-02, B9). `agentIdsInChannel` was the CHANNEL-wide roster
  // count the deleted tier table picked a tier from; the route asks no such question now — who a
  // message is for is on the row — so a fake for it would be a fake for a call that is gone.
  const sessionEngine = {
    liveOnThread: () => cfg.agents,
    feedInbound: (a) => { calls.feedInbound.push(a); return cfg.feedInboundReturn; },
  };
  // 2026-08-01: the label a fed message is titled with is the AUTHOR's — a peer's AGENT posts
  // from the peer's account, so the account's display name is the wrong answer for it. The
  // resolver is `authorLabel`, INSIDE the sliced block, so it is the real one here rather
  // than a fake; only the account-name lookup under it is injected.
  const io = { displayNameFor: (id) => cfg.displayName(id) };
  // ⚠ HALF REAL, HALF RECORDER (2026-09-02, A9), and the split is the module's own seam.
  // `verdictFor` is PURE and is the ONE statement of how the four outcome words are ordered —
  // faking it would let these tables assert a word the app does not produce. `note` is a
  // RECORDER because the buffer holds MODULE state keyed by workspace, so a real one would
  // leak one case's receipts into the next. `delivery-ack.test.mjs` drives the buffer itself.
  const deliveryAck = {
    verdictFor: realDeliveryAck.verdictFor,
    note: (...a) => { calls.acks.push(a); return true; },
  };
  const api = new Function(
    "targeting", "sessionEngine", "io", "agentHandles", "deliveryAck", "diag",
    `${BLOCK}\n return { feedLiveSession, authorLabel, mentionedAgentIds, serverAddressed, serverNamesMember, storedVerdict, planFor, escalationAnswerAgentIds, addressingFor, mayFeed, mayWake, unwoken, dormant };`
  )(targeting, sessionEngine, io, agentHandles, deliveryAck, () => {});
  return { ...api, calls, cfg };
}


// ── THE DORMANT FIXTURES (2026-08-28) ────────────────────────────────────────
// ⚠ `agent()` CARRIES NEITHER FLAG, and that is what makes the delivery table honest: every case
// built on it drives the NOT-DORMANT path — the class no wake rule governs.
export const idle = (id, ownPostIds = []) => ({ ...agent(id, ownPostIds), awaitingDirective: true });
export const parked = (id, ownPostIds = []) => ({ ...agent(id, ownPostIds), state: { parked: true } });
export const authHeld = (id) => ({ ...agent(id), state: { parked: true, authHeld: true } });

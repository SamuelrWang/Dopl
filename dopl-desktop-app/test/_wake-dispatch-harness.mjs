// THE SESSION-DISPATCH ROUTING HARNESS — shared by `test/session-dispatch.test.mjs` (the fan-out
// truth table) and `test/wake-tier-routing.test.mjs` (the tiered-wake truth table).
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

// ⚠ THE REAL TIER MODULE, NOT A FAKE (2026-08-28). `session-wake-tiers.js` is pure — no electron,
// no I/O, no model — so the wake rule these tables drive is the SHIPPED rule. Only the model CALL
// (`session-triage.js › claim`) is injected, per test, because that is the one thing a unit test
// must not make. Faking the tier table instead would make the tables assert a rule they own.
const wakeTiers = require(join(HERE, "..", "main", "session-wake-tiers.js"));
// ⚠ THE REAL SLUG RULE, NOT A FAKE (2026-08-28, F-350). The name door is a CONVENTION shared
// with the renderer, so a stub here would let the two trees drift and every table below
// would still pass. `handleIndexFor` takes its name resolver by argument, so the real module
// needs no electron and no disk.
const agentHandles = require(join(HERE, "..", "main", "agent-handles.js"));

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
export const peerMsg = (over = {}) => ({ kind: "message", authorUserId: PEER, body: "reply body", taskId: TASK, seq: 7, meta: {}, ...over });

// A fresh harness per test: configurable fakes + recorded calls.
//
// ⚠ THREE INJECTIONS, NOT SEVEN. This used to plumb `settings`, `store` and `notifyLocal` in
// beside them, for routes (2), (3) and (5). The block binds none of the three any more, and a
// fake for a dependency the source has dropped is how a harness quietly keeps testing a
// product that is gone.
// `agents` is the LIVE ROSTER on the thread — the multiplayer shape. Each entry is a session
// object as the engine's registry holds one: an `agentId` and the `ownPostIds` Set that lets it
// recognise its own words coming back off the wire.
export const agent = (id, ownPostIds = []) => ({ agentId: id, ownPostIds: new Set(ownPostIds) });

export function harness(over = {}) {
  const calls = { feedInbound: [], triage: [] };
  const cfg = {
    agents: [],
    feedInboundReturn: true,
    displayName: (id) => `name:${id}`,
    // ⚠ THE CHANNEL ROSTER IS ITS OWN KNOB (2026-08-28). "How many agents are associated with the
    // CHANNEL" is what picks the tier, and it is a DIFFERENT question from "who is live on this
    // THREAD" (`agents`) — a channel-level agent and a threaded one both count toward it. Default:
    // whatever is on the thread, which is the ordinary single-thread case.
    channelAgents: null,
    // What the tier-3 router answers. `""` = nobody claimed.
    triageClaim: "",
    ...over,
  };
  const targeting = {
    firstClassTaskId: (m) => m.taskId || "",
  };
  const sessionEngine = {
    liveOnThread: () => cfg.agents,
    agentIdsInChannel: () => (cfg.channelAgents === null
      ? cfg.agents.map((a) => String(a.agentId || ""))
      : cfg.channelAgents),
    feedInbound: (a) => { calls.feedInbound.push(a); return cfg.feedInboundReturn; },
  };
  const sessionTriage = {
    claim: async (a) => { calls.triage.push(a); return cfg.triageClaim; },
  };
  // 2026-08-01: the label a fed message is titled with is the AUTHOR's — a peer's AGENT posts
  // from the peer's account, so the account's display name is the wrong answer for it. The
  // resolver is `authorLabel`, INSIDE the sliced block, so it is the real one here rather
  // than a fake; only the account-name lookup under it is injected.
  const io = { displayNameFor: (id) => cfg.displayName(id) };
  const api = new Function(
    "targeting", "sessionEngine", "io", "wakeTiers", "sessionTriage", "agentHandles", "diag",
    `${BLOCK}\n return { feedLiveSession, authorLabel, mentionedAgentIds, escalationAnswerAgentIds, addressingFor, mayFeed, unwoken, dormant, wakeCandidates };`
  )(targeting, sessionEngine, io, wakeTiers, sessionTriage, agentHandles, () => {});
  wakeTiers.resetForTests(); // the recent-message ring is module state; every harness starts cold
  return { ...api, calls, cfg };
}


// ── THE DORMANT FIXTURES (2026-08-28) ────────────────────────────────────────
// ⚠ `agent()` CARRIES NEITHER FLAG, and that is what makes the fan-out table honest: every case
// built on it drives the NOT-DORMANT path, i.e. ruling 4's fan-out, untouched by any tier.
export const idle = (id, ownPostIds = []) => ({ ...agent(id, ownPostIds), awaitingDirective: true });
export const parked = (id, ownPostIds = []) => ({ ...agent(id, ownPostIds), state: { parked: true } });
export const authHeld = (id) => ({ ...agent(id), state: { parked: true, authHeld: true } });

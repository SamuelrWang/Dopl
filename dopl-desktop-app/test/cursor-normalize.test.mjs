// THE CURSOR NORMALIZER, DRIVEN FROM RECORDED-SHAPE STREAM EVENTS.
//
// ⚠ THIS FILE IS THE ANSWER TO "NO LIVE INSTALLS". The port's locked decision (4) is that nothing
// was installed and every claim is read off open documentation, so the normalizer was written PURE
// — no I/O, no dispatch, no session, no clock — precisely so its whole surface can be driven from
// events. Each fixture below CITES the `cursor-research.md` section its shape comes from, and a
// correction from a live smoke test is a fixture edit rather than a rewrite.
//
// ⚠ AND THE TOLERANCE IS NOT DEFENSIVE HABIT, IT IS A DOCUMENTED INSTRUCTION. The research states
// that `tool_call.args` / `.result` are "internal-facing and may change" and that the SDK is
// public beta, and says in as many words that a Dopl tool card built on their shape needs a
// tolerant mapper and a plain fallback rendering. §5 item X3 is the volatility check. So the cases
// here drive that tolerance ON PURPOSE — including a garbage payload, which must still render a
// card rather than vanishing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CURSOR = join(HERE, "..", "main", "runtime", "cursor");
const normalize = require(join(CURSOR, "normalize.js"));
const mcp = require(join(CURSOR, "mcp.js"));

const CTX = { channelId: "chan-1", peerName: "Ada", peerId: "peer-1" };
const types = (out) => out.map((e) => e.type);
const run = (msg, ctx) => normalize.normalize(msg, ctx || CTX);

// ── FIXTURES ─────────────────────────────────────────────────────────────────────────────────
// Each key names the research section the SHAPE is derived from.

// §"Capability table" / Session resume — the agent handle arrives as the RESULT of
// `Agent.create()`, not as a stream event, so `launch-spec.js` mints this `dopl/`-namespaced
// frame from it. Namespaced so nobody reads it as protocol.
const AGENT_CREATED = {
  type: normalize.AGENT_CREATED, agentId: "ag_01H", model: "composer-2.5",
};

// §"Streaming output" — "Events: `system`, `user`, `assistant`, `thinking`, `tool_call`
// (running/completed/error), `status`, `task`, `usage`, `request`."
const ASSISTANT = { type: "assistant", text: "Looking at the failing test now." };
const THINKING = { type: "thinking", thinking: "The stack points at the reducer." };
const TOOL_RUNNING = {
  type: "tool_call", call_id: "tc_2", name: "shell", status: "running", args: { command: "npm test" },
};
const TOOL_DONE = {
  type: "tool_call", call_id: "tc_2", name: "shell", status: "completed", result: "18 passing",
};
const TOOL_FAILED = {
  type: "tool_call", call_id: "tc_2", name: "shell", status: "error", result: "exit 1",
};

// §"Context / token metering" — `TokenUsage` per turn: `inputTokens`, `outputTokens`,
// `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`, `reasoningTokens`.
const USAGE = {
  type: "usage",
  usage: { inputTokens: 41000, cacheReadTokens: 9000, outputTokens: 1200, totalTokens: 51200 },
};

// The synthetic turn frame. ⚠ §"Context / token metering" again for the COST half:
// `agent.getUsage()` -> `{rawCostCents, chargedCents}` — a CALL, not a stream event, which is the
// whole reason this frame exists.
const TURN_DONE = {
  type: normalize.TURN_COMPLETED,
  model: "composer-2.5",
  usage: { inputTokens: 41000, cacheReadTokens: 9000, outputTokens: 1200, totalTokens: 51200 },
  cost: { rawCostCents: 812, chargedCents: 640 },
};

// §"Custom tools" — Dopl's own channel op, arriving as a `tool_call` because `customTools` are
// "registered as a built-in `custom-user-tools` MCP server". The bare short name is what our
// server registers; `main/mcp-tool-names.js` canonicalises it.
const POST_RUNNING = {
  type: "tool_call", call_id: "tc_3", name: "dopl_channel", status: "running",
  args: { op: "post", body: "done" },
};

test("an agent creation becomes `launched`, and it carries the handle every resume depends on", () => {
  const out = run(AGENT_CREATED);
  assert.deepEqual(types(out), ["launched"]);
  assert.equal(out[0].sessionId, "ag_01H");
  assert.equal(out[0].model, "composer-2.5");
});

test("an assistant turn and a thinking block render; an unknown event renders nothing", () => {
  assert.deepEqual(types(run(ASSISTANT)), ["assistant"]);
  assert.equal(run(ASSISTANT)[0].payload.text, "Looking at the failing test now.");
  assert.deepEqual(types(run(THINKING)), ["thinking"]);
  for (const ev of [{ type: "system" }, { type: "status", status: "running" }, { type: "task" }, { type: "user" }]) {
    assert.deepEqual(run(ev), [], ev.type);
  }
});

test("a tool call paints a card on `running` and fills it on `completed`", () => {
  const started = run(TOOL_RUNNING);
  assert.deepEqual(types(started), ["tool_use"]);
  assert.equal(started[0].payload.toolUseId, "tc_2");
  assert.equal(started[0].payload.name, "shell");
  const done = run(TOOL_DONE);
  assert.deepEqual(types(done), ["tool_result"]);
  assert.equal(done[0].payload.toolUseId, "tc_2", "the fill must join the card it fills");
  assert.equal(done[0].payload.ok, true);
});

test("a FAILED call reports ok:false — and an UNRECOGNISED status reads as success", () => {
  assert.equal(run(TOOL_FAILED)[0].payload.ok, false);
  // ⚠ THE DEFAULT DIRECTION MATTERS. A false negative retracts an `outbound_post` the operator
  // already watched leave (the reducer un-counts a post on a failing result), so claiming a
  // delivered message failed is worse than missing a failure. And the research warns these shapes
  // move, so an unfamiliar status is exactly the case that will happen.
  const odd = { type: "tool_call", call_id: "tc_9", name: "shell", status: "finished-somehow" };
  assert.equal(run(odd)[0].payload.ok, true);
});

test("a finished turn meters TOKENS and reports the CHARGED cost, never the raw one", () => {
  const out = run(TURN_DONE);
  assert.deepEqual(types(out), ["context", "result"]);
  // The window occupancy is the PROMPT half (input + cached read), not the whole turn.
  assert.equal(out[0].tokens, 50000);
  assert.equal(out[1].sessionTokens, 51200);
  // ⚠ `chargedCents`, NOT `rawCostCents`. The cost cap is a BUDGET control — it answers "how much
  // has this operator spent" — and raw is the pre-plan figure, which would trip a cap over money
  // nobody paid.
  assert.equal(out[1].costUsd, 6.4);
  // …and raw is the fallback only when charged is absent, so a build reporting one still meters.
  const rawOnly = run({ ...TURN_DONE, cost: { rawCostCents: 812 } });
  assert.equal(rawOnly[1].costUsd, 8.12);
});

test("…and a cost this platform did not report is NULL, never 0", () => {
  // ⚠ A ZERO IS A BUDGET THAT NEVER TRIPS. `main/session-state.js › costCapReached` is fed by
  // exactly one number, and this runtime is the one whose cap can really fire — so a failed
  // `getUsage()` must read as unmeasured rather than as free.
  for (const cost of [null, undefined, {}, { chargedCents: "640" }, { chargedCents: -1 }]) {
    const out = run({ ...TURN_DONE, cost });
    assert.equal(out[1].costUsd, null, JSON.stringify(cost));
  }
  const empty = run({ type: normalize.TURN_COMPLETED });
  assert.deepEqual(types(empty), ["result"], "no usage at all paints no context row");
  assert.equal(empty[0].sessionTokens, 0);
});

test("a bare `usage` event meters the window without ending a turn", () => {
  const out = run(USAGE);
  assert.deepEqual(types(out), ["context"]);
  assert.equal(out[0].tokens, 50000);
  // ⚠ THE SNAKE_CASE SPELLINGS ARE BELT FOR A BETA SDK, not a guess dressed as a measurement: the
  // camelCase names are the ones the research prints.
  const snake = run({ type: "usage", usage: { input_tokens: 2000, output_tokens: 100 } });
  assert.equal(snake[0].tokens, 2000);
});

test("an own-channel post becomes ONE outbound_post, and the generic tool card is suppressed", () => {
  const out = run(POST_RUNNING);
  assert.deepEqual(types(out), ["outbound_post"], "a sent message must never double-render");
  assert.equal(out[0].payload.text, "done");
  // v2.7 L3: the SAME call becomes the inline Send / Deny card while it waits.
  const gated = run(POST_RUNNING, { ...CTX, willGatePost: () => true });
  assert.equal(gated[0].payload.pending, true);
  assert.equal(gated[0].payload.ownChannel, true);
  // ⚠ IT IS A BOOLEAN, NEVER ANOTHER CHANNEL'S ID (§H-9), and a CROSS-channel post is not an
  // own-channel send — it is the exfil shape and renders as a plain tool card.
  const other = run({ ...POST_RUNNING, call_id: "tc_4", args: { op: "post", channel: "other", body: "x" } });
  assert.deepEqual(types(other), ["tool_use"]);
});

test("an event shape nobody recognises still renders a PLAIN CARD rather than vanishing", () => {
  // ⚠ THE TOLERANCE CASE, AND IT IS THE POINT OF THE WHOLE PARSER. The payloads are documented as
  // liable to change, so a shape a later SDK adds must degrade to a thin card — a session that
  // looks like it did NOTHING between two turns is a worse failure than a card with a poor summary.
  const weird = { type: "tool_call", callId: "tc_9", blob: { a: 1 } };
  const out = run(weird);
  assert.deepEqual(types(out), ["tool_use"]);
  assert.equal(out[0].payload.name, "unknown");
  // Only a call with NO ID is dropped — a card that can never be filled by its own result.
  assert.deepEqual(run({ type: "tool_call", name: "x", status: "running" }), []);
  assert.deepEqual(run({ type: "who/knows" }), []);
  assert.deepEqual(run(null), []);
  assert.deepEqual(run({}), []);
});

test("a `request` event renders NOTHING, because there is nothing an operator could answer", () => {
  // ⚠ §5 ITEM X1, AND ITS REAL STAKE IS LIVENESS RATHER THAN A MISSING CONTROL. The event is
  // documented as "awaiting approval" WITH NO RESPONDER API, so a card for it could never be
  // resolved. What that means in practice is that a run mode which ASKS has nobody to ask, and the
  // turn stalls — which is why `toolMode.windowlessFloor` raising every unattended session to
  // `auto-review` is load-bearing for liveness here and not only for reach.
  assert.deepEqual(run({ type: "request", request_id: "rq_1" }), []);
});

test("an AUTH-SHAPED rejection holds the session; every other error renders nothing", () => {
  // ⚠ IT SHORT-CIRCUITS THE CONSUME LOOP: core stops reading, parks the session and swaps the
  // dead-end bubble for the credential path. Emitting render events beside it would paint the very
  // bubble the hold exists to replace.
  for (const text of [
    "401 Unauthorized",
    "You are not logged in. Run `cursor-agent login`.",
    "authentication failed",
    "invalid api key",
    "CURSOR_API_KEY is not set",
  ]) {
    const out = run({ type: "error", text });
    assert.deepEqual(types(out), ["auth_hold"], text);
    assert.equal(out[0].text, text, "the platform's OWN sentence is carried, never a rewrite");
  }
  assert.deepEqual(run({ type: "error", text: "ECONNRESET" }), [],
    "a transport failure is a crash, not a credential problem");
});

// ── THE DOPL FORWARD ─────────────────────────────────────────────────────────────────────────
//
// ⚠ THE HALF NO OTHER ADAPTER HAS. `mcp.sessionTransport` is `in-process`, so an allowed
// `execute()` has to reach `packages/mcp-server` itself. Streamable HTTP lets a server answer one
// POST with either `application/json` or an SSE stream, and a client that handles one shape works
// in development and fails in production, or the reverse.

test("the Streamable HTTP reader parses BOTH answer shapes and drops neither", () => {
  const frame = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
  assert.deepEqual(mcp.parseSse(`event: message\ndata: ${JSON.stringify(frame)}\n\n`), frame);
  // A keep-alive comment and a blank data line contribute nothing rather than throwing.
  assert.equal(mcp.parseSse(": keep-alive\n\ndata:\n\n"), null);
  // ⚠ THE LAST FRAME WINS, which is what a stream carrying a progress notification before its
  // result requires — reading the FIRST one would answer a call with somebody's progress update.
  const first = { jsonrpc: "2.0", method: "notifications/progress" };
  assert.deepEqual(
    mcp.parseSse(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(frame)}\n\n`),
    frame
  );
});

test("the protocol version this client is built against is the one the server ships", () => {
  // ⚠ NO SHARED MODULE ACROSS THIS JOIN — main is CommonJS Electron and the server is the
  // `@modelcontextprotocol/sdk` package — so the two agree by literal or not at all. This is the
  // only version check a path-delivered runtime has: `packaging.versionPin` is null by design, and
  // unlike the other native runtime there is no `initialize` handshake against a pinned binary.
  const src = readFileSync(require.resolve("@modelcontextprotocol/sdk/types.js"), "utf8");
  const hit = /LATEST_PROTOCOL_VERSION = ['"]([^'"]+)['"]/.exec(src);
  assert.ok(hit, "the SDK's version constant moved — this join needs re-pinning");
  assert.equal(mcp.PROTOCOL_VERSION, hit[1],
    "this client advertises a protocol revision the bundled MCP SDK does not speak");
});

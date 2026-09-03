// THE CODEX NORMALIZER, DRIVEN FROM RECORDED-SHAPE JSON-RPC FIXTURES.
//
// ⚠ THIS FILE IS THE ANSWER TO "NO LIVE INSTALLS". The port's locked decision (4) is that nothing
// was installed and every claim is read off open source, so the normalizer was written PURE — no
// I/O, no dispatch, no session, no clock — precisely so its whole surface can be driven from
// frames. Each fixture below CITES the `codex-research.md` section its shape comes from, and a
// correction from a live smoke test is a fixture edit rather than a rewrite.
//
// ⚠ AND THE SHAPES ARE SYNTHETIC, WHICH IS SAID OUT LOUD RATHER THAN IMPLIED. The research
// documents the METHOD NAMES and what they CONTAIN; it does not print a payload. `codex-research.md`
// §5 lists the exact approval and item payloads as the first thing to capture against a live
// app-server (§5 items C2, C12). So every reader in `normalize.js` is deliberately TOLERANT across
// the plausible spellings, and the cases here drive that tolerance ON PURPOSE — including a
// garbage payload, which must still render a card rather than vanishing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const normalize = require(join(CODEX, "normalize.js"));
const client = require(join(CODEX, "client.js"));

const CTX = { channelId: "chan-1", peerName: "Ada", peerId: "peer-1" };
const types = (out) => out.map((e) => e.type);

// ── FIXTURES ─────────────────────────────────────────────────────────────────────────────────
// Each key names the research section the SHAPE is derived from.

// §1 "Session: thread/start …" — the thread id arrives as the RESULT of `thread/start`, not as a
// notification, so `launch-spec.js` mints this `dopl/`-namespaced frame from it. Namespaced so
// nobody reads it as protocol.
const THREAD_STARTED = {
  method: normalize.THREAD_STARTED,
  params: { threadId: "th_01H", model: "gpt-5.6-terra" },
};

// §1 "Streamed notifications: … item/started, item/completed" + §1 primitives "Thread -> Turn ->
// Item". The item TYPE words are the ones the approval-request methods use
// (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`).
const MESSAGE_STARTED = { method: "item/started", params: { item: { id: "it_1", type: "agentMessage" } } };
const MESSAGE_DONE = {
  method: "item/completed",
  params: { item: { id: "it_1", type: "agentMessage", text: "Looking at the failing test now." } },
};
const COMMAND_STARTED = {
  method: "item/started",
  params: { item: { id: "it_2", type: "commandExecution", command: { command: "npm test" } } },
};
const COMMAND_DONE = {
  method: "item/completed",
  params: { item: { id: "it_2", type: "commandExecution", status: "completed", output: "18 passing" } },
};
const COMMAND_FAILED = {
  method: "item/completed",
  params: { item: { id: "it_2", type: "commandExecution", status: "failed", output: "exit 1" } },
};

// §1 "item/agentMessage/delta (token streaming), item/commandExecution/outputDelta".
const MESSAGE_DELTA = { method: "item/agentMessage/delta", params: { itemId: "it_1", delta: "Look" } };
const OUTPUT_DELTA = { method: "item/commandExecution/outputDelta", params: { itemId: "it_2", delta: "18 pass" } };

// §3 "Context / token metering — `usage` on `turn.completed` … per-turn, not a live running
// meter"; §3 "usage on turn/completed is tokens" and NO USD figure anywhere (§5 item C11).
const TURN_DONE = {
  method: "turn/completed",
  params: { status: "completed", model: "gpt-5.6-terra", usage: { input_tokens: 41000, cached_input_tokens: 9000, output_tokens: 1200, total_tokens: 51200 } },
};
// §5 item C12 — the field breakdown is unmeasured, so a payload spelled another way must still
// meter rather than reading as zero.
const TURN_DONE_CAMEL = {
  method: "turn/completed",
  params: { usage: { promptTokens: 2000, completionTokens: 100 } },
};

// §1 "an MCP tool call" — Dopl's own channel tool, arriving as an item. The bare short name is
// what our server registers; `main/mcp-tool-names.js` canonicalises it.
const POST_STARTED = {
  method: "item/started",
  params: { item: { id: "it_3", type: "mcpToolCall", name: "dopl_channel", arguments: { op: "send", body: "done" } } },
};

test("a thread start becomes `launched`, and it carries the handle every resume depends on", () => {
  const out = normalize.normalize(THREAD_STARTED, CTX);
  assert.deepEqual(types(out), ["launched"]);
  assert.equal(out[0].sessionId, "th_01H");
  assert.equal(out[0].model, "gpt-5.6-terra");
});

test("an agent message renders on COMPLETION, and its `started` renders nothing", () => {
  // ⚠ THE STARTED FRAME FOR A MESSAGE MUST NOT PAINT A TOOL CARD — an assistant turn is not a tool
  // call, and rendering both would double every message in the stream.
  assert.deepEqual(normalize.normalize(MESSAGE_STARTED, CTX), []);
  const out = normalize.normalize(MESSAGE_DONE, CTX);
  assert.deepEqual(types(out), ["assistant"]);
  assert.equal(out[0].payload.text, "Looking at the failing test now.");
});

test("a command execution paints a card on `started` and fills it on `completed`", () => {
  const started = normalize.normalize(COMMAND_STARTED, CTX);
  assert.deepEqual(types(started), ["tool_use"]);
  assert.equal(started[0].payload.toolUseId, "it_2");
  assert.equal(started[0].payload.name, "commandExecution");
  const done = normalize.normalize(COMMAND_DONE, CTX);
  assert.deepEqual(types(done), ["tool_result"]);
  assert.equal(done[0].payload.toolUseId, "it_2", "the fill must join the card it fills");
  assert.equal(done[0].payload.ok, true);
});

test("a FAILED item reports ok:false — and a SILENT one reads as success", () => {
  assert.equal(normalize.normalize(COMMAND_FAILED, CTX)[0].payload.ok, false);
  // ⚠ THE DEFAULT DIRECTION MATTERS. A false negative retracts an `outbound_post` the operator
  // already watched leave (the reducer un-counts a post on a failing result), so claiming a
  // delivered message failed is worse than missing a failure.
  const silent = { method: "item/completed", params: { item: { id: "x", type: "commandExecution" } } };
  assert.equal(normalize.normalize(silent, CTX)[0].payload.ok, true);
});

test("both DELTA streams are dropped — the outbound card must never be painted from a partial", () => {
  // ⚠ THE TWIN OF THE CLAUDE LANE'S `includePartialMessages: false`, AND IT IS LOAD-BEARING FOR
  // THE SAME REASON: the consent card shows the operator the bytes a post will send, so a streamed
  // tool input must never be what it is painted from. Acting on deltas would also double-render
  // every message.
  assert.deepEqual(normalize.normalize(MESSAGE_DELTA, CTX), []);
  assert.deepEqual(normalize.normalize(OUTPUT_DELTA, CTX), []);
  assert.deepEqual(normalize.normalize({ method: "turn/started", params: {} }, CTX), []);
});

test("a finished turn meters TOKENS and reports NO COST — the cap is hidden, never zeroed", () => {
  const out = normalize.normalize(TURN_DONE, CTX);
  assert.deepEqual(types(out), ["context", "result"]);
  // The window occupancy is the PROMPT half (input + cached input), not the whole turn.
  assert.equal(out[0].tokens, 50000);
  assert.equal(out[1].sessionTokens, 51200);
  // ⚠ NULL, NOT 0. `main/session-state.js › costCapReached` is fed by exactly one number, and a
  // zero is a budget that never trips. `total_cost_usd` is the OTHER runtime's field; nothing in
  // the research says Codex reports a USD cost at all (§5 item C11).
  assert.equal(out[1].costUsd, null, "a cost this platform does not emit must never become 0");
});

test("…and an unmeasured usage spelling still meters rather than reading as zero", () => {
  const out = normalize.normalize(TURN_DONE_CAMEL, CTX);
  assert.equal(out[0].tokens, 2000);
  assert.equal(out[1].sessionTokens, 2100, "no `total`, so the parts are summed");
  const empty = normalize.normalize({ method: "turn/completed", params: {} }, CTX);
  assert.deepEqual(types(empty), ["result"], "no usage at all paints no context row");
  assert.equal(empty[0].sessionTokens, 0);
});

test("an own-channel post becomes ONE outbound_post, and the generic tool card is suppressed", () => {
  const out = normalize.normalize(POST_STARTED, CTX);
  assert.deepEqual(types(out), ["outbound_post"], "a sent message must never double-render");
  assert.equal(out[0].payload.text, "done");
  // v2.7 L3: the SAME item becomes the inline Send / Deny card while it waits.
  const gated = normalize.normalize(POST_STARTED, { ...CTX, willGatePost: () => true });
  assert.equal(gated[0].payload.pending, true);
  assert.equal(gated[0].payload.ownChannel, true);
  // ⚠ IT IS A BOOLEAN, NEVER ANOTHER CHANNEL'S ID (§H-9).
  const other = normalize.normalize(
    { method: "item/started", params: { item: { id: "it_4", type: "mcpToolCall", name: "dopl_channel", arguments: { op: "send", channel: "other", body: "x" } } } },
    CTX
  );
  assert.deepEqual(types(other), ["tool_use"], "a CROSS-channel post is not an own-channel send");
});

test("an item shape nobody recognises still renders a PLAIN CARD rather than vanishing", () => {
  // ⚠ THE TOLERANCE CASE, AND IT IS THE POINT OF THE WHOLE PARSER. The payloads are §5-unverified,
  // so a shape a later CLI adds must degrade to a thin card — a session that looks like it did
  // NOTHING between two turns is a worse failure than a card with a poor summary.
  const weird = { method: "item/started", params: { item: { id: "it_9", type: "somethingNew", blob: { a: 1 } } } };
  const out = normalize.normalize(weird, CTX);
  assert.deepEqual(types(out), ["tool_use"]);
  assert.equal(out[0].payload.name, "somethingNew");
  // Only an item with NO ID is dropped — a card that can never be filled by its own result.
  assert.deepEqual(normalize.normalize({ method: "item/started", params: { item: { type: "x" } } }, CTX), []);
  assert.deepEqual(normalize.normalize({ method: "who/knows", params: {} }, CTX), []);
  assert.deepEqual(normalize.normalize(null, CTX), []);
  assert.deepEqual(normalize.normalize({}, CTX), []);
});

test("an AUTH-SHAPED rejection holds the session; every other error renders nothing", () => {
  // ⚠ IT SHORT-CIRCUITS THE CONSUME LOOP: core stops reading, parks the session and swaps the
  // dead-end bubble for the credential path. Emitting render events beside it would paint the very
  // bubble the hold exists to replace.
  for (const text of [
    "401 Unauthorized",
    "You are not logged in. Run `codex login`.",
    "authentication failed",
    "invalid api key",
  ]) {
    const out = normalize.normalize({ type: "error", text }, CTX);
    assert.deepEqual(types(out), ["auth_hold"], text);
    assert.equal(out[0].text, text, "the platform's OWN sentence is carried, never a rewrite");
  }
  assert.deepEqual(normalize.normalize({ type: "error", text: "ECONNRESET" }, CTX), [],
    "a transport failure is a crash, not a credential problem");
});

test("the JSON-RPC line framing survives split chunks, and drops nothing it received whole", () => {
  // ⚠ `item/commandExecution/outputDelta` STREAMS COMMAND STDOUT, so a frame can arrive in pieces
  // and a single line can be large. Splitting on `\n` and parsing per line is what the protocol
  // specifies; a reader that assumed one chunk per frame would silently lose events under load.
  const seen = [];
  const feed = client.makeLineReader((line) => seen.push(line));
  feed('{"a":1}\n{"b":');
  assert.deepEqual(seen, ['{"a":1}'], "a half-line is buffered, never emitted");
  feed('2}\n\n  \n{"c":3}\n');
  assert.deepEqual(seen, ['{"a":1}', '{"b":2}', '{"c":3}'], "blank lines contribute nothing");
});

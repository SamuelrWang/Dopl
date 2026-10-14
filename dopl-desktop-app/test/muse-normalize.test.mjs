// The Muse normalizer over REAL frames: Dopl's own `muse serve` 1.4.7 echo recording and Meta's MSP
// conformance transcripts, frame by frame through `normalize.js` (pure).

import { test } from "node:test";
import assert from "node:assert/strict";
import { notifications, m } from "./_muse-harness.mjs";

const { normalize, SESSION_STARTED, ERROR_MESSAGE_TYPE } = m("normalize.js");
const all = (frames) => frames.flatMap((f) => normalize(f, {}));
const types = (evs) => evs.map((e) => e.type);

test("echo-turn (real 1.4.7): the agent message is the one assistant line; user echo and observer children render nothing", () => {
  const evs = all(notifications("echo-turn-1.4.7.ndjson"));
  const said = evs.filter((e) => e.type === "assistant").map((e) => e.payload.text);
  assert.deepEqual(said, ["echo: hello"]);
  assert.ok(!evs.some((e) => e.type === "tool_use" || e.type === "tool_result"), "reminderChild / userMessage are not tool cards");
  // A raw `turn/completed` (no launch-spec enrichment) carries no usage: the result is UNMEASURED, never 0.
  const r = evs.filter((e) => e.type === "result");
  assert.equal(r.length, 1);
  assert.equal(r[0].sessionTokens, null);
});

test("the launch frame carries the session id and model into `launched`", () => {
  const [ev] = normalize({ method: SESSION_STARTED, params: { sessionId: "s-1", model: "muse-spark" } }, {});
  assert.equal(ev.type, "launched");
  assert.equal(ev.sessionId, "s-1");
  assert.equal(ev.model, "muse-spark");
});

test("approval-round-trip: a toolCall opens a tool card on start and completes it ok", () => {
  const evs = all(notifications("meta/approval-round-trip.ndjson"));
  const use = evs.find((e) => e.type === "tool_use");
  const done = evs.find((e) => e.type === "tool_result");
  assert.ok(use && done, `got ${types(evs).join(",")}`);
  assert.equal(use.payload.toolUseId, done.payload.toolUseId);
  assert.equal(done.payload.ok, true);
});

test("cancel-mid-turn: a cancelled tool is NOT ok, and the cancelled turn still ends with a result", () => {
  const evs = all(notifications("meta/cancel-mid-turn.ndjson"));
  assert.equal(evs.find((e) => e.type === "tool_result").payload.ok, false);
  assert.equal(evs.filter((e) => e.type === "result").length, 1);
});

test("provider-failure-turn: a failed turn says so in the lane, then the retry's answer renders", () => {
  const evs = all(notifications("meta/provider-failure-turn.ndjson"));
  const said = evs.filter((e) => e.type === "assistant").map((e) => e.payload.text);
  assert.match(said[0], /^Muse could not finish this turn: model failed after 3 attempts/);
  assert.equal(said[1], "Two tests fail in tbh-agent: both in the retry ladder.");
  assert.equal(evs.filter((e) => e.type === "result").length, 2);
  assert.ok(!evs.some((e) => e.type === "auth_hold"), "a 503 is not a sign-in problem");
});

test("tolerance: an unknown item kind is drift (once, named), never a crash or a silent drop", () => {
  const evs = all(notifications("meta/tolerance-unknown-item-kind.ndjson"));
  const drift = evs.filter((e) => e.type === "shape_drift");
  assert.equal(drift.length, 1);
  assert.match(drift[0].where || JSON.stringify(drift[0]), /hologramPreview/);
});

test("tolerance: unknown notifications and stream kinds never throw", () => {
  for (const f of ["meta/tolerance-unknown-state-method.ndjson", "meta/tolerance-unknown-stream-kind.ndjson", "meta/text-run-single-turn.ndjson"]) {
    assert.doesNotThrow(() => all(notifications(f)), f);
  }
  const said = all(notifications("meta/text-run-single-turn.ndjson")).filter((e) => e.type === "assistant");
  assert.equal(said.length, 1, "deltas never render; the completed block does, once");
});

test("authRequired is an auth hold, and it returns ALONE (no failure line beside it)", () => {
  const evs = normalize({ method: "turn/completed", params: { turnId: "t", terminal: "failed", error: { kind: "authRequired", message: "Sign in with muse login", retryable: false } } }, {});
  assert.deepEqual(types(evs), ["auth_hold"]);
});

test("a required Dopl MCP server that failed to start (measured configError) is Dopl's tools not connecting", () => {
  const msg = "invalid run configuration: Required MCP server `dopl_session` failed during startup: the process could not be started or the server could not be reached.";
  const evs = normalize({ method: "turn/completed", params: { turnId: "t", terminal: "failed", error: { kind: "configError", message: msg, retryable: false } } }, {});
  assert.deepEqual(types(evs), ["assistant", "mcp_status_report", "result"]);
  assert.match(evs[0].payload.text, /Dopl's tools did not connect/);
});

test("usage: the session's CUMULATIVE total is the result; context comes from contextUsage; zero used = no context event", () => {
  const evs = normalize({ method: "turn/completed", params: {
    turnId: "t", terminal: "completed", model: "muse-spark",
    cumulative: { promptTokens: 9000, outputTokens: 400, totalTokens: 9400 }, contextUsed: 9400, contextWindow: 262144,
  } }, {});
  const ctx = evs.find((e) => e.type === "context");
  assert.equal(ctx.tokens, 9400);
  assert.equal(ctx.window, 262144);
  assert.equal(evs.find((e) => e.type === "result").sessionTokens, 9400);
  const none = normalize({ method: "turn/completed", params: { turnId: "t", terminal: "completed", cumulative: { promptTokens: 0, outputTokens: 0, totalTokens: 0 }, contextUsed: 0 } }, {});
  assert.ok(!none.some((e) => e.type === "context"));
  assert.equal(none.find((e) => e.type === "result").sessionTokens, 0, "echo's measured zero is a measurement");
});

test("an unreadable cumulative block is NULL plus a drift note — never a confident zero", () => {
  const evs = normalize({ method: "turn/completed", params: { turnId: "t", terminal: "completed", cumulative: { total: "lots" } } }, {});
  assert.equal(evs.find((e) => e.type === "result").sessionTokens, null);
  assert.ok(evs.some((e) => e.type === "shape_drift"));
});

test("core's rejection frame: auth-shaped text (incl. META_API_KEY) holds; anything else renders nothing", () => {
  assert.deepEqual(types(normalize({ type: ERROR_MESSAGE_TYPE, text: "META_API_KEY is invalid" }, {})), ["auth_hold"]);
  assert.deepEqual(normalize({ type: ERROR_MESSAGE_TYPE, text: "pipe closed" }, {}), []);
});

test("reasoning renders as thinking from its summary parts", () => {
  const [ev] = normalize({ method: "item/completed", params: { item: { itemId: "r", kind: "reasoning", status: "completed", summary: ["a", "b"] } } }, {});
  assert.equal(ev.type, "thinking");
  assert.equal(ev.payload.text, "a\nb");
});

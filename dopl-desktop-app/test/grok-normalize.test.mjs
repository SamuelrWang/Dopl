// Grok's normalizer over the REAL grok 1.0.52 recordings (`fixtures/grok/smoke-*.ndjson`): tool cards with
// `use_tool` unwrapped to the Dopl tool it dispatches, results, hook denials as failures, the synthetic
// prompt-result frame's usage/context, auth, Dopl's MCP server status, and nothing rendered from chatter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { g, notifications } from "./_grok-harness.mjs";

const n = g("normalize.js");
const updates = (name, kind) => notifications(name).filter((m) => m.method === "session/update" && m.params.update.sessionUpdate === kind);

test("a recorded Dopl MCP call renders under its REAL name (mcp__dopl_session__…), never `use_tool`", () => {
  const calls = updates("smoke-s1-modes.ndjson", "tool_call");
  const names = calls.map((m) => n.toolCallOf(m.params.update).name);
  assert.ok(names.includes("mcp__dopl_session__read_channel"), names.join(","));
  assert.ok(names.includes("mcp__dopl_session__post_message"));
  assert.ok(names.includes("search_tool"));
  assert.ok(!names.includes("use_tool"), "the dispatcher is unwrapped");
  const post = calls.find((m) => n.toolCallOf(m.params.update).name === "mcp__dopl_session__post_message");
  assert.deepEqual(n.toolCallOf(post.params.update).input, { text: "smoke" });
  const evs = n.normalize(post, {});
  assert.ok(evs.length >= 1 && ["tool_use", "outbound_post"].includes(evs[0].type));
});

test("built-in ids come from `_meta[\"x.ai/tool\"].name`; `variant` is not an argument", () => {
  const calls = updates("smoke-s2-dopl-config.ndjson", "tool_call").map((m) => n.toolCallOf(m.params.update));
  const ids = calls.map((c) => c.name);
  for (const id of ["run_terminal_command", "read_file", "write"]) assert.ok(ids.includes(id), `${id} missing from ${ids}`);
  for (const c of calls) assert.equal(c.input.variant, undefined);
});

test("a finished tool is a result: completed → ok, a hook deny / a rejection → failed, with the text", () => {
  const done = updates("smoke-s2-dopl-config.ndjson", "tool_call_update").filter((m) => ["completed", "failed"].includes(m.params.update.status));
  const evs = done.flatMap((m) => n.normalize(m, {}));
  assert.ok(evs.every((e) => e.type === "tool_result"));
  const denied = done.find((m) => /Hook denied/.test(JSON.stringify(m)));
  const [r] = n.normalize(denied, {});
  assert.equal(r.payload.ok, false);
  assert.match(String(r.payload.resultSummary), /Hook denied: Dopl containment/);
  const ran = done.find((m) => m.params.update.status === "completed" && /echo hi/.test(JSON.stringify(m)));
  assert.equal(n.normalize(ran, {})[0].payload.ok, true);
  // In-progress updates and the pre-run `tool_call_update` (title/rawInput) render nothing.
  const pending = updates("smoke-s3-resume-steer.ndjson", "tool_call_update").find((m) => m.params.update.status === "in_progress");
  assert.deepEqual(n.normalize(pending, {}), []);
});

test("chunks, titles, commands, config echoes and every `_x.ai/*` chatter frame render NOTHING (no drift either)", () => {
  for (const name of ["smoke-s1-modes.ndjson", "smoke-s2-dopl-config.ndjson", "smoke-s3-resume-steer.ndjson", "smoke-s4-config.ndjson"]) {
    for (const m of notifications(name)) {
      const kind = m.method === "session/update" ? m.params.update.sessionUpdate : "";
      if (kind === "tool_call" || kind === "tool_call_update" || m.method === "_x.ai/mcp/server_status") continue;
      assert.deepEqual(n.normalize(m, {}), [], `${name}: ${m.method} ${kind}`);
    }
  }
});

test("the prompt result: Dopl's running total (null-not-0), context = last prompt tokens over the window", () => {
  const evs = n.normalize({ method: n.PROMPT_RESULT, params: { cumulative: { totalTokens: 109289 }, contextUsed: 18813, contextWindow: 256000, model: "grok-4.7" } }, {});
  assert.deepEqual(evs.map((e) => e.type), ["context", "result"]);
  assert.equal(evs[1].sessionTokens, 109289);
  assert.equal(evs[0].tokens, 18813);
  const none = n.normalize({ method: n.PROMPT_RESULT, params: { cumulative: null, contextUsed: 0, model: "grok-4.7" } }, {});
  assert.deepEqual(none.map((e) => e.type), ["result"], "no measurement, no context event");
  assert.equal(none[0].sessionTokens, null, "never a total of zero");
});

test("usage keys: `cachedReadTokens` is a SUBSET of input (measured) — never added", () => {
  const t = n.tokensFrom({ inputTokens: 17896, outputTokens: 13, totalTokens: 17909, cachedReadTokens: 17792 });
  assert.equal(t.session, 17909);
  assert.equal(t.prompt, 17896);
});

test("auth: -32000 Authentication required and the handshake's no-token frame are holds, alone", () => {
  assert.deepEqual(n.normalize({ method: n.PROMPT_FAILED, params: { code: -32000, message: "Authentication required" } }, {}).map((e) => e.type), ["auth_hold"]);
  assert.deepEqual(n.normalize({ method: n.AUTH_REQUIRED, params: { text: "x" } }, {}).map((e) => e.type), ["auth_hold"]);
  assert.deepEqual(n.normalize({ type: "error", text: "401 Unauthorized" }, {}).map((e) => e.type), ["auth_hold"]);
  const other = n.normalize({ method: n.PROMPT_FAILED, params: { code: -32603, message: "boom" } }, {});
  assert.deepEqual(other.map((e) => e.type), ["assistant", "result"]);
});

test("Dopl's MCP server: `ready` (recorded) is silent; a failed status says so and reports it", () => {
  const ready = notifications("smoke-s1-modes.ndjson").filter((m) => m.method === "_x.ai/mcp/server_status");
  assert.ok(ready.length);
  for (const m of ready) assert.deepEqual(n.normalize(m, {}), []);
  const failed = n.normalize({ method: "_x.ai/mcp/server_status", params: { name: "dopl_session", status: "failed" } }, {});
  assert.deepEqual(failed.map((e) => e.type), ["assistant", "mcp_status_report"]);
  assert.deepEqual(n.normalize({ method: "_x.ai/mcp/server_status", params: { name: "other", status: "failed" } }, {}), []);
});

test("the yolo backstop and an unasked Dopl call are a safety stop and drift", () => {
  assert.equal(n.normalize({ method: n.UNSAFE, params: { text: "yolo" } }, {})[0].type, "safety_mismatch");
  assert.equal(n.normalize({ method: n.UNASKED, params: { tool: "mcp__dopl_session__post_message" } }, {})[0].type, "shape_drift");
});

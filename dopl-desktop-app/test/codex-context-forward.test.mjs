// THE ONE LINE THAT MAKES THE CONTEXT METER REACHABLE ON CODEX — `launch-spec.js`'s usage fold.
//
// ⚠ ITS OWN FILE, AND THE SEAM IS THE REASON TO CHANGE. `session-context-meter.test.mjs` is about
// the METER'S ARITHMETIC — precedence between a reported window and the frozen table, what an
// absent window renders, what must not clobber a known value. THIS is about the ADAPTER'S FOLD:
// which fields of an out-of-band `thread/tokenUsage/updated` snapshot ride the `turn/completed`
// frame core consumes. The two move for different reasons — one when the gauge's rules change, one
// when the Codex wire does — and the split is what kept the meter file under the §1 cap.
//
// 🔒 THE DEFECT THIS EXISTS FOR (2026-09-22): the whole meter path was built and shipped INERT.
// `modelContextWindow` is a SIBLING of `last`/`total` inside `tokenUsage`, and the fold forwarded
// only those two — so `normalize.js › windowFrom` never saw a window and a Codex session showed
// used tokens over nothing. Every unit test upstream and downstream passed.
//
// Driven through the real `start` with a fake connection (the pattern of `codex-launch-protocol`):
// no binary, no catalog (`natives`), no restriction config. The live half is `codex-live-session.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { threadEcho } from "./helpers/codex-echo.mjs";

const require = createRequire(import.meta.url);
const CODEX = join(import.meta.dirname, "..", "main", "runtime", "codex");
const client = require(join(CODEX, "client.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
const normalizer = require(join(CODEX, "normalize.js"));

/** One turn through `start`; `usage` is the `tokenUsage` snapshot sent before it completes (or none). */
async function completedFrame(usage) {
  let hooks = null;
  let turned = null;
  const turnStarted = new Promise((r) => { turned = r; });
  const fake = {
    async request(method, params) {
      if (method === "thread/start") return { ...threadEcho(params), thread: { id: "thread-1" } };
      if (method === "turn/start") { turned(); return { turn: { id: "turn-1" } }; }
      return {};
    },
    notify() {},
    close() {},
  };
  async function* prompts() { yield { message: { content: "hi" } }; }
  const original = client.connect;
  client.connect = (options) => { hooks = options; return fake; };
  const handle = launchSpec.start({
    session: { key: "c:t:a", state: {}, profile: "full" },
    args: [], env: {}, cwd: import.meta.dirname, prompt: prompts(),
    threadStart: { approvalPolicy: "on-request", sandbox: "workspace-write" },
    natives: true,
    dispatch: () => {},
  });
  try {
    await turnStarted;
    assert.equal((await handle.next()).value.method, "dopl/threadStarted");
    if (usage) hooks.onNotification({ method: "thread/tokenUsage/updated", params: { tokenUsage: usage } });
    hooks.onNotification({ method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } });
    const frame = (await handle.next()).value;
    assert.equal(frame.method, "turn/completed");
    return frame;
  } finally {
    handle.close();
    client.connect = original;
  }
}

const USAGE = {
  last: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
  total: { inputTokens: 300, outputTokens: 15, totalTokens: 315 },
};

test("launch-spec forwards the reported window onto the completed frame", async () => {
  const frame = await completedFrame({ ...USAGE, modelContextWindow: 200000 });
  assert.equal(frame.params.contextWindow, 200000, "the window must ride the same fold as usage/promptUsage");
  // …and it reaches the meter: the context event carries the server's window.
  const ctx = normalizer.normalize(frame, {}).find((e) => e && e.type === "context");
  assert.ok(ctx, "a context event");
  assert.equal(ctx.window, 200000);
  assert.equal(ctx.tokens, 100, "the turn's own prompt (`last`), not the thread total");
});

test("no snapshot, or one without a window, folds no number (never a 0 denominator)", async () => {
  // ⚠ ABSENT, NOT ZERO — a `0` denominator renders a FULL meter on an empty session.
  assert.equal((await completedFrame(null)).params.contextWindow, null);
  assert.equal(typeof (await completedFrame(USAGE)).params.contextWindow, "undefined");
});

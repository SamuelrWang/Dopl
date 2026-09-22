// THE LIVE APP-SERVER STATE MACHINE, WITHOUT SPAWNING A BINARY.
//
// The fake connection below speaks the measured v2 response shapes from the generated schema.
// This keeps the launch adapter pinned to the real protocol while leaving process discovery,
// authentication and network access to their own integration gates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const client = require(join(CODEX, "client.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, message) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

async function* prompts() {
  yield { message: { content: "First prompt" } };
  yield { message: { content: "Steer this turn" } };
}

test("an intentional close stays clean, while an unexpected app-server exit fails the stream", async () => {
  const clean = launchSpec.makeFrameQueue();
  clean.close();
  clean.fail(new Error("late child exit"));
  assert.deepEqual(await clean.next(), { value: undefined, done: true });

  const crashed = launchSpec.makeFrameQueue();
  crashed.fail(new Error("unexpected child exit"));
  await assert.rejects(crashed.next(), /unexpected child exit/);
});

test("start drives the measured v2 thread/turn state machine", async () => {
  const calls = [];
  let hooks = null;
  const fake = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "initialize") return {};
      if (method === "thread/start") {
        return { thread: { id: "thread-1" }, model: "gpt-6-astra" };
      }
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      if (method === "turn/steer") return { turnId: "turn-1" };
      return {};
    },
    close() {},
  };

  const originalConnect = client.connect;
  client.connect = (options) => { hooks = options; return fake; };
  let handle;
  try {
    handle = launchSpec.start({
      session: { key: "c:t:a", state: {}, profile: "full" },
      args: [], env: {}, cwd: HERE, prompt: prompts(),
      threadStart: { approvalPolicy: "on-request", sandbox: "read-only", model: "gpt-6-astra" },
      turnStart: { effort: "high" },
      dispatch: () => {}, emitQuiet: () => {},
    });

    await waitFor(() => calls.some((c) => c.method === "turn/steer"), "prompt pump never steered");
    const launched = await handle.next();
    assert.equal(launched.value.method, "dopl/threadStarted");
    assert.deepEqual(launched.value.params, { threadId: "thread-1", model: "gpt-6-astra" });
    assert.deepEqual(calls.find((c) => c.method === "thread/start").params, {
      cwd: HERE,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      model: "gpt-6-astra",
    });

    const started = calls.find((c) => c.method === "turn/start");
    assert.deepEqual(started.params, {
      threadId: "thread-1",
      input: [{ type: "text", text: "First prompt" }],
      effort: "high",
    });
    const steered = calls.find((c) => c.method === "turn/steer");
    assert.deepEqual(steered.params, {
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "Steer this turn" }],
    });

    await handle.interrupt();
    assert.deepEqual(calls.find((c) => c.method === "turn/interrupt").params, {
      threadId: "thread-1",
      turnId: "turn-1",
    });

    hooks.onNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 5, totalTokens: 125 },
          total: { inputTokens: 300, cachedInputTokens: 40, outputTokens: 15, totalTokens: 355 },
          modelContextWindow: 200000,
        },
      },
    });
    hooks.onNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
    });

    const completed = await handle.next();
    assert.equal(completed.value.method, "turn/completed");
    assert.deepEqual(completed.value.params.usage, {
      inputTokens: 300, cachedInputTokens: 40, outputTokens: 15, totalTokens: 355,
    });
    assert.deepEqual(completed.value.params.promptUsage, {
      inputTokens: 100, cachedInputTokens: 20, outputTokens: 5, totalTokens: 125,
    });
    assert.equal(completed.value.params.model, "gpt-6-astra");
  } finally {
    if (handle) handle.close();
    client.connect = originalConnect;
  }
});

test("LIVE: the adapter completes a real app-server turn", {
  skip: process.env.CODEX_ADAPTER_LIVE !== "1",
  timeout: 60000,
}, async () => {
  async function* onePrompt() {
    yield { message: { content: "Reply with exactly DOPL_CODEX_OK. Do not use tools." } };
  }
  const handle = launchSpec.start({
    session: { key: "live:codex:adapter", profile: "full", channelId: null, state: {} },
    args: [],
    threadStart: { approvalPolicy: "untrusted", sandbox: "read-only" },
    env: process.env,
    cwd: HERE,
    prompt: onePrompt(),
    log: (...parts) => process.stderr.write(`${parts.join(" ")}\n`),
    dispatch: () => {},
    emitQuiet: () => {},
  });
  const frames = [];
  try {
    for await (const frame of handle) {
      frames.push(frame);
      if (frame.method === "turn/completed") break;
    }
  } finally {
    handle.close();
  }
  const trace = frames.map((f) => ({ method: f.method, params: f.params }));
  assert.ok(frames.some((f) => f.method === "dopl/threadStarted" && f.params.threadId),
    JSON.stringify(trace));
  assert.ok(frames.some((f) => f.method === "item/completed"
    && f.params?.item?.type === "agentMessage"
    && String(f.params.item.text || "").includes("DOPL_CODEX_OK")));
  const completed = frames.find((f) => f.method === "turn/completed");
  assert.ok(completed.params.usage && completed.params.usage.totalTokens > 0);
});

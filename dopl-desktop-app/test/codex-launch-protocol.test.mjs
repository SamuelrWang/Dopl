// THE APP-SERVER STATE MACHINE — pinned to the schema, plus ONE live end-to-end turn.
//
// The fake connection below speaks the measured v2 response shapes from the generated schema, so
// the launch adapter stays pinned to the real protocol with no binary, no account and no network.
// The last case in the file is the exception: it drives the SAME adapter against a real
// `codex app-server`, and it runs only when `CODEX_APP_SERVER_LIVE=1` arms the tier.
//
// ⚠ Turn-level behaviour a fixture cannot decide — what a steer targets, what an interrupt leaves
// behind, what a resume does to the token totals — lives in `codex-live-session.test.mjs`, which
// is live-only by construction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { liveGate, announceGate, skipLive, appEnv, LIVE_THREAD, LIVE_TURN, LIVE_MODEL } from "./_codex-app-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const client = require(join(CODEX, "client.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));

// 🔒 ⚠ **ONE LIVE FLAG IN THIS TREE, AND IT IS `CODEX_APP_SERVER_LIVE`.** This case used to gate
// on a SECOND name, `CODEX_ADAPTER_LIVE`, which nothing ever set: not `npm test`, not
// `scripts/codex-compat.js`, not CI. So the one test that drives the real adapter against a real
// app-server had never executed anywhere, and it skipped with a bare `skip:` — no banner, no
// reason, indistinguishable from a pass in the summary. That is precisely the failure U1's helper
// exists to remove, so it now shares that helper's gate and its loud skip.
const GATE = announceGate(liveGate());

// Time-bounded: the fenced catalog is read ASYNCHRONOUSLY before the child exists (CX-09), and
// that read may spawn the bundled binary.
async function waitFor(predicate, message) {
  for (const until = Date.now() + 10000; Date.now() < until;) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
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
    notify(method) { calls.push({ method, notification: true }); },
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
    // CX-14: the protocol's `initialized` notification follows the `initialize` answer.
    assert.deepEqual(calls.slice(0, 2).map((c) => [c.method, !!c.notification]),
      [["initialize", false], ["initialized", true]]);
    assert.deepEqual(launched.value.params, { threadId: "thread-1", model: "gpt-6-astra" });
    assert.deepEqual(calls.find((c) => c.method === "thread/start").params, {
      cwd: HERE,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      model: "gpt-6-astra",
    });

    // 🔒 THE DELEGATION FENCE RIDES ARGV ON EVERY START (`catalog.js`), pointing into the private home.
    const at = hooks.args.indexOf("-c");
    assert.ok(at !== -1 && /^model_catalog_json=".*dopl-model-catalog\.json"$/.test(hooks.args[at + 1]), JSON.stringify(hooks.args));
    assert.ok(hooks.args[at + 1].includes(hooks.env.CODEX_HOME), "the catalog lives in the isolated CODEX_HOME");

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

test("a thread that started at a WIDER policy than Dopl asked for is refused", () => {
  // 🔒 MEASURED 2026-09-22 (`codex-cli 0.155.1`): `thread/start` IGNORES a field it does not
  // recognise and answers with its own default. Sending the pre-v2 `approval_policy` spelling
  // started a thread and reported `approvalPolicy: "on-request"` while `never` had been asked for
  // — no error anywhere. The response echo is the only thing that can catch that, and
  // `ThreadStartResponse` REQUIRES the field, so it is always there to read.
  assert.throws(
    () => launchSpec.assertPolicyTook({ approvalPolicy: "untrusted" }, { approvalPolicy: "on-request" }),
    /started the thread at approval policy `on-request` after Dopl asked for `untrusted`/
  );
  // The agreeing case is silent.
  launchSpec.assertPolicyTook({ approvalPolicy: "never" }, { approvalPolicy: "never" });
  // 🔒 UNKNOWN IS NOT A MISMATCH. A response that says nothing about the policy has told us
  // nothing, and a `granular` ask is an OBJECT whose echo is the server's normalised form — an
  // inequality there would be a false alarm, not a caught downgrade.
  launchSpec.assertPolicyTook({ approvalPolicy: "never" }, {});
  launchSpec.assertPolicyTook({ approvalPolicy: "never" }, { approvalPolicy: null });
  launchSpec.assertPolicyTook({}, { approvalPolicy: "on-request" });
  // 🔒 SINCE 2026-09-22 THE OBJECT FORM IS COMPARED: the operator's `never` travels as `granular`
  // (on `config.approval_policy`), and a server that fell back to a string would be a silent widen.
  const never = { config: { approval_policy: launchSpec.approvalPolicy("never") } };
  launchSpec.assertPolicyTook(never, { approvalPolicy: launchSpec.approvalPolicy("never") });
  assert.throws(() => launchSpec.assertPolicyTook(never, { approvalPolicy: "on-request" }), /refusing/);
  assert.throws(() => launchSpec.assertPolicyTook(never, { approvalPolicy: launchSpec.approvalPolicy("granular") }), /refusing/);
  // An absent key reads as the schema default (`false`), so a normalised echo is not a false alarm.
  launchSpec.assertPolicyTook({ approvalPolicy: { granular: { mcp_elicitations: true, rules: false, sandbox_approval: false } } },
    { approvalPolicy: launchSpec.approvalPolicy("never") });
});

// 💰 ⚠ ONE MODEL TURN PER ARMED RUN. The prompt asks for a single token and forbids tools; the
// thread is `read-only`, so nothing it could decide to do can touch this checkout.
test("LIVE: the adapter completes a real app-server turn", { timeout: 120000 }, async (t) => {
  if (skipLive(t, GATE)) return;
  async function* onePrompt() {
    yield { message: { content: "Reply with exactly DOPL_CODEX_OK. Do not use tools." } };
  }
  const handle = launchSpec.start({
    session: { key: "live:codex:adapter", profile: "full", channelId: null, state: {} },
    args: [],
    threadStart: { approvalPolicy: "untrusted", sandbox: "read-only", ...LIVE_THREAD },
    turnStart: { ...LIVE_TURN },
    // ⚠ THE ISOLATED HOME, NOT `~/.codex`. A live turn run through the operator's own
    // `config.toml` measures their machine; `appEnv()` is the child the app would spawn.
    env: appEnv(),
    cwd: mkdtempSync(join(tmpdir(), "dopl-codex-adapter-live-")),
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
  // 💰 The live-tier model rule, checked against what the server says it RAN, not what was asked.
  assert.equal(completed.params.model, LIVE_MODEL);
});

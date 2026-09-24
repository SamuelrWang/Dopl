// The first Codex turn waits for Dopl's MCP server (`mcp-ready.js`), driven through the REAL
// `launch-spec.js › start` and `normalize.js` with only the app-server connection and the catalog faked.
// The real-binary half is `codex-mcp-ready-live.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const CODEX = join(import.meta.dirname, "..", "main", "runtime", "codex");
const client = require(join(CODEX, "client.js"));
const catalog = require(join(CODEX, "catalog.js"));
const mcp = require(join(CODEX, "mcp.js"));
const mcpReady = require(join(CODEX, "mcp-ready.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
const protocol = require(join(CODEX, "protocol.js"));
const { normalize } = require(join(CODEX, "normalize.js"));

const tick = () => new Promise((r) => setImmediate(r));
async function until(pred, what) {
  for (let i = 0; i < 200; i += 1) { if (pred()) return; await tick(); }
  assert.fail(what);
}
const settle = async () => { for (let i = 0; i < 20; i += 1) await tick(); };

function pushQueue() {
  const items = [];
  let wake = null;
  return {
    push(m) { items.push(m); if (wake) { const w = wake; wake = null; w(); } },
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          while (!items.length) await new Promise((r) => { wake = r; });
          return { value: items.shift(), done: false };
        },
      };
    },
  };
}

const say = (text) => ({ message: { content: text } });
const WIRED = { config: { mcp_servers: { [mcp.SERVER_KEY]: { url: "http://127.0.0.1:1/api/mcp" } } } };
const status = (s, extra) => ({ threadId: "th-1", name: mcp.SERVER_KEY, status: s, error: null, failureReason: null, ...extra });

/**
 * `start()` against a fake app-server. `o.threadStart` is the spec's thread config (default: Dopl wired);
 * `o.list(params)` answers `mcpServerStatus/list` (default: never, like the CLI while a server starts);
 * `o.duringThreadStart(notify)` runs before `thread/start` answers.
 */
function run(o = {}) {
  const calls = [];
  const lines = [];
  let hooks = null;
  let turnSeq = 0;
  const notify = (method, params) => hooks.onNotification({ method, params });
  const fake = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") {
        if (o.duringThreadStart) o.duringThreadStart(notify);
        return { thread: { id: "th-1" }, model: "gpt-x" };
      }
      if (method === "mcpServerStatus/list") return o.list ? o.list(params) : new Promise(() => {});
      if (method === "turn/start") return { turn: { id: `tu-${++turnSeq}` } };
      if (method === "turn/steer") return { turnId: `tu-${turnSeq}` };
      return {};
    },
    notify(method) { calls.push({ method, notification: true }); },
    close() { calls.push({ method: "close" }); },
  };
  const realConnect = client.connect;
  const realCatalog = catalog.writeDelegationFreeCatalog;
  client.connect = (opts) => { hooks = opts; return fake; };
  catalog.writeDelegationFreeCatalog = async (home) => join(home, catalog.CATALOG_FILE);
  const prompts = pushQueue();
  const handle = launchSpec.start({
    session: { key: "c:t:a", state: {}, profile: "full" },
    args: [], env: {}, cwd: import.meta.dirname, prompt: prompts,
    threadStart: o.threadStart === undefined ? WIRED : o.threadStart,
    log: (...parts) => lines.push(parts.join(" ")),
    dispatch: () => {},
  });
  const restore = () => { client.connect = realConnect; catalog.writeDelegationFreeCatalog = realCatalog; };
  const named = (m) => calls.filter((c) => c.method === m);
  return { handle, calls, named, lines, prompts, notify, restore, connected: () => !!hooks };
}

/** Frames up to and including the first one `stop` matches, normalized. Bounded: a missing frame fails, never hangs. */
async function eventsUntil(h, stop) {
  const out = [];
  for (;;) {
    let timer = null;
    const bound = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no further frame; saw ${JSON.stringify(out.map((e) => e.type))}`)), 2000); });
    const { value, done } = await Promise.race([h.handle.next(), bound]).finally(() => clearTimeout(timer));
    if (done) return out;
    out.push(...normalize(value, {}));
    if (stop(value)) return out;
  }
}
const laneLines = (evs) => evs.filter((e) => e.type === "assistant").map((e) => e.payload.text);

test("the first turn/start waits for Dopl's server to report `ready`", async () => {
  const h = run();
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    await settle();
    assert.equal(h.named("turn/start").length, 0, "the turn started while Dopl's server was still starting");
    assert.deepEqual(h.named("mcpServerStatus/list")[0].params, { threadId: "th-1", detail: "toolsAndAuthOnly" });
    h.notify(mcpReady.STARTUP_METHOD, status("starting"));
    await settle();
    assert.equal(h.named("turn/start").length, 0, "`starting` is not an answer");
    h.notify(mcpReady.STARTUP_METHOD, status("ready"));
    await until(() => h.named("turn/start").length === 1, "the turn never started after `ready`");
    assert.equal(h.lines.length, 1, "one diag line per launch");
    assert.match(h.lines[0], /^codex: dopl mcp ready \(notification\) first turn waited \d+ms$/);
  } finally { h.handle.close(); h.restore(); }
});

test("a status that beats the `thread/start` answer is kept — no list, no wait", async () => {
  const h = run({ duringThreadStart: (notify) => notify(mcpReady.STARTUP_METHOD, status("ready")) });
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("turn/start").length === 1, "the turn never started");
    assert.equal(h.named("mcpServerStatus/list").length, 0);
    assert.match(h.lines[0], /ready \(already\) first turn waited 0ms/);
  } finally { h.handle.close(); h.restore(); }
});

test("a `starting` seen early is not an answer, and no list is asked", async () => {
  const h = run({ duringThreadStart: (notify) => notify(mcpReady.STARTUP_METHOD, status("starting")) });
  try {
    h.prompts.push(say("go"));
    await settle();
    assert.equal(h.named("turn/start").length, 0);
    assert.equal(h.named("mcpServerStatus/list").length, 0, "a status was already seen");
    h.notify(mcpReady.STARTUP_METHOD, status("ready"));
    await until(() => h.named("turn/start").length === 1, "the turn never started");
  } finally { h.handle.close(); h.restore(); }
});

test("the list answer settles the wait when no notification comes", async () => {
  const h = run({ list: async () => ({ data: [{ name: "other", runtimeStatus: "failed" }, { name: mcp.SERVER_KEY, runtimeStatus: "connected", tools: {} }] }) });
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("turn/start").length === 1, "the list answer did not release the turn");
    assert.match(h.lines[0], /ready \(list\)/);
  } finally { h.handle.close(); h.restore(); }
});

test("`failed`: the turn still starts, and ONE line says Dopl's tools did not connect", async () => {
  const h = run();
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    h.notify(mcpReady.STARTUP_METHOD, status("failed", { error: "MCP client for `dopl` failed to start:\nhandshake" }));
    await until(() => h.named("turn/start").length === 1, "a failed server must not block the turn");
    h.notify("turn/completed", { turn: { id: "tu-1", status: "completed" } });
    const evs = await eventsUntil(h, (f) => f && f.method === "turn/completed");
    assert.deepEqual(laneLines(evs), ["Dopl's tools did not connect (the connection failed), so this turn runs without them."]);
    assert.equal(evs.filter((e) => e.type === "auth_hold").length, 0);
    assert.match(h.lines[0], /failed \(notification\) first turn waited \d+ms error=MCP client for `dopl` failed to start: handshake$/);
  } finally { h.handle.close(); h.restore(); }
});

test("`cancelled` and a failed list row are the same line", async () => {
  const h = run({ list: async () => ({ data: [{ name: mcp.SERVER_KEY, runtimeStatus: "cancelled" }] }) });
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("turn/start").length === 1, "the turn never started");
    const evs = await eventsUntil(h, (f) => f && f.type === "error");
    assert.deepEqual(laneLines(evs), ["Dopl's tools did not connect (the connection was cancelled), so this turn runs without them."]);
  } finally { h.handle.close(); h.restore(); }
});

test("`reauthenticationRequired` is Dopl's bearer, not the Codex sign-in: a line, never an auth hold", async () => {
  const h = run();
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    h.notify(mcpReady.STARTUP_METHOD, status("failed", { failureReason: "reauthenticationRequired", error: "401 Unauthorized" }));
    await until(() => h.named("turn/start").length === 1, "the turn never started");
    const evs = await eventsUntil(h, (f) => f && f.type === "error");
    assert.deepEqual(evs.map((e) => e.type).filter((t) => t !== "launched"), ["assistant"]);
    assert.deepEqual(laneLines(evs), ["Dopl's tools did not connect (sign-in required), so this turn runs without them."]);
    assert.match(h.lines[0], /reason=reauthenticationRequired/);
  } finally { h.handle.close(); h.restore(); }
});

test("no Dopl server configured (no token): no wait, no list, no line", async () => {
  for (const threadStart of [{ config: {} }, null]) {
    const h = run({ threadStart });
    try {
      h.prompts.push(say("go"));
      await until(() => h.named("turn/start").length === 1, "the turn waited on a server that is not there");
      assert.equal(h.named("mcpServerStatus/list").length, 0);
      assert.match(h.lines[0], /none \(none\) first turn waited 0ms/);
    } finally { h.handle.close(); h.restore(); }
  }
});

test("messages pushed during the wait are delivered: the first starts the turn, the next steers it", async () => {
  const h = run();
  try {
    h.prompts.push(say("first"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    h.prompts.push(say("second"));
    await settle();
    assert.equal(h.named("turn/start").length + h.named("turn/steer").length, 0);
    h.notify(mcpReady.STARTUP_METHOD, status("ready"));
    await until(() => h.named("turn/steer").length === 1, "the second message never arrived");
    assert.equal(h.named("turn/start")[0].params.input[0].text, "first");
    assert.equal(h.named("turn/steer")[0].params.input[0].text, "second");
    assert.equal(h.named("turn/steer")[0].params.expectedTurnId, "tu-1");
  } finally { h.handle.close(); h.restore(); }
});

test("later turns never wait and never ask again", async () => {
  const h = run();
  try {
    h.prompts.push(say("one"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    h.notify(mcpReady.STARTUP_METHOD, status("ready"));
    await until(() => h.named("turn/start").length === 1, "no first turn");
    h.notify("turn/completed", { turn: { id: "tu-1", status: "completed" } });
    await eventsUntil(h, (f) => f && f.method === "turn/completed");
    h.notify(mcpReady.STARTUP_METHOD, status("starting"));
    h.prompts.push(say("two"));
    await until(() => h.named("turn/start").length === 2, "the second turn waited");
    assert.equal(h.named("mcpServerStatus/list").length, 1);
    assert.equal(h.lines.length, 1);
  } finally { h.handle.close(); h.restore(); }
});

test("close during the wait: no turn, the stream ends, the pump resolves", async () => {
  const h = run();
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    h.handle.close();
    await until(() => h.lines.length === 1, "the wait never resolved on close");
    assert.match(h.lines[0], /closed \(released\)/);
    await settle();
    assert.equal(h.named("turn/start").length, 0);
    const evs = await eventsUntil(h, () => false);
    assert.deepEqual(evs.map((e) => e.type), ["launched"], "queued frames drain, then the stream ends; no line");
  } finally { h.restore(); }
});

test("interrupt during the wait: settles at once, and the turn it starts is interrupted", async () => {
  const h = run();
  try {
    h.prompts.push(say("go"));
    await until(() => h.named("mcpServerStatus/list").length === 1, "no status was asked for");
    await h.handle.interrupt();
    await until(() => h.named("turn/interrupt").length === 1, "the stop was lost");
    assert.deepEqual(h.named("turn/interrupt")[0].params, { threadId: "th-1", turnId: "tu-1" });
    assert.match(h.lines[0], /interrupted \(released\)/);
    assert.equal(h.calls.findIndex((c) => c.method === "turn/start") < h.calls.findIndex((c) => c.method === "turn/interrupt"), true);
  } finally { h.handle.close(); h.restore(); }
});

// ── the wait itself ──────────────────────────────────────────────────────────────────────────

test("the bound is Codex's own startup timeout plus a second, from ONE constant", () => {
  assert.equal(mcpReady.READY_WAIT_MS, (mcp.STARTUP_TIMEOUT_SEC + 1) * 1000);
  assert.equal(mcp.buildDoplServerEntry(null).startup_timeout_sec, mcp.STARTUP_TIMEOUT_SEC);
  assert.ok(protocol.REQUIRED_METHODS.includes(mcpReady.LIST_METHOD), "a method the adapter sends is on the release gate");
});

test("a server that never reports: the bound ends the wait as `timeout`, and that earns the line", async () => {
  const ready = mcpReady.makeReadyWait(true, { waitMs: 30 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const out = await ready.wait({ request: () => new Promise(() => {}) }, "th-1");
    assert.equal(out.status, "timeout");
    assert.equal(out.source, "bound");
    assert.ok(out.waitedMs >= 25);
    assert.equal(mcpReady.missedTools(out), true);
    assert.equal(ready.isWaiting(), false);
    assert.deepEqual(laneLines(normalize({ type: "error", text: "", mcpStartup: "timeout" }, {})),
      ["Dopl's tools did not connect (no answer in time), so this turn runs without them."]);
  } finally { clearTimeout(keepAlive); }
});

test("the bound timer is unref'd and cleared when the wait is released", async () => {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const made = [];
  const cleared = [];
  globalThis.setTimeout = (fn, ms) => { const t = realSet(fn, ms); made.push(t); return t; };
  globalThis.clearTimeout = (t) => { cleared.push(t); return realClear(t); };
  try {
    const ready = mcpReady.makeReadyWait(true);
    const pending = ready.wait({ request: () => new Promise(() => {}) }, "th-1");
    assert.equal(made.length, 1);
    assert.equal(made[0].hasRef(), false, "a pending bound must not hold the process open");
    ready.release("closed");
    assert.equal((await pending).status, "closed");
    assert.deepEqual(cleared, made);
    assert.equal((await ready.wait({}, "th-1")).status, "closed", "a released wait stays released");
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});

test("only Dopl's server counts; a list that fails leaves the wait to the notification", async () => {
  const ready = mcpReady.makeReadyWait(true);
  const pending = ready.wait({ request: async () => { throw new Error("app-server gone"); } }, "th-1");
  ready.observe({ method: mcpReady.STARTUP_METHOD, params: { name: "codex_apps", status: "ready" } });
  await settle();
  assert.equal(ready.isWaiting(), true);
  ready.observe({ method: mcpReady.STARTUP_METHOD, params: { name: mcp.SERVER_KEY, status: "ready" } });
  assert.equal((await pending).status, "ready");
});

test("doplConfigured reads the entry the launch sends", () => {
  assert.equal(mcpReady.doplConfigured(WIRED), true);
  assert.equal(mcpReady.doplConfigured({ config: { mcp_servers: {} } }), false);
  assert.equal(mcpReady.doplConfigured(undefined), false);
});

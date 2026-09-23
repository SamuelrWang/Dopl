// The Codex adapter's run lifecycle, driven through the REAL `launch-spec.js › start`, the REAL
// `normalize.js` and core's REAL `session-io.js › applyCoreEvents`, with only the app-server
// connection and the catalog read faked.
//
// CX-02 / P4-04  an interrupted turn does not reset the cumulative baseline (no re-bill).
// CX-04          a failed turn becomes an auth hold, or one visible line in the lane.
// CX-09          the catalog read is off the synchronous path; no child before it resolves.
// CX-14          a fresh thread with no id fails the stream; `initialized` follows `initialize`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const CODEX = join(import.meta.dirname, "..", "main", "runtime", "codex");
const client = require(join(CODEX, "client.js"));
const catalog = require(join(CODEX, "catalog.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
const { normalize } = require(join(CODEX, "normalize.js"));
const io = require("../main/session-io.js");

const fakeStore = { setSdkSessionId() {}, saveRecord() {} };
const tick = () => new Promise((r) => setImmediate(r));
async function until(pred, what) {
  for (let i = 0; i < 200; i += 1) { if (pred()) return; await tick(); }
  assert.fail(what);
}

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

/**
 * `start()` against a fake app-server. `o.thread` is the `thread/start` answer; `o.catalog` a
 * function standing in for the catalog write (default: resolves at once).
 */
function run(o = {}) {
  const calls = [];
  let hooks = null;
  let turnSeq = 0;
  const fake = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start" || method === "thread/resume") {
        return o.thread !== undefined ? o.thread : { thread: { id: "th-1" }, model: "gpt-x" };
      }
      if (method === "turn/start") return { turn: { id: `tu-${++turnSeq}` } };
      if (method === "turn/steer") return { turnId: `tu-${turnSeq}` };
      return {};
    },
    notify(method) { calls.push({ method, notification: true }); },
    close() { calls.push({ method: "close" }); },
  };
  const connects = [];
  const realConnect = client.connect;
  const realCatalog = catalog.writeDelegationFreeCatalog;
  client.connect = (opts) => { connects.push(opts); hooks = opts; return fake; };
  catalog.writeDelegationFreeCatalog = o.catalog || (async (home) => join(home, catalog.CATALOG_FILE));
  const prompts = pushQueue();
  const handle = launchSpec.start({
    session: { key: "c:t:a", state: {}, profile: "full" },
    args: [], env: {}, cwd: import.meta.dirname, prompt: prompts,
    resumeThreadId: o.resumeThreadId || null,
    dispatch: () => {}, emitQuiet: () => {},
  });
  const restore = () => { client.connect = realConnect; catalog.writeDelegationFreeCatalog = realCatalog; };
  const notify = (method, params) => hooks.onNotification({ method, params });
  return { handle, calls, connects, prompts, notify, restore, hooks: () => hooks };
}

/** Pull frames until one matches, applying each through normalize + core, the consume loop's order. */
async function drain(h, s, stopAt) {
  const seen = [];
  for (;;) {
    const { value } = await h.handle.next();
    for (const ev of normalize(value, {})) {
      seen.push(ev);
      if (ev.type !== "auth_hold") io.applyCoreEvents(s, [ev], () => {}, fakeStore);
    }
    if (stopAt(value)) return seen;
  }
}
const isTurnEnd = (f) => f && f.method === "turn/completed";

test("CX-02: an interrupted turn keeps the thread's cumulative baseline — the next turn bills only itself", async () => {
  const h = run();
  try {
    const s = { tokensSpent: 0, lastTotalTokens: 0, turns: 0, state: {} };
    h.prompts.push(io.userMessage("go"));
    await until(() => h.calls.some((c) => c.method === "turn/start"), "no turn started");
    const usage = (last, total) => h.notify("thread/tokenUsage/updated", {
      tokenUsage: { last: { inputTokens: last, outputTokens: 0, totalTokens: last }, total: { inputTokens: total, outputTokens: 0, totalTokens: total } },
    });
    usage(18838, 18838);
    h.notify("turn/completed", { turn: { id: "tu-1", status: "completed" } });
    await drain(h, s, isTurnEnd);
    assert.equal(s.tokensSpent, 18838);

    // Stop: `turn/completed{interrupted}` with NO usage update (measured on codex-cli 0.155.1).
    h.prompts.push(io.userMessage("again"));
    await until(() => h.calls.filter((c) => c.method === "turn/start").length === 2, "no second turn");
    h.notify("turn/completed", { turn: { id: "tu-2", status: "interrupted" } });
    await drain(h, s, isTurnEnd);
    assert.equal(s.lastTotalTokens, 18838, "the baseline is the last cumulative total, not 0");

    h.prompts.push(io.userMessage("third"));
    await until(() => h.calls.filter((c) => c.method === "turn/start").length === 3, "no third turn");
    usage(23591, 42429);
    h.notify("turn/completed", { turn: { id: "tu-3", status: "completed" } });
    await drain(h, s, isTurnEnd);
    assert.equal(s.tokensSpent, 42429, "the thread's total, counted once — not 18,838 + 42,429");
    assert.equal(s.turns, 3);
  } finally { h.handle.close(); h.restore(); }
});

test("P4-04: core skips an UNMEASURED result (null) — spend and baseline stay, the turn still counts", () => {
  const s = { tokensSpent: 71194, lastTotalTokens: 71194, turns: 3, state: {} };
  const dispatched = [];
  io.applyCoreEvents(s, [{ type: "result", sessionTokens: null, model: "gpt-x" }], (_s, ev) => dispatched.push(ev.type), fakeStore);
  assert.deepEqual([s.tokensSpent, s.lastTotalTokens, s.turns], [71194, 71194, 4]);
  assert.ok(dispatched.includes("result"), "the turn still ends for the reducer");
  io.applyCoreEvents(s, [{ type: "result", sessionTokens: 99000 }], () => {}, fakeStore);
  assert.equal(s.tokensSpent, 99000, "the next measured turn bills only its delta");
});

test("CX-04: a final `error` notification that is auth-shaped raises the hold; one frame per turn", async () => {
  const h = run();
  try {
    h.prompts.push(io.userMessage("go"));
    await until(() => h.calls.some((c) => c.method === "turn/start"), "no turn started");
    h.notify("error", { threadId: "th-1", turnId: "tu-1", willRetry: true, error: { message: "stream disconnected, retrying" } });
    h.notify("error", { threadId: "th-1", turnId: "tu-1", willRetry: false, error: { message: "Your session expired", codexErrorInfo: "unauthorized" } });
    h.notify("turn/completed", { turn: { id: "tu-1", status: "failed", error: { message: "Your session expired", codexErrorInfo: "unauthorized" } } });
    const s = { state: {} };
    const evs = (await drain(h, s, isTurnEnd)).filter((e) => e.type !== "launched");
    assert.deepEqual(evs.map((e) => e.type), ["auth_hold", "result"],
      "the retrying error is ignored, and the failed turn/completed adds no second frame");
    assert.equal(evs[0].text, "Your session expired");
  } finally { h.handle.close(); h.restore(); }
});

test("CX-04: a failed turn that is NOT auth leaves ONE visible line in the lane (no reducer change)", async () => {
  const h = run();
  try {
    h.prompts.push(io.userMessage("go"));
    await until(() => h.calls.some((c) => c.method === "turn/start"), "no turn started");
    h.notify("turn/completed", { turn: { id: "tu-1", status: "failed", error: { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" } } });
    const evs = (await drain(h, { state: {} }, isTurnEnd)).filter((e) => e.type !== "launched");
    assert.deepEqual(evs.map((e) => e.type), ["assistant", "result"]);
    assert.equal(evs[0].payload.text, "Codex could not finish this turn: You've hit your usage limit.");
    // A 401 carried only in the HTTP variant is still auth.
    assert.deepEqual(normalize({ type: "error", text: "request failed", turnFailed: true,
      codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 401 } } }, {}).map((e) => e.type), ["auth_hold"]);
    // Core's own rejection frame (no `turnFailed`) still renders nothing: that path is a crash.
    assert.deepEqual(normalize({ type: "error", text: "ECONNRESET" }, {}), []);
  } finally { h.handle.close(); h.restore(); }
});

test("CX-09: start() returns before the catalog read, and no child exists until it resolves", async () => {
  let release = null;
  const h = run({ catalog: (home) => new Promise((r) => { release = () => r(join(home, catalog.CATALOG_FILE)); }) });
  try {
    assert.equal(typeof h.handle.close, "function", "the handle is returned synchronously");
    await tick(); await tick();
    assert.equal(h.connects.length, 0, "nothing spawned while the catalog is being read");
    release();
    await until(() => h.connects.length === 1, "the child was never started");
    const at = h.connects[0].args.indexOf("-c");
    assert.match(h.connects[0].args[at + 1], /model_catalog_json=.*dopl-model-catalog\.json/);
  } finally { h.handle.close(); h.restore(); }
});

test("CX-09: a close during the catalog read means no child at all (the two-children rule)", async () => {
  let release = null;
  const h = run({ catalog: (home) => new Promise((r) => { release = () => r(join(home, catalog.CATALOG_FILE)); }) });
  try {
    h.handle.close();
    release();
    for (let i = 0; i < 20; i += 1) await tick();
    assert.equal(h.connects.length, 0);
  } finally { h.restore(); }
});

test("CX-09: a catalog Dopl cannot build still FAILS the launch — the delegation fence holds", async () => {
  const h = run({ catalog: async () => { throw new Error("Dopl could not read Codex's model catalog — refusing the launch"); } });
  try {
    await assert.rejects(h.handle.next(), /refusing the launch/);
    assert.equal(h.connects.length, 0, "no app-server without the fenced catalog");
  } finally { h.handle.close(); h.restore(); }
});

test("CX-14: a fresh thread/start with no id fails the stream instead of running on a null thread", async () => {
  const h = run({ thread: { model: "gpt-x" } });
  try {
    await assert.rejects(h.handle.next(), /thread\/start returned no thread id/);
    assert.ok(!h.calls.some((c) => c.method === "turn/start"));
    assert.deepEqual(h.calls.slice(0, 2).map((c) => c.method), ["initialize", "initialized"]);
  } finally { h.handle.close(); h.restore(); }
});

test("CX-14: a resume keeps its known thread id when the answer omits one", async () => {
  const h = run({ thread: {}, resumeThreadId: "th-old" });
  try {
    const first = await h.handle.next();
    assert.deepEqual(first.value.params, { threadId: "th-old", model: null });
  } finally { h.handle.close(); h.restore(); }
});

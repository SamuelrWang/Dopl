// The SPA's API bridge under network failure: `dopl:api-request` answers an envelope, never an
// Electron-wrapped rejection ("Error invoking remote method … TypeError: fetch failed"), resends
// only what cannot double-send, and logs the cause. Drives the REAL handler registered by
// `main/ui-bridge.js › register` over a stubbed `fetch`.
//
// Run: `node --test dopl-desktop-app/test/ui-bridge-network.test.mjs`

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";

const net = real("./ui-bridge-net");
const API_BASE = "https://app.example";

let handlers;
let lines;
let resets;
let senderOk;
let tokens;
const realFetch = globalThis.fetch;

function boot() {
  handlers = {};
  lines = [];
  resets = [];
  senderOk = true;
  tokens = {
    getAccessToken: async () => "tok",
    getAuthState: () => ({ signedIn: true, userId: "u1" }),
    shouldRepairAuth: () => false,
    forceRefresh: async () => null,
    noteSessionRejected() {},
  };
  const bridge = loadWithStubs("ui-bridge.js", {
    electron: { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, shell: {} },
    "./app-version": { versionHeaders: () => ({}) },
    "./auth-tokens": new Proxy({}, { get: (_t, k) => tokens[k] }),
    "./api-repair": { discardBody() {} },
    "./config": { API_BASE, APP_ORIGIN: API_BASE },
    "./ui-sync": {},
    "./session-summary": {},
    "./auth-actions": {},
    "./auth-password": {},
    "./auth": {},
    "./avatar-policy": {},
    "./ipc-guards": { isAppWindowSender: () => senderOk },
    "./diag": { diag: (...parts) => lines.push(parts.join(" ")) },
    "./api": { currentPool: () => "pool-1", resetPool: (opts) => { resets.push(opts); return true; } },
    "./ui-bridge-net": net,
  });
  bridge.register({ getSenderIds: () => new Set([1]) });
}

const request = (path, opts = { method: "GET" }) => handlers["dopl:api-request"]({}, path, opts);

/** undici's shape: `TypeError: fetch failed` carrying the socket error as `cause`. */
function undiciError(code, message = "fetch failed") {
  return new TypeError(message, { cause: Object.assign(new Error(`socket ${code}`), { code }) });
}

function jsonResponse(status, body) {
  return { status, statusText: "", json: async () => body };
}

/** A fetch stub answering each call from `script` in turn (an Error rejects). */
function scriptFetch(...script) {
  const calls = [];
  globalThis.fetch = async (href, init) => {
    calls.push({ href, method: init.method });
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}

beforeEach(boot);
afterEach(() => { globalThis.fetch = realFetch; });

test("a stale socket on a GET resets the pool and resends once", async () => {
  const calls = scriptFetch(undiciError("ECONNRESET"), jsonResponse(200, { ok: true }));
  const out = await request("/api/channels?cursor=secret", { method: "GET" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(resets, [{ graceful: true, ifCurrent: "pool-1" }]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ui-bridge: network failure GET \/api\/channels code=ECONNRESET retried=yes result=ok$/);
  assert.ok(!lines[0].includes("secret"), "no query string in the log");
});

test("a POST with ECONNRESET is NOT retried — it may have reached the server", async () => {
  const calls = scriptFetch(undiciError("ECONNRESET"), jsonResponse(200, {}));
  const out = await request("/api/channels", { method: "POST", body: { name: "x" } });
  assert.equal(calls.length, 1, "a write is never sent twice");
  assert.equal(out.status, 0);
  assert.deepEqual(out.body, { error: { code: "NETWORK_UNAVAILABLE" } });
  assert.equal(resets.length, 1, "the pool is still replaced for the next request");
  assert.match(lines[0], /POST \/api\/channels code=ECONNRESET retried=no$/);
});

test("a connect-phase failure is resent for any method (nothing left the machine)", async () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
    boot();
    const calls = scriptFetch(undiciError(code), jsonResponse(201, { id: 1 }));
    const out = await request("/api/channels", { method: "POST", body: {} });
    assert.equal(calls.length, 2, code);
    assert.equal(out.status, 201, code);
  }
});

test("a resend that also fails answers NETWORK_UNAVAILABLE and names both causes", async () => {
  const calls = scriptFetch(undiciError("ENOTFOUND"), undiciError("ENETUNREACH"));
  const out = await request("/api/home/channels", { method: "GET" });
  assert.equal(calls.length, 2, "exactly one resend");
  assert.equal(out.status, 0);
  assert.equal(out.body.error.code, "NETWORK_UNAVAILABLE");
  assert.match(lines[0], /code=ENOTFOUND retried=yes result=ENETUNREACH$/);
});

test("the transport's own deadline answers NETWORK_TIMEOUT, without a resend", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  globalThis.fetch = (_href, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  const pending = request("/api/boot", { method: "POST" });
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(net.REQUEST_TIMEOUT_MS);
  const out = await pending;
  assert.equal(calls, 1);
  assert.deepEqual(out.body, { error: { code: "NETWORK_TIMEOUT" } });
  assert.match(lines[0], /POST \/api\/boot code=UI_BRIDGE_TIMEOUT retried=no$/);
});

test("a body cut off mid-read is a network failure, not an empty 200", async () => {
  scriptFetch({ status: 200, statusText: "", json: async () => { throw undiciError("UND_ERR_SOCKET", "terminated"); } });
  const out = await request("/api/skills", { method: "GET" });
  assert.equal(out.status, 0);
  assert.equal(out.body.error.code, "NETWORK_UNAVAILABLE");
});

test("a non-JSON body is still an answer without a body", async () => {
  scriptFetch({ status: 502, statusText: "Bad Gateway", json: async () => { throw new SyntaxError("Unexpected token <"); } });
  const out = await request("/api/skills", { method: "GET" });
  assert.deepEqual(out, { status: 502, statusText: "Bad Gateway", hasBody: false });
});

test("any other throw answers a generic envelope carrying no raw text", async () => {
  tokens.getAccessToken = async () => { throw new Error("keychain exploded: /Users/x/secret"); };
  const out = await request("/api/skills", { method: "GET" });
  assert.deepEqual(out, { status: 0, statusText: "", hasBody: true, body: { error: { code: "BRIDGE_FAILURE" } } });
  assert.ok(!JSON.stringify(out).includes("keychain"));
  assert.match(lines.at(-1), /^ui-bridge: request failed GET \/api\/skills error=Error$/);
});

test("deliberate bridge refusals still reject", async () => {
  await assert.rejects(request("/auth/x"), /dopl: invalid api path/);
  senderOk = false;
  await assert.rejects(request("/api/skills"), /dopl: refused/);
});

test("the log masks id- and token-like path segments", () => {
  assert.equal(net.logPath(`${API_BASE}/api/join/AbC123xyz?token=s`), "/api/join/:id");
  assert.equal(
    net.logPath(`${API_BASE}/api/channels/3f0c2a1e-1111-2222-3333-444455556666/tasks`),
    "/api/channels/:id/tasks"
  );
});

test("classification: undici codes, the deadline, and everything else", () => {
  assert.deepEqual(net.classifyFailure(undiciError("EPIPE")), { network: true, timeout: false, code: "EPIPE" });
  const aggregate = new TypeError("fetch failed", { cause: Object.assign(new AggregateError([Object.assign(new Error("x"), { code: "ECONNREFUSED" })]), {}) });
  assert.equal(net.classifyFailure(aggregate).code, "ECONNREFUSED");
  assert.equal(net.classifyFailure(new TypeError("fetch failed")).network, true);
  assert.equal(net.classifyFailure(new TypeError("Converting circular structure to JSON")).network, false);
  assert.equal(net.shouldRetry("GET", { network: true, timeout: false, code: "UND_ERR_SOCKET" }), true);
  assert.equal(net.shouldRetry("PATCH", { network: true, timeout: false, code: "UND_ERR_SOCKET" }), false);
  assert.equal(net.shouldRetry("DELETE", { network: true, timeout: false, code: "EAI_AGAIN" }), true);
  assert.equal(net.shouldRetry("GET", { network: true, timeout: true, code: "UI_BRIDGE_TIMEOUT" }), false);
});

// ── main/api.js › resetPool — the pool the retry rides ──────────────────────

const POOL = Symbol.for("undici.globalDispatcher.1");

function loadApi() {
  return loadWithStubs("api.js", {
    "./auth": {}, "./app-version": {}, "./api-repair": {}, "./config": { API_BASE },
  });
}

class FakePool {
  constructor() { this.closed = 0; this.destroyed = 0; }
  close() { this.closed += 1; return Promise.resolve(); }
  destroy() { this.destroyed += 1; return Promise.resolve(); }
}

test("resetPool({ graceful, ifCurrent }) swaps once and lets in-flight requests finish", () => {
  const saved = globalThis[POOL];
  try {
    const api = loadApi();
    const old = new FakePool();
    globalThis[POOL] = old;
    const seen = api.currentPool();
    assert.equal(api.resetPool({ graceful: true, ifCurrent: seen }), true);
    assert.notEqual(globalThis[POOL], old);
    assert.equal(old.closed, 1);
    assert.equal(old.destroyed, 0, "graceful never destroys the old pool");
    assert.equal(api.resetPool({ graceful: true, ifCurrent: seen }), false, "a sibling failure on the old pool does not churn the new one");
    const fresh = globalThis[POOL];
    assert.equal(api.resetPool(), true, "the wake path is unchanged");
    assert.equal(fresh.destroyed, 1);
  } finally {
    globalThis[POOL] = saved;
  }
});

// ── main/wake.js → renderer/app-preload.js › onWake ─────────────────────────

test("a wake tells every live app window, and a dead one does not stop the rest", () => {
  const wake = loadWithStubs("wake.js", {
    electron: { powerMonitor: { on() {} } },
    "./diag": { diag() {} },
  });
  const sent = [];
  const win = (name, opts = {}) => ({
    isDestroyed: () => !!opts.destroyed,
    webContents: { send: (ch) => { if (opts.throws) throw new Error("gone"); sent.push([name, ch]); } },
  });
  const noop = { wake() {}, resetPool() {}, onWake() {} };
  const onWake = wake.arm({
    listener: noop, api: noop, authTokens: noop, uiSync: noop, versionGate: noop,
    getAppWindows: () => [win("shell"), win("closed", { destroyed: true }), win("broken", { throws: true }), win("popout")],
  });
  onWake("resume");
  assert.deepEqual(sent, [["shell", "dopl:wake"], ["popout", "dopl:wake"]]);
  assert.equal(wake.WAKE_EVENT, "dopl:wake");
});

test("the preload's onWake subscribes to exactly that push, and unsubscribes", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { MAIN } = await import("./helpers/module-sandbox.mjs");
  const src = readFileSync(join(MAIN, "..", "renderer", "app-preload.js"), "utf8");
  const listeners = new Map();
  let exposed;
  const electron = {
    contextBridge: { exposeInMainWorld: (_k, v) => { exposed = v; } },
    ipcRenderer: {
      invoke: async () => null,
      on: (ch, fn) => listeners.set(ch, fn),
      removeListener: (ch, fn) => { if (listeners.get(ch) === fn) listeners.delete(ch); },
    },
  };
  new Function("require", "module", "exports", "process", src)(
    () => electron, { exports: {} }, {}, { argv: [] }
  );
  let woke = 0;
  const off = exposed.onWake(() => { woke += 1; });
  listeners.get("dopl:wake")({}, { anything: "ignored" });
  assert.equal(woke, 1);
  off();
  assert.equal(listeners.has("dopl:wake"), false);
  assert.equal(typeof exposed.onWake("not a function"), "function", "a bad callback is refused inertly");
});

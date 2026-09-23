// THE REAL SESSION ENGINE, IN PLAIN NODE — for cases that must go through its entry points
// (`launch*Session`, `messageByTask`, `controlByTask`, `init`) rather than a sliced block.
//
// Faked, and nothing else: `electron` and `electron-store` (one in-memory store file shared by every
// `new Store()`), the network (`api.js › apiFetch` records and answers 503; global `fetch` rejects),
// and the Claude adapter's process edge — `available`, `credentialState`, `models`,
// `buildLaunchSpec`, `start`, `resume`. `start`/`resume` answer a handle the case feeds raw Claude
// frames into; the real `normalize` reads them. Each test FILE is its own process, so the engine's
// module state is fresh per file; import this once, at the top.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
export const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const M = (p) => join(MAIN, p);

function prime(id, exports) {
  const filename = require_.resolve(id);
  require_.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

/** The one electron-store file. */
export const STORE = {};
class FakeStore {
  get(k, d) { return Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : d; }
  set(k, v) { if (k && typeof k === "object") Object.assign(STORE, k); else STORE[k] = v; }
  delete(k) { delete STORE[k]; }
  has(k) { return Object.prototype.hasOwnProperty.call(STORE, k); }
}

prime("electron", {
  app: { isPackaged: false, on() {}, getVersion: () => "0.0.0-test", getPath: () => { throw new Error("no userData in tests"); } },
  Notification: class { static isSupported() { return false; } on() { return this; } show() {} },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  BrowserWindow: class {},
  shell: {},
  safeStorage: { isEncryptionAvailable: () => false },
  powerMonitor: { on() {} },
});
prime("electron-store", FakeStore);

/** Every request that would have reached the server. */
export const requests = [];
const api = require_(M("api.js"));
api.apiFetch = async (path, opts) => {
  requests.push({ path, body: opts && opts.body });
  return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
};
globalThis.fetch = async () => { throw new Error("offline in tests"); };
// The engine arms real idle / abandonment timers; none may keep the test process alive.
for (const name of ["setTimeout", "setInterval"]) {
  const real = globalThis[name];
  globalThis[name] = (...args) => { const t = real(...args); if (t && typeof t.unref === "function") t.unref(); return t; };
}

/** The fake Claude process edge. `credential` is what the credential probe answers (an Error throws). */
export const rt = { credential: { usable: true, source: "cli-store" }, handles: [] };

function fakeHandle(spec, via) {
  const frames = [];
  let waiting = null;
  let done = false;
  const h = {
    via,
    session: spec.session,
    pushed: [],
    interrupts: 0,
    closed: false,
    /** One raw Claude frame, as the SDK would yield it. */
    feed(msg) {
      if (waiting) { const w = waiting; waiting = null; w({ value: msg, done: false }); } else frames.push(msg);
    },
    interrupt() { h.interrupts += 1; return Promise.resolve(); },
    close() {
      h.closed = true;
      done = true;
      if (waiting) { const w = waiting; waiting = null; w({ value: undefined, done: true }); }
    },
    [Symbol.asyncIterator]() { return h; },
    next() {
      if (frames.length) return Promise.resolve({ value: frames.shift(), done: false });
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((r) => { waiting = r; });
    },
  };
  (async () => { for await (const m of spec.prompt) h.pushed.push(m); })().catch(() => {});
  rt.handles.push(h);
  return h;
}

const registry = require_(M("runtime/index.js"));
Object.assign(registry.resolve("claude").runtime, {
  available: async () => ({ ok: true, reason: "" }),
  credentialState: async () => { if (rt.credential instanceof Error) throw rt.credential; return rt.credential; },
  models: async () => { throw new Error("no roster in tests"); },
  buildLaunchSpec: (req) => ({ session: req.session, prompt: req.session.pushIterator }),
  start: (spec) => fakeHandle(spec, "start"),
  resume: (spec) => fakeHandle(spec, "resume"),
});

export const engine = require_(M("session-engine.js"));
export const store = require_(M("session-store.js"));
export const registryReads = require_(M("session-registry.js"));
export const summary = require_(M("session-summary.js"));

/** Every lifecycle the engine asked the host to post. */
export const lifecycles = [];
engine.setLifecycleHandlers({
  onLaunched: (info) => lifecycles.push({ key: info && info.key, kind: "task_started" }),
  onEnded: (info, kind, extra) => lifecycles.push({ key: info && info.key, kind, extra }),
});

export const tick = () => new Promise((r) => setImmediate(r));
export async function settle(n = 20) { for (let i = 0; i < n; i += 1) await tick(); }

/** Raw Claude frames. */
export const frames = {
  init: (sessionId = "sdk-1") => ({ type: "system", subtype: "init", session_id: sessionId, model: "claude-haiku-4-5" }),
  say: (text) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } }),
  result: (input = 10) => ({ type: "result", subtype: "success", usage: { input_tokens: input, output_tokens: 1 } }),
};

export const CHANNEL = "22222222-3333-4444-5555-666666666666";
export const WORKSPACE = "11111111-2222-3333-4444-555555555555";
export const ME = "me-user";

/** The windowless launch every real lane makes (the funnel refuses anything else). */
export function launchArgs(over = {}) {
  return {
    windowless: true,
    channelId: CHANNEL,
    taskId: "",
    workspaceId: WORKSPACE,
    runtime: "claude",
    toolProfile: "channel_agent",
    mode: "interactive",
    message: "hello",
    context: { channelName: "Ops" },
    operatorArmed: true,
    ...over,
  };
}

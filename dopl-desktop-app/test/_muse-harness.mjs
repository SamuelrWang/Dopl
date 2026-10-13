// Shared fixtures for the Muse adapter suites: MSP transcripts (`{dir, raw}` per line — Meta's conformance
// corpus under `fixtures/muse/meta/`, Dopl's own `muse serve` recordings beside it) and a fake MSP
// connection that `launch-spec.js › start` / `login.js` can be pointed at.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const FIX = join(import.meta.dirname, "fixtures", "muse");
export const MUSE = join(import.meta.dirname, "..", "main", "runtime", "muse");
export const m = (file) => require(join(MUSE, file));

/** Every frame of a transcript, parsed: `[{ dir, msg }]`. `name` is relative to `fixtures/muse/`. */
export function transcript(name) {
  return readFileSync(join(FIX, name), "utf8").split("\n").filter(Boolean).map((l) => {
    const o = JSON.parse(l);
    return { dir: o.dir, msg: JSON.parse(o.raw) };
  });
}

/** The server's notifications (no responses, no requests), in order. */
export const notifications = (name) => transcript(name).filter((f) => f.dir === "server" && f.msg.method && f.msg.id === undefined).map((f) => f.msg);
/** The server's held requests (`approval/request` …). */
export const serverRequests = (name) => transcript(name).filter((f) => f.dir === "server" && f.msg.method && f.msg.id !== undefined).map((f) => f.msg);
/** The first `result` the server answered to `method` (matched by the client's request id). */
export function resultOf(name, method) {
  const frames = transcript(name);
  const req = frames.find((f) => f.dir === "client" && f.msg.method === method);
  if (!req) return undefined;
  const res = frames.find((f) => f.dir === "server" && f.msg.id === req.msg.id && f.msg.result !== undefined);
  return res && res.msg.result;
}

export const tick = () => new Promise((r) => setImmediate(r));
export async function until(pred, what, n = 400) {
  for (let i = 0; i < n; i += 1) { if (pred()) return; await tick(); }
  throw new Error(`timed out: ${what}`);
}

/** A push iterator standing in for core's prompt queue. */
export function pushQueue() {
  const items = [];
  let wake = null;
  return {
    push(x) { items.push(x); if (wake) { const w = wake; wake = null; w(); } },
    [Symbol.asyncIterator]() {
      return { next: async () => { while (!items.length) await new Promise((r) => { wake = r; }); return { value: items.shift(), done: false }; } };
    },
  };
}

/**
 * A fake `muse serve` connection. `answers[method](params, calls)` → the result (a thrown error is a JSON-RPC
 * error). Records every request/notify in `calls`; `hooks()` is the opts `connect` was given.
 */
export function fakeConn(answers = {}) {
  const calls = [];
  let opts = null;
  const conn = {
    async request(method, params) {
      calls.push({ method, params });
      const a = answers[method];
      if (typeof a === "function") return a(params, calls);
      if (a !== undefined) return a;
      return {};
    },
    notify(method, params) { calls.push({ method, params, notification: true }); },
    close() { calls.push({ method: "close" }); },
  };
  return {
    conn, calls,
    connect: (o) => { opts = o; return conn; },
    hooks: () => opts,
    notify: (method, params) => opts.onNotification({ method, params }),
    serverRequest: (msg) => opts.onServerRequest(msg),
  };
}

/** A `session/start` echo for what Dopl sent (the measured 1.4.7 shape). */
export function sessionEcho(sent, over = {}) {
  return {
    session: Object.assign({
      sessionId: "01a13697-1878-72a2-aabf-0b47302ecf71",
      status: "idle", activeTurnId: null, workspaceRoot: sent.workspaceRoot, providerId: "meta",
      modelId: sent.modelId || null,
      approvalMode: { mode: sent.approvalMode, source: "startup", lastCommandId: null },
      permissionState: { profileId: sent.permissionProfile, reviewerAuthority: "human", reviewerAttached: true },
    }, over),
    viewCursor: "",
  };
}

export const INIT = Object.freeze({
  serverInfo: { name: "muse", version: "1.4.7" }, museHome: "/tmp/x/data/muse", platformFamily: "unix", platformOs: "macos",
  schema: { version: 1, fingerprint: "sha256:6de32db0" }, grantedCapabilities: ["sessionMcp"], experimentalApi: true,
});

// Shared fixtures for the Grok adapter suites: Dopl's own `grok agent --no-leader stdio` recordings
// (`fixtures/grok/*.ndjson`, `{t, dir, raw}` per line — `out` to grok, `in` from grok, plus `spawn`/`mark`/`exit`;
// grok 1.0.52, real-model smoke 2026-10-13, redacted, setup/announcement chatter and reasoning signatures
// trimmed) and a fake ACP connection `launch-spec.js › start` can be pointed at.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const FIX = join(import.meta.dirname, "fixtures", "grok");
export const GROK = join(import.meta.dirname, "..", "main", "runtime", "grok");
export const g = (file) => require(join(GROK, file));

/** Every frame of a recording: `[{ dir, msg }]` (`msg` is the parsed JSON-RPC frame, or the raw mark object). */
export function recording(name) {
  return readFileSync(join(FIX, name), "utf8").split("\n").filter(Boolean).map((l) => {
    const o = JSON.parse(l);
    let msg = null;
    try { msg = JSON.parse(o.raw); } catch (_) { msg = o.raw; }
    return { dir: o.dir, msg };
  });
}

/** Grok's frames (`in`) only. */
export const inbound = (name) => recording(name).filter((f) => f.dir === "in").map((f) => f.msg);
/** Grok's server→client requests (`session/request_permission`, `_x.ai/hooks/run`). */
export const serverRequests = (name, method) => inbound(name).filter((m) => m.method && m.id !== undefined && (!method || m.method === method));
/** Grok's notifications. */
export const notifications = (name) => inbound(name).filter((m) => m.method && m.id === undefined);
/** What Dopl's driver answered each server request with, by id + method order. */
export const outbound = (name) => recording(name).filter((f) => f.dir === "out").map((f) => f.msg);
/** The result Grok answered to the Nth request named `method` (0-based). */
export function resultOf(name, method, nth = 0) {
  const frames = recording(name);
  const reqs = frames.filter((f) => f.dir === "out" && f.msg && f.msg.method === method);
  const req = reqs[nth];
  if (!req) return undefined;
  const at = frames.indexOf(req);
  const res = frames.slice(at).find((f) => f.dir === "in" && f.msg && f.msg.id === req.msg.id && f.msg.method === undefined);
  return res && (res.msg.result !== undefined ? res.msg.result : { error: res.msg.error });
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
export const userMsg = (text) => ({ message: { content: text } });

/**
 * A fake `grok agent` connection. `answers[method](params, calls)` → the result (a thrown error is a JSON-RPC
 * error; a returned Promise may be held). Records every request/notify in `calls`.
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
    notify: (method, params) => opts.onNotification({ jsonrpc: "2.0", method, params }),
    serverRequest: (msg) => opts.onServerRequest(msg),
  };
}

export const INIT = JSON.parse(readFileSync(join(FIX, "initialize-1.0.52.json"), "utf8"));
/** The signed-out `initialize` answer: the same build with only the browser method (LIVE, `g2`). */
export const INIT_SIGNED_OUT = Object.assign({}, INIT, { authMethods: INIT.authMethods.filter((m) => m.id !== "cached_token") });
/** The first `session/new` answer of a recording (models + configOptions + _meta). */
export const SESSION_NEW = resultOf("smoke-s3-resume-steer.ndjson", "session/new");

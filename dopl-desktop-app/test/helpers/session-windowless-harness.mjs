// Shared harness for the `main/session-windowless.js` suites.
//
// ⚠ EXTRACTED 2026-10-12 AT THE §2 CAP. `test/session-windowless-deny.test.mjs` crossed 500 lines
// when the failed-decision cases landed, so the NAVIGATION half moved to
// `test/session-windowless-open.test.mjs`. Both suites load the real module the same way, and a
// second copy of this loader is exactly the drift a split is meant to avoid: `load`'s stub list
// is a statement about what this module may reach, and two of them would disagree.
//
// Nothing here is a test.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(join(HERE, "..", "main", "session-windowless.js"), "utf8");

export function load(consentOver = {}, targetingOver = null) {
  const notices = [];
  const posts = []; // T25: the ONE thread_progress a first denial writes into the channel
  const diags = [];
  const rows = [];
  const banners = []; // notifyToolGate captures — { channelName, tool, onAllow, onOpen }
  const stamps = []; // session-permissions bookkeeping — ["auto"|"timeout", requestId]
  const consent = {
    createConsentRequest: async (workspaceId, row) => { rows.push({ workspaceId, ...row }); return null; },
    notifyOutbound: () => {},
    // The banner is "shown" and handed back as a fake Notification the TTL can close.
    notifyToolGate: (args) => { banners.push(args); return { close: () => {} }; },
    submitDecision: async () => {},
    pollStatus: async () => null,
    ...consentOver,
  };
  const stubRequire = (id) => {
    // 2026-10-09 (Samuel's spec): the denial notice is POPUP ONLY now and goes through the route
    // as `tool_blocked`, not through `channel-post.notifyLocal`. Captured here in the same
    // `notices` array, so every assertion below still reads the operator-facing copy.
    if (id === "./notification-route") {
      return {
        raise: (eventId, spec) => {
          notices.push({ eventId, title: spec && spec.title, body: spec && spec.body });
          return "popup";
        },
      };
    }
    if (id === "./channel-post") {
      return {
        // T25. The real signature is (entry, m, kind, threadId, extra, bodyText, opts).
        postThreadEvent: async (entry, m, kind, threadId, extra, bodyText, opts) => {
          posts.push({ entry, m, kind, threadId, extra, bodyText, opts });
          return true;
        },
      };
    }
    if (id === "./consent") return consent;
    if (id === "./targeting") return targetingOver || { openChannelForEntry: () => {} };
    if (id === "./session-permissions") {
      return {
        noteAutoDenied: (s, rid) => stamps.push(["auto", rid]),
        noteGateTimeout: (s, rid) => stamps.push(["timeout", rid]),
      };
    }
    if (id === "./diag") return { diag: (...p) => diags.push(p.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", SRC)(
    stubRequire, mod, mod.exports, timers.set
  );
  return { ...mod.exports, notices, posts, diags, rows, banners, stamps };
}

// ⚠ A HAND-ROLLED TIMER SHIM rather than node:test's mock timers: the module is evaluated via
// `new Function`, so injecting `setTimeout` as a parameter is exact — no global swapping, no
// interference with the runner's own timers, and `sleep()`'s real setTimeout is untouched
// because only the injected name reaches the module body.
export const timers = (() => {
  let queue = [];
  return {
    set: (fn, ms) => { const t = { fn, ms, unref: () => {} }; queue.push(t); return t; },
    fire: () => { const q = queue; queue = []; q.forEach((t) => t.fn()); },
    pending: () => queue.length,
    reset: () => { queue = []; },
  };
})();

/** A windowless session with one pending permission, as the engine holds it. */
export function session(over = {}) {
  return {
    windowless: true,
    channelId: "chan-1",
    threadId: "thread-1",
    workspaceId: "ws-1",
    settled: false,
    pendingPermissions: new Map([["req-1", {}]]),
    context: { channelName: "Website" },
    ...over,
  };
}

export const REQ = { type: "permission_request", requestId: "req-1", name: "Bash" };
export const flush = () => new Promise((r) => setImmediate(r));

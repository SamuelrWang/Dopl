// A 401 MUST STILL ANSWER null WHEN THE NOTICE CANNOT BE RAISED (2026-10-11, release review).
//
// THE DEFECT. `listener-io.js › notifyStale` used to wrap its `new Notification` in
// `try { … } catch {}`. Routing the notice through `main/notification-route.js` dropped that
// wrapper and replaced the construction with a LAZY `require('./notification-route')`. `raise()`
// guards its own internals; the require does not. And `notifyStale`'s two callers —
// `listWorkspaces` and `listChannels`, both of whose contract is "null means could not ask" —
// call it OUTSIDE any try. So a module-load throw stopped being a missed notification and became
// a thrown reconcile pass: no workspaces, no presence, no push, every channel loop starved, and
// the pass dying at step one the way the 1.8.x outage did.
//
// Worse, the latch was set BEFORE the raise, so the notice was lost AND latched — the operator
// was never told the session had expired, and never would be.
//
// METHOD: the shipped `listener-io.js` loaded over a stub map, with `./notification-route`
// answered by a THROWING getter so the failure is at require time, which is the leg `raise()`'s
// own guards cannot cover.
//
// Run: `node --test dopl-desktop-app/test/listener-stale-notice.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";

const API_BASE = "https://app.example";
const realFetch = globalThis.fetch;

/**
 * listener-io.js over fakes.
 * @param {object} o
 * @param {"throw-on-require"|"throw-on-raise"|"ok"} o.route how the notification route misbehaves
 */
function boot(o = {}) {
  const lines = [];
  const raised = [];
  const stubs = {
    "electron-store": class { get() { return {}; } set() {} },
    "./auth": { getAuthCookie: async () => "sb-x=tok" },
    "./app-version": { versionHeaders: () => ({}) },
    "./session-id-header": { sessionHeaders: () => ({}) },
    "./device-identity": { deviceHeaders: () => ({}) },
    "./listener-heal": real("./listener-heal"),
    // The repair is not the subject: run the send once and hand its answer back.
    "./api-repair": {
      fetchWithAuthRepair: (_tag, _path, send) => send(),
      discardBody: () => {},
    },
    "./listener-budget": { isWakeAbort: () => false, awaitTimeoutFor: () => 1, fetchTimeoutFor: () => 1 },
    "./config": { API_BASE, LISTENER: { AWAIT_TIMEOUT_MS: 1, AWAIT_FETCH_TIMEOUT_MS: 1, IDLE_GAP_MS: 1 }, REALTIME: { CHEAP_AWAIT_TIMEOUT_MS: 1, CHEAP_FETCH_TIMEOUT_MS: 1, LONG_IDLE_MS: 1 } },
    "./diag": { diag: (...parts) => lines.push(parts.join(" ")) },
    "./listener-people": {},
  };
  const routeOk = { raise: (id, payload) => { raised.push({ id, payload }); } };
  if (o.route === "throw-on-require") {
    // ⚠ THE LEG `raise()` CANNOT GUARD. A getter, because that is how a require that throws at
    // MODULE LOAD looks to the caller: the failure happens before any export exists to be safe.
    Object.defineProperty(stubs, "./notification-route", {
      enumerable: true,
      get() { throw new Error("notification-route failed to load"); },
    });
  } else if (o.route === "throw-on-raise") {
    stubs["./notification-route"] = { raise: () => { throw new Error("raise blew up"); } };
  } else {
    stubs["./notification-route"] = routeOk;
  }
  return { io: loadWithStubs("listener-io.js", stubs), lines, raised };
}

/** Every fetch answers this status, with a body nothing reads. */
function statusFetch(status) {
  globalThis.fetch = async () => ({ status, ok: status >= 200 && status < 300, json: async () => ({}) });
}

// ── THE REGRESSION ───────────────────────────────────────────────────────────

test("a 401 whose notice cannot even be REQUIRED still answers null from listChannels", async () => {
  const { io, lines } = boot({ route: "throw-on-require" });
  try {
    statusFetch(401);
    const outcome = {};
    // Before the fix this REJECTED: `notifyStale` threw out of the 401 branch, past
    // `listChannels`, past `listChannelsWithRetry`, into the reconcile pass.
    const chans = await io.listChannels("3f0c2a1e-1111-2222-3333-444455556666", outcome);
    assert.equal(chans, null, "null means `could not ask`, and that is still the answer");
    assert.equal(outcome.authFailure, true, "and the 401 is still classified as auth-shaped");
    assert.ok(lines.some((l) => /stale-session notice failed/.test(l)), "the failure is logged, not swallowed");
    assert.ok(lines.some((l) => /listChannels 401 ws/.test(l)), "and the 401's own line still runs");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("listWorkspaces, the FIRST call of every reconcile pass, survives it the same way", async () => {
  const { io } = boot({ route: "throw-on-require" });
  try {
    statusFetch(401);
    assert.equal(await io.listWorkspaces(), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a route that throws INSIDE raise is contained too", async () => {
  // `raise()` guards its own internals today; this pins that `notifyStale` does not depend on
  // that remaining true.
  const { io } = boot({ route: "throw-on-raise" });
  try {
    statusFetch(401);
    assert.equal(await io.listChannels("ws-1", {}), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── THE LATCH ────────────────────────────────────────────────────────────────

test("a FAILED notice is not latched — the next 401 tries again", async () => {
  // ⚠ THE SECOND HALF OF THE DEFECT. `staleNotified = true` ran BEFORE the raise, so one
  // unloadable route meant the operator was never told the session had expired and never would
  // be, for the life of the process.
  const { io, lines } = boot({ route: "throw-on-require" });
  try {
    statusFetch(401);
    await io.listChannels("ws-1", {});
    await io.listChannels("ws-1", {});
    assert.equal(
      lines.filter((l) => /stale-session notice failed/.test(l)).length,
      2,
      "a lost notice must not latch: it was never delivered"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a DELIVERED notice latches, and is said exactly once", async () => {
  // The latch's real job, unchanged: `signed_out` carries no sound and no button because the
  // copy says what to do, and it is said once.
  const { io, raised } = boot({ route: "ok" });
  try {
    statusFetch(401);
    await io.listChannels("ws-1", {});
    await io.listChannels("ws-1", {});
    await io.listWorkspaces();
    assert.equal(raised.length, 1, "once per expiry, not once per 401");
    assert.equal(raised[0].id, "signed_out");
    assert.match(raised[0].payload.body, /sign in to resume channel listening/);
    // …and the listen loop's reset re-arms it for a later expiry.
    io.resetStale();
    await io.listChannels("ws-1", {});
    assert.equal(raised.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

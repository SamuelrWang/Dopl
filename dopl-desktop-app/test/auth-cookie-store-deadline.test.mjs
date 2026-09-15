// THE COOKIE STORE CANNOT WEDGE A REQUEST PATH ANY MORE (2026-09-15, F-700).
//
// THE BOOT THIS LOCKS OUT. 08:22:33Z: Electron's stdout logs
// `ERROR:content/browser/network_service_instance_impl.cc:721] Network service crashed or was
// terminated, restarting service.`; listener.log logs `presence: started` at 08:22:33.624 and
// then `presence: superseding the in-flight beat` at 08:23:05 — the FIRST beat still in flight
// after 30 seconds — followed by no `reconcile:`, no `namecache loaded`, no `session-state
// push` and no `auth-tokens` line at all. (A healthy boot aborts that superseded beat in ~12s
// and loads the name cache in ~15s; the 2026-09-14 09:11:00Z boot has the identical shape.)
// F-698 had already bounded the refresh POST, and a fresh process has a fresh undici pool, so
// the only unbounded await left on every request path was `session.defaultSession.cookies.get`
// — which `api.js › sendOnce` and `listener-io.js › sendOnce` both reach through
// `auth.getAuthCookie()` BEFORE arming their own AbortController. Chromium's network service
// owns that store; when it restarts, an in-flight promise can be dropped and never settle.
//
// WHY SOURCE EXTRACTION: `main/auth-cookies.js` requires `electron` (session) and `./config`,
// so it cannot be imported under `node --test`. The four functions that make up the bound are
// sliced verbatim with `fnOf` and evaluated over injected deps — the REAL `main/deadline.js` is
// injected rather than stubbed, on the same one-program argument as `_session-state-push-harness`.
//
// Run: `node --test dopl-desktop-app/test/auth-cookie-store-deadline.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const SRC = readFileSync(join(MAIN, "auth-cookies.js"), "utf8");
const deadline = createRequire(import.meta.url)(join(MAIN, "deadline.js"));

const ORIGIN = "https://app.usedopl.test";
const HOST = "app.usedopl.test";
const BASE = "sb-testref-auth-token";

// ⚠ The deadline is a PARAMETER of the slice, not a rewrite of it: the shipped constant is 5s
// and a suite must not wait 5s, so the same source runs against a 25ms clock.
const TEST_DEADLINE_MS = 25;

// ⚠ `fnOf` anchors on the `function` keyword, so it drops a leading `async` and the slice then
// fails to parse its own `await`. Put it back rather than reaching past the shared probe.
const asyncFnOf = (src, name) =>
  (new RegExp(`async\\s+function\\s+${name}\\s*\\(`).test(src) ? "async " : "") + fnOf(src, name);

/**
 * One fresh instance of the bound per test — including a fresh `stalledReported` set, so
 * "logs once" is a claim about one process rather than about the order of these tests.
 */
function load(cookiesImpl) {
  const logged = [];
  const make = new Function(
    "session", "APP_ORIGIN", "APP_HOST", "COOKIE_BASE", "diag",
    "withDeadline", "DEADLINE", "COOKIE_STORE_TIMEOUT_MS", "stalledReported",
    `${fnOf(SRC, "isOurAuthCookie")}
     ${fnOf(SRC, "cookieStoreStalled")}
     ${fnOf(SRC, "jarCall")}
     ${asyncFnOf(SRC, "getSessionCookieHeader")}
     return { getSessionCookieHeader, isOurAuthCookie };`
  );
  const api = make(
    { defaultSession: { cookies: cookiesImpl } },
    ORIGIN, HOST, BASE,
    (...parts) => logged.push(parts.join(" ")),
    deadline.withDeadline, deadline.DEADLINE, TEST_DEADLINE_MS,
    new Set()
  );
  return { ...api, logged };
}

/** A store whose `get` never settles and never rejects — the dropped-promise shape. */
const deadStore = { get: () => new Promise(() => {}) };

test("a store that NEVER ANSWERS returns '' instead of hanging the caller", async () => {
  const api = load(deadStore);
  const t0 = Date.now();
  assert.equal(await api.getSessionCookieHeader(), "");
  assert.ok(Date.now() - t0 < 2000, "it answered on the deadline, not on the store");
});

// ⚠ '' is deliberately the SAME answer as "signed out / no cookies yet": `auth.js ›
// getAuthCookie` falls through to the stored-blob path, which F-698 already bounded at 20s.
test("the timeout answer is the signed-out answer, so getAuthCookie falls through to the blob path", async () => {
  const empty = load({ get: async () => [] });
  const dead = load(deadStore);
  assert.equal(await dead.getSessionCookieHeader(), await empty.getSessionCookieHeader());
});

test("ONE diag line per process, not one per call — a dead store must not log on every 30s beat", async () => {
  const api = load(deadStore);
  await api.getSessionCookieHeader();
  await api.getSessionCookieHeader();
  const stalls = api.logged.filter((l) => l.includes("cookie store did not answer"));
  assert.equal(stalls.length, 1, `logged once across two stalled calls, got ${api.logged.length} line(s)`);
  assert.ok(stalls[0].includes("getSessionCookieHeader"), "the line names the function that gave up");
});

test("a SETTLING store still returns the header — the bound is invisible on the healthy path", async () => {
  const api = load({
    get: async ({ url }) => {
      assert.equal(url, ORIGIN, "still scoped to APP_ORIGIN");
      return [
        { name: `${BASE}.0`, value: "aaa", domain: HOST },
        { name: `${BASE}.1`, value: "bbb", domain: HOST },
      ];
    },
  });
  assert.equal(await api.getSessionCookieHeader(), `${BASE}.0=aaa; ${BASE}.1=bbb`);
  assert.equal(api.logged.length, 0, "a healthy read logs nothing");
});

// ⚠ FIX S3 IS NOT WEAKENED BY THE BOUND: a sibling subdomain's DOMAIN cookie is still rejected
// on the way through the new sentinel check.
test("a settling store's foreign domain cookie is still filtered out", async () => {
  const api = load({
    get: async () => [
      { name: BASE, value: "planted", domain: ".usedopl.test" },
      { name: BASE, value: "ours", domain: HOST },
    ],
  });
  assert.equal(await api.getSessionCookieHeader(), `${BASE}=ours`);
});

test("a store that REJECTS is still the caught, '' answer it always was", async () => {
  const api = load({ get: async () => { throw new Error("store gone"); } });
  assert.equal(await api.getSessionCookieHeader(), "");
  assert.ok(api.logged.some((l) => l.includes("cookie read failed")), "the pre-existing catch still logs");
});

// The shipped deadline itself, asserted where it lives rather than in prose.
test("the shipped deadline is 5s — a local IPC hop to Chromium, not a network call", () => {
  assert.match(SRC, /const COOKIE_STORE_TIMEOUT_MS = 5000;/);
});

// ⚠ Every store call in the file goes through `jarCall`. A future `cookies.get/set/remove`
// added bare would reintroduce exactly the await this finding is about.
test("NO bare `session.defaultSession.cookies.*` await is left in the file", () => {
  const bare = SRC.split("\n").filter((l) => /await session\.defaultSession\.cookies\./.test(l));
  assert.deepEqual(bare, [], `these lines bypass jarCall:\n${bare.join("\n")}`);
});

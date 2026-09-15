// THE SUPABASE REFRESH POST HAS A DEADLINE (2026-09-14, F-698).
//
// `auth.js › refreshInner` called `fetch` with no signal. On the 09:11:00Z boot the post-wake socket
// was dead and that one call hung ~25 minutes; `refresh()` is single-flight, so the session-state
// push's boot cycle, the listener's first reconcile and presence's first beat all awaited the same
// promise. The two guarded lanes never recovered (`running` / `reconciling` held for the life of the
// process). This suite drives the REAL transport with a fake fetch and a fake clock.
//
// Run: `node --test dopl-desktop-app/test/auth-refresh-transport.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const transport = createRequire(import.meta.url)(join(MAIN, "auth-refresh-transport.js"));

/** A hand-driven clock: `fire()` runs the armed deadline. */
function fakeTimers() {
  const armed = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, unref() {} }; armed.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    armed,
    fire: () => { for (const t of armed) if (!t.cleared) t.fn(); },
  };
}

/** A fetch that never answers on its own but honours its abort signal, like a dead socket. */
function hangingFetch(seen) {
  return (url, init) => new Promise((_resolve, reject) => {
    seen.push({ url, init });
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
}

test("a refresh that never answers is ABORTED at the deadline, not awaited forever", async () => {
  const timers = fakeTimers();
  const seen = [];
  const pending = transport.postRefresh({
    supabaseUrl: "https://x.supabase.co", anonKey: "anon", refreshToken: "rt-1",
    fetchImpl: hangingFetch(seen), timers,
  });
  assert.equal(timers.armed.length, 1, "one deadline is armed");
  assert.equal(timers.armed[0].ms, transport.REFRESH_TIMEOUT_MS);
  timers.fire();
  await assert.rejects(pending, (err) => err.name === "AbortError");
  assert.equal(seen[0].init.signal.aborted, true, "the fetch's own signal is what was aborted");
});

test("a refresh that answers clears its deadline and passes the wire shape through untouched", async () => {
  const timers = fakeTimers();
  const seen = [];
  const answer = { ok: true, status: 200 };
  const res = await transport.postRefresh({
    supabaseUrl: "https://x.supabase.co", anonKey: "anon", refreshToken: "rt-1",
    fetchImpl: async (url, init) => { seen.push({ url, init }); return answer; }, timers,
  });
  assert.equal(res, answer);
  assert.equal(timers.armed[0].cleared, true, "the deadline does not outlive the call");
  assert.equal(seen[0].url, "https://x.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.headers.apikey, "anon");
  assert.equal(seen[0].init.headers.Authorization, "Bearer anon");
  assert.deepEqual(JSON.parse(seen[0].init.body), { refresh_token: "rt-1" });
});

test("a network throw clears the deadline too and reaches the caller as the same error", async () => {
  const timers = fakeTimers();
  await assert.rejects(
    transport.postRefresh({
      supabaseUrl: "https://x.supabase.co", anonKey: "anon", refreshToken: "rt-1",
      fetchImpl: async () => { throw new Error("fetch failed"); }, timers,
    }),
    /fetch failed/
  );
  assert.equal(timers.armed[0].cleared, true);
});

test("the deadline is generous, and longer than api.js's 15s so a repair chain is bounded by the longer timer", () => {
  assert.ok(transport.REFRESH_TIMEOUT_MS > 15000);
  assert.ok(transport.REFRESH_TIMEOUT_MS <= 30000);
});

test("SOURCE: auth.js's refreshInner goes through the transport and has no bare fetch left", () => {
  const src = readFileSync(join(MAIN, "auth.js"), "utf8");
  const inner = src.slice(src.indexOf("async function refreshInner("), src.indexOf("\n}\n", src.indexOf("async function refreshInner(")));
  assert.ok(inner.includes("refreshTransport.postRefresh("), "refreshInner posts through the transport");
  assert.ok(!/\bawait fetch\(/.test(inner), "no unbounded fetch remains in refreshInner");
});

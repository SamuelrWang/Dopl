// THE 1.8.x CHANNELS OUTAGE, locked out.
//
// WHAT HAPPENED. api.js:2 said it out loud — "The Channels listener keeps its own
// copy (E2E-verified — not refactored here)". So when Phase 2 gave api.js a 401
// repair, listener-io.js never got one, and listener-io is the transport under
// `listWorkspaces`, `listChannels`, every `/await` long-poll, channel-post's task
// lifecycle, the roster, threads and consent. On the bundled SPA nothing keeps the
// Supabase cookie jar fresh (the page that used to is gone) and `getAuthCookie()`
// repairs an EMPTY jar, never a STALE one — the jar cookie is written with a
// 400-day expiry, so it long outlives the JWT inside it. Every Channels call
// therefore 401'd on an expired credential, and the subsystem recovered only BY
// LUCK: when some other api.js caller happened to 401 first and repair the shared
// jar.
//
// AND IT WAS SILENT. `listWorkspaces`'s 401 branch was `{ notifyStale(); return
// null; }` — the ONE exit in the whole listener that logged nothing. It is also
// the FIRST call of every reconcile pass, and reconcile returned on its null
// before presence, realtime, identity resolution and every channel loop. Field
// evidence (listener.log, 2026-08-04): 293 × `reconcile self-heal: retrying 1
// unenumerated workspace(s)`, and ZERO listWorkspaces / listChannels /
// enumeration-FAILED / namecache / identity lines — proving the pass died at step
// one, in the branch that said nothing, while the log blamed "1 unenumerated
// workspace" that had never been asked about.
//
// WHY SOURCE EXTRACTION: api-repair.js and listener-io.js are CommonJS and pull in
// electron + electron-store, so they cannot be imported under `node --test`. The
// functions are sliced verbatim and driven with injected fakes, so this exercises
// what ships. listener-heal.js is dependency-free and is required for real.
//
// Run: `node --test dopl-desktop-app/test/listener-auth-repair.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const require = createRequire(import.meta.url);
const heal = require("../main/listener-heal.js"); // dependency-free: the REAL module

const REPAIR = M("api-repair.js");
const IO = M("listener-io.js");
const API = M("api.js");
const LISTENER = M("channel-listener.js");
const TOKENS = M("auth-tokens.js");
// ⚠ THE 401 RULE MOVED (2026-08-30): `shouldRepairAuth` and the rest of the pure block
// live in `main/auth-token-rules.js` since auth-tokens.js hit the §2 cap. Same source,
// new address; auth-tokens.js re-exports it, so no call site changed.
const TOKEN_RULES = M("auth-token-rules.js");

// fnOf slices from the `function` keyword, so an `async function` loses its
// modifier. Re-attach it, asserting the shipped function really is async.
function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// The REAL one-retry rule, not a mirror of it.
const shouldRepairAuth = new Function(
  `${fnOf(TOKEN_RULES, "shouldRepairAuth")}\n return shouldRepairAuth;`
)();

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

// ── The listener transport, assembled from the shipped source ────────────────
// sendOnce + apiFetch (listener-io.js) over fetchWithAuthRepair (api-repair.js),
// with the cookie jar, the token authority, diag and fetch injected.
function transport(opts = {}) {
  const calls = { fetch: [], diag: [], emits: [], cookieWrites: [], refreshes: 0 };
  // The jar: a plain box. `stale` is what the server rejects; a repair replaces it.
  let cookie = opts.cookie === undefined ? "sb-x-auth-token=STALE" : opts.cookie;
  const refresh = opts.refresh === undefined
    ? async () => ({ access_token: "FRESH" })
    : opts.refresh;

  const auth = {
    getAuthCookie: async () => cookie,
    writeSessionCookies: async (s) => {
      calls.cookieWrites.push(s);
      if (opts.writeThrows) throw new Error("jar is locked");
      cookie = `sb-x-auth-token=${s.access_token}`;
    },
  };
  const authTokens = {
    shouldRepairAuth,
    forceRefresh: async () => { calls.refreshes += 1; return refresh(); },
    emitAuthState: (s) => calls.emits.push(s),
    // ⚠ 2026-08-30: the 401-survived branch LATCHES rather than emitting bare. Recorded as
    // the same 'signed-out' the old seam produced, because the observable half is
    // unchanged — what moved is that auth-tokens now REMEMBERS it (the flap fix). The
    // latch itself is pinned in test/auth-storage-unavailable.test.mjs.
    noteSessionRejected: () => calls.emits.push("signed-out"),
  };
  const diag = (...a) => calls.diag.push(a.join(" "));

  // ⚠ `discardBody` IS SLICED FROM SOURCE ALONGSIDE IT, not stubbed (2026-08-30): the
  // release of the pre-retry 401 body is the thing the leak pin below measures, and a
  // stub here would let the shipped call be deleted with the pin still green.
  const fetchWithAuthRepair = new Function(
    "auth", "authTokens", "diag",
    `${fnOf(REPAIR, "discardBody")}\n`
      + `${asyncFnOf(REPAIR, "fetchWithAuthRepair")}\n return fetchWithAuthRepair;`
  )(auth, authTokens, diag);

  // `responses` is consumed one entry per ATTEMPT: a response, an Error to throw,
  // or "hang" (never settles until the request's own signal aborts).
  const responses = (opts.responses || []).slice();
  const fakeFetch = (url, init) => {
    calls.fetch.push({ url, init, cookie: init.headers.Cookie, signal: init.signal });
    const r = responses.shift();
    if (init.signal && init.signal.aborted) return Promise.reject(abortError());
    if (r === "hang") {
      return new Promise((_, rej) => {
        init.signal.addEventListener("abort", () => rej(abortError()), { once: true });
      });
    }
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r === undefined ? { ok: true, status: 200 } : r);
  };

  const apiFetch = new Function(
    "auth", "appVersion", "API_BASE", "fetch", "fetchWithAuthRepair",
    `${asyncFnOf(IO, "sendOnce")}\n${fnOf(IO, "apiFetch")}\n return apiFetch;`
  )(auth, { versionHeaders: () => ({ "X-Dopl-App-Version": "1.8.4" }) },
    "https://app.test", fakeFetch, fetchWithAuthRepair);

  return { apiFetch, calls, jar: () => cookie };
}

const ok = { ok: true, status: 200, json: async () => ({ workspaces: [{ id: "w1" }] }) };
const unauthorized = { ok: false, status: 401 };

// ── 1. The repair itself ─────────────────────────────────────────────────────

test("a 200 is returned untouched — no refresh, no second request", async () => {
  const t = transport({ responses: [ok] });
  const res = await t.apiFetch("/api/workspaces", { timeoutMs: 100 });
  assert.equal(res.status, 200);
  assert.equal(t.calls.fetch.length, 1);
  assert.equal(t.calls.refreshes, 0, "a healthy call must never rotate the refresh token");
});

test("a non-401 failure is NOT an auth problem and must not rotate anything", async () => {
  for (const status of [403, 404, 429, 500, 503]) {
    const t = transport({ responses: [{ ok: false, status }] });
    const res = await t.apiFetch("/api/channels", { workspaceId: "w1" });
    assert.equal(res.status, status);
    assert.equal(t.calls.refreshes, 0, `${status} must not force a rotation`);
    assert.equal(t.calls.fetch.length, 1, `${status} must not retry`);
  }
});

test("THE FIX: a 401 forces one rotation, repairs the JAR, and retries once", async () => {
  const t = transport({ responses: [unauthorized, ok] });
  const res = await t.apiFetch("/api/workspaces", { timeoutMs: 100 });
  assert.equal(res.status, 200, "the retry's answer is what the caller gets");
  assert.equal(t.calls.refreshes, 1);
  assert.equal(t.calls.fetch.length, 2);
  // The whole point: the retry carried a DIFFERENT credential. Before this fix the
  // listener re-sent the same dead cookie forever, or waited for another module to
  // repair the shared jar by luck.
  assert.equal(t.calls.fetch[0].cookie, "sb-x-auth-token=STALE");
  assert.equal(t.calls.fetch[1].cookie, "sb-x-auth-token=FRESH");
  assert.deepEqual(t.calls.emits, [], "a repaired 401 is not a sign-out");
});

test("EXACTLY ONCE: a 401 that survives a fresh token surfaces instead of spinning", async () => {
  const t = transport({ responses: [unauthorized, unauthorized, ok] });
  const res = await t.apiFetch("/api/channels/c1/await?since=0&timeoutMs=1");
  assert.equal(res.status, 401, "a real authorization answer must reach the caller");
  assert.equal(t.calls.fetch.length, 2, "never a third attempt — this is the retry-storm guard");
  assert.equal(t.calls.refreshes, 1, "and never a second rotation of a rotating refresh token");
  assert.match(t.calls.diag.join("\n"), /401 survived a forced refresh/);
  assert.deepEqual(t.calls.emits, ["signed-out"], "…and it is surfaced, not swallowed");
});

test("a refresh that produces nothing surfaces the original 401 — and does NOT sign out", async () => {
  // auth-tokens classifies 5xx / 429 / timeouts as TRANSIENT and keeps the stored
  // session, so a null refresh is "could not rotate", not "you are signed out".
  // Emitting signed-out here would flip the renderer to the login screen on a blip.
  for (const refresh of [async () => null, async () => ({}), async () => ({ access_token: "" })]) {
    const t = transport({ responses: [unauthorized, ok], refresh });
    const res = await t.apiFetch("/api/workspaces");
    assert.equal(res.status, 401);
    assert.equal(t.calls.fetch.length, 1, "no retry with a credential we never got");
    assert.deepEqual(t.calls.emits, []);
    assert.match(t.calls.diag.join("\n"), /401 and the refresh did not produce a session/);
  }
});

test("a refresh that THROWS cannot spin, and cannot take the caller down with it", async () => {
  const t = transport({
    responses: [unauthorized, ok],
    refresh: async () => { throw new Error("network is down"); },
  });
  await assert.rejects(() => t.apiFetch("/api/workspaces"), /network is down/);
  assert.equal(t.calls.fetch.length, 1, "bounded: no retry loop behind a failing refresh");
});

test("a jar write that fails still retries once, with the failure on the record", async () => {
  const t = transport({ responses: [unauthorized, ok], writeThrows: true });
  const res = await t.apiFetch("/api/workspaces");
  assert.equal(res.status, 200);
  assert.equal(t.calls.fetch.length, 2);
  assert.match(t.calls.diag.join("\n"), /jar repair after 401 failed/);
});

// ── 2. The long-poll's behavior is unchanged ─────────────────────────────────

test("the request the listener sends is byte-for-byte what it sent before", async () => {
  const t = transport({ responses: [ok] });
  await t.apiFetch("/api/channels/c1/await?since=7&timeoutMs=1", {
    workspaceId: "w1", timeoutMs: 15000,
  });
  const { url, init } = t.calls.fetch[0];
  assert.equal(url, "https://app.test/api/channels/c1/await?since=7&timeoutMs=1");
  assert.equal(init.method, "GET");
  assert.equal(init.headers["X-Workspace-Id"], "w1");
  assert.equal(init.headers.Accept, "application/json");
  assert.equal(init.headers["X-Dopl-App-Version"], "1.8.4", "Q10's transport stamp survives");
  assert.equal(init.body, undefined);
  assert.ok(init.signal, "the abort wiring is still there");
});

test("the caller's abort signal still cuts a long-poll short — the wake kick", async () => {
  const ctrl = new AbortController();
  const t = transport({ responses: ["hang"] });
  const p = t.apiFetch("/api/channels/c1/await?since=0&timeoutMs=50000", {
    workspaceId: "w1", timeoutMs: 58000, signal: ctrl.signal,
  });
  ctrl.abort(); // a realtime INSERT wake / powerMonitor resume
  await assert.rejects(p, (e) => e.name === "AbortError");
  assert.equal(t.calls.refreshes, 0, "an abort is a turnover, not an auth failure");
});

test("an ALREADY-aborted caller signal aborts before the request, as before", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const t = transport({ responses: [ok] });
  await assert.rejects(
    () => t.apiFetch("/api/channels/c1/await", { signal: ctrl.signal }),
    (e) => e.name === "AbortError"
  );
});

test("our OWN timeout still aborts the request", async () => {
  const t = transport({ responses: ["hang"] });
  await assert.rejects(
    () => t.apiFetch("/api/channels/c1/await", { timeoutMs: 5 }),
    (e) => e.name === "AbortError"
  );
});

test("the retry gets its own full timeout, not the leftovers of the first", async () => {
  // Each attempt builds a fresh AbortController + timer inside sendOnce, so a 401
  // repair cannot hand the retry a controller that is already about to fire.
  const t = transport({ responses: [unauthorized, ok] });
  await t.apiFetch("/api/channels/c1/await", { timeoutMs: 100 });
  assert.equal(t.calls.fetch.length, 2);
  assert.notEqual(t.calls.fetch[0].signal, t.calls.fetch[1].signal, "a fresh controller per attempt");
});

test("awaitOrCheap still chooses the URL and options — the repair sits underneath it", () => {
  const fn = fnOf(IO, "awaitOrCheap");
  assert.match(fn, /awaitTimeoutFor\(healthy, REALTIME\.CHEAP_AWAIT_TIMEOUT_MS, LISTENER\.AWAIT_TIMEOUT_MS\)/);
  assert.match(fn, /fetchTimeoutFor\(healthy, REALTIME\.CHEAP_FETCH_TIMEOUT_MS, LISTENER\.AWAIT_FETCH_TIMEOUT_MS\)/);
  assert.match(fn, /\{ workspaceId: entry\.workspaceId, timeoutMs: fetchMs, signal \}/);
});

// ── 3. The silence is gone ───────────────────────────────────────────────────

function listWorkspacesWith(res) {
  const calls = { diag: [], stale: 0 };
  const fn = new Function(
    "apiFetch", "notifyStale", "diag", "normalizeList", "discardBody",
    `${asyncFnOf(IO, "listWorkspaces")}\n return listWorkspaces;`
  )(
    async () => res,
    () => { calls.stale += 1; },
    (...a) => calls.diag.push(a.join(" ")),
    (d, k) => (d && d[k]) || [],
    // 2026-08-30: every early return releases the body. Counted, not stubbed away —
    // test/unread-body-seams.test.mjs is where the rule itself is pinned.
    (r) => { calls.discarded = (calls.discarded || 0) + 1; return r; }
  );
  return { run: fn, calls };
}

test("THE SILENT BRANCH: listWorkspaces now says a 401 killed the pass", async () => {
  const { run, calls } = listWorkspacesWith(unauthorized);
  assert.equal(await run(), null, "null is still 'could not ask', never 'no workspaces'");
  assert.equal(calls.stale, 1, "the stale-session notification still fires");
  assert.equal(calls.diag.length, 1, "the outage's one unlogged exit is on the record");
  assert.match(calls.diag[0], /listWorkspaces 401/);
  assert.match(calls.diag[0], /presence, push and every channel loop are starved/,
    "…and it names the blast radius, which is what nobody could see for hours");
});

test("EVERY failing exit from listWorkspaces logs — no silent nulls are left", async () => {
  for (const res of [unauthorized, { ok: false, status: 500 }, { ok: false, status: 404 }]) {
    const { run, calls } = listWorkspacesWith(res);
    assert.equal(await run(), null);
    assert.ok(calls.diag.length >= 1, `status ${res.status} still returns null silently`);
  }
  const { run, calls } = listWorkspacesWith(ok);
  assert.deepEqual(await run(), [{ id: "w1" }]);
  assert.deepEqual(calls.diag, [], "…and the healthy path stays quiet");
});

// ── 4. The self-heal tells the truth about WHICH failure it is ───────────────

function healHarness() {
  let t = 1_000_000;
  const runs = [];
  const logs = [];
  const pending = new Map();
  let seq = 0;
  const healer = heal.createReconcileHealer({
    run: () => runs.push(t),
    log: (...a) => logs.push(a.join(" ")),
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; pending.set(id, { fn, at: t + ms }); return id; },
      clearTimeout: (id) => pending.delete(id),
    },
  });
  return { healer, runs, logs, pendingCount: () => pending.size };
}

test("a failed WORKSPACE LIST no longer reports itself as one unenumerated workspace", () => {
  const h = healHarness();
  assert.equal(h.healer.onWorkspaceListFailure(), true);
  const line = h.logs.join("\n");
  assert.match(line, /WORKSPACE LIST/);
  assert.ok(!/unenumerated workspace\(s\)/.test(line),
    "the copy that sent this outage looking for one broken workspace for hours");
  assert.ok(!/\b1\b/.test(line.replace(/\d+ms/g, "")), "and it invents no count at all");
});

test("the two failures stay distinguishable in the log", () => {
  const h = healHarness();
  h.healer.onEnumerationFailure(2);
  assert.match(h.logs.join("\n"), /retrying 2 unenumerated workspace\(s\)/,
    "a per-workspace enumeration failure keeps its own, now-accurate copy");
});

test("DOES NOT STORM: the two paths share ONE pending retry", () => {
  const h = healHarness();
  assert.equal(h.healer.onWorkspaceListFailure(), true);
  assert.equal(h.healer.onWorkspaceListFailure(), false, "a second failing pass must not stack");
  assert.equal(h.healer.onEnumerationFailure(3), false, "…and neither may the other path");
  assert.equal(h.pendingCount(), 1);
});

test("stop() cancels a workspace-list retry too", () => {
  const h = healHarness();
  h.healer.onWorkspaceListFailure();
  h.healer.stop();
  assert.equal(h.pendingCount(), 0);
});

// ── 5. Reconcile ordering: a failed list must not take the operator offline ───

test("the failed-list branch never CLEARS presence or push", () => {
  const fn = fnOf(LISTENER, "reconcileInner");
  const branch = fn.slice(fn.indexOf("if (workspaces === null)"));
  const stmt = branch.slice(0, branch.indexOf("\n"));
  assert.match(stmt, /healer\.onWorkspaceListFailure\(\); setStatus\(\); return;/);
  assert.ok(!/setWorkspaces/.test(stmt),
    "it must not hand presence or realtime a set — least of all an empty one");
});

test("presence and lastGoodWorkspaceIds move in LOCKSTEP, which is what keeps this safe", () => {
  // The early return above is only safe because neither side is emptied by it: both
  // still hold what the last SUCCESSFUL pass installed. That invariant is the whole
  // step-4 answer, so pin it — a future edit that clears one without the other
  // reintroduces "my peer says I'm offline" on the next transient failure.
  const fn = fnOf(LISTENER, "reconcileInner");
  const good = fn.indexOf("lastGoodWorkspaceIds = wsIds;");
  const beat = fn.indexOf("presence.setWorkspaces(wsIds);");
  assert.ok(good !== -1 && beat !== -1 && good < beat, "the success path fills both, together");
  const out = fn.slice(fn.indexOf("if (!(await auth.ensureSignedIn()))"), fn.indexOf("identityMismatch"));
  assert.match(out, /presence\.setWorkspaces\(\[\]\)/);
  assert.match(out, /lastGoodWorkspaceIds = \[\]/, "and sign-out empties both, together");
});

test("the failed-list branch returns BEFORE the prune, so no loop is dropped", () => {
  const fn = fnOf(LISTENER, "reconcileInner");
  const nul = fn.indexOf("if (workspaces === null)");
  const prune = fn.indexOf("entry.stop = true;");
  assert.ok(nul !== -1 && prune !== -1 && nul < prune,
    "a list we never got says nothing about which channels still exist");
});

// ── 6. No other main-process transport is missing the repair ─────────────────

test("every authenticated main-process fetch seam goes through the shared repair", () => {
  // The bug CLASS, not the bug: a main-process module with its own fetch copy that
  // forgot the 401 repair. Enumerate the seams instead of trusting a memory of
  // them — attaching the Supabase cookie jar to an outbound request is the whole
  // definition of "needs the repair", so the set of files that do it must be
  // exactly the two that call api-repair.js. A third one is the next outage.
  const files = readdirSync(join(HERE, "..", "main")).filter((f) => f.endsWith(".js"));
  const cookieSeams = files.filter((f) => /headers\.Cookie = cookie/.test(M(f))).sort();
  assert.deepEqual(cookieSeams, ["api.js", "listener-io.js"]);
  for (const src of [API, IO]) {
    assert.match(src, /fetchWithAuthRepair\('(api|listener)', pathname, \(\) => sendOnce\(pathname, opts\)\)/);
  }
  // ui-bridge.js is the BEARER seam: it sends Authorization, never the jar, so it
  // carries the equivalent one-retry rule inline (writing cookies there would be
  // wrong). It is the only other place `shouldRepairAuth` may appear.
  const repairers = files.filter((f) => /shouldRepairAuth\(/.test(M(f))).sort();
  // ⚠ `auth-tokens.js` LEFT THIS LIST ON 2026-08-30 and `auth-token-rules.js` took its
  // place: the rule's definition moved with the rest of the pure block when that file hit
  // the §2 cap. auth-tokens.js still re-exports the name — it simply no longer CALLS it.
  assert.deepEqual(repairers, ["api-repair.js", "auth-token-rules.js", "ui-bridge.js"],
    "a module deciding 401 policy on its own is how listener-io drifted in the first place");
});

// ── THE ABANDONED-BODY LEAK (regression: 17 GB dev RSS, 2026-08-30) ──────────
//
// Node's `fetch` is undici: until a `Response` body is consumed or cancelled the request
// counts as IN FLIGHT, its socket is never returned to the pool, and the next call opens
// ANOTHER connection. What is retained is native — socket buffers plus TLS session state —
// so it never pressures GC, never appears in a heap snapshot, and shows up only as RSS.
//
// The branches that leak are the ERROR branches, which is backwards from where anyone looks:
// the success path reads `res.json()` and is fine, while the paths a saturated or
// stale-credentialed server puts every caller on drop the body on the floor, forever.

test("LEAK: the pre-retry 401 body is RELEASED before a second connection is opened", async () => {
  const cancelled = [];
  const body = (tag) => ({ cancel: async () => { cancelled.push(tag); } });
  const t = transport({
    responses: [
      { ok: false, status: 401, body: body("first"), bodyUsed: false },
      { ok: true, status: 200, body: body("retry"), bodyUsed: false },
    ],
  });
  const res = await t.apiFetch("/api/channels", {});
  assert.equal(res.status, 200, "the retry's response is what the caller gets");
  assert.deepEqual(t.calls.fetch.length, 2, "one repair, one retry");
  assert.deepEqual(cancelled, ["first"], "the abandoned 401 is released; the returned one is not");
});

test("LEAK: releasing is BEST-EFFORT — an odd or already-read body must not throw", async () => {
  // A body already consumed, absent, or one whose cancel() rejects: none of those may
  // escape into a caller that had finished with the response.
  const shapes = [
    { ok: false, status: 401 },                                   // no body at all
    { ok: false, status: 401, body: {}, bodyUsed: false },        // no cancel()
    { ok: false, status: 401, body: { cancel: () => {} }, bodyUsed: true },  // already read
    { ok: false, status: 401, body: { cancel: () => { throw new Error("boom"); } }, bodyUsed: false },
    { ok: false, status: 401, body: { cancel: () => Promise.reject(new Error("late")) }, bodyUsed: false },
  ];
  for (const first of shapes) {
    const t = transport({ responses: [first, { ok: true, status: 200 }] });
    const res = await t.apiFetch("/api/channels", {});
    assert.equal(res.status, 200, `shape ${JSON.stringify(Object.keys(first))} still retries`);
  }
});

test("LEAK: the presence heartbeat releases its body on EVERY branch, success included", () => {
  // ⚠ THE STEADIEST LEAK IN THE APP PRECISELY BECAUSE NOTHING ABOUT IT EVER FAILS: one beat
  // per workspace every 30s, for the life of the process, and `beatOnce` reads no body on
  // any branch — it only looks at `res.status` / `res.ok`.
  const PRESENCE = M("presence.js");
  const fn = fnOf(PRESENCE, "beatOnce");
  assert.match(fn, /discardBody\(res\)/, "the beat must release the response it never reads");
  assert.ok(
    orderOf(fn, "discardBody(res)", "if (res.status === 404)", "beatOnce"),
    "released BEFORE the branches that return without reading it"
  );
  assert.match(PRESENCE, /require\('\.\/api-repair'\)/, "and it uses the ONE shared helper");
});

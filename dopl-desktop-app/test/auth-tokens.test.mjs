// Phase 2 — the main-process ACCESS-TOKEN AUTHORITY (main/auth-tokens.js).
//
// THE TWO BUGS THIS LOCKS OUT, both documented before they could be shipped:
//
//   1. SILENT SIGN-OUT (auth-flows.md §4.1, desktop-main.md R2). `refreshInner`
//      called `clearSession()` on ANY 400. Supabase ROTATES the refresh token on
//      use, so FIX S6's own race produces exactly one 400 for every loser — and
//      the loser then signed the operator out. It was survivable only because the
//      COOKIE JAR was a second source. The bearer path has none, so the drop is
//      now bounded: N CONSECUTIVE *definitive* rejections, and a transient network
//      failure never counts toward it. If `nextFailureState` ever lets a transient
//      failure move `definitive`, one captive portal is a sign-out again.
//
//   2. NOTHING REFRESHES (desktop-main.md §3.3 B1/B2). The remote page's
//      supabase-js is the only auto-refresher today; the bundled SPA deletes it.
//      `getAuthCookie()` repairs an EMPTY jar, never a STALE one, so a
//      stale-but-present credential is forwarded verbatim and 401s. Hence a
//      proactive timer keyed on the token's OWN lifetime, a near-expiry gate on
//      every read, and a 401 repair that retries EXACTLY once.
//
// WHY SOURCE EXTRACTION: auth-tokens.js is CommonJS and requires auth-store.js,
// which requires electron (safeStorage) + electron-store, so it cannot be
// imported under `node --test`. The decision core is fenced as PURE and sliced
// verbatim, so the test stays honest to what ships.
//
// Run: `node --test dopl-desktop-app/test/auth-tokens.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const TOKENS = M("auth-tokens.js");
const AUTH = M("auth.js");
const API = M("api.js");
const BRIDGE = M("ui-bridge.js");

const PURE = between(
  TOKENS,
  "// ─── BEGIN AUTH-TOKENS-PURE",
  "// ─── END AUTH-TOKENS-PURE",
  "auth-tokens pure block"
);

const {
  needsRefresh,
  refreshDelayMs,
  classifyFailure,
  nextFailureState,
  retryDelayMs,
  shouldRepairAuth,
  NEAR_EXPIRY_SEC,
  MAX_DEFINITIVE_FAILURES,
  MIN_SCHEDULE_MS,
  MAX_SCHEDULE_MS,
  RETRY_CEILING_MS,
} = new Function(
  `${PURE}
   return { needsRefresh, refreshDelayMs, classifyFailure, nextFailureState,
            retryDelayMs, shouldRepairAuth, NEAR_EXPIRY_SEC, MAX_DEFINITIVE_FAILURES,
            MIN_SCHEDULE_MS, MAX_SCHEDULE_MS, RETRY_CEILING_MS };`
)();

const NOW = 1_800_000_000; // fixed clock (unix seconds)
const HOUR = 3600;

// ── NEAR-EXPIRY DETECTION ───────────────────────────────────────────────────

test("a token with most of its life left is not refreshed", () => {
  assert.equal(needsRefresh(NOW + HOUR, NOW), false);
  assert.equal(needsRefresh(NOW + 10 * 60, NOW), false);
});

test("the near-expiry window is 120s and is a strict inside-the-window test", () => {
  assert.equal(NEAR_EXPIRY_SEC, 120);
  assert.equal(needsRefresh(NOW + 121, NOW), false, "just outside the window: still usable");
  assert.equal(needsRefresh(NOW + 120, NOW), false, "exactly at the boundary: not yet inside");
  assert.equal(needsRefresh(NOW + 119, NOW), true, "inside the window: rotate before handing it out");
});

test("an already-expired token needs a refresh", () => {
  assert.equal(needsRefresh(NOW - 1, NOW), true);
  assert.equal(needsRefresh(NOW - HOUR, NOW), true);
});

test("an UNREADABLE exp counts as needing a refresh, never as usable", () => {
  // The alternative fails OPEN: we would send a credential we cannot date, and a
  // dopl_at_ device token (not a JWT at all) has no exp to read.
  for (const bad of [null, undefined, NaN, Infinity, "soon"]) {
    assert.equal(needsRefresh(bad, NOW), true, `exp=${String(bad)} must not be treated as fresh`);
  }
});

// ── REFRESH SCHEDULING MATH (~80% of lifetime) ──────────────────────────────

test("a fresh 1h token is refreshed at ~80% of its life, i.e. ~48 minutes in", () => {
  // exp = now + 3600 with a 3600s lifetime -> target = exp - 720 = now + 2880s.
  assert.equal(refreshDelayMs({ expSec: NOW + HOUR, lifetimeSec: HOUR, nowSec: NOW }), 2_880_000);
});

test("scheduling is keyed on the token's OWN lifetime, not a hardcoded hour", () => {
  // A 10-minute token must not be scheduled as if it lived an hour.
  assert.equal(refreshDelayMs({ expSec: NOW + 600, lifetimeSec: 600, nowSec: NOW }), 480_000);
  // A 2-hour token gets proportionally more slack.
  assert.equal(
    refreshDelayMs({ expSec: NOW + 2 * HOUR, lifetimeSec: 2 * HOUR, nowSec: NOW }),
    Math.min(MAX_SCHEDULE_MS, (2 * HOUR - 0.2 * 2 * HOUR) * 1000)
  );
});

test("the delay shrinks as the token ages, and it is the REMAINING time that counts", () => {
  const half = refreshDelayMs({ expSec: NOW + HOUR / 2, lifetimeSec: HOUR, nowSec: NOW });
  const full = refreshDelayMs({ expSec: NOW + HOUR, lifetimeSec: HOUR, nowSec: NOW });
  assert.ok(half < full, "a half-spent token must be refreshed sooner");
  assert.equal(half, (HOUR / 2 - 0.2 * HOUR) * 1000);
});

test("a past-due or barely-alive token is floored, never scheduled at 0 (no spin loop)", () => {
  // F-072: a read must never become a write storm. `kick()` refreshes such a
  // token immediately; the TIMER must still never be armed tighter than the floor.
  assert.equal(refreshDelayMs({ expSec: NOW - HOUR, lifetimeSec: HOUR, nowSec: NOW }), MIN_SCHEDULE_MS);
  assert.equal(refreshDelayMs({ expSec: NOW + 60, lifetimeSec: HOUR, nowSec: NOW }), MIN_SCHEDULE_MS);
  assert.ok(MIN_SCHEDULE_MS >= 10_000, `MIN_SCHEDULE_MS=${MIN_SCHEDULE_MS} is too tight to be a floor`);
});

test("a bogus far-future exp is capped, so the timer can never park past a real session", () => {
  const far = refreshDelayMs({ expSec: NOW + 400 * 24 * HOUR, lifetimeSec: 400 * 24 * HOUR, nowSec: NOW });
  assert.equal(far, MAX_SCHEDULE_MS);
  assert.ok(MAX_SCHEDULE_MS <= 60 * 60 * 1000);
});

test("an unreadable exp or lifetime falls back to a bounded delay, not to NaN", () => {
  assert.equal(refreshDelayMs({ expSec: null, lifetimeSec: HOUR, nowSec: NOW }), MIN_SCHEDULE_MS);
  assert.equal(refreshDelayMs({}), MIN_SCHEDULE_MS);
  assert.equal(refreshDelayMs(), MIN_SCHEDULE_MS);
  // A missing lifetime defaults to 3600 rather than collapsing the schedule.
  assert.equal(refreshDelayMs({ expSec: NOW + HOUR, nowSec: NOW }), 2_880_000);
  assert.equal(refreshDelayMs({ expSec: NOW + HOUR, lifetimeSec: 0, nowSec: NOW }), 2_880_000);
});

test("every schedule leaves room for the whole retry ladder before the token dies", () => {
  // The point of 80%: a failure at the scheduled time must still have time to
  // climb the backoff ladder before `exp`. 20% of an hour is 12 minutes.
  const delayMs = refreshDelayMs({ expSec: NOW + HOUR, lifetimeSec: HOUR, nowSec: NOW });
  const slackMs = HOUR * 1000 - delayMs;
  assert.ok(slackMs > RETRY_CEILING_MS, `only ${slackMs}ms of slack for a ${RETRY_CEILING_MS}ms ceiling`);
});

// ── FAILURE CLASSIFICATION ──────────────────────────────────────────────────

test("a server rejection of the refresh token is DEFINITIVE", () => {
  for (const status of [400, 401, 403, 422]) {
    assert.equal(classifyFailure({ status }), "definitive", `HTTP ${status}`);
  }
});

test("a throw, a 5xx or a rate limit is TRANSIENT — the token was never judged", () => {
  for (const status of [null, undefined, 0, 408, 429, 500, 502, 503, 504]) {
    assert.equal(classifyFailure({ status }), "transient", `status=${String(status)}`);
  }
  assert.equal(classifyFailure(), "transient", "a missing outcome is ignorance, not rejection");
  assert.equal(classifyFailure({}), "transient");
});

// ── BOUNDED-FAILURE COUNTING (the silent sign-out) ──────────────────────────

const zero = { definitive: 0, attempts: 0 };
const fail = (state, outcome) => nextFailureState(state, outcome);
const carry = (r) => ({ definitive: r.definitive, attempts: r.attempts });

test("ONE 400 does not drop the session — that was the whole bug", () => {
  const r = fail(zero, { ok: false, status: 400 });
  assert.equal(r.kind, "definitive");
  assert.equal(r.definitive, 1);
  assert.equal(r.dropSession, false, "a single rotation-race loser must not sign the operator out");
});

test("the session is dropped only after N CONSECUTIVE definitive rejections", () => {
  assert.equal(MAX_DEFINITIVE_FAILURES, 3);
  let s = zero;
  const drops = [];
  for (let i = 1; i <= MAX_DEFINITIVE_FAILURES; i++) {
    const r = fail(s, { ok: false, status: 400 });
    drops.push(r.dropSession);
    s = carry(r);
  }
  assert.deepEqual(drops, [false, false, true], "drop lands exactly on the Nth, not before");
});

test("a transient failure NEVER advances the drop counter", () => {
  // One captive portal / sleep-mid-flight must not be able to sign anyone out,
  // no matter how many times it repeats.
  let s = zero;
  for (let i = 0; i < 50; i++) {
    const r = fail(s, { ok: false, status: 503 });
    assert.equal(r.kind, "transient");
    assert.equal(r.definitive, 0, "a network failure is not a rejection");
    assert.equal(r.dropSession, false);
    s = carry(r);
  }
  assert.equal(s.attempts, 50, "…but it does drive the backoff ladder");
});

test("transients interleaved with definitives do not reset the definitive count", () => {
  // The counter is CONSECUTIVE over rejections, not over attempts: an offline
  // blip between two 400s must not buy the dead token another life forever.
  let s = zero;
  s = carry(fail(s, { ok: false, status: 400 }));
  s = carry(fail(s, { ok: false, status: 503 }));
  assert.equal(s.definitive, 1);
  s = carry(fail(s, { ok: false, status: 400 }));
  assert.equal(s.definitive, 2);
  const r = fail(s, { ok: false, status: 400 });
  assert.equal(r.dropSession, true);
});

test("a SUCCESS clears both counters, so the ladder never carries across sessions", () => {
  let s = zero;
  s = carry(fail(s, { ok: false, status: 400 }));
  s = carry(fail(s, { ok: false, status: 400 }));
  assert.equal(s.definitive, 2, "one more would drop");
  const r = fail(s, { ok: true });
  assert.equal(r.kind, "ok");
  assert.equal(r.definitive, 0);
  assert.equal(r.attempts, 0);
  assert.equal(r.dropSession, false);
  // …and the next isolated 400 starts from scratch rather than dropping.
  assert.equal(fail(carry(r), { ok: false, status: 400 }).dropSession, false);
});

test("a missing/garbage prior state is treated as a clean slate, not as a drop", () => {
  for (const bad of [null, undefined, 0, "x"]) {
    const r = fail(bad, { ok: false, status: 400 });
    assert.equal(r.definitive, 1);
    assert.equal(r.dropSession, false);
  }
});

// ── BOUNDED BACKOFF ─────────────────────────────────────────────────────────

test("the retry ladder grows and then holds a ceiling", () => {
  const ladder = [1, 2, 3, 4, 5, 10, 100].map(retryDelayMs);
  assert.deepEqual(ladder.slice(0, 3), [5_000, 20_000, 60_000]);
  for (const d of ladder.slice(3)) assert.equal(d, RETRY_CEILING_MS);
});

test("the ladder is monotonic and never zero (an offline machine must not hammer)", () => {
  let prev = 0;
  for (let n = 1; n <= 12; n++) {
    const v = retryDelayMs(n);
    assert.ok(v > 0, `attempt ${n} scheduled at 0`);
    assert.ok(v >= prev, `attempt ${n} (${v}) < previous (${prev})`);
    prev = v;
  }
});

test("a nonsense attempt number still yields the first rung, never NaN", () => {
  for (const bad of [0, -3, null, undefined, NaN, "x"]) {
    assert.equal(retryDelayMs(bad), 5_000, `attempt=${String(bad)}`);
  }
});

// ── 401 REPAIR: EXACTLY ONE RETRY ───────────────────────────────────────────

test("a 401 is repaired once", () => {
  assert.equal(shouldRepairAuth(401, false), true);
});

test("a 401 that survives the repair is NOT retried again — no loop", () => {
  assert.equal(shouldRepairAuth(401, true), false);
});

test("no other status triggers a refresh", () => {
  for (const s of [200, 204, 400, 403, 404, 409, 429, 500, 502]) {
    assert.equal(shouldRepairAuth(s, false), false, `HTTP ${s} must not force a rotation`);
  }
});

// ── THE SHELL: what the pure core is actually wired to ──────────────────────

test("auth.js's 400 handler is BOUNDED — the drop decision left refreshInner", () => {
  const fn = fnOf(AUTH, "refreshInner");
  assert.ok(
    !/if \(res\.status === 400\) \{\s*clearSession\(\)/.test(fn),
    "the unconditional one-400-is-a-sign-out branch must be gone"
  );
  assert.match(fn, /noteRefreshOutcome\(\{ ok: false, status: res\.status \}\)/);
  assert.match(fn, /verdict\.dropSession/, "…and clearSession runs only on that verdict");
  assert.match(fn, /noteRefreshOutcome\(\{ ok: true \}\)/, "success must reset the counter");
});

test("a thrown refresh reports TRANSIENT, so a dead network can never sign anyone out", () => {
  const fn = fnOf(AUTH, "refreshInner");
  const tail = fn.slice(fn.indexOf("catch (err)"));
  assert.match(tail, /noteRefreshOutcome\(\{ ok: false, status: null \}\)/);
  assert.ok(!/clearSession\(\)/.test(tail), "a throw must never drop the session");
});

test("there is ONE refresher: auth-tokens rotates through auth.js's single-flight refresh", () => {
  // Two independent refreshers against a rotating refresh token is exactly the
  // FIX S6 amplification (one winner, N-1 400s, and each 400 used to be a drop).
  const fn = fnOf(TOKENS, "refreshNow");
  assert.match(fn, /require\('\.\/auth'\)\.refresh\(\)/);
  assert.ok(
    !/auth\/v1\/token/.test(TOKENS),
    "auth-tokens must not open its own connection to the Supabase token endpoint"
  );
});

test("the near-expiry gate is on the READ path, not only on the timer", () => {
  // B2: `getAuthCookie()` repairs an EMPTY jar but forwards a STALE credential
  // verbatim. The bearer authority must not repeat that.
  const fn = fnOf(TOKENS, "getAccessToken");
  assert.match(fn, /needsRefresh\(/);
  assert.match(fn, /refreshNow\(/);
  assert.match(fn, /exp != null && exp > nowSec\(\)/, "an expired token is null, not 'best effort'");
});

test("the timer re-decides from the token on every fire (a wake can make it fire late)", () => {
  const fn = fnOf(TOKENS, "tick");
  assert.match(fn, /needsRefresh\(/, "the alarm is a hint; the token is the truth");
  assert.match(fn, /scheduleNext\(/, "…and a still-fresh token re-arms rather than rotating");
});

test("kick()'s healthy branch pushes signed-in (every fresh sign-in lands there)", () => {
  // Fleet audit 2026-08-03 (critical): a fresh JWT is never near expiry, so
  // both sign-in entry points fall through to the healthy branch — and the
  // renderer flips OFF the login screen only on this push. Silence here
  // stranded every sign-in on the login screen for ~48 minutes.
  const fn = fnOf(TOKENS, "kick");
  assert.match(fn, /emitAuthState\('signed-in'\)/, "the healthy branch must push signed-in");
  assert.match(fn, /scheduleNext\(/);
});

test("powerMonitor wake re-decides immediately and does NOT forgive definitive failures", () => {
  const fn = fnOf(TOKENS, "onWake");
  assert.match(fn, /kick\(/);
  assert.ok(
    !/failure = \{/.test(fn),
    "a wake is not evidence that a rejected refresh token came back to life"
  );
});

test("api.js repairs a 401 exactly once and keeps the COOKIE transport alive", () => {
  const fn = fnOf(API, "apiFetch");
  assert.match(fn, /shouldRepairAuth\(res\.status, false\)/);
  assert.match(fn, /forceRefresh\(\)/);
  assert.match(fn, /writeSessionCookies\(fresh\)/, "the retry must carry a DIFFERENT credential");
  assert.equal(
    (fn.match(/sendOnce\(/g) || []).length,
    2,
    "exactly one original attempt and one retry — never a loop"
  );
  assert.match(fn, /emitAuthState\('signed-out'\)/, "a surviving 401 is surfaced, not swallowed");
});

test("the ui-bridge seam is implemented and still token-free across IPC", () => {
  assert.match(fnOf(BRIDGE, "getBearerToken"), /authTokens\.getAccessToken\(\)/);
  assert.match(fnOf(BRIDGE, "getAuthState"), /authTokens\.getAuthState\(\)/);
  const send = fnOf(BRIDGE, "broadcastAuthState");
  assert.ok(!/token/i.test(send), "the push channel must never carry a credential");
  assert.match(send, /signedIn: Boolean/);
  const perform = fnOf(BRIDGE, "performApiRequest");
  assert.match(perform, /await getBearerToken\(\)/, "the token read is async now that it can refresh");
  assert.match(perform, /shouldRepairAuth\(res\.status, false\)/);
});

test("I11 — no token value can reach a log", () => {
  // Only the SOURCE, the seconds-left and the failure kind are ever logged.
  for (const [name, src] of [["auth-tokens.js", TOKENS]]) {
    const logs = src.match(/\bdiag\([^;]*\)/g) || [];
    for (const line of logs) {
      assert.ok(
        !/access_token|refresh_token|\.token\b/.test(line),
        `${name} logs a credential: ${line}`
      );
    }
  }
});

test("the renderer-facing auth state carries an id and a boolean, and nothing else", () => {
  const fn = fnOf(TOKENS, "getAuthState");
  assert.match(fn, /signedIn:/);
  assert.match(fn, /userId:/);
  assert.ok(!/access_token/.test(fn.replace(/s\.access_token/g, "")), "no token in the payload");
});

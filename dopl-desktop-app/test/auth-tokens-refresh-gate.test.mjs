// F-132's RESIDUAL: the ui-sync credential storm (main/auth-tokens.js).
//
// THE INCIDENT. `~/Library/Application Support/dopl-desktop/listener.log`, offline
// machine: `ui-sync auth MISSING — rotate` interleaved 1:1 with `auth-tokens: refresh
// failed — transient (… attempt 39316)` — tens of thousands of refresh attempts in
// seconds.
//
// THE CYCLE, and it closes through THREE modules, which is why no single one of them
// looked wrong. refreshNow announces a FAILED rotation with emitAuthState('signed-in')
// (it must: the emitter dedupes on the last key, and the 'refreshing' emit ahead of it
// guarantees it is never suppressed). main/shell-mode.js's auth fan-out answers a
// 'signed-in' by calling ui-sync's refreshAuth(). ui-sync answers that by reading
// getAccessToken(). getAccessToken, with a near-expired token, drove a real rotation on
// EVERY call — so the failure re-drove the read that produced it. The proactive timer
// had the retry ladder; the caller-driven path had no bound at all.
//
// WHAT THIS FILE PINS is therefore a RATE and an ORDERING, not a helper:
//   1. one failed rotation must not become N (the storm reproduction below), and
//   2. the gate must be armed BEFORE the announcement, i.e. in noteRefreshOutcome —
//      auth.js reports there before refreshNow resumes, whereas a stamp written in
//      refreshNow's own tail is written after the re-entrant read has already gone.
// It must also stay OFF the scheduled path: gating tick()/refreshNow would let a timer
// firing a hair early refuse its own rotation and never re-arm — a dead refresher.
//
// WHY SOURCE EXTRACTION: auth-tokens.js is CommonJS and requires auth-store.js, which
// requires electron + electron-store, so it cannot be imported under `node --test`.
// The PURE block plus the four real functions are sliced verbatim and run against fakes
// (a frozen clock, a store, an offline `auth.refresh()`), so the loop under test is the
// shipped control flow rather than a re-description of it.
//
// Run: `node --test dopl-desktop-app/test/auth-tokens-refresh-gate.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(join(HERE, "..", "main", "auth-tokens.js"), "utf8");

const PURE = between(
  TOKENS,
  "// ─── BEGIN AUTH-TOKENS-PURE",
  "// ─── END AUTH-TOKENS-PURE",
  "auth-tokens pure block"
);

const NOW_MS = 1_800_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

// `fnOf` slices from the `function` keyword, so the `async` of an async declaration is
// left behind; it is prepended back rather than widening the shared probe.
const asyncFn = (name) => `async ${fnOf(TOKENS, name)}`;

// The module rebuilt around fakes. `let failure` / `let retryNotBeforeMs` live HERE, not
// in the slice, so reverting the fix in the source still produces a runnable module —
// which is the whole point: the mutation must fail on BEHAVIOUR, not on a ReferenceError.
const build = (opts = {}) => new Function(
  "deps",
  `
  const Date = deps.Date;
  const store = deps.store;
  const diag = deps.diag;
  const require = deps.require;
  const emitAuthState = deps.emitAuthState;
  const scheduleNext = deps.scheduleNext;
  const clearTimer = deps.clearTimer;
  ${PURE}
  const nowSec = () => Math.floor(Date.now() / 1000);
  ${fnOf(TOKENS, "sessionExpSec")}
  ${fnOf(TOKENS, "sessionLifetimeSec")}
  let failure = { definitive: 0, attempts: 0 };
  let retryNotBeforeMs = 0;
  ${fnOf(TOKENS, "noteRefreshOutcome")}
  ${asyncFn("refreshNow")}
  ${asyncFn("getAccessToken")}
  return { getAccessToken, noteRefreshOutcome, attempts: () => failure.attempts };
  `
)(harness(opts));

function harness(opts) {
  const state = {
    nowMs: NOW_MS,
    // Already past `exp`: the offline case the log captured, where the fallthrough in
    // getAccessToken has nothing usable to hand back either.
    session: { access_token: "tok", refresh_token: "r", expires_at: NOW_SEC - 60, expires_in: 3600 },
    refreshCalls: 0,
    emits: [],
    queue: [],
    inflight: [],
  };
  let mod = null;
  const deps = {
    Date: { now: () => state.nowMs },
    store: {
      loadSession: () => state.session,
      jwtExp: () => null, // not a real JWT; sessionExpSec falls back to expires_at
      decodeJwt: () => null,
      authFail: () => {},
    },
    diag: () => {},
    scheduleNext: () => {},
    clearTimer: () => {},
    // auth.js's refreshInner, offline: it reports the outcome BEFORE it returns, which
    // is the ordering the fix depends on.
    require: () => ({
      refresh: async () => {
        state.refreshCalls += 1;
        if (opts.succeedAfter != null && state.refreshCalls > opts.succeedAfter) {
          state.session = { ...state.session, access_token: "fresh", expires_at: state.nowMs / 1000 + 3600 };
          mod.noteRefreshOutcome({ ok: true });
          return state.session;
        }
        mod.noteRefreshOutcome({ ok: false, status: null }); // a throw: transient
        return null;
      },
    }),
    // main/shell-mode.js's fan-out, collapsed to the one subscriber that matters: a
    // 'signed-in' makes ui-sync re-read the credential. DEFERRED by default, which is
    // ui-sync today (readTokenWithDeadline puts the read behind a
    // `Promise.resolve().then(...)`, so the re-entry lands a microtask later — which is
    // why the storm ran at memory speed instead of blowing the stack). `syncFanout`
    // models the other shape the emitter's contract allows: a subscriber that calls
    // getAccessToken() directly, and so reaches the gate from INSIDE the announcement.
    emitAuthState: (status) => {
      state.emits.push(status);
      if (status !== "signed-in") return;
      if (opts.syncFanout) state.inflight.push(mod.getAccessToken());
      else state.queue.push(() => mod.getAccessToken());
    },
  };
  state.deps = deps;
  Object.defineProperty(state, "bind", { value: (m) => { mod = m; } });
  harness.last = state;
  return deps;
}

// Build + wire the fan-out back to the built module.
function make(opts) {
  const mod = build(opts);
  const state = harness.last;
  state.bind(mod);
  return { mod, state };
}

// Drain the queued re-reads the way the microtask cascade would, up to a cap. The cap
// stands in for "forever": the real loop was rate-limited only by how fast fetch failed.
async function drain(state, limit = 40) {
  let n = 0;
  while (state.queue.length && n < limit) {
    n += 1;
    await state.queue.shift()();
  }
  return n;
}

// Settle the fire-and-forget reads a SYNCHRONOUS subscriber starts, including any they
// start in turn.
async function settle(state, rounds = 20) {
  for (let i = 0; i < rounds && state.inflight.length; i++) {
    await Promise.all(state.inflight.splice(0));
  }
}

// ── THE STORM ───────────────────────────────────────────────────────────────

test("a failed rotation does not re-drive itself: one attempt, not a cascade", async () => {
  const { mod, state } = make();
  assert.equal(await mod.getAccessToken(), null, "an expired token with no rotation is null");
  await drain(state);
  assert.equal(
    state.refreshCalls,
    1,
    `one caller-driven read produced ${state.refreshCalls} rotations — the storm is back`
  );
  assert.equal(state.emits.filter((e) => e === "signed-in").length, 1, "…and one announcement");
});

test("every announcement of a failure would re-enter, so the gate must hold across them", async () => {
  // Ten independent callers (ui-bridge, api-repair, ui-sync's own recheck) asking while
  // the machine is offline is normal traffic, not a bug. It must still cost ONE rotation.
  const { mod, state } = make();
  for (let i = 0; i < 10; i++) await mod.getAccessToken();
  await drain(state);
  assert.equal(state.refreshCalls, 1, `10 reads cost ${state.refreshCalls} rotations`);
});

test("a subscriber that reads the credential INSIDE the emit is bounded too", async () => {
  // This is the assertion that makes WHERE the stamp is written load-bearing rather
  // than incidental. getAccessToken runs as far as the gate before its first `await`,
  // so a subscriber calling it directly from the fan-out reaches the gate during the
  // announcement — earlier than a stamp written in refreshNow's tail would exist.
  // ui-sync happens to defer its read; emitAuthState's contract does not require that
  // of the next subscriber, and this bound must not depend on it.
  const { mod, state } = make({ syncFanout: true });
  assert.equal(await mod.getAccessToken(), null);
  await settle(state);
  assert.equal(state.refreshCalls, 1, `a synchronous re-read cost ${state.refreshCalls} rotations`);
});

test("the gate is a PAUSE, not a wedge — the ladder's first rung reopens it", async () => {
  const { mod, state } = make();
  await mod.getAccessToken();
  await drain(state);
  assert.equal(state.refreshCalls, 1);
  state.nowMs += 4_999; // still inside the 5s first rung
  await mod.getAccessToken();
  assert.equal(state.refreshCalls, 1, "reopened early — the ladder is not being honoured");
  state.nowMs += 2; // past it
  await mod.getAccessToken();
  assert.equal(state.refreshCalls, 2, "the gate never reopened — an offline blip is a wedge");
});

test("the ladder is climbed, so a long outage does not retry at the first rung forever", async () => {
  const { mod, state } = make();
  await mod.getAccessToken();
  await drain(state);
  state.nowMs += 5_001;
  await mod.getAccessToken();
  await drain(state);
  assert.equal(state.refreshCalls, 2);
  state.nowMs += 5_001; // enough for rung 1, NOT for rung 2 (20s)
  await mod.getAccessToken();
  assert.equal(state.refreshCalls, 2, "the second failure must widen the gap, not repeat it");
  state.nowMs += 15_000;
  await mod.getAccessToken();
  assert.equal(state.refreshCalls, 3);
});

test("a SUCCESS clears the gate — the ladder must not outlive the outage", async () => {
  const { mod, state } = make({ succeedAfter: 1 });
  await mod.getAccessToken(); // fails, arms the gate
  await drain(state);
  state.nowMs += 5_001;
  const token = await mod.getAccessToken(); // succeeds, clears it
  assert.equal(token, "fresh");
  assert.equal(state.refreshCalls, 2);
  // A token that goes near-expiry again immediately must rotate at once, not wait out
  // a ladder that belonged to a failure the network has already recovered from.
  state.session = { ...state.session, access_token: "tok", expires_at: NOW_SEC - 60 };
  await mod.getAccessToken();
  assert.equal(state.refreshCalls, 3, "a stale gate survived a successful rotation");
});

// ── THE PURE PREDICATE ──────────────────────────────────────────────────────

const { mayRefreshNow } = new Function(`${PURE} return { mayRefreshNow };`)();

test("an unarmed gate always passes, and an armed one opens exactly at its stamp", () => {
  for (const unarmed of [0, null, undefined, NaN, -1, "x"]) {
    assert.equal(mayRefreshNow(NOW_MS, unarmed), true, `notBefore=${String(unarmed)}`);
  }
  assert.equal(mayRefreshNow(NOW_MS, NOW_MS + 1), false);
  assert.equal(mayRefreshNow(NOW_MS, NOW_MS), true, "the stamp itself is open");
  assert.equal(mayRefreshNow(NOW_MS + 1, NOW_MS), true);
});

test("an unreadable clock fails OPEN — a rate limit must never strand a session", () => {
  for (const bad of [NaN, Infinity, null, undefined, "now"]) {
    assert.equal(mayRefreshNow(bad, NOW_MS + 10_000), true, `now=${String(bad)}`);
  }
});

// ── THE WIRING (where the stamp is written is the fix) ──────────────────────

test("the gate is armed by the FAILURE REPORT, not by refreshNow's tail", () => {
  // Two reasons, and the first is not about ordering at all: noteRefreshOutcome is the
  // ONE place every refresh outcome is reported — auth.ensureFresh() and
  // getAccessTokenInfo() rotate without ever entering refreshNow — so arming anywhere
  // else lets the stamp drift from the `attempts` it is derived from. The second is
  // ordering: auth.js reports here before refreshNow resumes, so the stamp exists
  // before the announcement that re-enters. See the syncFanout test above.
  assert.match(fnOf(TOKENS, "noteRefreshOutcome"), /retryNotBeforeMs = Date\.now\(\) \+ retryDelayMs\(/);
  assert.ok(
    !/retryNotBeforeMs\s*=/.test(fnOf(TOKENS, "refreshNow")),
    "the stamp moved into refreshNow, where it is written one emit too late"
  );
});

test("the gate covers the CALLER-DRIVEN read only — never the timer", () => {
  // tick() fires at exactly the stamp it scheduled. A timer that fires a millisecond
  // early would refuse its own rotation and return without re-arming: a refresher that
  // is silently dead until the next wake.
  assert.match(fnOf(TOKENS, "getAccessToken"), /mayRefreshNow\(Date\.now\(\), retryNotBeforeMs\)/);
  for (const name of ["tick", "refreshNow", "kick", "forceRefresh"]) {
    assert.ok(!/mayRefreshNow/.test(fnOf(TOKENS, name)), `${name}() must not be gated`);
  }
});

test("a fresh sign-in and a sign-out both void the gate", () => {
  for (const name of ["onSignIn", "onSignOut"]) {
    assert.match(fnOf(TOKENS, name), /retryNotBeforeMs = 0/, `${name}() leaves the ladder armed`);
  }
  // A wake does NOT, deliberately — it is not evidence that the network came back, and
  // the stamp is wall-clock, so a real sleep has already expired it.
  assert.ok(!/retryNotBeforeMs/.test(fnOf(TOKENS, "onWake")));
});

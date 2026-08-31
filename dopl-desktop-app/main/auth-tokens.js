// THE MAIN-PROCESS ACCESS-TOKEN AUTHORITY (Phase 2 — Supabase JWT as Bearer).
//
// WHAT THIS IS. Exactly one place in main answers "give me a Supabase access JWT
// that is valid right now". The server side has already landed the matching half:
// `/api/**` accepts `Authorization: Bearer <supabase access JWT>` as a SESSION
// credential (ES256 + kid), so a bearer from here is NOT an agent caller and all
// ~24 `sessionOnly` routes keep working (docs/migration-research/auth-flows.md §3.2).
//
// WHY IT HAS TO EXIST. Today the only thing that keeps a live Supabase session on
// this machine is the REMOTE PAGE's supabase-js, auto-refreshing the Electron
// cookie jar. The bundled SPA deletes that page, and with it the refresher
// (desktop-main.md §3.3 B1). Main already owns a working single-flight refresh
// client (auth.js `refresh()`), it is simply almost never called. This module is
// the missing proactive half: a timer keyed on the token's own lifetime, a
// near-expiry gate on every read, and a wake hook.
//
// ADDITIVE, NOT A REPLACEMENT. The cookie path (auth-cookies.js and every consumer
// of `auth.getAuthCookie()`) is untouched and stays the shipping transport until
// Phase 4. Both read the SAME session blob and refresh through the SAME
// single-flight `auth.refresh()`, so there is one credential and one rotation —
// two refreshers against a rotating refresh token is the FIX S6 amplification.
//
// THE LANDMINE THIS DEFUSES (auth-flows.md §4.1, desktop-main.md R2). `refreshInner`
// used to call `clearSession()` on ANY 400 — a real sign-out, from one bad response.
// That was survivable only because the cookie jar was a second source; the bearer
// path has no second source, so the drop is now bounded here: N CONSECUTIVE
// definitive failures, and a transient network failure never counts toward it.
//
// SECURITY. I11 — no token value is ever logged, only its source, its seconds-left
// and the failure kind. I8/§3.2 — the value returned here may reach an outbound
// `Authorization` header and NOTHING else: never a spawned session's env, never
// mcp-spawn.json, never over IPC to the renderer (ui-bridge builds the header in
// main and hands back only `{ signedIn, userId }`).

const store = require('./auth-store');
const { diag } = require('./diag');

// ─── THE PURE CORE LIVES NEXT DOOR (main/auth-token-rules.js) ───────────────
// Every scheduling and failure decision — the constants, `needsRefresh`,
// `refreshDelayMs`, `classifyFailure`, `nextFailureState`, `retryDelayMs`,
// `mayRefreshNow`, `shouldRepairAuth` — moved there VERBATIM (sentinels included, so
// the two suites still slice one source) when this file hit the §2 cap and the
// 2026-08-30 rejected-session latch had nowhere to go. Nothing inside changed, and
// every name is re-exported below, so no call site moved.
const rules = require('./auth-token-rules');
const {
  NEAR_EXPIRY_SEC, DEFAULT_LIFETIME_SEC, MAX_DEFINITIVE_FAILURES,
  needsRefresh, refreshDelayMs, classifyFailure, nextFailureState,
  retryDelayMs, mayRefreshNow, shouldRepairAuth,
} = rules;

// ── Session shape helpers ───────────────────────────────────────────────────
// `exp` from the JWT itself when readable, falling back to the stored
// `expires_at`. jwtExp() returns null for anything that is not a JWT.
function sessionExpSec(s) {
  if (!s) return null;
  const fromJwt = store.jwtExp(s.access_token);
  if (fromJwt != null) return fromJwt;
  return Number.isFinite(s.expires_at) ? s.expires_at : null;
}

function sessionLifetimeSec(s) {
  if (!s) return DEFAULT_LIFETIME_SEC;
  const claims = s.access_token ? store.decodeJwt(s.access_token) : null;
  const exp = sessionExpSec(s);
  if (claims && Number.isFinite(claims.iat) && exp != null && exp > claims.iat) {
    return exp - claims.iat;
  }
  if (Number.isFinite(s.expires_in) && s.expires_in > 0) return s.expires_in;
  return DEFAULT_LIFETIME_SEC;
}

const nowSec = () => Math.floor(Date.now() / 1000);

// ── Subscribers / auth state ────────────────────────────────────────────────
let started = false;
let timer = null;
let failure = { definitive: 0, attempts: 0 };
// The stamp `mayRefreshNow` reads: earliest a caller-driven rotation may start again.
// Armed/cleared in noteRefreshOutcome — the ordering note there is the actual fix.
let retryNotBeforeMs = 0;
// The 401-survived-a-fresh-token latch (see noteSessionRejected). In memory only:
// it is a fact about this run's credential, and a restart re-asks the server.
let sessionRejected = false;
const subscribers = new Set();
let lastEmitKey = null;

/**
 * The renderer-safe view of the session. TOKEN-FREE BY CONTRACT — `{ signedIn,
 * userId }` is the entire thing ui-bridge is allowed to hand across IPC.
 *
 * NOTE the deliberate narrowing: this is the BEARER authority's answer, derived
 * from the stored session blob alone. `auth-state.isSignedIn()` stays broader
 * (a live cookie jar also counts) and is still what the listener, presence and
 * the tray consult; this one answers "can main mint an Authorization header".
 */
function getAuthState() {
  const s = store.loadSession();
  const claims = s && s.access_token ? store.decodeJwt(s.access_token) : null;
  return {
    // ⚠ THE REJECTION OUTRANKS THE BLOB (2026-08-30 — see `noteSessionRejected`).
    // Holding a syntactically fine token is not the same as holding one the API
    // accepts, and this answer is what every other lane reads.
    signedIn: !sessionRejected && !!(s && s.access_token),
    userId: sessionRejected ? null : (claims && claims.sub) || null,
  };
}

/**
 * A 401 SURVIVED A FORCED ROTATION — the one condition this module already calls a real
 * sign-out. ⚠ IT MUST BE REMEMBERED, and not remembering it was the churn engine of the
 * 2026-08-30 incident (ENGINEERING.md carries the full loop).
 *
 * In one line: both repair seams answered it with a bare `emitAuthState('signed-out')`,
 * which FORCES `signedIn:false` into one push while leaving the blob in place — so the
 * next request rotated again and announced signed-IN, `lastEmitKey` cannot dedupe an
 * alternating pair, and `app.tsx › App` read one auth TRANSITION per 401 and answered
 * each with `queryClient.clear()` + `persister.removeClient()` + a navigate to boot. The
 * clear re-fires every mounted query, each 401s, each drives another flap.
 *
 * ⚠ LATCHED UNTIL A NEW CREDENTIAL, not until the next successful rotation: rotating the
 * SAME session mints a different token for the same rejected identity, which is exactly
 * the resurrection that made the claim a lie. Only `onSignIn`/`onSignOut` clear it.
 * ⚠ THE BLOB IS NOT DROPPED HERE — that stays bounded in `noteRefreshOutcome` (N
 * consecutive DEFINITIVE refresh rejections). A 401 from the app API is evidence about
 * the API, not proof the Supabase refresh token is dead.
 */
function noteSessionRejected(reason) {
  if (!sessionRejected) {
    diag('auth-tokens: session REJECTED —', reason || '401 survived a forced refresh',
      '— staying signed out until a new sign-in');
  }
  sessionRejected = true;
  clearTimer();
  emitAuthState('signed-out');
}

/**
 * Notify subscribers of an auth transition: 'signed-in' | 'signed-out' |
 * 'refreshing'. Deduped on (status, userId) so a quiet machine emits nothing and
 * the SPA never re-renders on a no-op. A throwing subscriber can never break the
 * refresh loop that called this.
 */
function emitAuthState(status) {
  const base = getAuthState();
  const payload = {
    status,
    signedIn: status === 'signed-out' ? false : base.signedIn,
    userId: status === 'signed-out' ? null : base.userId,
  };
  const key = `${payload.status}:${payload.userId || ''}:${payload.signedIn}`;
  if (key === lastEmitKey) return payload;
  lastEmitKey = key;
  for (const fn of subscribers) {
    try {
      fn(payload);
    } catch (err) {
      diag('auth-tokens: auth-state subscriber threw —', (err && err.message) || String(err));
    }
  }
  return payload;
}

/** Subscribe to auth transitions. Returns the unsubscribe function. */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ── The proactive refresh timer ─────────────────────────────────────────────
function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNext(delayMs) {
  clearTimer();
  if (!started) return;
  timer = setTimeout(() => {
    timer = null;
    tick().catch((err) => diag('auth-tokens: tick error —', (err && err.message) || String(err)));
  }, delayMs);
}

/**
 * Reported by auth.js's refreshInner on every refresh outcome, so the
 * drop-the-session decision lives HERE (bounded) instead of inline on a single
 * 400. Returns `{ dropSession }`; auth.js clears the blob only when it is true.
 */
function noteRefreshOutcome(outcome) {
  const next = nextFailureState(failure, outcome);
  if (outcome && outcome.ok) {
    failure = { definitive: 0, attempts: 0 };
    retryNotBeforeMs = 0;
    return { dropSession: false, kind: 'ok', attempts: 0, definitive: 0 };
  }
  failure = { definitive: next.definitive, attempts: next.attempts };
  // ARM THE GATE HERE, WHERE `failure` IS WRITTEN — the place matters as much as the
  // rate limit. F-132's residual: 39 316 refresh attempts in seconds on an offline
  // machine, each paired with a `ui-sync auth MISSING — rotate` line. THE CYCLE:
  // refreshNow announces a FAILED rotation with emitAuthState('signed-in') — it must,
  // or the UI stays stuck on 'refreshing', and the 'refreshing' emit ahead of it means
  // lastEmitKey can never dedupe it away — main/shell-mode.js answers that by calling
  // ui-sync's refreshAuth(), and ui-sync answers THAT by reading getAccessToken(). The
  // failure re-drove the read that produced it. Two reasons for this seam over
  // refreshNow's tail: (1) it is the ONE place every outcome is reported, including the
  // cookie path's auth.ensureFresh(), which never enters refreshNow, so the stamp
  // cannot drift from the `attempts` it is derived from; (2) it runs BEFORE the
  // announcement, so the bound does not rest on a subscriber's read being deferred.
  retryNotBeforeMs = Date.now() + retryDelayMs(next.attempts);
  diag(
    'auth-tokens: refresh failed —',
    next.kind,
    `(definitive ${next.definitive}/${MAX_DEFINITIVE_FAILURES}, attempt ${next.attempts})`,
    next.dropSession
      ? '— DROPPING the stored session'
      : '— keeping the stored session; will retry'
  );
  // The drop is about to happen, so the ladder starts clean for the next sign-in —
  // gate included, or the first read after it would be refused for up to
  // RETRY_CEILING_MS on the strength of a session that no longer exists.
  if (next.dropSession) { failure = { definitive: 0, attempts: 0 }; retryNotBeforeMs = 0; }
  return {
    dropSession: next.dropSession,
    kind: next.kind,
    attempts: next.attempts,
    definitive: next.definitive,
  };
}

// One rotation through the SHARED single-flight refresh in auth.js. Never runs a
// second refresher: concurrent callers (this timer, getAccessToken, the 401
// repair, the cookie path) all join the same in-flight promise, because Supabase
// rotates the refresh token on use and N refreshes means N-1 400s (FIX S6).
async function refreshNow(reason) {
  // ⚠ A REJECTED SESSION IS NOT ROTATED. Every 401 repair calls in here, so without
  // this the latch would stop the FLAP but not the traffic: one Supabase rotation per
  // 401, forever, on a credential the API has already refused.
  if (sessionRejected) {
    clearTimer();
    emitAuthState('signed-out');
    return null;
  }
  const before = store.loadSession();
  if (!before || !before.refresh_token) {
    clearTimer();
    emitAuthState('signed-out');
    return null;
  }
  emitAuthState('refreshing');
  let next = null;
  try {
    // LAZY REQUIRE, deliberately: auth.js reports its refresh outcome back into
    // this module, so a top-level require in both directions would close a cycle.
    next = await require('./auth').refresh();
  } catch (err) {
    store.authFail('token refresh error', err);
  }
  if (next && next.access_token) {
    diag(
      'auth-tokens: refreshed (',
      reason,
      ') — seconds left',
      String((sessionExpSec(next) || 0) - nowSec())
    );
    scheduleNext(
      refreshDelayMs({
        expSec: sessionExpSec(next),
        lifetimeSec: sessionLifetimeSec(next),
        nowSec: nowSec(),
      })
    );
    emitAuthState('signed-in');
    return next;
  }
  // Failed. If the bounded counter above decided to drop, the blob is gone and
  // this is a real sign-out; otherwise keep the session and retry on backoff.
  const after = store.loadSession();
  if (!after || !after.access_token) {
    clearTimer();
    emitAuthState('signed-out');
    return null;
  }
  // Still signed in — we simply could not ROTATE. Say so, or the UI stays stuck
  // on 'refreshing' until the next success (the emitter dedupes, so a repeated
  // 'refreshing' would never clear itself).
  emitAuthState('signed-in');
  scheduleNext(retryDelayMs(failure.attempts));
  return null;
}

// Re-arm from whatever is on disk right now: refresh immediately when the token is
// already near expiry, otherwise sleep until ~80% of its life.
function kick(reason) {
  const s = sessionRejected ? null : store.loadSession();
  if (!s || !s.access_token) {
    clearTimer();
    emitAuthState('signed-out');
    return;
  }
  const exp = sessionExpSec(s);
  if (needsRefresh(exp, nowSec())) {
    refreshNow(reason).catch(() => {});
    return;
  }
  // HEALTHY PATH MUST EMIT TOO (fleet audit 2026-08-03, critical): every
  // successful sign-in lands here — a fresh JWT is never near expiry — and
  // both sign-in entry points (password IPC, dopl:// capture) rely on this
  // push to flip the renderer off the login screen. emitAuthState's
  // lastEmitKey dedupe makes repeat kicks (wake, watch) free.
  emitAuthState('signed-in');
  scheduleNext(
    refreshDelayMs({ expSec: exp, lifetimeSec: sessionLifetimeSec(s), nowSec: nowSec() })
  );
}

async function tick() {
  const s = sessionRejected ? null : store.loadSession();
  if (!s || !s.refresh_token) {
    clearTimer();
    emitAuthState('signed-out');
    return;
  }
  const exp = sessionExpSec(s);
  // A timer can fire late (sleep) or early (clock change); re-decide from the
  // token rather than trusting that the alarm meant what it meant when it was set.
  if (!needsRefresh(exp, nowSec())) {
    scheduleNext(
      refreshDelayMs({ expSec: exp, lifetimeSec: sessionLifetimeSec(s), nowSec: nowSec() })
    );
    return;
  }
  await refreshNow('scheduled');
}

// ── Public surface ──────────────────────────────────────────────────────────

/**
 * A currently-valid Supabase access JWT, or null. Refreshes in line when the
 * stored token is inside the near-expiry window, so no caller ever has to think
 * about expiry. Never logged, never returned to the renderer.
 */
async function getAccessToken() {
  if (sessionRejected) return null; // the API refused this session; do not mint headers for it
  const s = store.loadSession();
  if (!s || !s.access_token) return null;
  const exp = sessionExpSec(s);
  if (!needsRefresh(exp, nowSec())) return s.access_token;
  // GATED (F-132 residual). Every caller funnels through here, so this is the one
  // place that can stop a caller which re-asks on failure from re-driving a rotation
  // per ask. Being gated is NOT a failure: the fallthrough below still answers with
  // the token we hold while it has real life left — which is what the near-expiry
  // margin is FOR — and the timer goes on climbing the same ladder in the background.
  if (mayRefreshNow(Date.now(), retryNotBeforeMs)) {
    const next = await refreshNow('near-expiry');
    if (next && next.access_token) return next.access_token;
  }
  // The refresh failed (or the gate held it) but the token we hold may still have
  // real life in it (the near-expiry window is a safety margin, not death). Past
  // `exp` it is a guaranteed 401 and null is the honest answer.
  //
  // RE-READ THE STORE, never the pre-refresh snapshot (refreshNow's own `after =
  // loadSession()` pattern): if that refresh was the third consecutive definitive
  // rejection, auth.js has just cleared the blob and 'signed-out' has been
  // emitted — handing `s.access_token` back would keep authenticating requests
  // for up to NEAR_EXPIRY_SEC after the authority declared the session gone.
  const after = store.loadSession();
  if (!after || !after.access_token) return null;
  const afterExp = sessionExpSec(after);
  return afterExp != null && afterExp > nowSec() ? after.access_token : null;
}

// ⚠ `getAuthHeader()` STOOD HERE AND IS DELETED (2026-08-20). It wrapped `getAccessToken()`
// as `Bearer <token>` and had ZERO callers: every seam that attaches a credential builds the
// header itself (`api.js`, `ui-bridge.js`, `listener-io.js`), which is exactly what INVARIANTS
// §11's "exactly two cookie-attaching seams; a third copy of the rule is the bug" is about — a
// convenience wrapper here is where a third one would start. Callers take `getAccessToken()`.

/**
 * Force ONE rotation regardless of expiry — the 401-repair entry point. Returns
 * the fresh session (so the caller can also repair the cookie jar) or null.
 */
async function forceRefresh() {
  return refreshNow('401-repair');
}

/** Start the proactive timer. Idempotent. */
function start() {
  if (started) return;
  started = true;
  kick('start');
}

/** Stop the timer (quit / teardown). Subscribers are left intact. */
function stop() {
  started = false;
  clearTimer();
}

/**
 * powerMonitor 'resume' / 'unlock-screen'. The machine may have slept through a
 * whole token lifetime and the timer that would have fired is long gone, so
 * re-decide from disk immediately. The failure counters are deliberately NOT
 * reset: a wake is not evidence that a rejected refresh token came back to life.
 */
function onWake() {
  if (!started) return;
  kick('wake');
}

/** The deep-link capture just persisted a brand-new session. */
function onSignIn() {
  failure = { definitive: 0, attempts: 0 };
  retryNotBeforeMs = 0; // a NEW credential is real evidence; the old ladder is void
  sessionRejected = false; // …and so is the rejection: this is a different credential
  lastEmitKey = null;
  if (!started) {
    emitAuthState('signed-in');
    return;
  }
  kick('sign-in');
}

/** Explicit sign-out: stop rotating a credential that no longer exists. */
function onSignOut() {
  failure = { definitive: 0, attempts: 0 };
  retryNotBeforeMs = 0;
  // The credential is gone, so the latch has nothing left to protect against — and
  // leaving it armed would refuse the NEXT sign-in on this machine.
  sessionRejected = false;
  clearTimer();
  emitAuthState('signed-out');
}

module.exports = {
  getAccessToken,
  getAuthState,
  forceRefresh,
  noteRefreshOutcome,
  noteSessionRejected,
  emitAuthState,
  subscribe,
  start,
  stop,
  onWake,
  onSignIn,
  onSignOut,
  // Pure core — exported for callers that need the rule, not the timer.
  needsRefresh,
  refreshDelayMs,
  classifyFailure,
  nextFailureState,
  retryDelayMs,
  mayRefreshNow,
  shouldRepairAuth,
  NEAR_EXPIRY_SEC,
  MAX_DEFINITIVE_FAILURES,
};

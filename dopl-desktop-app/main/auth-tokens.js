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

// ─── BEGIN AUTH-TOKENS-PURE (no electron/require refs below) ────────────────
// Every scheduling and failure decision is a pure function of injected numbers, so
// the truth table is unit-testable without a clock, a socket or an OS keychain.
// Sliced verbatim by test/auth-tokens.test.mjs.

// A token this close to `exp` is treated as already dead: the request it would
// authorize still has to travel, and the server's own clock may be ahead of ours.
const NEAR_EXPIRY_SEC = 120;
// Refresh at ~80% of the token's life — early enough that a failure leaves room
// for the whole bounded retry ladder below before the token actually dies.
const REFRESH_AT_FRACTION = 0.8;
// Floor: a bogus/near-past `exp` must never turn the timer into a spin loop
// (F-072 — a read must never become a write storm).
const MIN_SCHEDULE_MS = 15_000;
// Ceiling: a bogus far-future `exp` must not park the timer past any real session.
const MAX_SCHEDULE_MS = 60 * 60 * 1000;
const DEFAULT_LIFETIME_SEC = 3600;
// How many CONSECUTIVE definitive failures before the stored session is dropped.
// One 400 is not proof: FIX S6's rotation race produces exactly one, and after it
// there is no cookie jar left to fall back to.
const MAX_DEFINITIVE_FAILURES = 3;
// Retry ladder for a failed refresh. Bounded growth, then a ceiling — a machine
// that is offline for a week must not hammer, and must not sign the operator out.
const RETRY_BACKOFF_MS = [5_000, 20_000, 60_000];
const RETRY_CEILING_MS = 5 * 60 * 1000;

// TRUE when the token must be rotated before it is handed to anyone. An UNREADABLE
// exp counts as "needs refresh": we cannot justify sending a token we cannot date.
function needsRefresh(expSec, nowSec, nearSec = NEAR_EXPIRY_SEC) {
  if (expSec == null || !Number.isFinite(expSec)) return true;
  return expSec - nowSec < nearSec;
}

// When the proactive timer should next fire, in ms from `nowSec`. Keyed on the
// token's OWN lifetime (exp - iat) rather than a constant, so a project that
// shortens or lengthens its JWT TTL needs no change here.
function refreshDelayMs(input) {
  const { expSec, lifetimeSec, nowSec } = input || {};
  if (expSec == null || !Number.isFinite(expSec)) return MIN_SCHEDULE_MS;
  const life =
    Number.isFinite(lifetimeSec) && lifetimeSec > 0 ? lifetimeSec : DEFAULT_LIFETIME_SEC;
  const target = expSec - life * (1 - REFRESH_AT_FRACTION);
  const ms = (target - nowSec) * 1000;
  if (!Number.isFinite(ms)) return MIN_SCHEDULE_MS;
  return Math.min(MAX_SCHEDULE_MS, Math.max(MIN_SCHEDULE_MS, Math.round(ms)));
}

// 'definitive' — the SERVER answered and rejected the refresh token itself.
// 'transient' — anything else: a throw (DNS, captive portal, sleep mid-flight), a
// 5xx, a 429, a malformed body. A transient failure must NEVER move the machine
// toward a sign-out; that is precisely how one bad network turned into one.
function classifyFailure(outcome) {
  const status = outcome && outcome.status;
  if (status === 400 || status === 401 || status === 403 || status === 422) {
    return 'definitive';
  }
  return 'transient';
}

// The bounded-drop counter. `attempts` drives the backoff ladder (any failure);
// `definitive` drives the drop (server rejections only) and is what MUST reach
// MAX_DEFINITIVE_FAILURES before a session is thrown away.
function nextFailureState(state, outcome) {
  const prev = state && typeof state === 'object' ? state : { definitive: 0, attempts: 0 };
  if (outcome && outcome.ok) {
    return { definitive: 0, attempts: 0, kind: 'ok', dropSession: false };
  }
  const kind = classifyFailure(outcome);
  const definitive = kind === 'definitive' ? (prev.definitive || 0) + 1 : prev.definitive || 0;
  return {
    definitive,
    attempts: (prev.attempts || 0) + 1,
    kind,
    dropSession: definitive >= MAX_DEFINITIVE_FAILURES,
  };
}

// Backoff for the Nth consecutive failed refresh (1-based).
function retryDelayMs(attempt) {
  const i = Math.max(0, Math.floor(Number(attempt) || 0) - 1);
  return i < RETRY_BACKOFF_MS.length ? RETRY_BACKOFF_MS[i] : RETRY_CEILING_MS;
}

// THE 401 REPAIR RULE — exactly one retry, never a loop. A 401 that survives a
// fresh token is a real authorization answer (revoked session, wrong workspace,
// a sessionOnly route), and retrying it again only multiplies the damage.
function shouldRepairAuth(status, alreadyRetried) {
  return status === 401 && !alreadyRetried;
}
// ─── END AUTH-TOKENS-PURE ───────────────────────────────────────────────────

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
  return { signedIn: !!(s && s.access_token), userId: (claims && claims.sub) || null };
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
    return { dropSession: false, kind: 'ok', attempts: 0, definitive: 0 };
  }
  failure = { definitive: next.definitive, attempts: next.attempts };
  diag(
    'auth-tokens: refresh failed —',
    next.kind,
    `(definitive ${next.definitive}/${MAX_DEFINITIVE_FAILURES}, attempt ${next.attempts})`,
    next.dropSession
      ? '— DROPPING the stored session'
      : '— keeping the stored session; will retry'
  );
  // The drop is about to happen, so the ladder starts clean for the next sign-in.
  if (next.dropSession) failure = { definitive: 0, attempts: 0 };
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
  const s = store.loadSession();
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
  scheduleNext(
    refreshDelayMs({ expSec: exp, lifetimeSec: sessionLifetimeSec(s), nowSec: nowSec() })
  );
}

async function tick() {
  const s = store.loadSession();
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
  const s = store.loadSession();
  if (!s || !s.access_token) return null;
  const exp = sessionExpSec(s);
  if (!needsRefresh(exp, nowSec())) return s.access_token;
  const next = await refreshNow('near-expiry');
  if (next && next.access_token) return next.access_token;
  // The refresh failed but the token we hold may still have real life in it (the
  // near-expiry window is a safety margin, not death). Past `exp` it is a
  // guaranteed 401 and null is the honest answer.
  return exp != null && exp > nowSec() ? s.access_token : null;
}

/** `Authorization` header value, or null. The one intended use of the token. */
async function getAuthHeader() {
  const token = await getAccessToken();
  return token ? `Bearer ${token}` : null;
}

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
  clearTimer();
  emitAuthState('signed-out');
}

module.exports = {
  getAccessToken,
  getAuthHeader,
  getAuthState,
  forceRefresh,
  noteRefreshOutcome,
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
  shouldRepairAuth,
  NEAR_EXPIRY_SEC,
  MAX_DEFINITIVE_FAILURES,
};

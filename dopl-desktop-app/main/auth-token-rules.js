// auth-token-rules.js — THE ACCESS-TOKEN AUTHORITY'S PURE DECISIONS.
//
// WHY THIS FILE EXISTS, and it is the `listener-budget.js` reason verbatim: the
// 2026-08-30 abort-churn fix had to add a rejected-session latch to `auth-tokens.js`,
// and that file was sitting at 498 of the §2 500-line cap — the fix could not be
// written until something moved. This block is what moved, VERBATIM, sentinels
// included: every scheduling and failure decision, each a pure function of injected
// numbers, with no electron, no store, no clock and no socket.
//
// ⚠ THE SENTINELS TRAVELLED WITH IT ON PURPOSE. `test/auth-tokens.test.mjs` and
// `test/auth-tokens-refresh-gate.test.mjs` slice `BEGIN/END AUTH-TOKENS-PURE` out of
// the shipped source and evaluate it, so the block had to stay sliceable at its new
// address rather than become a second copy. Being dependency-free, it is additionally
// `require`-able for real — which is strictly better than the slice and is the
// direction a future test should move.
//
// ⚠ `auth-tokens.js` RE-EXPORTS every name below, so no call site moved.

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

// THE IN-LINE REFRESH GATE (F-132's residual storm). The ladder above was honoured
// only by the proactive TIMER; the CALLER-DRIVEN path — getAccessToken() below — had
// no bound at all, so while the stored token sat inside the near-expiry window every
// single call re-drove a real network rotation. Same ladder, read off the wall clock.
// `notBeforeMs` is the stamp the last FAILED refresh left behind; 0 (never failed, or
// a success cleared it) passes, and an unreadable clock fails OPEN — a rate limit
// that cannot read the time must not strand a session.
function mayRefreshNow(nowMs, notBeforeMs) {
  if (!Number.isFinite(notBeforeMs) || notBeforeMs <= 0) return true;
  return Number.isFinite(nowMs) ? nowMs >= notBeforeMs : true;
}

// THE 401 REPAIR RULE — exactly one retry, never a loop. A 401 that survives a
// fresh token is a real authorization answer (revoked session, wrong workspace,
// a sessionOnly route), and retrying it again only multiplies the damage.
function shouldRepairAuth(status, alreadyRetried) {
  return status === 401 && !alreadyRetried;
}
// ─── END AUTH-TOKENS-PURE ───────────────────────────────────────────────────

module.exports = {
  NEAR_EXPIRY_SEC,
  REFRESH_AT_FRACTION,
  MIN_SCHEDULE_MS,
  MAX_SCHEDULE_MS,
  DEFAULT_LIFETIME_SEC,
  MAX_DEFINITIVE_FAILURES,
  RETRY_BACKOFF_MS,
  RETRY_CEILING_MS,
  needsRefresh,
  refreshDelayMs,
  classifyFailure,
  nextFailureState,
  retryDelayMs,
  mayRefreshNow,
  shouldRepairAuth,
};

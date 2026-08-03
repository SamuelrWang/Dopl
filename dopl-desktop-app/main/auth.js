// Main-process auth store for the background listener.
//
// WHY COOKIES, NOT A BEARER TOKEN (documented deviation from the contract):
// The contract's listener sketch calls the API with `Authorization: Bearer
// <access token>`. The real shared auth layer (src/shared/auth/with-auth.ts)
// treats ANY Authorization header as an OAuth *MCP* token and validates it
// against the MCP token store; a raw Supabase JWT fails that check and the
// request 401s WITHOUT falling through to cookies. The only bearer it accepts
// is a Dopl-OAuth token, which the desktop app never mints. The supported path
// for a session caller is the Supabase auth cookies (getSessionUser). So the
// listener authenticates by forwarding the Electron session's
// `sb-<ref>-auth-token*` cookies — the session path the server actually honors.
//
// The captured access/refresh tokens + Supabase refresh endpoint (both required
// by Phase 3) are still implemented here: they keep a valid session alive when
// the window is hidden, and repair the cookie jar if it goes stale.
//
// SPLIT NOTE (Q4, 500-line cap). Three siblings sit under this file and it
// re-exports all of them, so no caller changed:
//   auth-store.js   — the encrypted blob + JWT decoders + throttled failure log
//   auth-cookies.js — everything that touches the Electron cookie jar
//   auth-state.js   — isSignedIn / ensureSignedIn / blob repair / signOut
// This file keeps the deep-link CSRF gate, the Realtime credential choice, the
// Supabase refresh call, and the Cookie-header assembly for API calls.

const crypto = require('crypto');
const { app } = require('electron');
const cookies = require('./auth-cookies');
const state = require('./auth-state');
const { store, authFail, persist, loadSession, clearSession, decodeJwt, jwtExp } = require('./auth-store');
const { diag } = require('./diag');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const PENDING_AUTH_KEY = 'pendingAuth'; // { nonce, ts } — M4 login-CSRF gate
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

// ── Login-CSRF gate for the deep link (M4) ─────────────────────────────────
// A dopl://auth#<tokens> link can be fired by ANY local process or a website
// (login CSRF): the app would otherwise adopt an attacker-controlled session.
// We require that THIS app initiated a sign-in recently: auth-actions.js calls
// beginPendingAuth() when it opens the external sign-in URL (and appends the
// nonce as ?state=), and captureFromFragment() will only persist a fragment
// when a matching pending record exists inside the TTL.
//
// FOLLOW-UP DEBT: the strongest form is a full state round-trip — the web sign-in
// flow echoing our `state` nonce back in the dopl:// fragment. Until the web side
// echoes it, we enforce the pending-flag + 10-minute TTL gate (and, if a state IS
// present, require it to match). Web-side echo is tracked as follow-up work.
function beginPendingAuth() {
  const nonce = crypto.randomBytes(16).toString('hex');
  store.set(PENDING_AUTH_KEY, { nonce, ts: Date.now() });
  return nonce;
}

function hasValidPendingAuth() {
  const p = store.get(PENDING_AUTH_KEY);
  return !!(p && p.ts && Date.now() - p.ts <= PENDING_AUTH_TTL_MS);
}

// Single-use: consumes (deletes) the pending record and returns whether it was
// valid. If the flow echoed a `state`, it must match the stored nonce.
function consumePendingAuth(state_) {
  const p = store.get(PENDING_AUTH_KEY);
  store.delete(PENDING_AUTH_KEY);
  if (!p || !p.ts) return false;
  if (Date.now() - p.ts > PENDING_AUTH_TTL_MS) return false;
  if (state_ != null && state_ !== '' && state_ !== p.nonce) return false;
  return true;
}

// ── Deep-link token capture (Phase 3) ─────────────────────────────────────
// Called from openDeepLink() with the raw dopl://auth#<fragment>. Extracts the
// Supabase tokens the OAuth completion handed back and stores them encrypted.
// Returns false (and persists nothing) when the M4 pending-auth gate rejects.
function captureFromFragment(fragment) {
  try {
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return false;

    // M4: reject sessions we didn't initiate (no pending flag / expired / bad state).
    if (!consumePendingAuth(params.get('state'))) {
      console.warn('[auth] rejected deep-link session: no matching pending sign-in');
      diag('auth: rejected deep-link session (no matching pending sign-in)');
      return false;
    }

    const expiresIn = Number(params.get('expires_in') || 0);
    const expiresAt = Number(params.get('expires_at') || 0);
    persist({
      access_token,
      refresh_token,
      token_type: 'bearer',
      expires_in: expiresIn || 3600,
      expires_at: expiresAt || Math.floor(Date.now() / 1000) + (expiresIn || 3600),
    });
    state.invalidateCookieIdentity(); // re-read the jar the completion page sets
    console.log('[auth] captured Supabase session from deep link');
    diag('auth: captured Supabase session from deep link');
    return true;
  } catch (err) {
    authFail('captureFromFragment failed', err);
    return false;
  }
}

// The authenticated user's id (Supabase auth uid), decoded from the STORED
// access token (deep-link sessions) without a network call. Returns null for
// cookie-only sign-ins where no session blob was captured.
function getUserId() {
  const s = loadSession();
  if (!s || !s.access_token) return null;
  const claims = decodeJwt(s.access_token);
  return claims && claims.sub ? claims.sub : null;
}

// H2: derive the operator id from the auth cookie, covering cookie-only sessions
// where getUserId() (stored blob) is null.
async function getUserIdFromCookies() {
  try {
    const token = await cookies.readCookieAccessToken();
    const claims = token ? decodeJwt(token) : null;
    return claims && claims.sub ? claims.sub : null;
  } catch (err) {
    authFail('cookie identity decode failed', err);
    return null;
  }
}

// ── Realtime credential selection ─────────────────────────────────────────
// Realtime is the ONLY consumer that needs a raw user JWT (setAuth); every HTTP
// caller uses the cookie jar instead. Treat a token as dead this many seconds
// before its real `exp` so we never hand Realtime one that dies mid-join.
const ACCESS_SKEW_SEC = 60;
// Rotate the stored blob at most this often when both sources are stale
// (F-072: a read must never trigger a write storm).
const REFRESH_COOLDOWN_MS = 30_000;
let lastRefreshAttemptMs = 0;

// ─── BEGIN TOKEN-CHOICE (pure; unit-tested via source extraction) ──────────
// WHICH credential Realtime gets. Two sources exist and they DRIFT APART:
//   'stored' — the deep-link session blob. Rewritten only by captureFromFragment()
//              or refresh(), and refresh() is reachable only from getAuthCookie()'s
//              repair branch, which never runs while the renderer keeps the cookie
//              jar fresh. So the blob's JWT dies ~1h after sign-in and STAYS dead.
//   'cookie' — the jar the live web session auto-refreshes; normally the fresh one.
// The old rule was "stored first, cookie only if the blob is missing", which pins
// Realtime to the one source that rots: it then sends an expired JWT, Realtime
// answers CHANNEL_ERROR, and every rejoin re-reads the SAME dead token, so push
// never recovers (zero SUBSCRIBED) while the cookie-authed HTTP calls stay fine.
// Worse, when NO token is passed at all, realtime-js falls back to the URL apikey
// and joins as `anon` — whose RLS evaluation of the published tables raises 42501
// (`permission denied for function is_current_workspace_member`) and crashes the
// project's whole postgres_changes pipeline, for every client.
// So: pick the candidate with the most life left, and report WHY, so the caller
// can log the reason and the source without ever logging the token value.
// Pure over its inputs (`nowSec` injected) so the truth table is unit-testable.
function chooseAccessToken(candidates, nowSec, skewSec) {
  const usable = (candidates || []).filter((c) => c && c.token);
  if (usable.length === 0) {
    return { kind: 'none', token: null, exp: null, secondsLeft: null, fresh: false, reason: 'no-credential' };
  }
  const scored = usable.map((c) => ({
    kind: c.kind,
    token: c.token,
    exp: c.exp == null ? null : c.exp,
    secondsLeft: c.exp == null ? null : c.exp - nowSec,
  }));
  const alive = scored.filter((c) => c.exp != null && c.exp > nowSec + skewSec);
  const pool = alive.length ? alive : scored;
  // Furthest-future exp wins. A token whose exp we cannot read sorts LAST: it is
  // probably not a Supabase JWT, and Realtime would reject it anyway.
  const rank = (c) => (c.exp == null ? -Infinity : c.exp);
  const best = pool.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  return {
    kind: best.kind,
    token: best.token,
    exp: best.exp,
    secondsLeft: best.secondsLeft,
    fresh: alive.length > 0,
    reason: alive.length ? 'fresh' : best.exp == null ? 'exp-unreadable' : 'all-expired',
  };
}
// ─── END TOKEN-CHOICE ──────────────────────────────────────────────────────

// The Supabase user access_token JWT for Realtime auth (setAuth) PLUS the
// metadata the caller logs: which source it came from, how much life it has left,
// and why it was chosen. The token value lives only in `.token` and is never
// logged. When both sources are stale we rotate the stored blob once per cooldown
// and re-pick, so a long-lived background listener repairs itself instead of
// re-sending a token the server has already rejected.
async function getAccessTokenInfo() {
  const stored = loadSession();
  let cookieToken = null;
  try {
    cookieToken = await cookies.readCookieAccessToken();
  } catch (err) {
    authFail('access-token read failed', err);
  }
  const candidates = [
    { kind: 'stored', token: (stored && stored.access_token) || null },
    { kind: 'cookie', token: cookieToken },
  ].map((c) => ({ ...c, exp: jwtExp(c.token) }));

  const pick = chooseAccessToken(candidates, Math.floor(Date.now() / 1000), ACCESS_SKEW_SEC);
  if (pick.fresh) return pick;
  if (Date.now() - lastRefreshAttemptMs < REFRESH_COOLDOWN_MS) return pick;
  lastRefreshAttemptMs = Date.now();
  const next = await refresh();
  if (!next || !next.access_token) return pick;
  candidates.push({ kind: 'refreshed', token: next.access_token, exp: jwtExp(next.access_token) });
  return chooseAccessToken(candidates, Math.floor(Date.now() / 1000), ACCESS_SKEW_SEC);
}

// Back-compat shape for callers that only want the token string.
async function getAccessToken() {
  return (await getAccessTokenInfo()).token;
}

function isAccessExpired(skewSec = 60) {
  const s = loadSession();
  if (!s || !s.expires_at) return true;
  return s.expires_at <= Math.floor(Date.now() / 1000) + skewSec;
}

// ── Refresh via the Supabase token endpoint (Phase 3) ──────────────────────
//
// FIX S6 (Q5 review) — SINGLE-FLIGHT, because the amplification was real. Only
// getAccessTokenInfo() was cooldowned; `ensureFresh()` (the listener's per-workspace
// enumeration-retry path, and getAuthCookie's repair branch) called refresh()
// directly with no coordination at all. N concurrent channel loops therefore fired N
// refreshes against the SAME refresh token, and Supabase ROTATES on use — exactly one
// wins and the rest get a 400, whose handler below drops the stored blob. So a
// transient failure could convert itself into a real sign-out of the blob. One
// in-flight promise, shared by every caller: the cooldown in getAccessTokenInfo is
// still useful (it bounds how OFTEN we rotate) but it is no longer the only bound.
let refreshing = null;
function refresh() {
  if (refreshing) return refreshing;
  refreshing = refreshInner().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshInner() {
  const s = loadSession();
  if (!s || !s.refresh_token) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      }
    );
    if (!res.ok) {
      authFail('refresh failed', `HTTP ${res.status}`);
      // BOUNDED DROP (Phase 2). This used to be `if (res.status === 400)
      // clearSession()` — a real sign-out from ONE bad response. It was only ever
      // survivable because the cookie jar was a second source; the bearer path
      // (auth-tokens.js) has none, and FIX S6's own rotation race produces exactly
      // one 400. So the decision moved to auth-tokens.noteRefreshOutcome: N
      // CONSECUTIVE definitive rejections drop the blob, and a transient network
      // failure never counts toward it. A throw here (module unloadable) falls to
      // the outer catch and drops NOTHING, which is the safe direction.
      const verdict = require('./auth-tokens').noteRefreshOutcome({ ok: false, status: res.status });
      if (verdict && verdict.dropSession) {
        clearSession();
        diag('auth: refresh rejected repeatedly — stored blob dropped; cookie session may still be live');
      }
      return null;
    }
    const data = await res.json();
    if (!data.access_token || !data.refresh_token) {
      // A 200 with no tokens is not a rejection of the refresh token — treat it
      // as transient so it can never accumulate toward a sign-out.
      require('./auth-tokens').noteRefreshOutcome({ ok: false, status: res.status });
      return null;
    }
    const next = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'bearer',
      expires_in: data.expires_in || 3600,
      expires_at:
        data.expires_at ||
        Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user || null,
    };
    persist(next);
    require('./auth-tokens').noteRefreshOutcome({ ok: true });
    console.log('[auth] refreshed Supabase session');
    return next;
  } catch (err) {
    authFail('refresh error', err);
    // A throw is a TRANSIENT failure (DNS, captive portal, sleep mid-flight, a
    // torn socket). It must never move the machine toward a sign-out — but it
    // must still advance the backoff so a dead network is not hammered.
    try { require('./auth-tokens').noteRefreshOutcome({ ok: false, status: null }); } catch (_) {}
    return null;
  }
}

// If the stored access token is expired, refresh it. Returns the live session.
async function ensureFresh() {
  if (isAccessExpired()) return refresh();
  return loadSession();
}

// Returns a Cookie header for an API call, repairing the jar from the stored
// (refreshed) session when the live cookies are missing or stale.
async function getAuthCookie() {
  let cookie = await cookies.getSessionCookieHeader();
  if (cookie) return cookie;
  // No live cookies — try to reconstruct from the stored session.
  const fresh = await ensureFresh();
  if (fresh) {
    await cookies.writeSessionCookies(fresh);
    cookie = await cookies.getSessionCookieHeader();
  }
  return cookie;
}

module.exports = {
  captureFromFragment,
  beginPendingAuth,
  hasValidPendingAuth,
  getUserId,
  getUserIdFromCookies,
  getAccessToken,
  getAccessTokenInfo,
  isAccessExpired,
  refresh,
  ensureFresh,
  getSessionCookieHeader: cookies.getSessionCookieHeader,
  getAuthCookie,
  writeSessionCookies: cookies.writeSessionCookies,
  clearSession,
  // Q4 signed-in state (auth-state.js) — re-exported so every existing
  // `auth.isSignedIn()` call site keeps working, now cookie-aware.
  isSignedIn: state.isSignedIn,
  ensureSignedIn: state.ensureSignedIn,
  refreshSignedInState: state.refreshSignedInState,
  signedInSource: state.signedInSource,
  identityMismatch: state.identityMismatch, // S4: the jar and the blob name different users
  signOut: state.signOut,
  _appName: () => (app && app.getName ? app.getName() : 'Dopl'),
};

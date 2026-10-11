// Main-process auth store for the background listener.
//
// TWO TRANSPORTS. The server (src/shared/auth/with-auth.ts) accepts a session
// two ways: the Supabase auth cookies, and `Authorization: Bearer <Supabase
// access JWT>` (any bearer not prefixed `dopl_at_`). api.js and the listener
// forward the Electron session's `sb-<ref>-auth-token*` cookies (getAuthCookie
// below); the bearer lane is auth-tokens.js. Both read the SAME session blob and
// rotate it through the SAME single-flight refresh() here.
//
// The captured access/refresh tokens + the Supabase refresh endpoint keep a
// valid session alive when the window is hidden, and repair the cookie jar if
// it goes stale.
//
// Three siblings sit under this file, and it re-exports what callers need:
//   auth-store.js   — the encrypted blob + JWT decoders + throttled failure log
//   auth-cookies.js — everything that touches the Electron cookie jar
//   auth-state.js   — isSignedIn / ensureSignedIn / blob repair / signOut
// This file keeps the deep-link CSRF gate, the Realtime credential choice, the
// Supabase refresh call, and the Cookie-header assembly for API calls.

const crypto = require('crypto');
const cookies = require('./auth-cookies');
const state = require('./auth-state');
const {
  store,
  authFail,
  persist,
  loadSession,
  clearSession,
  decodeJwt,
  jwtExp,
  markRefreshTokenRejected,
} = require('./auth-store');
const { diag } = require('./diag');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');
const refreshTransport = require('./auth-refresh-transport'); // 2026-09-14: the bounded refresh POST

const PENDING_AUTH_KEY = 'pendingAuth'; // [{ nonce, ts, requireState?, ttlMs? }]
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
const PENDING_AUTH_MAX = 4; // concurrent sign-in attempts worth remembering

// ── Login-CSRF gate for the deep link (M4) ─────────────────────────────────
// A dopl://auth#<tokens> link can be fired by ANY local process or a website
// (login CSRF): the app would otherwise adopt an attacker-controlled session.
// We require that THIS app initiated a sign-in recently: auth-actions.js calls
// beginPendingAuth() when it opens the external sign-in URL (and appends the
// nonce as ?state=), and captureFromFragment() will only persist a fragment
// when a matching pending record exists inside the TTL.
//
// ─── BEGIN PENDING-AUTH (pure; unit-tested via source extraction) ──────────
// The gate's DECISION, free of electron-store: given the stored records, the
// clock, and whatever `state` a fragment echoed, WHICH record (if any)
// authorizes adoption.
//
// TWO RECORD KINDS in the code; only ONE is armed by any live path.
//   requireState — the flow controls the whole round trip, so the returning
//     fragment echoes our nonce and an EXACT match is enforceable. Both
//     `beginPendingAuth` callers in main/ pass `requireState: true`:
//       · the BROWSER handoff (OAuth), armed in auth-actions.maybeBeginAuth.
//         Our ?state rides the entire web leg: /auth/desktop-start forwards it
//         into the Supabase redirectTo, /auth/callback threads it on to
//         /auth/desktop-handoff, and that page puts it in the dopl:// fragment.
//       · the in-process password adoption (auth-password.js), whose fragment
//         main builds itself and which never crosses a process or the OS.
//     A 128-bit nonce is UNGUESSABLE, which is the property this rests on — an
//     injected dopl:// link cannot invent one. It is NOT unreadable: on the
//     browser leg it transits the system browser as a query param (address bar,
//     history, server access logs). The TTL and single use bound that exposure,
//     not secrecy of the value.
//   presence-only — a record with no `requireState`. NOTHING WRITES ONE. The
//     no-echo branch of `pickPendingAuth` serves only records an older build
//     left in the store; they age out on the TTL. Do not arm a new flow this
//     way — see the fail-closed note below.
//
// FAIL CLOSED IN BOTH DIRECTIONS (F-054). A fragment that echoes a state may
// spend ONLY the record carrying that exact nonce — a mismatch matches nothing
// and does NOT fall back to presence+TTL admission. A fragment with no state may
// spend only a record that does not require one.
//
// A LIST, not one record, so one sign-in never voids another in flight.
// Records are single-use and expired ones are pruned on every read/write;
// PENDING_AUTH_MAX is the belt-and-braces bound.
function livePendingAuth(list, now, ttlMs) {
  return (Array.isArray(list) ? list : []).filter(
    (p) =>
      p && typeof p.nonce === 'string' && typeof p.ts === 'number'
      && now - p.ts <= (typeof p.ttlMs === 'number' ? p.ttlMs : ttlMs)
  );
}

function pickPendingAuth(live, state_) {
  if (state_ != null && state_ !== '') {
    // An echo binds the fragment to ONE record. No match is a rejection, not a
    // reason to look for a laxer record: a wrong state must never be treated as
    // no state at all, or an attacker would strip it to reach the branch below.
    return live.find((p) => p.nonce === state_) || null;
  }
  // No echo: only a record that does not REQUIRE one may be consumed, newest first.
  const open = live.filter((p) => !p.requireState);
  return open.length ? open[open.length - 1] : null;
}
// ─── END PENDING-AUTH ──────────────────────────────────────────────────────

function readPendingAuth() {
  return livePendingAuth(store.get(PENDING_AUTH_KEY), Date.now(), PENDING_AUTH_TTL_MS);
}

function writePendingAuth(list) {
  if (list.length) store.set(PENDING_AUTH_KEY, list.slice(-PENDING_AUTH_MAX));
  else store.delete(PENDING_AUTH_KEY);
}

function beginPendingAuth(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const nonce = crypto.randomBytes(16).toString('hex');
  const rec = { nonce, ts: Date.now() };
  if (o.requireState) rec.requireState = true;
  if (typeof o.ttlMs === 'number' && o.ttlMs > 0) rec.ttlMs = o.ttlMs;
  writePendingAuth([...readPendingAuth(), rec]);
  return nonce;
}

// Single-use: consumes (deletes) the matching pending record and returns whether
// one was found. The OTHER live records survive — a completed password sign-in
// must not kill the OAuth flow the operator started thirty seconds earlier.
function consumePendingAuth(state_) {
  const live = readPendingAuth();
  const hit = pickPendingAuth(live, state_);
  writePendingAuth(hit ? live.filter((p) => p !== hit) : live);
  return !!hit;
}

// Disarm every pending record. Sign-out must leave no armed gate behind: the
// operator believes the machine is signed out, so a dopl:// fragment arriving in
// the residual TTL must not be adopted into the freshly cleaned app.
function clearPendingAuth() {
  store.delete(PENDING_AUTH_KEY);
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
    // The reason names WHICH way the gate failed but never the state value itself.
    if (!consumePendingAuth(params.get('state'))) {
      const why = params.get('state')
        ? 'the echoed state matches no armed sign-in'
        : 'no state echoed, and no state-free sign-in is armed';
      console.warn('[auth] rejected deep-link session —', why);
      diag('auth: rejected deep-link session —', why);
      return false;
    }

    const expiresIn = Number(params.get('expires_in') || 0);
    const expiresAt = Number(params.get('expires_at') || 0);
    const stored = persist({
      access_token,
      refresh_token,
      token_type: 'bearer',
      expires_in: expiresIn || 3600,
      expires_at: expiresAt || Math.floor(Date.now() / 1000) + (expiresIn || 3600),
    });
    // persist() REFUSES to write when safeStorage is unavailable (it will not
    // downgrade a refresh token to cleartext). Reporting success there made
    // sign-in a silent dead end: the caller answered {ok:true}, the next session
    // load found nothing, and the login screen came back with no error at all.
    if (!stored) {
      diag('auth: deep-link session NOT stored (see the persist failure above) — reporting failure');
      return false;
    }
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
    // ⚠ BOUNDED SINCE 2026-09-14 (F-698). This was a bare `fetch` with no signal; on a dead
    // post-wake socket it hung ~25 minutes, and because `refresh()` is single-flight every lane
    // that needed a credential at boot hung with it. The deadline lives in the transport module.
    const res = await refreshTransport.postRefresh({
      supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, refreshToken: s.refresh_token,
    });
    if (!res.ok) {
      // The CODE, not just the status — see auth-token-rules.js › refreshFailureCode for why
      // "HTTP 400" alone cost a three-incident investigation, and for the no-token guarantee.
      const code = require('./auth-token-rules').refreshFailureCode(await res.text().catch(() => ''));
      authFail('refresh failed', `HTTP ${res.status}${code ? ` (${code})` : ''}`);
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
        // ⚠ THE JAR MUST NOT RESURRECT THIS TOKEN (the 2026-08-29 sign-out
        // loop — auth-store.js › markRefreshTokenRejected carries the field
        // log). Two halves: remember the rejected token so the auth-state
        // probe refuses to adopt it back, and clear a jar holding THAT SAME
        // dead session (auth-cookies.js › clearCookiesIfSameRefreshToken —
        // a different, fresher jar session is left alone).
        markRefreshTokenRejected(s.refresh_token);
        const jarOutcome = await cookies.clearCookiesIfSameRefreshToken(s.refresh_token);
        diag(
          'auth: refresh rejected repeatedly — stored blob dropped;',
          jarOutcome === 'cleared'
            ? 'cookie jar held the same dead session and was cleared'
            : 'cookie session differs and may still be live'
        );
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
    // ⚠ THE JAR ROTATES WITH THE BLOB (2026-08-29). Supabase rotates the
    // refresh token on every use, and the blob was the only store this write
    // reached — the jar kept the PREVIOUS session forever, since the remote
    // page's supabase-js (the jar's old refresher) is gone. That drift is what
    // armed the sign-out loop: the moment the blob was dropped, auth-state
    // adopted the jar's long-dead token back. One credential, one rotation,
    // BOTH stores. Best-effort: a jar write failure must not fail a refresh
    // that already succeeded.
    try {
      await cookies.writeSessionCookies(next);
    } catch (err) {
      authFail('cookie write-back after refresh failed', err);
    }
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
  clearPendingAuth,
  getUserId,
  getUserIdFromCookies,
  getAccessToken,
  getAccessTokenInfo,
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
};

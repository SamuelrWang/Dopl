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

const crypto = require('crypto');
const { app, safeStorage, session } = require('electron');
const Store = require('electron-store');
const {
  APP_ORIGIN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REF,
} = require('./config');

const store = new Store();
const STORE_KEY = 'authSession'; // safeStorage-encrypted blob
const COOKIE_BASE = `sb-${SUPABASE_REF}-auth-token`;
const BASE64_PREFIX = 'base64-';
const PENDING_AUTH_KEY = 'pendingAuth'; // { nonce, ts } — M4 login-CSRF gate
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

// ── Encrypted persistence ─────────────────────────────────────────────────
function persist(sessionObj) {
  try {
    const json = JSON.stringify(sessionObj);
    if (safeStorage.isEncryptionAvailable()) {
      store.set(STORE_KEY, safeStorage.encryptString(json).toString('base64'));
      store.delete(STORE_KEY + 'Plain');
    } else {
      // No OS keychain (unusual on macOS). Fall back to local-only plaintext —
      // still confined to this user's app-support dir. Warn once.
      console.warn('[auth] safeStorage unavailable; storing session unencrypted');
      store.set(STORE_KEY + 'Plain', json);
      store.delete(STORE_KEY);
    }
  } catch (err) {
    console.error('[auth] persist failed:', err && err.message);
  }
}

function loadSession() {
  try {
    const enc = store.get(STORE_KEY);
    if (enc && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')));
    }
    const plain = store.get(STORE_KEY + 'Plain');
    if (plain) return JSON.parse(plain);
  } catch (err) {
    console.error('[auth] load failed:', err && err.message);
  }
  return null;
}

function clearSession() {
  store.delete(STORE_KEY);
  store.delete(STORE_KEY + 'Plain');
}

// ── Login-CSRF gate for the deep link (M4) ─────────────────────────────────
// A dopl://auth#<tokens> link can be fired by ANY local process or a website
// (login CSRF): the app would otherwise adopt an attacker-controlled session.
// We require that THIS app initiated a sign-in recently: index.js calls
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
function consumePendingAuth(state) {
  const p = store.get(PENDING_AUTH_KEY);
  store.delete(PENDING_AUTH_KEY);
  if (!p || !p.ts) return false;
  if (Date.now() - p.ts > PENDING_AUTH_TTL_MS) return false;
  if (state != null && state !== '' && state !== p.nonce) return false;
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
      return false;
    }

    const expiresIn = Number(params.get('expires_in') || 0);
    const expiresAt = Number(params.get('expires_at') || 0);
    const sessionObj = {
      access_token,
      refresh_token,
      token_type: 'bearer',
      expires_in: expiresIn || 3600,
      expires_at: expiresAt || Math.floor(Date.now() / 1000) + (expiresIn || 3600),
    };
    persist(sessionObj);
    console.log('[auth] captured Supabase session from deep link');
    return true;
  } catch (err) {
    console.error('[auth] captureFromFragment failed:', err && err.message);
    return false;
  }
}

// ── JWT helpers (offline) ──────────────────────────────────────────────────
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
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

function cookieChunkIndex(name) {
  const m = name.match(/\.(\d+)$/);
  return m ? Number(m[1]) : -1; // the unsuffixed base cookie sorts first
}

// Reassemble the Supabase auth COOKIE the web sign-in set and return the raw
// access_token JWT string (or null). The cookie value is @supabase/ssr's
// `base64-` + base64url(JSON session), possibly chunked across `<base>.0`,
// `.1`, …; we reassemble, decode, and pull the access token. No signature check
// needed — it came from our own cookie jar. Shared by getUserIdFromCookies
// (reads the token's `sub`) and getAccessToken (returns the token for Realtime).
async function readCookieAccessToken() {
  const jar = await session.defaultSession.cookies.get({ url: APP_ORIGIN });
  const authCookies = jar
    .filter((c) => c.name === COOKIE_BASE || c.name.startsWith(COOKIE_BASE + '.'))
    .sort((a, b) => cookieChunkIndex(a.name) - cookieChunkIndex(b.name));
  if (authCookies.length === 0) return null;

  let raw = authCookies.map((c) => c.value).join('');
  if (raw.startsWith(BASE64_PREFIX)) raw = raw.slice(BASE64_PREFIX.length);
  let json;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch (_) {
    json = Buffer.from(raw, 'base64').toString('utf8');
  }
  const parsed = JSON.parse(json);
  return (
    (parsed && parsed.access_token) ||
    (Array.isArray(parsed) && parsed[0]) ||
    null
  );
}

// H2: derive the operator id from the auth cookie, covering cookie-only sessions
// where getUserId() (stored blob) is null.
async function getUserIdFromCookies() {
  try {
    const token = await readCookieAccessToken();
    const claims = token ? decodeJwt(token) : null;
    return claims && claims.sub ? claims.sub : null;
  } catch (err) {
    console.error('[auth] cookie identity decode failed:', err && err.message);
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

// The `exp` claim (unix seconds) of a JWT, or null when it cannot be read (e.g. a
// Dopl `dopl_at_` device token, which is not a JWT at all).
function jwtExp(token) {
  const claims = token ? decodeJwt(token) : null;
  const exp = claims && claims.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

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
    cookieToken = await readCookieAccessToken();
  } catch (err) {
    console.error('[auth] access-token read failed:', err && err.message);
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
async function refresh() {
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
      console.warn('[auth] refresh failed:', res.status);
      // A 400 here usually means the refresh token was rotated/revoked — the
      // stored session is dead. Drop it so we stop retrying a bad token.
      if (res.status === 400) clearSession();
      return null;
    }
    const data = await res.json();
    if (!data.access_token || !data.refresh_token) return null;
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
    console.log('[auth] refreshed Supabase session');
    return next;
  } catch (err) {
    console.error('[auth] refresh error:', err && err.message);
    return null;
  }
}

// If the stored access token is expired, refresh it. Returns the live session.
async function ensureFresh() {
  if (isAccessExpired()) return refresh();
  return loadSession();
}

// ── Live cookie forwarding (the auth the API server actually accepts) ───────
// Reads the Supabase auth cookies from the Electron session and returns them as
// a Cookie header value. Empty string when signed out / no cookies yet.
async function getSessionCookieHeader() {
  try {
    const jar = await session.defaultSession.cookies.get({ url: APP_ORIGIN });
    const authCookies = jar.filter(
      (c) => c.name === COOKIE_BASE || c.name.startsWith(COOKIE_BASE + '.')
    );
    if (authCookies.length === 0) return '';
    return authCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (err) {
    console.error('[auth] cookie read failed:', err && err.message);
    return '';
  }
}

// Best-effort resilience: encode the stored session into the Electron cookie jar
// in @supabase/ssr's format (`base64-` + base64url(JSON), chunked at 3180) so a
// background call still has valid cookies if the renderer's own auto-refresh has
// not run. The live page normally keeps these fresh; this only repairs gaps.
async function writeSessionCookies(sessionObj) {
  try {
    const encoded =
      BASE64_PREFIX + Buffer.from(JSON.stringify(sessionObj), 'utf8').toString('base64url');
    // L5: clear the base + ALL chunk cookies (.0–.9) to avoid stale-chunk
    // reassembly — a larger session can span more than the first few chunks.
    for (const name of [
      COOKIE_BASE,
      ...Array.from({ length: 10 }, (_, i) => `${COOKIE_BASE}.${i}`),
    ]) {
      await session.defaultSession.cookies.remove(APP_ORIGIN, name).catch(() => {});
    }
    const expirationDate = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
    const chunks = [];
    if (encoded.length <= 3180) {
      chunks.push({ name: COOKIE_BASE, value: encoded });
    } else {
      for (let i = 0, part = 0; i < encoded.length; i += 3180, part++) {
        chunks.push({ name: `${COOKIE_BASE}.${part}`, value: encoded.slice(i, i + 3180) });
      }
    }
    for (const c of chunks) {
      await session.defaultSession.cookies.set({
        url: APP_ORIGIN,
        name: c.name,
        value: c.value,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'lax',
        expirationDate,
      });
    }
    return true;
  } catch (err) {
    console.error('[auth] cookie writeback failed:', err && err.message);
    return false;
  }
}

// Returns a Cookie header for an API call, repairing the jar from the stored
// (refreshed) session when the live cookies are missing or stale.
async function getAuthCookie() {
  let cookie = await getSessionCookieHeader();
  if (cookie) return cookie;
  // No live cookies — try to reconstruct from the stored session.
  const fresh = await ensureFresh();
  if (fresh) {
    await writeSessionCookies(fresh);
    cookie = await getSessionCookieHeader();
  }
  return cookie;
}

function isSignedIn() {
  return !!loadSession();
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
  getSessionCookieHeader,
  getAuthCookie,
  writeSessionCookies,
  isSignedIn,
  clearSession,
  _appName: () => (app && app.getName ? app.getName() : 'Dopl'),
};

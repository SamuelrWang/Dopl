// The Electron cookie-jar layer for the Supabase auth session.
//
// SPLIT NOTE (Q4): extracted from auth.js so that file stays under the 500-line
// cap once the cookie-fallback signed-in state landed. This module owns
// EVERYTHING that touches `session.defaultSession.cookies` for the
// `sb-<ref>-auth-token*` cookie family: reading the session back out of the jar,
// serializing a session into it, and clearing it. auth.js keeps the policy
// (which credential wins, is the user signed in, blob repair); this file is the
// transport.
//
// WHY THE JAR IS TRUSTWORTHY, STATED HONESTLY (FIX S3, Q5 review). This comment
// used to claim the jar is "origin-locked", and that claim was the whole
// justification for rebuilding the session blob out of it without a CSRF nonce.
// It was FALSE on two counts, and both are fixed:
//
//   (1) The FILTER was by cookie NAME only. `cookies.get({url: APP_ORIGIN})`
//       returns every cookie VISIBLE to that URL, which includes `.usedopl.com`
//       DOMAIN cookies — settable by ANY sibling subdomain, not by us. A
//       subdomain could therefore plant `sb-<ref>-auth-token` and have the
//       desktop adopt that session as the operator's own. Both readers below now
//       require the cookie to be HOST-ONLY for the APP_ORIGIN host (`isOurAuthCookie`).
//   (2) In-window navigation was NOT locked to APP_ORIGIN — auth-actions.isAppUrl
//       admitted every `*.usedopl.com` host, so a page on any sibling subdomain
//       ran inside the app window and wrote to the jar. That branch is now
//       `isAppOrigin` (exact origin); everything else goes to the system browser.
//
// THE REAL GUARANTEE, post-fix: only pages served from APP_ORIGIN itself — plus
// writeSessionCookies() below — can set a HOST-ONLY cookie for the APP_ORIGIN
// host, and only host-only cookies are read back. A sibling subdomain can still
// set a `.usedopl.com` cookie, but nothing here will ever read it. That is what
// makes "rebuild the stored session blob from the jar" (auth-state.js) safe
// without a pending-auth nonce: it is not the attacker-supplied deep-link case
// captureFromFragment's CSRF gate defends. auth-state.js adds the second half of
// the belt — a jar whose identity disagrees with the blob is never adopted.

const { session } = require('electron');
const { APP_ORIGIN, SUPABASE_REF } = require('./config');
const { diag } = require('./diag');

const COOKIE_BASE = `sb-${SUPABASE_REF}-auth-token`;
const BASE64_PREFIX = 'base64-';
const CHUNK_SIZE = 3180;
const MAX_CHUNKS = 10;
// The one host whose cookies count as ours. Chromium reports a host-only cookie's
// domain as the bare host and a domain cookie's as `.suffix`, so stripping one
// leading dot and requiring an EXACT match accepts our own host-only cookies and
// rejects `.usedopl.com` (which normalizes to `usedopl.com`, not `www.usedopl.com`).
const APP_HOST = (() => {
  try { return new URL(APP_ORIGIN).hostname; } catch (_) { return ''; }
})();

// Every cookie name the session can occupy: the base plus `.0`…`.9` chunks.
function cookieNames() {
  return [COOKIE_BASE, ...Array.from({ length: MAX_CHUNKS }, (_, i) => `${COOKIE_BASE}.${i}`)];
}

// FIX S3 — NAME *and* HOST. The name half alone let a sibling subdomain's domain
// cookie into both readers below; the host half is what actually pins the jar to
// our own origin. Fails closed: an unreadable/absent domain is not ours.
function isOurAuthCookie(c) {
  if (!c || typeof c.name !== 'string') return false;
  if (c.name !== COOKIE_BASE && !c.name.startsWith(COOKIE_BASE + '.')) return false;
  if (!APP_HOST) return false;
  return String(c.domain || '').replace(/^\./, '') === APP_HOST;
}

function cookieChunkIndex(name) {
  const m = name.match(/\.(\d+)$/);
  return m ? Number(m[1]) : -1; // the unsuffixed base cookie sorts first
}

// Reassemble the Supabase auth COOKIE the web sign-in set and return the WHOLE
// session object (or null). The cookie value is @supabase/ssr's `base64-` +
// base64url(JSON session), possibly chunked across `<base>.0`, `.1`, …; we
// reassemble, decode, and parse. No signature check needed — it came from our
// own cookie jar.
//
// Two on-disk shapes exist and both are handled: the modern object (the full
// Session: access_token / refresh_token / expires_at / user) and the legacy
// array ([access_token, refresh_token, provider_token, provider_refresh_token]).
// The refresh_token is the load-bearing part — it is what lets auth.js rebuild a
// dead session blob without any server round trip.
async function readCookieSession() {
  const jar = await session.defaultSession.cookies.get({ url: APP_ORIGIN });
  const authCookies = jar
    .filter(isOurAuthCookie)
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
  // FIX S3 — a TORN or duplicated chunk set does not decode to JSON, and this
  // parse used to throw straight out of the function. Every caller treats a throw
  // as "the jar read failed" (authFail) rather than "no session", so a half-written
  // rotation could look like an auth failure instead of a benign miss. Return null:
  // the caller's own contract for "nothing usable in the jar".
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    diag('auth: cookie session unparseable (torn/duplicate chunks) —', (err && err.message) || String(err));
    return null;
  }
  if (Array.isArray(parsed)) {
    return parsed[0] ? { access_token: parsed[0], refresh_token: parsed[1] || null } : null;
  }
  return parsed && parsed.access_token ? parsed : null;
}

// The raw access_token JWT string from the jar (or null). Realtime is the only
// consumer that needs a raw user JWT; every HTTP caller forwards the cookies.
async function readCookieAccessToken() {
  const s = await readCookieSession();
  return (s && s.access_token) || null;
}

// Reads the Supabase auth cookies and returns them as a Cookie header value.
// Empty string when signed out / no cookies yet.
async function getSessionCookieHeader() {
  try {
    const jar = await session.defaultSession.cookies.get({ url: APP_ORIGIN });
    const authCookies = jar.filter(isOurAuthCookie); // FIX S3: host-only, not name-only
    if (authCookies.length === 0) return '';
    return authCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (err) {
    diag('auth: cookie read failed —', (err && err.message) || String(err));
    return '';
  }
}

// L5: clear the base AND all chunk cookies so a stale chunk can never be
// reassembled into a half-old session. Also the sign-out primitive (Q4 fix 3):
// clearing the jar is what actually signs the web view out — the encrypted blob
// alone never rendered the UI signed in.
async function clearSessionCookies() {
  try {
    for (const name of cookieNames()) {
      await session.defaultSession.cookies.remove(APP_ORIGIN, name).catch(() => {});
    }
    return true;
  } catch (err) {
    diag('auth: cookie clear failed —', (err && err.message) || String(err));
    return false;
  }
}

// The 2026-08-29 sign-out loop, jar half (auth-store.js ›
// markRefreshTokenRejected carries the field log). After the bounded drop
// rejects a refresh token for good, a jar still holding that SAME session is a
// stale COPY of the dead credential — clearing it is what stops the next
// auth-state probe adopting it straight back into the blob. A jar holding a
// DIFFERENT session (the renderer signed in fresh) is left alone. Answers what
// happened for the caller's diag line; never throws, never logs a token (I11).
async function clearCookiesIfSameRefreshToken(rejectedRefreshToken) {
  try {
    const jar = await readCookieSession();
    if (jar && jar.refresh_token === rejectedRefreshToken) {
      await clearSessionCookies();
      return 'cleared';
    }
    return 'differs';
  } catch (_) {
    return 'error';
  }
}

// Best-effort resilience: encode the stored session into the Electron cookie jar
// in @supabase/ssr's format (`base64-` + base64url(JSON), chunked at 3180) so a
// background call still has valid cookies if the renderer's own auto-refresh has
// not run. The live page normally keeps these fresh; this only repairs gaps.
//
// FIX S6 — SET, THEN PRUNE. This used to CLEAR the jar and then set the chunks, so
// between those two awaits the jar was EMPTY. Every concurrent listener loop that
// read it in that window saw "signed out", each kicked its own repair, and the
// Supabase rotation 400s all but one of them — which clears the stored blob. One
// transient 5xx could therefore amplify into a real sign-out. The new order never
// leaves a gap: write every chunk this session occupies FIRST, then remove only the
// leftover chunk names it does NOT occupy (a shorter session after a longer one).
async function writeSessionCookies(sessionObj) {
  try {
    const encoded =
      BASE64_PREFIX + Buffer.from(JSON.stringify(sessionObj), 'utf8').toString('base64url');
    const expirationDate = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
    const chunks = [];
    if (encoded.length <= CHUNK_SIZE) {
      chunks.push({ name: COOKIE_BASE, value: encoded });
    } else {
      for (let i = 0, part = 0; i < encoded.length; i += CHUNK_SIZE, part++) {
        chunks.push({ name: `${COOKIE_BASE}.${part}`, value: encoded.slice(i, i + CHUNK_SIZE) });
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
    // PRUNE last. A stale chunk left behind would reassemble into a half-old
    // session (the L5 hazard clearSessionCookies exists for), so the names this
    // write did not occupy still have to go — just not before the write.
    const written = new Set(chunks.map((c) => c.name));
    for (const name of cookieNames()) {
      if (written.has(name)) continue;
      await session.defaultSession.cookies.remove(APP_ORIGIN, name).catch(() => {});
    }
    return true;
  } catch (err) {
    diag('auth: cookie writeback failed —', (err && err.message) || String(err));
    return false;
  }
}

module.exports = {
  COOKIE_BASE,
  APP_HOST,
  isOurAuthCookie, // FIX S3: the host-only predicate both readers share
  readCookieSession,
  readCookieAccessToken,
  getSessionCookieHeader,
  writeSessionCookies,
  clearSessionCookies,
  clearCookiesIfSameRefreshToken,
};

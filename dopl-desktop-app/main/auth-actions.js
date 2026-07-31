// Sign-in / sign-out actions, shared by the window's navigation handler and the
// tray (Q4 fix 3 — before this there was no way to sign in when the app already
// LOOKED signed in, and no sign-out control at all: recovery from a wedged
// listener meant deleting the app's Cookies store by hand).
//
// SPLIT NOTE: extracted from index.js (AT the 500-line cap). isAppOrigin and
// maybeBeginAuth moved here with it so the CSRF nonce is armed in exactly one
// place, whichever entry point starts the flow.

const { shell } = require('electron');
const { APP_ORIGIN, HOME_URL } = require('./config');
const auth = require('./auth');
const { diag } = require('./diag');

// The web login page opens this in the system browser (window.open →
// setWindowOpenHandler below); the tray's "Sign in…" opens the same URL directly,
// so both paths go through maybeBeginAuth and both are CSRF-gated.
const SIGN_IN_URL = `${APP_ORIGIN}/auth/desktop-start`;

// In-app navigation is limited to the app's own web origin. Sign-in runs in the
// SYSTEM BROWSER (Supabase PKCE requires it), so OAuth provider hosts are NOT
// kept in-window — they're opened externally and hand the session back via the
// dopl:// deep link.
//
// FIX S3 (Q5 review) — EXACT ORIGIN, not the domain family. This was `isAppUrl`,
// which also admitted `usedopl.com` and EVERY `*.usedopl.com` host. Two things
// depended on that being tight and neither survived it:
//   - auth-cookies.js justified its nonce-free blob rebuild on the jar being
//     "origin-locked", citing this function. A page on any sibling subdomain ran
//     INSIDE the app window and could write `.usedopl.com` cookies the desktop
//     then read back as the operator's session.
//   - maybeBeginAuth appends our login-CSRF nonce as `?state=` to any matching
//     `/auth/` URL. On a sibling subdomain that hands the nonce to a host we do
//     not control, which is the one secret the deep-link gate rests on.
// Everything that is NOT this exact origin now goes to the system browser — the
// same place every non-app URL already went, so no destination becomes
// unreachable; it just stops running inside the window.
function isAppOrigin(urlStr) {
  try {
    return new URL(urlStr).origin === APP_ORIGIN;
  } catch (_) {
    return false;
  }
}

// M4: when we hand an app-origin sign-in URL to the system browser, arm the
// pending-auth gate and tag the URL with our state nonce. captureFromFragment()
// then refuses any dopl:// session that wasn't initiated here. Non-auth URLs are
// returned unchanged. NOT weakened by the tray entry point — beginSignIn() below
// routes through this same function.
function maybeBeginAuth(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!isAppOrigin(urlStr) || !/\/auth\//i.test(u.pathname)) return urlStr;
    const nonce = auth.beginPendingAuth();
    if (!u.searchParams.has('state')) u.searchParams.set('state', nonce);
    return u.toString();
  } catch (_) {
    return urlStr;
  }
}

// Tray "Listener signed out — Sign in…". Shows the window (so the operator sees
// where they are) and kicks the same external OAuth flow the web login page does.
function beginSignIn({ showWindow } = {}) {
  try { if (typeof showWindow === 'function') showWindow(); } catch (_) { /* best-effort */ }
  const url = maybeBeginAuth(SIGN_IN_URL);
  diag('auth: tray sign-in — opening external sign-in flow');
  return shell.openExternal(url).catch((err) => diag('auth: sign-in open failed —', err && err.message));
}

// Tray "Sign out". Drops the encrypted blob AND the cookie jar (the jar is what
// renders the web UI signed in — clearing only the blob would leave the app
// looking signed in, which is the exact confusion this whole fix is about), then
// loads the app home, which resolves server-side to /login for a signed-out user.
// Finally nudges the listener so it reconciles to the signed-out state now rather
// than on its 5-minute timer.
async function signOut({ showWindow, load, onSignedOut } = {}) {
  await auth.signOut();
  try { if (typeof showWindow === 'function') showWindow(); } catch (_) { /* best-effort */ }
  try { if (typeof load === 'function') load(HOME_URL); } catch (err) { diag('auth: sign-out reload failed —', err && err.message); }
  try { if (typeof onSignedOut === 'function') onSignedOut(); } catch (err) { diag('auth: sign-out listener nudge failed —', err && err.message); }
}

module.exports = { SIGN_IN_URL, isAppOrigin, maybeBeginAuth, beginSignIn, signOut };

// Sign-in / sign-out actions, shared by the window's navigation handler and the
// tray (Q4 fix 3 — before this there was no way to sign in when the app already
// LOOKED signed in, and no sign-out control at all: recovery from a wedged
// listener meant deleting the app's Cookies store by hand).
//
// SPLIT NOTE: extracted from index.js (AT the 500-line cap). isAppOrigin and
// maybeBeginAuth moved here with it so the CSRF nonce is armed in exactly one
// place, whichever entry point starts the flow.

const { shell } = require('electron');
const { APP_ORIGIN } = require('./config');
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
function beginSignIn({ showWindow, provider } = {}) {
  try { if (typeof showWindow === 'function') showWindow(); } catch (_) { /* best-effort */ }
  // Closed enum, google default — /auth/desktop-start reads ?provider= and
  // anything unrecognized there also degrades to google.
  const p = provider === 'github' ? 'github' : 'google';
  const target = p === 'google' ? SIGN_IN_URL : `${SIGN_IN_URL}?provider=${p}`;
  const url = maybeBeginAuth(target);
  diag('auth: sign-in — opening external flow via', p);
  return shell.openExternal(url).catch((err) => diag('auth: sign-in open failed —', err && err.message));
}
// SIGN-OUT MOVED OUT (Stage D, 2026-08-06). `signOut({showWindow, load, onSignedOut})`
// lived here and its whole shape was the retired remote shell's: it reloaded HOME_URL so
// the WEB app would resolve server-side to /login. The SPA has no page to reload — the
// renderer swaps to the sign-in screen off the pushed auth state — so the tray now calls
// `shell-mode.spaSignOut`, and `ui-bridge` already routed around this function
// deliberately ("NOT authActions.signOut(): that loads the remote page"). With the shell
// deleted it had no caller left.

module.exports = { SIGN_IN_URL, isAppOrigin, maybeBeginAuth, beginSignIn };

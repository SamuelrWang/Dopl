// THE dopl:// HANDLER — protocol registration, the pre-ready park, and the two
// verbs. Extracted from index.js at the 500-line cap (the wake.js / app-menu.js
// idiom) when the `open` verb joined the auth handoff.
//
// The grammar and the web-path → SPA-route map are main/deep-link-target.js,
// which is pure so it can be a truth table. This file is the wiring: it holds
// no policy, only windows, timers and electron events.
//
// State stays here rather than in index.js because it is entirely this module's:
// `pending` exists for the ~ms between macOS delivering an `open-url` and the
// app being ready to do anything with it. `deps`:
//   auth, authTokens, listener, mcpConfig  — the auth handoff's collaborators
//   showMainWindow()                       — reveal/recreate the shell
//   navigateTo(path)                       — the SPA bridge (shell-mode.js)
//   getMainWindow(), getLoadGuard()        — the window and remote-mode loader
//   isSpaMode(), appOrigin, diag

const { app } = require('electron');
const { PROTOCOL } = require('./config');
const target = require('./deep-link-target');

/** Received before `app.isReady()`; flushed once, at startup. */
let pending = null;

/**
 * THE ONE PLACE A ROUTE IS PUSHED AT A COLD WINDOW.
 *
 * A deep link is the one navigation that routinely arrives at a window that is
 * still loading — the link is what LAUNCHED the app, and `flushPendingDeepLink`
 * runs a few lines after the shell window is created. `navigateTo` is a
 * `webContents.send`, and a send to a renderer that has not yet subscribed is
 * dropped on the floor with no error, so pushing immediately would work in
 * every warm test and fail on every real cold start.
 *
 * So: send now if the window has finished loading, otherwise wait for it. The
 * second send exists because `did-finish-load` is the DOCUMENT's event and the
 * subscription is a React effect a tick or so behind it; re-sending the same
 * route is free (the router is already there, and navigating to where you are
 * is a no-op) and it is the only remedy that needs nothing from the renderer.
 */
const MOUNT_GAP_MS = 300;

function pushRoute(deps, route) {
  const win = deps.getMainWindow();
  if (!win || win.isDestroyed()) return false;
  const send = () => {
    if (win.isDestroyed()) return;
    deps.navigateTo(route);
    setTimeout(() => {
      if (!win.isDestroyed()) deps.navigateTo(route);
    }, MOUNT_GAP_MS);
  };
  try {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
    return true;
  } catch (err) {
    deps.diag('deeplink navigate failed —', err && err.message);
    return false;
  }
}

/**
 * `dopl://open` — show the app, and put it on the linked page when the link
 * named one.
 *
 * SIGNED OUT IS A SHOW, NOT A NAVIGATE. The SPA answers a signed-out boot with
 * the sign-in screen, and steering it at a workspace route it cannot resolve
 * would replace that with a page waiting on a session. Landing home after the
 * sign-in completes is the accepted outcome (website-retirement-plan.md §2.5) —
 * there is deliberately no deferred navigation here, because there is none
 * anywhere else in this app to reuse and a queue that outlives an OAuth round
 * trip is a feature, not a hardening detail.
 *
 * REMOTE MODE (DOPL_UI=remote, the rollback shell) gets the window and nothing
 * else. Its routing is a URL load through the load guard, and teaching the
 * rollback path a new trick is how a rollback path stops being one.
 */
function openApp(url, parsed, deps) {
  deps.showMainWindow();
  const route = target.webPathToRoute(parsed.target);
  if (route === null && parsed.target) {
    deps.diag('deeplink open: unusable target, opening home —', url);
  }
  if (!deps.isSpaMode()) return;
  if (route === null || route === target.HOME_ROUTE) return;
  let signedIn = false;
  try {
    signedIn = !!deps.auth.isSignedIn();
  } catch (_) {
    signedIn = false;
  }
  if (!signedIn) {
    deps.diag('deeplink open: signed out, opening the app instead of', route);
    return;
  }
  pushRoute(deps, route);
}

/**
 * `dopl://auth#<tokens>` — the OAuth / magic-link handoff. MOVED HERE
 * UNCHANGED; every comment below predates this file and still governs.
 */
function adoptSession(fragment, deps) {
  // Capture the Supabase tokens into the encrypted main-process store so the background
  // listener has a session (and a refresh token) even when the window is hidden.
  //
  // M4: only adopt the session if THIS app initiated the sign-in recently. A rejected
  // fragment (injected dopl:// link, an expired flow) is dropped entirely — we neither
  // persist it nor navigate the window to adopt it. A false ALSO covers "the store
  // refused the write" (auth.js), which is a failed sign-in, not an adopted one.
  const accepted = deps.auth.captureFromFragment(fragment);
  if (!accepted) {
    console.warn('[deeplink] auth fragment not adopted (no pending sign-in / expired / not stored)');
    return;
  }
  // Deterministic re-arm of the token authority on fresh credentials (C15); no-op when
  // start() hasn't run (DOPL_UI=remote).
  try { deps.authTokens.onSignIn(); } catch (err) { deps.diag('token re-arm error', err && err.message); }

  // Surface the app — CREATING the window when the link arrived with it closed, which the
  // SPA window makes routine (it is destroyed on close, not hidden).
  deps.showMainWindow();
  if (!deps.isSpaMode()) {
    // Remote rollback shell only: the completion page plants the cookie jar. In SPA mode
    // the captured tokens ARE the session — loading it stranded the window on "Signing
    // you in…"; onSignIn() above pushed the flip.
    const url = `${deps.appOrigin}/auth/desktop-complete#${fragment}`;
    const guard = deps.getLoadGuard();
    const win = deps.getMainWindow();
    if (guard) guard.load(url);
    else if (win) win.loadURL(url).catch((err) => deps.diag('deeplink load failed —', err && err.message));
  }

  // Let the remote completion page plant its cookies, then restart the listener against
  // the fresh session and ensure the CLI's Dopl MCP config.
  setTimeout(() => {
    deps.listener.restart();
    deps.mcpConfig.ensureMcpConfig().catch((err) => deps.diag('mcp-config post-signin error', err && err.message));
  }, 3000);
}

/** Dispatch. An unparseable dopl:// URL is dropped, exactly as before. */
function openDeepLink(url, deps) {
  const parsed = target.parseDeepLink(url);
  if (!parsed) return;
  if (parsed.verb === target.VERB_OPEN) {
    openApp(url, parsed, deps);
    return;
  }
  adoptSession(parsed.fragment, deps);
}

/**
 * PARK ONLY BEFORE app-ready. The old gate was "is there a window?" — almost always true
 * pre-migration (the remote window hid on close), routinely false now that the SPA window
 * is DESTROYED on close while the app stays in the tray. An OAuth return or a clicked
 * magic link then parked forever (the park is flushed exactly once, at startup) and the
 * pending-auth record expired. Capture needs no window; openDeepLink surfaces one.
 */
function handle(url, deps) {
  if (!url || !url.startsWith(target.PROTOCOL_PREFIX)) return;
  if (!app.isReady()) {
    pending = url; // macOS can deliver open-url before the store exists
    return;
  }
  openDeepLink(url, deps);
}

function flushPending(deps) {
  if (!pending) return;
  const url = pending;
  pending = null;
  openDeepLink(url, deps);
}

/**
 * Register as the handler for dopl:// (also declared in Info.plist via build
 * config) and subscribe to the delivery macOS uses. Windows/Linux hand deep
 * links to the FIRST instance as a launch arg — `second-instance` in index.js
 * forwards those to `handle`.
 */
function arm(deps) {
  app.setAsDefaultProtocolClient(PROTOCOL);
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handle(url, deps);
  });
  return {
    handle: (url) => handle(url, deps),
    flushPending: () => flushPending(deps),
  };
}

module.exports = { arm, handle, flushPending, openDeepLink, pushRoute, MOUNT_GAP_MS };

// THE POP-OUT THREAD WINDOW, opt-in (wiring plan Phase 10, 2026-08-18).
//
// WHAT IT IS. A second window on the SAME SPA bundle showing ONE THREAD and nothing else —
// the thread view's "Open as new window" affordance. Not a session window: it shows the
// THREAD (the shared transcript), not an agent's run.
//
// It lands on a route of its own, OUTSIDE the SPA's `AppShellLayout`
// (`apps/desktop-ui/src/pages/thread-window/index.tsx`): transcript, composer and title only,
// never the sidebar and panels the operator already has open behind it (Samuel, 2026-08-19).
//
// It works because every renderer-reachable `ipcMain.handle` is bound to a REGISTRY of
// app-owned windows (main/app-windows.js, Samuel's 2026-08-18 ruling), not to the main window.
//
// ⚠ THE PRELOAD IS THE SPA'S OWN, DELIBERATELY. A pop-out is an app window; what
// authorizes it is REGISTRATION, not a narrower bridge. `spa-window.js ›
// spaWebPreferences` and `› policeNavigation` are shared verbatim, so the pop-out gets the
// identical sandbox, the identical `setWindowOpenHandler` deny, and the identical
// navigation lock (only the one local index document, or the Vite origin in dev).
//
// ⚠ THE LANDING ROUTE IS THE THREAD WINDOW'S OWN — `/{segment}/thread-window/{channelId}`,
// with the thread named as a `?thread=` SELECTION on it, exactly as before. It is a
// TOP-LEVEL row in `apps/desktop-ui/src/routes.tsx`, deliberately outside the workspace
// layout, and deliberately NOT in `WORKSPACE_PAGES` nor in `deep-link-target.js ›
// ROOT_ROUTES`: a `dopl://` link must not be able to mint a bare thread window, because a
// pop-out is created by MAIN at a window main built and registered. Such a link is an
// unknown page inside a real workspace and opens that workspace's HOME page — the table's
// existing rule, asserted in `test/deep-link-target.test.mjs`. The `WORKSPACE_PAGES` drift
// test reads only that block of `routes.tsx`, so this row keeps it green by construction.
// ⚠ It rides the HASH, because the SPA is a hash router over a `file://` document
// (`apps/desktop-ui/src/app.tsx`) — which also means the pop-out is landed at CREATION
// rather than steered afterwards over the navigate bridge, so there is no mount race.

const { BrowserWindow } = require('electron');
const appWindows = require('./app-windows');
const spaWindow = require('./spa-window');
const { diag } = require('./diag');

// ⚠ A HAND COPY of `apps/desktop-ui/src/routes.tsx › THREAD_WINDOW_PATH` (main cannot
// import the SPA's TypeScript — the same constraint `deep-link-target.js`'s page table is
// under). It lives HERE rather than in `shell-mode.js` because this module is its only
// reader: `CHANNELS_PAGE` is exported over there because `navigateToChannels` needs it, and
// a route nobody else navigates to has no business in that file. `test/popout-window.test.mjs`
// reads the SPA export and fails on drift.
const THREAD_WINDOW_PAGE = 'thread-window';

// ⚠ A RENDERER-DRIVEN WINDOW FACTORY WITH NO CEILING IS A RESOURCE PRIMITIVE. Four is well
// above what a person opens on purpose and far below what a compromised page would want;
// at the cap the op refuses in the same `{ ok: false }` shape as every other rejection.
const MAX_POPOUTS = 4;

// key -> BrowserWindow. Reuse rather than duplicate: asking twice for the same thread
// FRONTS the window that already shows it.
const openPopouts = new Map();

// ─── BEGIN POPOUT-ROUTE-PURE (unit-tested via source extraction) ─────────────
// No electron/require refs below.

/** One pop-out per (channel, thread). */
function popoutKey(channelId, threadId) {
  return `${channelId}|${threadId}`;
}

/**
 * THE ROUTE A POP-OUT LANDS ON, as a hash-router path.
 *
 * ⚠ EVERY INPUT IS ALREADY CHARACTER-CHECKED BY THE CALLER (`channel-dir-ipc.js` runs the
 * UUID gate on the channel and `deep-link-target.js › isSafeSegment` on the other two).
 * This function refuses an EMPTY one and interpolates the rest — it is deliberately NOT a
 * second copy of the character rule, because a second copy is a second answer to it
 * (INVARIANTS §11). `page` is passed in so the rule stays testable against any page string
 * and the module's ONE spelling of the route lives at its single call site.
 */
function threadRoute(segment, page, channelId, threadId) {
  if (!segment || !page || !channelId || !threadId) return null;
  return `/${segment}/${page}/${channelId}?thread=${threadId}`;
}
// ─── END POPOUT-ROUTE-PURE ───────────────────────────────────────────────────

/** Forget windows that have gone, so the budget counts only live ones. */
function sweep() {
  for (const [key, win] of Array.from(openPopouts)) {
    if (!appWindows.isLiveWindow(win)) openPopouts.delete(key);
  }
  return openPopouts;
}

// The window itself. Same bundle, same preload, same navigation lock as the shell —
// smaller, and freely movable/resizable, because it exists to sit beside something else.
//
// ⚠ 520x600 is sized for ONE single-column transcript beside another app, and default = MIN
// size so the window opens at its most compact (v2.2 item 7). ⚠ `title` is the
// PRE-PAINT name only — the renderer sets `document.title` to "Dopl — <thread>" once the
// thread loads and Electron copies it onto the window (`thread-window.tsx ›
// threadWindowTitle`); nothing here disables that, and it must not start to.
function createPopoutWindow(route) {
  const win = new BrowserWindow({
    width: 520,
    height: 600,
    minWidth: 520,
    minHeight: 600,
    title: 'Dopl',
    // --bg-base from the design tokens, so the first paint is not a white flash.
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: spaWindow.spaWebPreferences(),
  });

  const dev = spaWindow.devUrl();
  if (dev) {
    win.loadURL(`${dev}#${route}`);
  } else {
    // ⚠ `hash` carries no leading '#'. The navigation lock compares PATHNAMES and ignores
    // query/hash, so landing this way is inside the policy rather than an exception to it.
    win.loadFile(spaWindow.INDEX_HTML, { hash: route });
  }
  // Always shown: a pop-out only ever exists because somebody just asked for it, so
  // `wasOpenedHidden()` (which governs a login-item launch) has nothing to say here.
  win.once('ready-to-show', () => win.show());

  spaWindow.policeNavigation(win);
  // ⚠ THE LINE THAT MAKES THE WINDOW WORK AT ALL. Without it every privileged call from
  // this renderer is refused and the surface renders nothing while reporting nothing.
  // Registration happens HERE, in main, at creation — never on a renderer's say-so.
  appWindows.register(win);
  return win;
}

/**
 * Open (or front) the pop-out for one thread. Returns `{ ok }` — `ok:false` for an
 * unusable target or a full budget, in the SAME shape every other refusal in
 * `channel-dir-ipc.js` uses, so a caller cannot tell them apart.
 */
function openThreadWindow(target) {
  const t = target || {};
  const route = threadRoute(t.segment, THREAD_WINDOW_PAGE, t.channelId, t.threadId);
  if (!route) return { ok: false };

  const key = popoutKey(t.channelId, t.threadId);
  sweep();
  const existing = openPopouts.get(key);
  if (existing) {
    // Asking again for a thread already popped out is a request to SEE it.
    try {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    } catch (err) {
      diag('popout: could not front an existing window —', (err && err.message) || String(err));
    }
    return { ok: true };
  }

  if (openPopouts.size >= MAX_POPOUTS) {
    diag('popout: refused — the window budget is full', `(${MAX_POPOUTS})`);
    return { ok: false };
  }

  let win;
  try {
    win = createPopoutWindow(route);
  } catch (err) {
    diag('popout: create failed —', (err && err.message) || String(err));
    return { ok: false };
  }
  openPopouts.set(key, win);
  try {
    win.on('closed', () => { if (openPopouts.get(key) === win) openPopouts.delete(key); });
  } catch (_err) { /* not an emitter — the sweep still collects it */ }
  return { ok: true };
}

/** Live pop-out count. Diagnostics and tests; nothing renderer-reachable reads it. */
function count() {
  return sweep().size;
}

module.exports = {
  openThreadWindow,
  count,
  MAX_POPOUTS,
  THREAD_WINDOW_PAGE,
  // The pure half, for callers that need the rule rather than the window.
  threadRoute,
};

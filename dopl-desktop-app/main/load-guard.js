// Load lifecycle guard for the main window.
//
// THE BUG this fixes: after a network transition (sleep/wake, wifi change) the
// renderer's Chromium connection pool holds dead keepalive sockets, so a remote
// load can HANG until the OS TCP timeout (~minutes) while a fresh curl is instant.
// A hanging load fires neither `did-finish-load` NOR `did-fail-load`, so the old
// `showOffline()` dead-end never triggered and the window sat on its dark
// backgroundColor — the "solid black window that eventually comes in".
//
// The guard owns every remote load for the window and guarantees two things:
//   1. The window is NEVER blank. Before the first remote paint (and during
//      retries) a local loading screen is shown; Chromium holds that painted
//      frame during the subsequent remote fetch, so the swap to real content is
//      seamless and there is no black flash.
//   2. A hung load recovers in seconds, not minutes. A watchdog timer fires when
//      neither finish nor fail arrives in time; it stops the load, drops the dead
//      Chromium connections (session.closeAllConnections) + the main-process fetch
//      pool (resetMainPool), and retries on a backoff — keeping the loading screen
//      up the whole time.
//
// The pure decision core (`nextBackoffMs` + `decideLoad`) is side-effect free and
// unit-tested via source extraction (see test/load-guard.test.mjs); the imperative
// shell (`createLoadGuard`) only translates its effect descriptors into Electron
// calls. Keep the two pure functions free of require()/Electron references so the
// extraction test keeps working.

// How long a remote load may run before the watchdog assumes it has hung on dead
// sockets. Longer than a healthy first paint, short enough to beat the multi-minute
// OS TCP timeout that is the whole problem.
const WATCHDOG_MS = 11_000;

// Retry backoff for the CURRENT target, indexed by attempt number (0-based, where
// attempt 0 is the initial immediate load): 0s, 2s, 5s, then every 10s.
function nextBackoffMs(attempt) {
  if (attempt <= 0) return 0;
  if (attempt === 1) return 2_000;
  if (attempt === 2) return 5_000;
  return 10_000;
}

// Pure load-lifecycle reducer. Given the current guard state and a lifecycle
// event, return the next state plus a side-effect-free description of what the
// imperative shell should do. No Electron, no timers, no I/O here.
//
//   state:  { attempt, remotePainted }
//     attempt       retry counter for the current target (0 = first try)
//     remotePainted has real remote content painted at least once, ever
//   event:  'start' | 'finish' | 'fail' | 'watchdog' | 'gone' | 'kick'
//   effect: { render, load, armWatchdog, stopLoad, dropConnections, retryInMs }
//     render          'loading' | 'offline' | null  — which local screen to show
//     load            boolean  — (re)issue loadURL(currentTarget)
//     armWatchdog     boolean  — start the hang watchdog for this load
//     stopLoad        boolean  — webContents.stop() a hung navigation first
//     dropConnections boolean  — closeAllConnections() + reset the main fetch pool
//     retryInMs       number|null — schedule another 'start' after this delay
function decideLoad(state, event) {
  const painted = !!state.remotePainted;
  const attempt = state.attempt | 0;
  const noop = {
    render: null, load: false, armWatchdog: false,
    stopLoad: false, dropConnections: false, retryInMs: null,
  };
  switch (event) {
    // A remote load begins (initial load, in-app nav, deep link, or a retry).
    // Show the loading screen first only when nothing has painted yet; once remote
    // content has painted, Chromium holds the current frame during the fetch.
    case 'start':
      return {
        state: { attempt, remotePainted: painted },
        effect: { ...noop, render: painted ? null : 'loading', load: true, armWatchdog: true },
      };
    // Remote content finished loading — success. Reset the retry counter.
    case 'finish':
      return { state: { attempt: 0, remotePainted: true }, effect: { ...noop } };
    // did-fail-load (fast failure: offline / DNS / refused). Show the offline page
    // (existing behavior) AND auto-retry on the backoff — the old dead-end is gone.
    case 'fail': {
      const next = attempt + 1;
      return {
        state: { attempt: next, remotePainted: painted },
        effect: { ...noop, render: 'offline', retryInMs: nextBackoffMs(next) },
      };
    }
    // Watchdog fired: the load hung (no finish, no fail) on dead sockets. Stop it,
    // drop the stale connection pools, keep the loading screen up, retry on backoff.
    case 'watchdog': {
      const next = attempt + 1;
      return {
        state: { attempt: next, remotePainted: painted },
        effect: {
          ...noop,
          render: painted ? null : 'loading',
          stopLoad: true, dropConnections: true, retryInMs: nextBackoffMs(next),
        },
      };
    }
    // Renderer crashed / went unresponsive — reload from scratch through the guard.
    case 'gone':
      return {
        state: { attempt: 0, remotePainted: false },
        effect: { ...noop, render: 'loading', load: true, armWatchdog: true },
      };
    // Wake nudge: if the last load never reached remote content, retry it now;
    // a happily-painted window is left alone (its next fetch uses fresh sockets).
    case 'kick':
      if (painted) return { state: { attempt, remotePainted: true }, effect: { ...noop } };
      return {
        state: { attempt, remotePainted: false },
        effect: { ...noop, render: 'loading', load: true, armWatchdog: true },
      };
    default:
      return { state: { attempt, remotePainted: painted }, effect: { ...noop } };
  }
}

// Imperative shell — binds the pure reducer to one BrowserWindow. Attaches the
// webContents lifecycle listeners on construction and exposes the load-control
// surface index.js wires in place of raw loadURL/loadFile/showOffline calls.
//
//   opts.window        the BrowserWindow
//   opts.homeUrl       default target (the app home)
//   opts.loadingFile   absolute path to the local loading screen
//   opts.offlineFile   absolute path to the local offline screen
//   opts.resetMainPool () => void — resets the main-process (undici) fetch pool
//   opts.diag          (...parts) => void — optional file logger
function createLoadGuard(opts) {
  const { window: win, homeUrl, loadingFile, offlineFile } = opts;
  const resetMainPool = typeof opts.resetMainPool === 'function' ? opts.resetMainPool : () => {};
  const log = typeof opts.diag === 'function' ? opts.diag : () => {};
  const wc = win.webContents;

  let state = { attempt: 0, remotePainted: false };
  let target = homeUrl;
  let watchdog = null;
  let retryTimer = null;
  let loadPending = false; // a 'start' has been requested and not yet settled

  const alive = () => win && !win.isDestroyed() && !wc.isDestroyed();
  const fileFor = (render) => (render === 'offline' ? offlineFile : loadingFile);

  function clearWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }
  function clearRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }

  function armWatchdog() {
    clearWatchdog();
    watchdog = setTimeout(() => { watchdog = null; dispatch('watchdog'); }, WATCHDOG_MS);
    if (watchdog.unref) watchdog.unref();
  }

  function scheduleRetry(ms) {
    clearRetry();
    retryTimer = setTimeout(() => { retryTimer = null; dispatch('start'); }, ms);
    if (retryTimer.unref) retryTimer.unref();
  }

  function showLocal(file) { if (alive()) wc.loadFile(file).catch(() => {}); }
  function loadRemote() { if (alive()) wc.loadURL(target).catch(() => {}); }

  // Paint the local screen first, then start the remote load once it has
  // committed, so the loading frame is genuinely on screen (and thus held by
  // Chromium) rather than instantly aborted by an eager loadURL.
  function showThenLoad(file) {
    if (!alive()) return;
    const t = target;
    wc.loadFile(file).catch(() => {}).then(() => { if (alive() && target === t) loadRemote(); });
  }

  function apply(effect) {
    if (effect.stopLoad && alive()) { try { wc.stop(); } catch (_) { /* nothing loading */ } }
    if (effect.dropConnections) {
      try { Promise.resolve(wc.session.closeAllConnections()).catch(() => {}); } catch (_) {}
      try { resetMainPool(); } catch (_) {}
    }
    if (effect.armWatchdog) armWatchdog(); else if (!effect.load) clearWatchdog();

    if (effect.render && effect.load) showThenLoad(fileFor(effect.render));
    else if (effect.render) showLocal(fileFor(effect.render));
    else if (effect.load) loadRemote();

    if (effect.retryInMs != null) scheduleRetry(effect.retryInMs);
  }

  function dispatch(event) {
    const { state: next, effect } = decideLoad(state, event);
    state = next;
    if (event === 'start') { loadPending = true; clearRetry(); }
    else if (event === 'finish' || event === 'fail') loadPending = false;
    apply(effect);
  }

  // ── webContents lifecycle wiring ──────────────────────────────────────────
  wc.on('did-finish-load', () => {
    // Fires for the local loading/offline screens too; only a remote (non-file)
    // finish counts as real content on screen.
    const url = wc.getURL() || '';
    if (url.startsWith('file:')) return;
    clearWatchdog();
    dispatch('finish');
  });

  // A main-frame COMMIT proves the connection is alive — the dead-socket hang
  // this guard exists for never commits. Disarm the watchdog so a slow-but-
  // healthy full load (subresources past the timeout) is never stop()ed into a
  // retry loop; did-finish-load / did-fail-load still settle the state machine.
  wc.on('did-navigate', (_e, url) => {
    if ((url || '').startsWith('file:')) return;
    clearWatchdog();
  });

  wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED — normal during redirects / our own stop()
    if ((validatedURL || '').startsWith('file:')) return; // a local screen failing is not a remote failure
    log('[load-guard] did-fail-load', errorCode, String(validatedURL || '').slice(0, 80));
    clearWatchdog();
    dispatch('fail');
  });

  // Renderer crash / hang → rebuild the page through the guard.
  wc.on('render-process-gone', (_e, details) => {
    log('[load-guard] render-process-gone', details && details.reason);
    dispatch('gone');
  });
  win.on('unresponsive', () => { log('[load-guard] window unresponsive'); dispatch('gone'); });

  // ── public surface ────────────────────────────────────────────────────────
  return {
    // Load a remote URL (home, in-app nav, deep link) under watchdog protection.
    load(url) { if (url) target = url; dispatch('start'); },

    // Ensure the window is never revealed blank: if remote content has not painted
    // and no load is in flight, put the loading screen up (and start loading).
    ensureNotBlank() {
      if (state.remotePainted || loadPending) return;
      dispatch('start');
    },

    // Wake recovery: drop the renderer's stale sockets and, if the last load never
    // reached remote content, retry it immediately. A painted window is untouched.
    onWake() {
      try { Promise.resolve(wc.session.closeAllConnections()).catch(() => {}); } catch (_) {}
      dispatch('kick');
    },

    hasPaintedRemote() { return state.remotePainted; },

    // Cancel timers (used if the owning code tears the window down).
    dispose() { clearWatchdog(); clearRetry(); },
  };
}

module.exports = { createLoadGuard, decideLoad, nextBackoffMs, WATCHDOG_MS };

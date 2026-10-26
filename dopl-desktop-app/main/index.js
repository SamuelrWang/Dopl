const { app, session } = require('electron');
const Store = require('electron-store');

// Shared origins/URLs live in config.js so the window shell and the background
// listener never drift. See config.js for APP_URL / APP_ORIGIN / PROTOCOL.
const { APP_ORIGIN, PROTOCOL } = require('./config');
const auth = require('./auth');
const authActions = require('./auth-actions');
const appMenu = require('./app-menu');
const tray = require('./tray');
const updater = require('./updater');
const listener = require('./channel-listener');
const targeting = require('./targeting');
const versionSkew = require('./version-skew');
const channelDirs = require('./channel-dirs');
const channelDirIpc = require('./channel-dir-ipc');
// 2026-09-13: the frameless agent pop-out's own close / zoom, bound to the SAME registry.
const windowChrome = require('./window-chrome');
const mcpConfig = require('./mcp-config');
const api = require('./api');
const { diag } = require('./diag');
// v1.9 Session Window: engine seam + window factory / lifecycle echoes + window-mode.
const sessionEngine = require('./session-engine');
const spaWindow = require('./spa-window');
const mediaPermission = require('./media-permission'); // 2026-09-08: the session permission fence
const dictation = require('./dictation'); // 2026-10-08: on-device speech helper
const catalogPublish = require('./catalog-publish'); // 2026-10-08: glasses model menu
// Phase 10: the registry of APP-OWNED windows — the shell plus any pop-out thread window.
// It is what every renderer-reachable ipcMain.handle is bound to, and registration happens
// only at window creation, in main. See main/app-windows.js's header.
const appWindows = require('./app-windows');
const { makeShellHelpers, wireSpaServices, spaSignOut } = require('./shell-mode');
const deepLinkModule = require('./deep-link');
const uiBridge = require('./ui-bridge');
const authTokens = require('./auth-tokens');
const uiSync = require('./ui-sync');
const triggerOutcomes = require('./trigger-outcomes'); // the engine's lifecycle echo seam (2026-08-20)
const agentRetention = require('./agent-retention'); // 2026-08-22: the ended-agent 7-day sweep
const launchDirectives = require('./launch-directives'); // 2026-08-22: the orchestrator launch lane
const agentDirections = require('./agent-directions');
const runtimeCredentials = require('./runtime-credentials');
// Phase-4 prerequisite: the server-authoritative minimum-version gate. Policy in
// min-version.js, shell in version-gate.js, screen in update-required-window.js.
const versionGate = require('./version-gate');
const wake = require('./wake');
// C-8: the before-quit teardown — the dialog, the wait path, and the bounded final flush.
const quitGuard = require('./quit-guard');

const store = new Store();
let mainWindow = null;

// ── Window ────────────────────────────────────────────────────────────────────
// The UI is the bundled SPA (`spa-window.js` loadFile, off local disk). `createShellWindow`
// (shell-mode.js) is the ONE factory every "make or show the window" path goes through, and
// the min-version gate is its single enforcement point. Whether a hidden login launch shows
// the window is decided there (`spa-window.js › wasOpenedHidden`).

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createShellWindow({ show: true }); // force visible even on a hidden login launch
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const shellHelpers = makeShellHelpers({
  getMainWindow: () => mainWindow,
  setMainWindow: (win) => { mainWindow = win; },
  createSpaWindow: spaWindow.createSpaWindow,
  // Phase 10: bind the shell as an app window the moment it is built. Without this the
  // guards have nothing to admit and the whole privileged surface is dead.
  registerAppWindow: appWindows.register,
  // The min-version gate rides this ONE factory (see shell-mode.js).
  versionGate,
  showMainWindow: (...a) => showMainWindow(...a),
  appOrigin: APP_ORIGIN,
  diag,
});
const createShellWindow = shellHelpers.createShellWindow;
const navigateToChannels = shellHelpers.navigateToChannels;
// THE THREE "OPEN THE APP" DOORS GO THROUGH THIS: reveal only, never re-route
// (`shell-mode.js › openMainWindow`).
const openMainWindow = shellHelpers.openMainWindow;

// The menu's "Home". The renderer owns routing, so this asks it to go to boot.
function loadApp() {
  shellHelpers.navigateTo('/');
}

// ── Navigation / link handling ─────────────────────────────────────────────────
// index.js opens nothing externally. Sign-in leaves through `authActions.beginSignIn` →
// `maybeBeginAuth(url)` → `shell.openExternal`, the ONE place the M4 login-CSRF nonce is armed.

// ── Menu ────────────────────────────────────────────────────────────────────
// The menu-bar template lives in app-menu.js (extracted at the 500-line cap).
function buildMenu() {
  appMenu.build({ onHome: loadApp, getWindow: () => mainWindow });
}

// ── Deep link (dopl://) ─────────────────────────────────────────────────────────
// Two verbs, both owned by deep-link.js (extracted at the 500-line cap): the
// OAuth/magic-link session handoff `dopl://auth#<tokens>`, and `dopl://open`,
// which shows the app and — when the link names one — the linked page. The
// grammar and the web-path → SPA-route map are the pure deep-link-target.js.
// `arm` registers the protocol and the macOS 'open-url' delivery, and hands back
// the two entry points the rest of this file needs.
const deepLink = deepLinkModule.arm({
  auth,
  authTokens,
  listener,
  mcpConfig,
  showMainWindow: (...a) => showMainWindow(...a),
  navigateTo: (path) => shellHelpers.navigateTo(path),
  getMainWindow: () => mainWindow,
  appOrigin: APP_ORIGIN,
  diag,
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux deliver deep links as a launch arg; macOS uses 'open-url'.
    const link = argv.find((a) => a.startsWith(PROTOCOL + '://'));
    // ⚠ A SECOND LAUNCH CARRYING A DEEP LINK IS NOT A PLAIN OPEN: the link names
    // where to land and `deepLink.handle` reveals the window itself.
    if (link) { deepLink.handle(link); return; }
    openMainWindow();
  });

  app.whenReady().then(() => {
    // THE PERMISSION FENCE, FIRST — before any window exists, because Electron's default is to
    // approve every permission a renderer asks for and a window created ahead of this would carry
    // that default for the life of its first page. One call on the DEFAULT session covers every
    // window in the app (`main/media-permission.js` carries the allowlist and the reasoning).
    mediaPermission.installPermissionFence(session.defaultSession);

    // Present a clean Chrome User-Agent (no "Electron/x" or app-name token) so
    // the web app and any third-party widgets don't treat us as an odd client.
    try {
      app.userAgentFallback = app.userAgentFallback
        .replace(/ Electron\/[^\s]+/i, '')
        .replace(new RegExp(' ' + app.getName() + '\\/[^\\s]+', 'i'), '');
    } catch (_) {}

    // Launch at login as a hidden background listener.
    try {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    } catch (err) {
      console.warn('[login-item] failed:', err && err.message);
    }

    buildMenu();

    // Menu-bar tray for the background role.
    tray.create({
      onOpen: () => openMainWindow(),
      onQuit: () => { app.isQuitting = true; app.quit(); },
      // "Update ready — restart to install": restarts straight away when nothing
      // is live, and asks first (naming the session) when an agent is mid turn.
      onUpdate: () => updater.requestRestart(),
      // "Check for updates now": the explicit ask. Since 2026-08-22 the interval
      // is 30m and focus triggers a gapped check, so this is the impatient path
      // rather than the only one.
      onCheckUpdates: () => updater.checkNow(),
      // Q4 fix 3: the escape hatch. "Sign in…" appears only while the listener
      // reports signed out and runs the same CSRF-gated external OAuth flow the
      // web login page does; "Sign out" clears the blob AND the cookie jar, then
      // reloads the app (which resolves to /login) and re-reconciles the listener.
      onSignIn: () => authActions.beginSignIn({ showWindow: showMainWindow }),
      onSignOut: () => { void spaSignOut({ auth, authTokens, listener, showMainWindow }); },
      // Round C "Channel folders": accessors read fresh on every rebuild; the chosen
      // path stays local (channel-dirs.js). A set/clear rebuilds the menu.
      getChannels: () => listener.listWatchedChannels(),
      getChannelDirLabel: (id) => channelDirs.liveChannelDirLabel(id),
      onSetChannelDir: (id) => {
        channelDirs
          .promptAndSetChannelDir(id)
          .catch((err) => diag('channel-dir set error', err && err.message))
          .finally(() => tray.refresh());
      },
      onClearChannelDir: (id) => {
        channelDirs.clearChannelDir(id);
        tray.refresh();
      },
    });

    // In-app "Change folder" control. The bundled SPA reaches the native folder picker
    // through these three narrow, label-only IPC handlers. onChanged refreshes the tray so its
    // "Channel folders" submenu stays in sync with a change made from the SPA.
    // H3: the sender binding — every handler in that file answers only an APP-OWNED
    // window's own top frame, never an iframe inside it. The subject is the registry
    // (shell + pop-outs; Phase 10, Samuel's ruling).
    // An ACCESSOR, not a snapshot: register() runs before any window exists, the shell is
    // rebuilt on reopen, and a pop-out can appear or close at any moment.
    channelDirIpc.register({ onChanged: () => tray.refresh(), getSenderIds: () => appWindows.senderIds() });

    // THE FRAMELESS WINDOW'S OWN BUTTONS (2026-09-13). `agent-window.js` took `frame: false`, so
    // macOS draws no close and no zoom control and the renderer's own pair reaches main here.
    // ⚠ SAME ACCESSOR, SAME REASON as the line above: each op acts on the CALLER'S window
    // (`BrowserWindow.fromWebContents`), so there is no id to forge — but an unbound surface must
    // still be a dead one rather than an open one.
    windowChrome.register({ getSenderIds: () => appWindows.senderIds() });
    // The composer's on-device dictation (`main/dictation.js`); same sender fence as above.
    dictation.register({ getSenderIds: () => appWindows.senderIds() });
    // Publish each runtime's live model roster so the server-side glasses menu can offer it.
    catalogPublish.start();

    // Auto-update (electron-updater ↔ GitHub Releases). Silent download with
    // progress on the tray; the tray gains an "Update ready — restart to
    // install" item (plus the tooltip) when one is staged, and the download
    // completing offers a one-click restart. Never auto-restarts: the operator
    // decides, because a restart mid-turn kills a live spawned session (Q10c) —
    // which is why the prompt is handed the live-session list rather than
    // guessing that nothing is running.
    updater.init({
      onReady: (version) => tray.setUpdateReady(version),
      onNote: (text, opts) => tray.setUpdateNote(text, opts),
      // Feeds the min-version gate. Two things ride this: the blocking screen's
      // live download narration, and the anti-brick guard — a check that
      // COMPLETED and found nothing is the only honest evidence that a floor is
      // above the newest build that exists, and it degrades the block.
      onState: () => versionGate.onUpdaterState(),
      getLiveSessions: () => sessionEngine.listLiveSessions(),
    });

    // The agent runtimes' own CLIs track their vendors' newest builds in the background, so a new
    // model never waits on a Dopl release (`runtime/updates/index.js`). Never awaited.
    require('./runtime').startUpdates();

    // The Phase-4 minimum-version gate. `GET /api/version` carries the floor; a
    // build below it swaps the app window for the blocking update screen and back
    // again through the one shell factory. Every failure to get an answer
    // (offline, timeout, 5xx, a malformed floor) leaves the app OPEN — see
    // min-version.js for the full fail-open table.
    shellHelpers.wireVersionGate({ onWarn: (notice) => tray.setVersionFloor(notice) });

    // Q10b: a peer running an OLDER build is the standing explanation for "the
    // fix works here and not there". version-skew.js reads the server-stamped
    // metadata.appVersion off their messages and reports each (peer, build) once;
    // the tray keeps the latest as a quiet, disabled line.
    versionSkew.setHandlers({ onSkew: (skew) => tray.setPeerSkew(skew) });

    // The token authority's PROACTIVE timer. It used to be gated on SPA mode, because the
    // retired remote page ran its own supabase-js against the SAME rotating refresh-token
    // family — main rotating at ~80% of token life left that page holding a stale refresh
    // token, and Supabase's reuse detection revoked the family (hourly sign-outs of the
    // rollback shell). With the remote shell deleted there is no second refresher, so this
    // is now the only one and runs unconditionally. wireSpaServices owns the ONE
    // uiBridge.register call.
    // ⚠ IT HANDS BACK ONE THING — `bootReconcile` — and that call is DELIBERATELY not made in
    // this block: it must see the registry `sessionEngine.init()` fills (see its own site below).
    let spaServices = null;
    {
      try { authTokens.start(); } catch (err) { diag('authTokens.start error', err && err.message); }
      spaServices = wireSpaServices({
        uiBridge, authTokens, uiSync, diag,
        sessionSummary: require('./session-summary'), // §3.3: the session-pill push
        sessionNarration: require('./session-narration'), // the agent window's work lane (F-212)
        sessionStatePush: require('./session-state-push'), // §3.5 / F-147: the server half
        // Phase 10: the bridge is bound to the REGISTRY, and every main→renderer push fans
        // out over it — a pop-out that never hears the doorbell, the summaries or a
        // SIGN-OUT is the silent-staleness failure INVARIANTS §11 names.
        getSenderIds: () => appWindows.senderIds(),
        getAppWindows: () => appWindows.liveWindows(),
      });
      createShellWindow({ show: false });
    }
    // Each runtime's Dopl sign-in status, pushed to every app window; a clicked sign-in notification reveals the app.
    runtimeCredentials.start({ getWindows: () => appWindows.liveWindows(), showWindow: () => showMainWindow() });
    deepLink.flushPending();

    // Session seam: lifecycle handlers, then init() (registers session IPC + reloads records) BEFORE listener.start.
    // The lifecycle echo is the calm `session_ended` note a WAITING PEER needs.
    sessionEngine.setLifecycleHandlers(triggerOutcomes.lifecycleHandlers);
    // ⚠ THE 7-DAY SWEEP IS ARMED BEFORE `init()` (2026-08-22, Samuel's ended-agent ruling), and
    // the order matters in one direction only: `init()` reads the durable records back and
    // marks interrupted ones ended, so sweeping FIRST means this run's own start does not have
    // to compete with a record it is about to write. `start()` sweeps once immediately and then
    // daily; it is idempotent and its interval is `unref`'d, so it never holds a quit open.
    // ⚠ IT OWNS THE ONE LIST OF PER-AGENT ARTIFACTS — the cleaners are handed in HERE, and a
    // store missing from this literal LEAKS SILENTLY (agent-retention.js says so at `bind`).
    try {
      agentRetention.bind({
        clearRecord: (keys) => require('./session-store').forgetKeys(keys),
        releaseEnded: (keys) => require('./session-summary').releaseEnded(keys),
        forgetNotice: (keys) => require('./queued-notice').forgetKeys(keys),
      });
      agentRetention.start();
    } catch (err) { diag('agentRetention.start error', err && err.message); }
    try { sessionEngine.init(); } catch (err) { diag('sessionEngine.init error', err && err.message); }
    // 🔒 **THE BOOT RECONCILE, AFTER `init()` AND NEVER BEFORE IT (2026-09-14).** It used to run
    // inside `wireSpaServices` above, which is wired before the engine reloads its records — so the
    // run's FIRST push reported an EMPTY registry, the server deleted every row for the workspace,
    // and `session-boot.js › reparkDormant`'s `touch()` then posted the re-parked ones back. Two
    // writes and a visible flap on every surface that reads `channel_sessions`, to say what ONE
    // write here says correctly the first time. `shell-mode.js › wireSpaServices` returns it for
    // exactly this reason; `test/shell-mode.test.mjs` pins the order.
    try { if (spaServices) spaServices.bootReconcile(); }
    catch (err) { diag('session-state push boot reconcile error', err && err.message); }

    // Q11: the legacy-reply registry is durable now. targeting.js stays
    // dependency-free (its truth tables slice the block into a bare `new
    // Function` scope), so the store is INJECTED here, before any loop can
    // classify a message. Expired and over-cap records are purged on load. A
    // failure here leaves the old in-memory registry, whose only cost is one
    // spurious consent prompt per restarted exchange.
    try {
      const adopted = targeting.useLegacyThreadStore(store);
      diag('legacy-thread registry: adopted', adopted, 'record(s) from disk');
    } catch (err) {
      diag('legacy-thread registry load error', err && err.message);
    }

    // Start the Channels listener; it drives the tray status label. The
    // openChannel handler lets a clicked notification open + navigate the window
    // — since Phase 9 it is handed (segment, channelId) and lands ON the channel,
    // which is the "windowing inverts" ruling's whole focus-the-app half.
    listener.start((status, meta) => tray.update(status, meta), {
      openChannel: navigateToChannels,
    });

    // The operator's banner switches are on their ACCOUNT now (`main/notification-prefs.js`), and
    // the gate that reads them is synchronous, so it answers from a cache. Warm it HERE, right
    // after the thing that raises the banners starts: without this the first mention of a session
    // is judged on the defaults (every banner ON), which is the safe direction but not the
    // operator's answer. Fire-and-forget — `refresh` never throws and never blocks a banner.
    void require('./notification-prefs').refresh(true);

    // ── THE ORCHESTRATOR LAUNCH LANE (2026-08-22, Samuel's launch-over-MCP ruling) ─────────
    //
    // ⚠ ARMED AFTER `listener.start`, AND THE ORDER IS LOAD-BEARING IN ONE DIRECTION. It binds
    // a second `postgres_changes` listener onto the listener's OWN per-workspace WebSocket
    // (`main/realtime.js › setDirectives`), so realtime has to exist first; and it resolves a
    // directive's channel context through `listener.channelForLaunch`: the watched DTO, else the
    // server's row fetched by id (a directive that beat the first reconcile). Neither answering
    // is REFUSED (`no-bridge`) rather than launched blind.
    //
    // ⚠ IT IS OFF UNLESS THE OPERATOR TURNED IT ON, PER MACHINE, and `start` reads that toggle
    // before it binds anything: a default install adds no binding, names the table nowhere, and
    // is unaffected by the lane's presence or absence on the server.
    // ⚠ THE CONTAINMENT INPUTS ARE MAIN'S, NOT THE DIRECTIVE'S — `watchedChannel` is the same
    // full server DTO `sessions:launch` reads (F-267), and the posture is the operator's own
    // durable per-channel record. A directive supplies a goal and a model.
    try {
      launchDirectives.start({
        getUserId: () => (authTokens.getAuthState() || {}).userId || null,
        launch: (spec) => require('./session-engine').launchRequesterSession(spec),
        watchedChannel: (channelId) => listener.watchedChannel(channelId),
        channelForLaunch: (channelId) => listener.channelForLaunch(channelId),
        workspaces: () => require('./realtime').desiredWorkspaceIds(),
      });
    } catch (err) { diag('launchDirectives.start error', err && err.message); }

    // THE PRIVATE DIRECT LANE (2026-08-31). ⚠ ITS OWN `start`, and its own consent: the
    // launch toggle does not arm this one, because launching buys COMPUTE and directing
    // reaches a RUNNING agent's private lane.
    try {
      agentDirections.start({
        getUserId: () => (authTokens.getAuthState() || {}).userId || null,
        // ⚠ THE SAME OP THE OPERATOR'S OWN COMPOSER USES (ruling R1) — one resolution, one
        // `steer`, one private-turn open. What the `directed` argument changes inside it is
        // the FRAMING (fenced data, never operator authority) and the reply capture.
        direct: (spec) => require('./session-reopen').messageByThread(spec),
        workspaces: () => require('./realtime').desiredWorkspaceIds(),
      });
    } catch (err) { diag('agentDirections.start error', err && err.message); }

    // Feature E: ensure the Claude CLI has the Dopl MCP configured (best-effort;
    // no-ops when signed out or the CLI/endpoint isn't available).
    mcpConfig.ensureMcpConfig().catch((err) => diag('mcp-config startup error', err && err.message));

    // Wake-from-sleep fast catch-up. The fan-out (and the reason each participant
    // is in it) lives in wake.js, extracted at the 500-line cap when the gate
    // joined it; resume + unlock-screen fire together and are coalesced there.
    wake.arm({
      listener, api, authTokens, uiSync, versionGate,
      getAppWindows: () => appWindows.liveWindows(),
    });

    app.on('activate', () => {
      // Clicking the dock icon is an explicit request to see the app, so force
      // the window visible even if this process was launched hidden at login.
      if (!mainWindow || mainWindow.isDestroyed()) {
        createShellWindow({ show: true });
      } else {
        openMainWindow();
      }
    });
  });

  // THE QUIT TEARDOWN (C-8). main/quit-guard.js owns the whole decision: it NAMES the
  // threads a quit would interrupt, offers Quit anyway / Wait / Cancel, ends each session
  // through the reducer's calm `inactive` terminal so the waiting peer is told, and races one
  // final session-state push. It fails OPEN on every path — a requested quit always happens.
  quitGuard.arm({
    listener,
    listOrphanRisk: () => sessionEngine.listOrphanRisk(),
    endLiveSessions: () => sessionEngine.endLiveSessions(),
    flushSessionState: () => require('./session-state-push').flush(),
  });

  // Background listener role: the app stays resident even with no windows.
  // (On macOS the window is hidden rather than closed, so this rarely fires;
  // keeping it a no-op means Win/Linux also stay in the tray until Quit.)
  app.on('window-all-closed', () => {});
}

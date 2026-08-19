# Wiring the bundled SPA window

Phase 2 of [docs/DESKTOP-MIGRATION-PLAN.md](../docs/DESKTOP-MIGRATION-PLAN.md)
added the three files below.

**THE SPA IS THE DEFAULT NOW — this page said "built but not wired" long after it
was (corrected 2026-08-05, F-146).** `main/shell-mode.js`'s `isSpaMode()` is
`process.env.DOPL_UI !== 'remote'`, so the bundled window is what a normal launch
creates and the REMOTE path is the opt-out, not the default. Setting
`DOPL_UI=remote` still loads the retired website in a `BrowserWindow` and is the
manual rollback lever; it is not a shipping surface (the website is retired, see
ENGINEERING §9.3) and it sends no `X-Dopl-Runtime` stamp, so a request typed
there opens no session.

| File | Role |
|---|---|
| `main/spa-window.js` | The local `BrowserWindow` (loadFile / dev URL, navigation locked down). |
| `renderer/app-preload.js` | `window.dopl` — 4 members, no tokens, no caller headers. |
| `main/ui-bridge.js` | The `ipcMain.handle` half, sender-bound to the SPA window. |

The renderer itself is `apps/desktop-ui` (Vite + React). Its build output lands
in `renderer/app/`, which `build.files: ["main/**/*", "renderer/**/*"]` already
covers — **no electron-builder change is needed**.

## The two-line integration

In `main/index.js`, inside `app.whenReady()` and next to the existing
`channelDirIpc.register(...)` call (`main/index.js:345`):

```js
const spaWindow = require('./spa-window');     // with the other requires
const uiBridge = require('./ui-bridge');

// … inside app.whenReady(), BEFORE the window is created:
uiBridge.register({ getMainWindow: () => mainWindow });
```

and swap the window factory: `createMainWindow()` (`main/index.js:366`) becomes
`mainWindow = spaWindow.createSpaWindow()`.

The accessor is read lazily on every IPC call, exactly like
`channelDirIpc.register`, because the window outlives `register()` and is rebuilt
on reopen. If it answers nothing, every handler fails closed.

⚠ **THE OPTION NAME CHANGED ON 2026-08-18** (wiring plan Phase 10, Samuel's ruling —
option (a)). Both `register()` calls above now take `getSenderIds: () => appWindows.senderIds()`
rather than `getMainWindow`: the sender binding's subject is `main/app-windows.js`'s
registry of APP-OWNED windows — the shell plus any pop-out thread window — not the one
main-window slot. The lazy-accessor reasoning is unchanged and now covers one more case
(a pop-out can appear or close at any moment). Live rule: INVARIANTS §11.

## Before flipping the switch, know what else moves

- **`main/load-guard.js` goes inert.** It exists to recover hung *remote* loads
  after sleep/wake and explicitly ignores `file:` URLs, so a `loadFile` window
  never marks `remotePainted`. Keep the module for the rollback path; do not
  expect it to guard the bundled load.
- **`wireNavigation` is replaced**, not reused — `spa-window.js` owns its own
  `will-navigate` + `setWindowOpenHandler` policy (`isAllowedNavigation`).
- **The close-hides-the-window workaround** (`main/index.js:100-107`) exists to
  keep the renderer alive so its Supabase cookies stay live for the background
  listener. Once main owns the credential, re-check whether it is still needed —
  do not let it become load-bearing for something else by accident.
- **Auth has landed, but is not wired either.** `main/auth-tokens.js` is the
  main-process access-token authority (proactive refresh at ~80% of token
  lifetime, near-expiry gate on every read, bounded-drop on refresh failure), and
  `ui-bridge.js`'s `getBearerToken()` / `getAuthState()` are implemented against
  it — `getBearerToken()` is now **async**. `broadcastAuthState(win, state)` is
  still the push channel for `window.dopl.onAuthState`. Three calls in
  `main/index.js` are required to make it live:

  ```js
  const authTokens = require('./auth-tokens');

  authTokens.start();                                   // in app.whenReady()
  authTokens.subscribe((s) => uiBridge.broadcastAuthState(mainWindow, s));
  // inside the existing powerMonitor onWake() fan-out, next to api.resetPool():
  try { authTokens.onWake(); } catch (err) { diag('wake token error', err && err.message); }
  ```

  Optional but recommended: `authTokens.onSignIn()` right after
  `auth.captureFromFragment()` in `openDeepLink`, and `authTokens.onSignOut()`
  after `auth.signOut()` — both replace a timing guess with a deterministic
  re-arm (C15). Until `start()` is called the timer never runs; the cookie path
  is unaffected either way.
- **`scripts/smoke-test.js` still loads the remote site.** After the flip it
  should `loadFile` the built SPA and assert first paint + the bridge — which
  makes it a real release gate for the first time.

## Build and run

```bash
# production shape: build the renderer, then run/package the app
npm run build:ui --prefix ../            # → dopl-desktop-app/renderer/app/
npm start                                # electron .

# dev shape: Vite dev server + HMR inside the Electron window
npm run dev:ui --prefix ../              # http://localhost:5173 (strictPort)
DOPL_UI_DEV_URL=http://localhost:5173 npm start
```

`renderer/app/` is **git-ignored build output**. A packaging run
(`npm run dist` / `npm run release`) must be preceded by `npm run build:ui`, or
the app ships without a UI — there is no build step in electron-builder that
would catch it.

`DOPL_UI_DEV_URL` is read per window creation. When it is set, the strict
production CSP is absent (Vite injects it only at build time) and the dev
origin is added to the navigation allow-list — both dev-only relaxations, both
in one place.

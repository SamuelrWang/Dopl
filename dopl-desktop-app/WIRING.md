# How the bundled SPA window is wired

The desktop app has ONE shell: a local `BrowserWindow` loading the bundled SPA
(`apps/desktop-ui`, built into `renderer/app/`). The remote-website shell and its
`DOPL_UI=remote` opt-out were deleted in Stage D (2026-08-06). Live rules:
docs/INVARIANTS.md §11.

| File | Role |
|---|---|
| `main/spa-window.js` | `createSpaWindow` — `loadFile renderer/app/index.html` (or `DOPL_UI_DEV_URL` in dev), sandbox + contextIsolation, navigation locked down. |
| `main/shell-mode.js` | `makeShellHelpers` (the single shell factory, which the min-version gate rides) and `wireSpaServices` (the one `uiBridge.register` call). |
| `main/app-windows.js` | Registry of app-owned windows (the shell plus any pop-out thread window, `main/popout-window.js`). IPC sender binding uses `appWindows.senderIds()`. |
| `renderer/app-preload.js` | `window.dopl`. The op list is `test/_app-ops-fixture.mjs › APP_OPS` (58 ops on 2026-10-02) — read it, do not trust the number. No tokens cross it. |
| `main/ui-bridge.js` | The `ipcMain.handle` half, sender-bound to app windows. |
| `main/auth-tokens.js` | The main-process access-token authority; `authTokens.start()` runs unconditionally in `main/index.js`. |

`build.files` (`main/**/*`, `renderer/**/*`) already covers `renderer/app/`; no
electron-builder change is needed.

## Adding a bridge op

Change the preload, the `ipcMain` handler, the SPA's typed mirror
(`apps/desktop-ui/src/lib/dopl-bridge.ts`) and `test/_app-ops-fixture.mjs › APP_OPS`
together. CI's `scripts/check-bridge-caller-drift.mjs` fails a preload member with
no caller in the SPA.

## Build and run

```bash
# from the repo root
npm run build:ui            # → dopl-desktop-app/renderer/app/
cd dopl-desktop-app && npm start

# dev: Vite + HMR inside the Electron window
npm run dev:ui              # repo root, http://localhost:5173 (strictPort)
cd dopl-desktop-app && npm run dev   # sets DOPL_UI_DEV_URL=http://localhost:5173
```

Point the app at a local API with `DOPL_APP_URL=http://localhost:3000` (the default
is `https://www.usedopl.com/`, `main/config.js`), with the web app running via
`npm run dev` at the root.

`renderer/app/` is git-ignored build output. `npm run dist` / `npm run release`
must be preceded by `npm run build:ui`, or the app ships without a UI.

When `DOPL_UI_DEV_URL` is set, the production CSP is absent (Vite injects it at
build time) and the dev origin joins the navigation allow-list — both dev-only.

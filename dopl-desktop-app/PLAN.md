# Dopl Desktop — Build Plan

Goal: gut the old "Dopl Connect" companion (floating overlay + local openclaw
runtime + cloud gateway client) and turn this Electron project into the **Dopl
desktop app** — a clean native wrapper around the production web app at
`https://www.usedopl.com/`.

Keep everything that makes notarization easy; replace everything functional.

## Target
- URL wrapped: `https://www.usedopl.com/` (`usedopl.com` 307-redirects to www)
- Platform: macOS arm64 (DMG), Electron 32.3.3
- Signing identity present: `Developer ID Application: Samuel Wang (7352NBAF44)`
- appId kept: `com.dopl.connect` (proven-notarizable; cert is team-scoped anyway)
- productName: `Dopl`

## KEEP (signing / notarization infra — untouched)
- `build/icon.icns`
- `scripts/notarize.js` (afterSign hook; runs when Apple creds present)
- `entitlements.mac.plist`
- `package.json` `build` block (appId, mac, dmg, afterSign)
- Developer ID cert in keychain (electron-builder auto-signs with it)

## GUT (all functional code from the old product)
- `main/node-manager.js`      (cloud gateway WS client)
- `main/runtime-manager.js`   (downloads Node.js + openclaw binary)
- `main/chat-manager.js`
- `main/event-manager.js`
- `main/ipc.js`               (huge IPC surface for the overlay)
- `renderer/input-bar.html` + `renderer/js/input-bar-app.js`
- `renderer/chat-panel.html` + `renderer/js/chat-panel-app.js`
- `renderer/js/utils.js`
- old `renderer/styles/*` (overlay styling)
- old `renderer/preload.js` (huge overlay bridge)
- dep: `ws` (no longer needed)

## NEW
- `main/index.js`     — single BrowserWindow → www.usedopl.com; window-state
                        persistence; external links → system browser; OAuth
                        popups allowed; offline fallback; standard macOS menu.
- `renderer/preload.js` — minimal, contextIsolated, exposes app version only.
- `renderer/offline.html` — retry screen shown on `did-fail-load`.
- `scripts/smoke.js` — headless Electron load check (CI/local debug). ⚠ Renamed from
  `smoke-test.js` on 2026-09-02: `node --test` with no glob collects `*-test.js` and this file
  is an ELECTRON entry point, not a test.
- `scripts/finish-notarize.sh` — ONE command to notarize+staple the built DMG
                        when Apple creds are available.

## Notarization status (IMPORTANT)
No Apple notarization credentials exist on this machine right now:
- no `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` in env or any `.env`
- no stored `notarytool` keychain profile
- no App Store Connect API key (`.p8`)

The Developer **signing** cert IS present, so the build is fully Developer-ID
signed. Notarization (Apple-server submit) is the only step that needs creds.
`scripts/notarize.js` skips cleanly when creds are absent.

### To finish notarization (one command, when creds available)
```
cd companion-app
export APPLE_ID="you@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com → App-Specific Passwords
npm run notarize        # notarizes + staples dist/*.dmg, Team 7352NBAF44
```
(Or simply re-run `npm run build` with those two vars exported — the afterSign
hook notarizes during the build.)

## Verify steps (run before declaring done)
1. `node_modules/.bin/electron scripts/smoke.js` → expects `did-finish-load`
   on www.usedopl.com, prints page title, no fatal console errors.
2. `npm run build` → produces signed DMG in `dist/`.
3. `codesign --verify --deep --strict` + `spctl -a` on the built `.app`.

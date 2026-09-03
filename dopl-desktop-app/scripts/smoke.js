/**
 * Smoke test: launch Electron, load the BUNDLED SPA with production webPreferences, assert the
 * page loads. Prints a JSON result, exits non-zero on failure.
 * Run: `node_modules/.bin/electron scripts/smoke.js`  (npm run smoke)
 *
 * ⚠ **NOT NAMED `smoke-test.js` ANY MORE, AND THE RENAME IS THE FIX (2026-09-02).**
 * `node --test` — with no glob, which is how this suite is run by hand and in
 * every doc that names it — collects `*-test.js` by DEFAULT, so this file was
 * picked up as a test, launched no Electron, and failed. **PERMANENTLY, ONE
 * FAILURE, ON EVERY BARE RUN**, which is the worst possible shape for a suite:
 * a red that means nothing trains a reader to skip the red that means
 * something. `npm test` passes an explicit glob under `test/` and never saw it,
 * so the two invocations of the same suite disagreed.
 *
 * ⚠ Loads the LOCAL `renderer/app/index.html`, never a remote URL — accurate and offline.
 * ⚠ NEEDS A BUILT SPA (`npm run build:ui` from the repo root); a tree that never built one
 * fails with `reason: 'no-spa-bundle'` rather than a confusing did-fail-load.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const fs = require('fs');
const INDEX_HTML = path.join(__dirname, '..', 'renderer', 'app', 'index.html');
const TIMEOUT_MS = 30000;

function done(ok, info) {
  console.log('SMOKE_RESULT ' + JSON.stringify({ ok, ...info }));
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() => {
  if (!fs.existsSync(INDEX_HTML)) {
    done(false, { reason: 'no-spa-bundle', path: INDEX_HTML, hint: 'run `npm run build:ui` from the repo root' });
    return;
  }
  const errors = [];
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const wc = win.webContents;

  const timer = setTimeout(() => done(false, { reason: 'timeout', errors }), TIMEOUT_MS);

  // ⚠ Electron 35+: 'console-message' emits ONE event object
  // ({ level, message, lineNumber, sourceId, frame }), and `level` is a STRING
  // ('info'|'warning'|'error'|'debug'), not the old integer.
  wc.on('console-message', ({ level, message }) => {
    if (level === 'error') errors.push(message);
  });

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    clearTimeout(timer);
    done(false, { reason: 'did-fail-load', code, desc, url, errors });
  });

  wc.on('did-finish-load', async () => {
    try {
      const info = await wc.executeJavaScript(`(() => ({
        title: document.title,
        url: location.href,
        hasBody: !!document.body && document.body.innerText.length > 0,
        bodyLen: document.body ? document.body.innerText.length : 0,
        desktopFlag: !!(window.dopl && window.dopl.isDesktop)
      }))()`);
      clearTimeout(timer);
      done(true, { ...info, consoleErrors: errors.length });
    } catch (err) {
      clearTimeout(timer);
      done(false, { reason: 'eval-failed', message: err.message, errors });
    }
  });

  win.loadFile(INDEX_HTML);
});

app.on('window-all-closed', () => {});

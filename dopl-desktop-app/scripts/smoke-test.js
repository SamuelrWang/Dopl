/**
 * Headless-ish smoke test: launch Electron, load the wrapped URL with the same
 * webPreferences as production, and assert the page loads. Prints a JSON result
 * and exits non-zero on failure. Run: `node_modules/.bin/electron scripts/smoke-test.js`
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const APP_URL = process.env.DOPL_APP_URL || 'https://www.usedopl.com/';
const TIMEOUT_MS = 30000;

function done(ok, info) {
  console.log('SMOKE_RESULT ' + JSON.stringify({ ok, ...info }));
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() => {
  const errors = [];
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const wc = win.webContents;

  const timer = setTimeout(() => done(false, { reason: 'timeout', errors }), TIMEOUT_MS);

  wc.on('console-message', (_e, level, message) => {
    // level 3 = error
    if (level === 3) errors.push(message);
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

  win.loadURL(APP_URL);
});

app.on('window-all-closed', () => {});

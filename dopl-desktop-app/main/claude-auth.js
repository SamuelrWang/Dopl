// Feature D — "Sign in to Claude" (no-terminal CLI auth).
//
// When a spawn fails with an auth-shaped error, we offer an in-app sign-in
// instead of the generic failure notice:
//   Tier 2 (primary): drive `claude setup-token` under a pseudo-TTY
//     (`script -q /dev/null claude setup-token`), parse the OAuth URL from its
//     output, open it in the system browser, collect the pasted authorization
//     code in a minimal LOCAL BrowserWindow, and write it to the child's stdin.
//   Tier 1 (fallback): open Terminal and run `claude /login` for the user.
//
// EMPIRICAL (claude 2.1.220, macOS, verified 2026-07-25): under a pty,
// setup-token prints "Opening browser to sign in…", emits the OAuth authorize
// URL as an OSC-8 hyperlink whose host is claude.com (NOT anthropic), and then
// prompts "Paste code here if prompted >" on stdin. On completion it either
// stores the credential in claude's own store (spawns then work with no env) or
// prints a long-lived token — BOTH handled: a printed sk-ant-* token is captured
// and stored (claude-token) for CLAUDE_CODE_OAUTH_TOKEN injection; otherwise a
// clean exit is treated as success and spawns rely on claude's own store.
//
// Every flow state is diag()-logged. The token value is NEVER logged.

const path = require('path');
const { spawn, execFile } = require('child_process');
const { dialog, shell, Notification, BrowserWindow, ipcMain } = require('electron');

const spawner = require('./session-spawner');
const { setStoredOAuthToken } = require('./claude-token');
const { diag } = require('./diag');

const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_ERROR_RE = /401|OAuth.*expired|Re-authenticate/i;

let inProgress = false; // single-flight: never stack two sign-in flows

function isAuthShapedError(text) {
  return AUTH_ERROR_RE.test(String(text == null ? '' : text));
}

// ── OAuth URL / token parsing ────────────────────────────────────────────────
function extractOAuthUrl(s) {
  // Primary: the OSC-8 hyperlink target — ESC ] 8 ; params ; URI BEL. The URI is
  // clean (the animated redraw only mangles the VISIBLE text, not the target).
  const osc = s.match(/\x1b\]8;[^;]*;(https?:\/\/[^\x07\x1b]+)/);
  if (osc && /oauth|authorize/i.test(osc[1])) return osc[1];
  // Fallback: first authorize-looking https URL; the spinner can duplicate it,
  // so cut at a second "https" occurrence.
  const gen = s.match(/https?:\/\/[^\s\x00-\x1f"']*(?:oauth|authorize)[^\s\x00-\x1f"']*/i);
  if (gen) {
    let u = gen[0];
    const dup = u.indexOf('https', 5);
    return dup > 0 ? u.slice(0, dup) : u;
  }
  return null;
}

function extractToken(s) {
  // setup-token prints a long-lived OAuth token when it doesn't store it itself.
  const m = s.match(/sk-ant-[a-zA-Z0-9._-]{20,}/);
  return m ? m[0] : null;
}

// ── Paste-back code window (local file page, single narrow IPC) ──────────────
function openCodePrompt(onSubmit, onCancel) {
  const win = new BrowserWindow({
    width: 460,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Sign in to Claude',
    backgroundColor: '#0b0b0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'code-prompt-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'code-prompt.html'));
  win.once('ready-to-show', () => win.show());

  let submitted = false;
  const handler = (event, code) => {
    // Only accept from this window's own webContents.
    if (win.isDestroyed() || event.sender !== win.webContents) return;
    if (submitted) return;
    submitted = true;
    try { onSubmit(code); } catch (_) { /* forwarded to child */ }
    try { if (!win.isDestroyed()) win.close(); } catch (_) {}
  };
  ipcMain.on('code-prompt:submit', handler);
  win.on('closed', () => {
    ipcMain.removeListener('code-prompt:submit', handler);
    if (!submitted) onCancel();
  });
  return win;
}

// ── Tier 2: setup-token under a pty ──────────────────────────────────────────
function runSetupTokenFlow(bin) {
  return new Promise((resolve) => {
    let child;
    try {
      // macOS `script -q /dev/null <cmd>` gives the child a TTY with no window.
      child = spawn('script', ['-q', '/dev/null', bin, 'setup-token'], {
        env: spawner.cliEnv(bin),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      diag('signin tier2: spawn failed', err && err.message);
      resolve(false);
      return;
    }

    let out = '';
    let settled = false;
    let urlOpened = false;
    let promptWin = null;
    let capturedToken = null;

    const timer = setTimeout(() => {
      diag('signin tier2: timeout (5m)');
      finish(false);
    }, SETUP_TIMEOUT_MS);

    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (promptWin && !promptWin.isDestroyed()) promptWin.close(); } catch (_) {}
      try { child.stdin.end(); } catch (_) {}
      try { child.kill('SIGINT'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 1500);
      if (ok && capturedToken) {
        const stored = setStoredOAuthToken(capturedToken);
        diag('signin tier2: printed token', stored ? 'stored (safeStorage)' : 'store FAILED');
      }
      diag('signin tier2:', ok ? 'success' : 'failed');
      resolve(ok);
    }

    const onData = (buf) => {
      const s = buf.toString('latin1');
      out += s;
      if (!urlOpened) {
        const url = extractOAuthUrl(out);
        if (url) {
          urlOpened = true;
          diag('signin tier2: oauth url parsed, opening browser + paste window');
          shell.openExternal(url).catch((e) => diag('signin tier2: openExternal failed', e && e.message));
          promptWin = openCodePrompt(
            (code) => {
              try {
                child.stdin.write(String(code) + '\n');
                diag('signin tier2: code submitted to child stdin');
              } catch (e) {
                diag('signin tier2: stdin write failed', e && e.message);
              }
            },
            () => {
              diag('signin tier2: code prompt cancelled');
              finish(false);
            }
          );
        }
      }
      if (!capturedToken) {
        const t = extractToken(out);
        if (t) {
          capturedToken = t;
          diag('signin tier2: printed token detected in output');
        }
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      diag('signin tier2: child error', err && err.message);
      finish(false);
    });
    child.on('close', (code) => {
      // A clean exit after the URL was opened = success (token captured, or
      // stored by claude itself). A non-zero exit, or exit before we ever
      // parsed a URL, is a failure → Tier 1.
      finish(code === 0 && urlOpened);
    });
  });
}

// ── Tier 1: open Terminal and run `claude /login` ────────────────────────────
function appleQuote(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

async function terminalFallback(bin) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Cancel', 'Open Terminal to sign in'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: 'Dopl',
    message: 'Open Terminal to sign in',
    detail:
      'Dopl will open Terminal and start the Claude sign-in. Follow the prompts there, then return to Dopl.',
  });
  if (response !== 1) {
    diag('signin tier1: user declined');
    return;
  }
  const cmd = (bin ? shellQuote(bin) : 'claude') + ' /login';
  const script = `tell application "Terminal"\nactivate\ndo script ${appleQuote(cmd)}\nend tell`;
  execFile('osascript', ['-e', script], (err) => {
    diag('signin tier1: terminal launch', err ? 'FAILED ' + (err.message || '') : 'ok');
  });
}

function notifySuccess() {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Dopl',
        body: "You're signed in to Claude. Channel auto-responses are back on.",
      }).show();
    }
  } catch (_) { /* best-effort */ }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
// Shows an alert notification + a dialog with a "Sign in to Claude" button, then
// runs Tier 2, falling back to Tier 1 on any failure. Single-flight: a second
// auth-shaped error while a flow is open is ignored.
async function startSignInFlow({ getClaudeBin, channelName } = {}) {
  if (inProgress) {
    diag('signin: flow already in progress — ignoring duplicate trigger');
    return;
  }
  inProgress = true;
  try {
    diag('signin: prompt shown (channel', (channelName || '?') + ')');
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Dopl: sign in to Claude',
          body: 'Your Claude sign-in expired. Sign in again to keep answering channel requests.',
        }).show();
      }
    } catch (_) { /* best-effort */ }

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Later', 'Sign in to Claude'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: 'Dopl',
      message: 'Sign in to Claude',
      detail:
        'The Claude CLI needs you to sign in again before Dopl can answer requests in your channels.',
    });
    if (response !== 1) {
      diag('signin: user chose Later');
      return;
    }

    const bin = getClaudeBin ? await getClaudeBin() : null;
    if (!bin) {
      diag('signin: claude cli unresolved — going straight to tier1');
      await terminalFallback(bin);
      return;
    }

    diag('signin: starting tier2 (setup-token pty)');
    const ok = await runSetupTokenFlow(bin);
    if (ok) {
      notifySuccess();
      return;
    }
    diag('signin: tier2 failed — offering tier1');
    await terminalFallback(bin);
  } catch (err) {
    diag('signin: flow error', err && err.message);
  } finally {
    inProgress = false;
  }
}

module.exports = { isAuthShapedError, startSignInFlow };

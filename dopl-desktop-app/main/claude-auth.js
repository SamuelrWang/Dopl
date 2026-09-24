// THE IN-APP CLAUDE CODE SIGN-IN. `claude setup-token` runs under a pseudo-TTY with no window
// (`script -q /dev/null`); its OAuth URL opens in the system browser, the code the page shows is pasted into
// a local window, and the long-lived token the CLI then prints is stored as Dopl's own (`claude-token.js`).
// setup-token only prints its token, so the operator's own Claude Code login is never written. The token is
// never logged.

const path = require('path');
const { spawn } = require('child_process');
const { shell, BrowserWindow, ipcMain } = require('electron');

const spawner = require('./session-spawner');
const { setStoredOAuthToken } = require('./claude-token');
const { diag } = require('./diag');

const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
// What setup-token prints around its token (claude 2.1.220). Both are required, so a token still arriving is never taken.
const TOKEN_OPEN = 'Your OAuth token';
const TOKEN_CLOSE = 'Store this token securely';

// ── Output parsing ───────────────────────────────────────────────────────────
function extractOAuthUrl(s) {
  // The OSC-8 hyperlink target (ESC ] 8 ; params ; URI BEL) is clean; the spinner mangles only the visible text.
  const osc = s.match(/\x1b\]8;[^;]*;(https?:\/\/[^\x07\x1b]+)/);
  if (osc && /oauth|authorize/i.test(osc[1])) return osc[1];
  // Fallback: the first authorize-looking URL, cut at a second "https" (the spinner can duplicate it).
  const gen = s.match(/https?:\/\/[^\s\x00-\x1f"']*(?:oauth|authorize)[^\s\x00-\x1f"']*/i);
  if (gen) {
    const u = gen[0];
    const dup = u.indexOf('https', 5);
    return dup > 0 ? u.slice(0, dup) : u;
  }
  return null;
}

const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

// The token between its two markers, with the terminal's escapes and line wrapping removed.
function extractToken(s) {
  const plain = String(s).replace(ANSI_RE, '');
  const open = plain.indexOf(TOKEN_OPEN);
  const close = open === -1 ? -1 : plain.indexOf(TOKEN_CLOSE, open);
  if (close === -1) return null;
  const m = plain.slice(open + TOKEN_OPEN.length, close).replace(/\s+/g, '').match(/sk-ant-[A-Za-z0-9._-]{20,}/);
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
    // Only from this window's own webContents.
    if (win.isDestroyed() || event.sender !== win.webContents || submitted) return;
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

// ── setup-token under a pty → true once Dopl holds the token ─────────────────
function runSetupTokenFlow(bin) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('script', ['-q', '/dev/null', bin, 'setup-token'], {
        env: spawner.cliEnv(bin),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      diag('claude signin: spawn failed', err && err.message);
      resolve(false);
      return;
    }

    let out = '';
    let settled = false;
    let urlOpened = false;
    let promptWin = null;

    const timer = setTimeout(() => {
      diag('claude signin: timeout (5m)');
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
      diag('claude signin:', ok ? 'token stored' : 'failed');
      resolve(ok);
    }

    const onData = (buf) => {
      if (settled) return;
      out += buf.toString('latin1');
      if (!urlOpened) {
        const url = extractOAuthUrl(out);
        if (url) {
          urlOpened = true;
          diag('claude signin: oauth url parsed, opening browser + paste window');
          shell.openExternal(url).catch((e) => diag('claude signin: openExternal failed', e && e.message));
          promptWin = openCodePrompt(
            (code) => {
              try {
                child.stdin.write(String(code) + '\n');
              } catch (e) {
                diag('claude signin: stdin write failed', e && e.message);
              }
            },
            () => {
              diag('claude signin: code prompt cancelled');
              finish(false);
            }
          );
        }
      }
      const token = extractToken(out);
      if (token) finish(setStoredOAuthToken(token));
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      diag('claude signin: child error', err && err.message);
      finish(false);
    });
    // An exit before a token was captured is a failure, whatever the code.
    child.on('close', () => finish(false));
  });
}

// The BUNDLED binary first (asar-unpacked and signed; most machines never installed a `claude`), then the
// external CLI. The loader pulls `electron.app`, so a throw means "no bundled binary".
async function resolveClaudeBin() {
  try {
    const bundled = require('./runtime/claude/loader').resolveClaudeExecutable();
    if (bundled) return bundled;
  } catch (err) {
    diag('claude signin: bundled binary unresolved', err && err.message);
  }
  try {
    return await spawner.getClaudeBinPath();
  } catch (err) {
    diag('claude signin: external cli unresolved', err && err.message);
    return null;
  }
}

let current = null;

/** One sign-in → `{ ok }`; a click while one runs joins it rather than starting a second. */
function signIn() {
  if (!current) {
    current = (async () => {
      const bin = await resolveClaudeBin();
      if (!bin) return { ok: false };
      return { ok: await runSetupTokenFlow(bin) };
    })().finally(() => { current = null; });
  }
  return current;
}

module.exports = { signIn, extractOAuthUrl, extractToken };

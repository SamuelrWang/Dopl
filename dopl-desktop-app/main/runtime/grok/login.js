// THE IN-APP GROK SIGN-IN — the user's own SuperGrok / X Premium subscription via Grok's own device-code
// login, `grok login --device-auth`, run under a script(1) pseudo-terminal in a throwaway home
// (`config-home.js › loginEnv`) and installed as the Dopl-owned `auth.json` on success. Never touches the
// operator's `~/.grok`; never logs a token, a user code or a URL's query string. When no Grok build is on this
// Mac, the sign-in first downloads xAI's build (`update-source.js`, on demand — the operator asked for Grok).
//
// What the CLI prints (grok 1.0.52, 2026-10-13, `test/fixtures/grok/login-device-auth-1.0.52.txt`):
//   To sign in, open this URL in your browser:   https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX
//   Confirm this code in your browser:            XXXX-XXXX
//   Waiting for authorization...
// then it polls and exits 0 with `$GROK_AUTH_PATH` written.

const fs = require('fs');
const configHome = require('./config-home');

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const SCRIPT_BIN = '/usr/bin/script';
const XAI_HOSTS = ['x.ai', 'grok.com'];

/** An `https:` URL on an xAI host, with no credentials or port in it. */
function isXaiUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return XAI_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Origin + path only: the query carries the user code. */
function redactUrl(raw) {
  try { const u = new URL(String(raw)); return `${u.origin}${u.pathname}`; } catch (_) { return '(unparseable)'; }
}

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|[\u0000-\u0008\u000b-\u001f]/g;

/** The pty text → `{ url, code }` once both are printed (either may be null so far). Pure. */
function scrape(text) {
  const clean = String(text || '').replace(ANSI_RE, ' ');
  const url = (clean.match(/https:\/\/[^\s"'<>]+/g) || []).find(isXaiUrl) || null;
  const after = clean.split(/confirm this code/i)[1] || '';
  const m = /\b([A-Z0-9]{3,6}(?:-[A-Z0-9]{3,6}){1,3})\b/.exec(after);
  return { url, code: m ? m[1] : null };
}

function electronDeps() {
  const { app, shell, dialog, BrowserWindow } = require('electron');
  return {
    openExternal: (url) => shell.openExternal(url),
    // A sheet on an app window (a parentless macOS message box blocks main); closed when the flow settles.
    showCode: ({ userCode, onCancel }) => {
      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (!parent) return () => {};
      const ctl = new AbortController();
      dialog.showMessageBox(parent, {
        type: 'info', title: 'Sign in to Grok', message: 'Confirm this code in your browser', detail: userCode,
        buttons: ['Cancel'], signal: ctl.signal,
      }).then(() => { if (!ctl.signal.aborted) onCancel(); }, () => {});
      return () => ctl.abort();
    },
    onQuit: (fn) => { app.once('will-quit', fn); return () => app.removeListener('will-quit', fn); },
  };
}

/** The binary to sign in with: the resolved one, else xAI's build downloaded now (on demand). */
async function ensureBinary() {
  const resolveBin = require('./resolve-bin');
  let found = resolveBin.resolveGrokBin();
  if (found.ok) return found.path;
  await require('../updates').checkNow('grok', { install: true });
  resolveBin.forget();
  found = resolveBin.resolveGrokBin();
  if (!found.ok) throw new Error(found.reason);
  return found.path;
}

let current = null; // the flow in flight: `{ outcome, end }`
let clicks = 0;

/** One sign-in → `{ ok, reason }`. A second call cancels the one in flight. `overrides` are for tests. */
async function signIn(overrides) {
  const o = overrides || {};
  const d = Object.assign({
    bin: ensureBinary,
    spawn: (cmd, args, opts) => require('child_process').spawn(cmd, args, opts),
    diag: (...a) => require('../../diag').diag(...a),
    timeoutMs: LOGIN_TIMEOUT_MS,
    userDataRoot: undefined,
  }, o.electron === false ? {} : electronDeps(), o);
  const ticket = ++clicks;
  for (;;) {
    if (ticket !== clicks) return { ok: false, reason: 'superseded' };
    if (!current) break;
    await current.end({ ok: false, reason: 'superseded' });
  }
  const flow = run(d);
  current = flow;
  try { return await flow.outcome; } finally { if (current === flow) current = null; }
}

/** Cancel the flow in flight → true when one ran. */
function cancel() {
  if (!current) return false;
  void current.end({ ok: false, reason: 'cancelled' });
  return true;
}

function run(d) {
  const s = { child: null, settled: false, shown: false, out: '' };
  let settle;
  const outcome = new Promise((r) => { settle = r; });
  let closeCode = () => {};
  let unQuit = () => {};
  // Armed once the binary is in hand: a first-time download (~170 MB) is not the operator's login time.
  let timer = null;

  function end(result) {
    if (s.settled) return outcome;
    s.settled = true;
    if (timer) clearTimeout(timer);
    unQuit();
    closeCode();
    // Killing script(1) takes the CLI down with its pty.
    if (s.child) { try { s.child.kill('SIGTERM'); } catch (_) { /* gone */ } }
    try { configHome.clearLoginHome(d.userDataRoot); } catch (_) { /* best effort */ }
    d.diag('grok signin:', result.ok ? 'signed in' : `ended (${result.reason})`);
    settle(result);
    return outcome;
  }

  function onOutput(chunk) {
    if (s.settled || s.shown) return;
    s.out += String(chunk);
    const { url, code } = scrape(s.out);
    if (!url || !code) return;
    s.shown = true;
    closeCode = d.showCode({ userCode: code, onCancel: () => { void end({ ok: false, reason: 'cancelled' }); } }) || (() => {});
    Promise.resolve().then(() => d.openExternal(url)).catch(() => { /* the code is on screen */ });
    d.diag('grok signin: device-code flow opened', redactUrl(url));
  }

  (async () => {
    unQuit = d.onQuit(() => { void end({ ok: false, reason: 'quit' }); }) || (() => {});
    const bin = await d.bin();
    if (s.settled) return;
    timer = setTimeout(() => { void end({ ok: false, reason: 'timeout' }); }, d.timeoutMs);
    if (timer.unref) timer.unref();
    const home = configHome.loginEnv(configHome.buildScrubbedEnv({ TERM: 'dumb' }), d.userDataRoot);
    // stdin `ignore`: script(1) with a piped stdin fails (EOPNOTSUPP, `claude-auth.js`).
    s.child = d.spawn(SCRIPT_BIN, ['-q', '/dev/null', bin, 'login', '--device-auth'], {
      env: home.env, cwd: home.home, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (s.child.stdout) s.child.stdout.on('data', onOutput);
    if (s.child.stderr) s.child.stderr.on('data', onOutput);
    s.child.on('error', () => { void end({ ok: false, reason: 'error' }); });
    s.child.on('close', (code) => {
      if (s.settled) return;
      if (code !== 0) { void end({ ok: false, reason: s.shown ? 'failed' : 'unavailable' }); return; }
      let present = false;
      try { present = fs.lstatSync(home.authFile).isFile(); } catch (_) { present = false; }
      if (!present) { void end({ ok: false, reason: 'no-credential' }); return; }
      try { configHome.installAuth(home.authFile, d.userDataRoot); } catch (_) { void end({ ok: false, reason: 'no-credential' }); return; }
      void end({ ok: true });
    });
  })().catch((err) => {
    d.diag('grok signin: failed —', (err && err.message) || err);
    return end({ ok: false, reason: 'error' });
  });

  return { outcome, end };
}

module.exports = { signIn, cancel, isXaiUrl, redactUrl, scrape, SCRIPT_BIN };

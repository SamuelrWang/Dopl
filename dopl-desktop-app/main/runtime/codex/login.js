// THE IN-APP CODEX SIGN-IN — the bundled app-server's own ChatGPT login, run in a throwaway home
// (`config-home.js › loginEnv`) and installed as the Dopl-owned `auth.json` on success. Browser flow
// first, device code when the browser flow cannot start. Never touches `~/.codex`; never logs a token,
// a user code or a URL's query string.

const path = require('path');
const configHome = require('./config-home');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const STEP_TIMEOUT_MS = 2000;
const OPENAI_HOSTS = ['openai.com', 'chatgpt.com'];

/** An `https:` URL on an OpenAI/ChatGPT host, with no credentials or port in it. */
function isOpenAiUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return OPENAI_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Origin + path only: the query carries the PKCE state. */
function redactUrl(raw) {
  try { const u = new URL(String(raw)); return `${u.origin}${u.pathname}`; } catch (_) { return '(unparseable)'; }
}

const bounded = (promise, ms) => Promise.race([
  Promise.resolve(promise).catch(() => undefined),
  new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }),
]);

function electronDeps() {
  const { app, shell, dialog, BrowserWindow } = require('electron');
  return {
    openExternal: (url) => shell.openExternal(url),
    // A sheet on an app window (a parentless macOS message box blocks main); closed when the flow settles.
    showCode: ({ userCode, onCancel }) => {
      const parent = BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (!parent) return () => {};
      const ctl = new AbortController();
      dialog.showMessageBox(parent, {
        type: 'info',
        title: 'Sign in to Codex',
        message: 'Enter this code in your browser',
        detail: userCode,
        buttons: ['Cancel'],
        signal: ctl.signal,
      }).then(() => { if (!ctl.signal.aborted) onCancel(); }, () => {});
      return () => ctl.abort();
    },
    onQuit: (fn) => { app.once('will-quit', fn); return () => app.removeListener('will-quit', fn); },
  };
}

let current = null; // the flow in flight: `{ outcome, end }`
let clicks = 0;

/**
 * One sign-in → `{ ok, reason }`. A second call cancels the one in flight (`reason: 'superseded'`).
 * `overrides` replace the electron, client and timing deps (tests); `userDataRoot` defaults to the app's.
 */
async function signIn(overrides) {
  const o = overrides || {};
  const d = Object.assign({
    connect: (opts) => require('./client').connect(opts),
    initializeParams: (v) => require('./client').initializeParams(v),
    version: () => require('../../app-version').appVersion(),
    diag: (...a) => require('../../diag').diag(...a),
    timeoutMs: LOGIN_TIMEOUT_MS,
    stepMs: STEP_TIMEOUT_MS,
    userDataRoot: undefined,
  }, o.electron === false ? {} : electronDeps(), o);
  // The newest click wins: an older one still waiting for the flow before it steps aside.
  const ticket = ++clicks;
  for (;;) {
    if (ticket !== clicks) return { ok: false, reason: 'superseded' };
    if (!current) break;
    await current.end({ ok: false, reason: 'superseded' });
  }
  const flow = run(d);
  current = flow;
  try {
    return await flow.outcome;
  } finally {
    if (current === flow) current = null;
  }
}

function run(d) {
  const s = { conn: null, loginId: null, settled: false, exited: false, waiter: null, completions: new Map() };
  let settle;
  const outcome = new Promise((r) => { settle = r; });
  let exited;
  const exit = new Promise((r) => { exited = r; });
  let closeCode = () => {};
  let unQuit = () => {};
  const timer = setTimeout(() => { void end({ ok: false, reason: 'timeout' }); }, d.timeoutMs);
  if (timer.unref) timer.unref();

  async function end(result, opts) {
    if (s.settled) return outcome;
    s.settled = true;
    const immediate = !!(opts && opts.immediate);
    clearTimeout(timer);
    unQuit();
    closeCode();
    if (s.waiter) s.waiter({ success: false });
    if (!result.ok && s.conn && s.loginId && !immediate) {
      await bounded(s.conn.request('account/login/cancel', { loginId: s.loginId }), d.stepMs);
    }
    if (s.conn) {
      try { s.conn.close(); } catch (_) { /* best effort */ }
      // The login server holds a local port and writes its home until it exits: wait, then force it.
      if (!immediate && !s.exited) await bounded(exit, d.stepMs);
      if (!immediate && !s.exited && s.conn.child) {
        try { s.conn.child.kill('SIGKILL'); } catch (_) { /* gone */ }
        await bounded(exit, d.stepMs);
      }
    }
    try { configHome.clearLoginHome(d.userDataRoot); } catch (_) { /* best effort */ }
    d.diag('codex signin:', result.ok ? 'signed in' : `ended (${result.reason})`);
    settle(result);
    return outcome;
  }

  function onNotification(msg) {
    if (!msg || msg.method !== 'account/login/completed') return;
    const p = msg.params || {};
    const id = typeof p.loginId === 'string' ? p.loginId : null;
    if (s.waiter && id === s.loginId) s.waiter(p);
    else if (id) s.completions.set(id, p);
  }

  const completion = (loginId) => new Promise((resolve) => {
    if (s.completions.has(loginId)) { resolve(s.completions.get(loginId)); return; }
    s.waiter = resolve;
  });

  async function browserLogin(conn) {
    let res;
    try {
      res = await conn.request('account/login/start', { type: 'chatgpt' });
    } catch (err) {
      d.diag('codex signin: browser flow unavailable —', (err && err.message) || err);
      return null;
    }
    if (!res || typeof res.loginId !== 'string') return null;
    s.loginId = res.loginId;
    if (!isOpenAiUrl(res.authUrl)) {
      d.diag('codex signin: refused a non-OpenAI auth URL', redactUrl(res.authUrl));
      return { refused: true };
    }
    try {
      await d.openExternal(res.authUrl);
    } catch (err) {
      d.diag('codex signin: could not open the browser —', (err && err.message) || err);
      await bounded(conn.request('account/login/cancel', { loginId: res.loginId }), d.stepMs);
      s.loginId = null;
      return null;
    }
    d.diag('codex signin: browser flow opened', redactUrl(res.authUrl));
    return { loginId: res.loginId };
  }

  async function deviceLogin(conn) {
    const res = await conn.request('account/login/start', { type: 'chatgptDeviceCode' });
    if (!res || typeof res.loginId !== 'string' || typeof res.userCode !== 'string') return null;
    s.loginId = res.loginId;
    if (!isOpenAiUrl(res.verificationUrl)) {
      d.diag('codex signin: refused a non-OpenAI verification URL', redactUrl(res.verificationUrl));
      return { refused: true };
    }
    const onCancel = () => { void end({ ok: false, reason: 'cancelled' }); };
    closeCode = d.showCode({ userCode: res.userCode, onCancel }) || (() => {});
    Promise.resolve().then(() => d.openExternal(res.verificationUrl)).catch(() => { /* the code is on screen */ });
    d.diag('codex signin: device-code flow opened', redactUrl(res.verificationUrl));
    return { loginId: res.loginId };
  }

  (async () => {
    unQuit = d.onQuit(() => { void end({ ok: false, reason: 'quit' }, { immediate: true }); }) || (() => {});
    const home = configHome.loginEnv(process.env, d.userDataRoot);
    s.conn = d.connect({
      env: home.env,
      onNotification,
      onExit: () => { s.exited = true; exited(); void end({ ok: false, reason: 'exited' }); },
      log: d.diag,
    });
    await s.conn.request('initialize', d.initializeParams(d.version()));
    s.conn.notify('initialized');
    const started = (!s.settled && await browserLogin(s.conn)) || (!s.settled && await deviceLogin(s.conn));
    if (s.settled) return;
    if (!started) return end({ ok: false, reason: 'unavailable' });
    if (started.refused) return end({ ok: false, reason: 'untrusted-url' });
    const done = await completion(started.loginId);
    if (s.settled) return;
    if (!done.success) return end({ ok: false, reason: 'failed' });
    configHome.installAuth(path.join(home.home, 'auth.json'), d.userDataRoot);
    return end({ ok: true });
  })().catch((err) => {
    d.diag('codex signin: failed —', (err && err.message) || err);
    return end({ ok: false, reason: 'error' });
  });

  return { outcome, end };
}

module.exports = { signIn, isOpenAiUrl, redactUrl, LOGIN_TIMEOUT_MS };

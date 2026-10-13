// THE IN-APP MUSE SIGN-IN — the user's own Muse subscription via Muse's own device-code login, spoken over
// MSP (`account/loginStart {type:"deviceCode"}`, experimental surface, measured on 1.4.7), run in a
// throwaway home (`config-home.js › loginEnv`, file credential backend) and installed as the Dopl-owned
// `auth.json` on success. Never touches the operator's `~/.config/muse` or Keychain; never logs a token, a
// user code or a URL's query string. When no Muse build is on this Mac, the sign-in first downloads Meta's
// own build (`update-source.js`, on demand — the operator asked for Muse).

const configHome = require('./config-home');

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const STEP_TIMEOUT_MS = 2000;
const META_HOSTS = ['meta.com'];

/** An `https:` URL on a Meta host, with no credentials or port in it. */
function isMetaUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return META_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Origin + path only: the query carries the device code. */
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
      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (!parent) return () => {};
      const ctl = new AbortController();
      dialog.showMessageBox(parent, {
        type: 'info', title: 'Sign in to Muse', message: 'Enter this code in your browser', detail: userCode,
        buttons: ['Cancel'], signal: ctl.signal,
      }).then(() => { if (!ctl.signal.aborted) onCancel(); }, () => {});
      return () => ctl.abort();
    },
    onQuit: (fn) => { app.once('will-quit', fn); return () => app.removeListener('will-quit', fn); },
  };
}

/** The binary to sign in with: the resolved one, else Meta's build downloaded now (on demand). */
async function ensureBinary() {
  const resolveBin = require('./resolve-bin');
  let found = resolveBin.resolveMuseBin();
  if (found.ok) return found.path;
  await require('../updates').checkNow('muse', { install: true });
  resolveBin.forget();
  found = resolveBin.resolveMuseBin();
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
    connect: (opts) => require('./client').connect(opts),
    handshake: (conn, v) => require('./client').handshake(conn, v),
    serveArgs: () => require('./client').serveArgs({ provider: 'meta' }),
    version: () => require('../../app-version').appVersion(),
    diag: (...a) => require('../../diag').diag(...a),
    timeoutMs: LOGIN_TIMEOUT_MS,
    stepMs: STEP_TIMEOUT_MS,
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
  const s = { conn: null, settled: false, exited: false, waiter: null, completed: null, started: false };
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
    if (s.waiter) s.waiter({ outcome: 'cancelled' });
    if (!result.ok && s.conn && s.started && !immediate) await bounded(s.conn.request('account/loginCancel', {}), d.stepMs);
    if (s.conn) {
      try { s.conn.close(); } catch (_) { /* best effort */ }
      if (!immediate && !s.exited) await bounded(exit, d.stepMs);
    }
    try { configHome.clearLoginHome(d.userDataRoot); } catch (_) { /* best effort */ }
    d.diag('muse signin:', result.ok ? 'signed in' : `ended (${result.reason})`);
    settle(result);
    return outcome;
  }

  function onNotification(msg) {
    if (!msg || msg.method !== 'account/loginCompleted') return;
    const p = msg.params || {};
    if (s.waiter) s.waiter(p); else s.completed = p;
  }
  const completion = () => new Promise((resolve) => {
    if (s.completed) { resolve(s.completed); return; }
    s.waiter = resolve;
  });

  (async () => {
    unQuit = d.onQuit(() => { void end({ ok: false, reason: 'quit' }, { immediate: true }); }) || (() => {});
    const bin = await d.bin();
    if (s.settled) return;
    const home = configHome.loginEnv(configHome.buildScrubbedEnv(), d.userDataRoot);
    s.conn = d.connect({
      bin, args: d.serveArgs(), env: home.env, onNotification,
      onExit: () => { s.exited = true; exited(); void end({ ok: false, reason: 'exited' }); },
      log: d.diag,
    });
    await d.handshake(s.conn, d.version());
    const res = await s.conn.request('account/loginStart', { type: 'deviceCode' });
    s.started = true;
    if (s.settled) return;
    if (!res || typeof res.userCode !== 'string' || !res.userCode) return end({ ok: false, reason: 'unavailable' });
    if (!isMetaUrl(res.verificationUrl)) {
      d.diag('muse signin: refused a non-Meta verification URL', redactUrl(res.verificationUrl));
      return end({ ok: false, reason: 'untrusted-url' });
    }
    closeCode = d.showCode({ userCode: res.userCode, onCancel: () => { void end({ ok: false, reason: 'cancelled' }); } }) || (() => {});
    Promise.resolve().then(() => d.openExternal(res.verificationUrl)).catch(() => { /* the code is on screen */ });
    d.diag('muse signin: device-code flow opened', redactUrl(res.verificationUrl));
    const done = await completion();
    if (s.settled) return;
    if (!done || done.outcome !== 'granted') return end({ ok: false, reason: (done && done.outcome) || 'failed' });
    // The account Muse now holds, read back before Dopl adopts the file.
    const acct = await s.conn.request('account/read', {});
    if (!acct || acct.state !== 'accountLogin') return end({ ok: false, reason: 'no-account' });
    configHome.installAuth(home.authFile, d.userDataRoot);
    return end({ ok: true });
  })().catch((err) => {
    d.diag('muse signin: failed —', (err && err.message) || err);
    return end({ ok: false, reason: 'error' });
  });

  return { outcome, end };
}

module.exports = { signIn, cancel, isMetaUrl, redactUrl };

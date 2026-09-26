// Dopl's own runtime credentials, for the runtimes it can sign in from inside the app
// (`credential.interactiveSignIn`): each one's status, its one app-level sign-in prompt, and the sign-in op.
// Every change is pushed whole to every app window; no credential crosses to a renderer.

const runtimeRegistry = require('./runtime');
const { diag } = require('./diag');

const STATUS_EVENT = 'dopl:runtime-credentials';

let host = { getWindows: () => [], showWindow: () => {} };
// runtimeId -> { inFlight, fullInFlight, rejected, prompt, dismissed }
const flags = new Map();
let lastDigest = null;
let pushing = Promise.resolve();

/** Wire the window registry (pushes) and the reveal a clicked notification runs. */
function start(h) {
  host = Object.assign({}, host, h);
  lastDigest = null;
  return push();
}

function signInIds() {
  return runtimeRegistry.ids().filter((id) => runtimeRegistry.copy.canSignIn(runtimeRegistry.descriptorFor(id)));
}

function flagsFor(id) {
  if (!flags.has(id)) flags.set(id, { inFlight: 0, fullInFlight: 0, rejected: false, prompt: false, dismissed: false });
  return flags.get(id);
}

async function stateOf(id, f) {
  if (f.inFlight > 0) return 'signing-in';
  let cred = null;
  try { cred = await runtimeRegistry.runtimeFor(id).credentialState(); } catch (_) { /* unreadable reads as absent */ }
  if (!cred || cred.usable === false) return 'not-connected';
  return f.rejected ? 'expired' : 'connected';
}

// The optional full login ("Enable Chrome & connectors"): `on` / `off` / `signing-in`, only where the runtime offers it.
function fullOf(id, f) {
  if (!runtimeRegistry.copy.canSignInFull(runtimeRegistry.descriptorFor(id))) return {};
  if (f.fullInFlight > 0) return { full: 'signing-in' };
  let on = false;
  try { on = runtimeRegistry.runtimeFor(id).hasFullLogin() === true; } catch (_) { /* unreadable reads as off */ }
  return { full: on ? 'on' : 'off' };
}

/** `[{ runtimeId, label, state, prompt, full? }]` in registration order; `state` is what the next session would meet. */
function list() {
  return Promise.all(signInIds().map(async (id) => {
    const f = flagsFor(id);
    return { runtimeId: id, label: runtimeRegistry.descriptorFor(id).label, state: await stateOf(id, f), prompt: f.prompt, ...fullOf(id, f) };
  }));
}

// Serialised, so an older answer can never land after a newer one; unchanged answers are not re-sent.
function push() {
  pushing = pushing.then(async () => {
    const runtimes = await list();
    const digest = JSON.stringify(runtimes);
    if (digest === lastDigest) return;
    lastDigest = digest;
    for (const win of host.getWindows() || []) {
      try { win.webContents.send(STATUS_EVENT, { runtimes }); } catch (err) { diag('runtime credentials: push failed —', err && err.message); }
    }
  }).catch((err) => diag('runtime credentials: status unreadable —', err && err.message));
  return pushing;
}

// A system notification whose click reveals the app (and the prompt in it), only while Dopl is not in front.
function notifyAway(id) {
  try {
    const { BrowserWindow, Notification } = require('electron');
    if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
    const n = new Notification({ title: runtimeRegistry.copy.signInAction(runtimeRegistry.descriptorFor(id)) });
    n.on('click', () => host.showWindow());
    n.show();
  } catch (err) {
    diag('runtime credentials: notification failed —', err && err.message);
  }
}

/** A session of this runtime needs a sign-in: its prompt is raised once, until a sign-in resolves it or it is dismissed. */
function needSignIn(runtimeId) {
  if (signInIds().indexOf(runtimeId) === -1) return;
  const f = flagsFor(runtimeId);
  if (!f.prompt && !f.dismissed && f.inFlight === 0) {
    f.prompt = true;
    notifyAway(runtimeId);
  }
  void push();
}

/** A session's credential was rejected mid-run: `expired` until a sign-in replaces it. */
function noteRejected(runtimeId) {
  if (signInIds().indexOf(runtimeId) === -1) return;
  flagsFor(runtimeId).rejected = true;
  needSignIn(runtimeId);
}

/** The operator closed the prompt; it stays closed until this runtime's next successful sign-in. */
function dismissPrompt(runtimeId) {
  const f = flags.get(runtimeId);
  if (!f || !f.prompt) return false;
  f.prompt = false;
  f.dismissed = true;
  void push();
  return true;
}

// One in-app flow on runtime `id`, its busy counter `busy` pushed around it → true when it took.
async function runFlow(id, busy, method) {
  const f = flagsFor(id);
  f[busy] += 1;
  void push();
  let ok = false;
  try {
    const res = await runtimeRegistry.runtimeFor(id)[method]();
    ok = !!res && res.ok === true;
  } catch (err) {
    diag('runtime credentials:', method, 'threw —', (err && err.message) || err);
  }
  f[busy] -= 1;
  if (ok && method === 'signIn') Object.assign(f, { rejected: false, prompt: false, dismissed: false });
  void push();
  return ok;
}

/** One runtime's in-app sign-in (`''` = the default runtime), then its held sessions are released. */
async function signIn(runtimeId) {
  const id = runtimeId || runtimeRegistry.DEFAULT_ID;
  if (signInIds().indexOf(id) === -1 || !(await runFlow(id, 'inFlight', 'signIn'))) return { ok: false };
  const resumed = await require('./session-auth').resumeHeldSessions(id);
  diag('runtime credentials: signed in to', id, '— held sessions resumed:', resumed);
  return { ok: true, resumed };
}

/**
 * "Enable Chrome & connectors" for one runtime: its full login (`runtime.signInFull`). Used by the next "Use my
 * tools" spawn; a running session keeps the credential it started with.
 */
async function signInFull(runtimeId) {
  const id = runtimeId || runtimeRegistry.DEFAULT_ID;
  if (!runtimeRegistry.copy.canSignInFull(runtimeRegistry.descriptorFor(id))) return { ok: false };
  return { ok: await runFlow(id, 'fullInFlight', 'signInFull') };
}

/** A Dopl sign-out: every runtime drops Dopl's own credential. True when none is left behind. */
async function signOutAll() {
  let cleared = true;
  for (const id of runtimeRegistry.ids()) {
    try {
      if ((await runtimeRegistry.runtimeFor(id).signOut()) === false) cleared = false;
    } catch (err) {
      cleared = false;
      diag('runtime credentials: sign-out threw for', id, '—', err && err.message);
    }
  }
  for (const f of flags.values()) Object.assign(f, { rejected: false, prompt: false, dismissed: false });
  void push();
  return cleared;
}

module.exports = { start, list, needSignIn, noteRejected, dismissPrompt, signIn, signInFull, signOutAll, STATUS_EVENT };

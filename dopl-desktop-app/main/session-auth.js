// The credential preflight and the auth HOLD. The hold is core (every runtime): a session whose runtime
// reports an auth failure parks and is held instead of crashing. The Claude Code credential probe here
// is Claude's own (called through `runtime/claude/credential.js`) until the credential lane moves.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { getStoredOAuthToken } = require('./claude-token');
const store = require('./session-store');
const { floorWindowlessMessage } = require('./session-profiles');
const { diag } = require('./diag');
const runtimeRegistry = require('./runtime');
const runtimeCopy = runtimeRegistry.copy;

/** The descriptor of the runtime this session was stamped with; its copy is what the agent reads. */
function copyFor(s) {
  return runtimeRegistry.descriptorFor(s && s.runtimeId);
}

// The auth env vars the scrubbed spawn env preserves; any one present means the child can authenticate.
const ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
// A click-rate cache; `forget()` clears it the moment a sign-in returns.
const PROBE_TTL_MS = 5000;

let deps = null;
let probe = null;

function bind(d) {
  deps = d || null;
}

function envCredential() {
  const env = process.env || {};
  for (const key of ENV_KEYS) {
    if (String(env[key] == null ? '' : env[key]).trim()) return key;
  }
  return '';
}

// The CLI's own record of a completed sign-in. Reads MARKERS, never the keychain secret (a cross-app
// read pops an OS prompt). Fails OPEN when the file exists but cannot be read; absent is the real "no".
function cliStoreSignedIn() {
  const home = os.homedir();
  try {
    const st = fs.statSync(path.join(home, '.claude', '.credentials.json'));
    if (st.isFile() && st.size > 2) return true;
  } catch (_) {}
  try {
    const raw = fs.readFileSync(path.join(home, '.claude.json'), 'utf8');
    const account = JSON.parse(raw).oauthAccount;
    return !!(account && typeof account === 'object' && account.accountUuid);
  } catch (err) {
    return err && err.code !== 'ENOENT';
  }
}

// `{ usable, source }`. `stored-token` is last so it is chosen only when it is the only credential, which is
// exactly when `withStoredCredential` injects it.
function credentialState() {
  const now = Date.now();
  if (probe && now - probe.at < PROBE_TTL_MS) return probe.state;
  let state = { usable: false, source: null };
  const envKey = envCredential();
  if (envKey) state = { usable: true, source: 'env' };
  else if (cliStoreSignedIn()) state = { usable: true, source: 'cli-store' };
  else if (getStoredOAuthToken()) state = { usable: true, source: 'stored-token' };
  probe = { at: now, state };
  return state;
}

function forget() {
  probe = null;
}

// Inject our own stored setup-token only when it is the sole credential; otherwise the env is returned as is.
function withStoredCredential(env) {
  const state = credentialState();
  if (state.source !== 'stored-token') return env;
  const token = getStoredOAuthToken();
  if (!token || !env) return env;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

// ─── BEGIN SESSION-AUTH-HOLD (injectable; unit-tested via source extraction) ──

// The block below takes its leaf deps (deps / store / diag / copy helpers) as free vars.

// A held session is a PARKED session held in reducer state (`authHeld`), so a wake cannot resume it and
// the park teardown runs (deny pending fail-closed, abort, clear idle, persist parked) idempotently (H1).
function dispatchHold(s) {
  try { deps.dispatch(s, { type: 'auth_hold' }); } catch (err) { diag('session-auth: hold dispatch failed', err && err.message); }
  try { store.setRecordPhase(s.key, 'parked'); } catch (err) { diag('session-auth: persist failed', err && err.message); }
}

// The preflight verdict. Every spawn is windowless, so `startSession` rolls a held launch back.
function holdMissingCredential(s, state) {
  if (!deps || !s || !state || state.usable !== false) return false;
  diag('session-auth: preflight HOLD — no credential on this machine for', runtimeCopy.runtimeLabel(copyFor(s)));
  s.authHold = { kind: 'preflight' };
  dispatchHold(s);
  return true;
}

// Asks the session's own runtime; no probe, or one that throws, is not a hold (the stream's auth sentinel
// parks it recoverably).
async function holdIfNoRuntimeCredential(s, runtime) {
  if (!runtime || typeof runtime.credentialState !== 'function') return false;
  try {
    return holdMissingCredential(s, await runtime.credentialState());
  } catch (_) {
    return false;
  }
}

// The runtime's normalizer classified a message or rejection as auth-shaped (`auth_hold`); that verdict is
// trusted — core never re-tests one runtime's words (P4-03). Already held CONVERGES rather than returning
// early: re-dispatching is idempotent and guarantees the session ends up parked and held (H1b).
function holdIfAuthFailure(s, _text) {
  if (!deps || !s || s.settled) return false;
  const already = !!s.authHold;
  if (!already) diag('session-auth: auth-shaped SDK failure -> hold');
  s.authHold = s.authHold || { kind: 'error' };
  // Fail closed first; the agent is told in its own runtime's words.
  try { if (deps.denyPending) deps.denyPending(s, runtimeCopy.heldToolDenial(copyFor(s))); } catch (_) { /* best effort */ }
  // The converge case gets no reducer abort, so the handle closes here (P4-14).
  deps.teardown(s);
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  dispatchHold(s);
  return true;
}

const resumeNudgeFor = (s) => runtimeCopy.resumeNudge(copyFor(s));

// Release a hold: the claim of `s.authHold` is the ticket (a second caller finds nothing), `auth_release`
// precedes the steer because wakeEffects refuses while authHeld, and the steer is the ordinary lazy wake.
async function resumeAfterSignIn(s) {
  if (!s.authHold) return;
  s.authHold = null;
  try { deps.dispatch(s, { type: 'auth_release' }); } catch (err) { diag('session-auth: release dispatch failed', err && err.message); }
  // The hold reset Axis B to `ask`; a windowless session has no accept surface, so re-apply the floor (F-236).
  if (s.windowless === true) {
    const floored = floorWindowlessMessage(s.state && s.state.messageMode);
    if (!s.state || s.state.messageMode !== floored) {
      try { deps.dispatch(s, { type: 'set_message_mode', mode: floored }); } catch (_) { /* best effort */ }
    }
  }
  deps.dispatch(s, { type: 'steer', text: resumeNudgeFor(s), priority: 'next' });
}

// ─── END SESSION-AUTH-HOLD ───────────────────────────────────────────────────

// ─── BEGIN AUTH-RESUME-FAN-OUT (injectable; unit-tested via source extraction) ─
// The in-app sign-in's fan-out (each runtime's `credential.signIn`), scoped by runtime (P4-06). It does not re-probe (the
// caller asked once), takes the list before walking it, and resumes each alone so one failure strands none.
async function resumeHeldSessions(runtimeId) {
  const registry = deps && deps.sessions;
  if (!registry || !runtimeId) return 0;
  const held = [];
  for (const s of registry.values()) {
    if (s && !s.settled && s.authHold && copyFor(s).id === runtimeId) held.push(s);
  }
  for (const s of held) {
    try {
      await resumeAfterSignIn(s);
    } catch (err) {
      diag('session-auth: resume after sign-in failed', err && err.message);
    }
  }
  return held.length;
}
// ─── END AUTH-RESUME-FAN-OUT ─────────────────────────────────────────────────

// A runtime with no in-app sign-in, or one declaring `credential.reprobeOnWake` (its credential can come back
// outside Dopl), re-probes on the next message and resumes when it is back (P4-06).
function reprobesOnWake(s) {
  if (!s || s.settled || !s.authHold) return false;
  const d = copyFor(s);
  return !runtimeCopy.canSignIn(d) || !!(d && d.credential && d.credential.reprobeOnWake === true);
}

async function reprobeHeld(s) {
  if (!reprobesOnWake(s)) return false;
  let state = null;
  try { state = await runtimeRegistry.runtimeFor(s.runtimeId).credentialState(); } catch (_) { return false; }
  if (!state || state.usable === false || !s.authHold) return false;
  diag('session-auth: credential is back for', runtimeCopy.runtimeLabel(copyFor(s)), '-> releasing the hold');
  await resumeAfterSignIn(s);
  return true;
}

module.exports = {
  bind,
  credentialState,
  forget,
  withStoredCredential,
  holdIfNoRuntimeCredential,
  holdIfAuthFailure,
  resumeAfterSignIn,
  resumeHeldSessions,
  reprobesOnWake,
  reprobeHeld,
};

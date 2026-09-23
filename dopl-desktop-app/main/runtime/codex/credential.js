// Is this machine signed in to Codex? `codex login status`'s exit code, asked of the SAME private home a
// session runs in (`config-home.js › isolatedEnv`), so it answers for the credential the next session reads.
// A spawn failure or timeout is unknown and fails open — the launch itself fails loudly if signed out.

const configHome = require('./config-home');

const STATUS_TIMEOUT_MS = 5000;
// Same 5s window as the Claude lane's probe cache: a burst of launches spawns one child, not one each.
const CACHE_MS = 5000;

let cached = null; // { at, value }

/** One probe. `opts.userDataRoot` is for tests; production resolves the app's own. */
function probeStatus(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish({ usable: true, source: 'probe-timeout' }), STATUS_TIMEOUT_MS);
    try {
      const { execFile } = require('child_process');
      // The file the probe and spawn use; an unresolvable one stays unknown (`available()` owns that).
      const found = require('./resolve-bin').resolveCodexBin();
      if (!found.ok) { clearTimeout(timer); finish({ usable: true, source: 'probe-unavailable' }); return; }
      const env = configHome.isolatedEnv(o.env || process.env, o.userDataRoot);
      const args = configHome.AUTH_STORE_ARGS.concat(['login', 'status']);
      execFile(found.path, args, { env, timeout: STATUS_TIMEOUT_MS }, (err) => {
        clearTimeout(timer);
        // Spawn failure or timeout → unknown (fail open); a clean non-zero exit → signed out.
        if (err && (err.code === 'ENOENT' || err.code === 'EACCES' || err.killed)) {
          finish({ usable: true, source: 'probe-unavailable' });
          return;
        }
        finish(err
          ? { usable: false, source: 'login-status-nonzero' }
          : { usable: true, source: 'login-status' });
      });
    } catch (_) {
      clearTimeout(timer);
      finish({ usable: true, source: 'probe-threw' });
    }
  });
}

/** `{ usable, source }` — `source` names which answer this is, for the diag line. Async: a child process. */
async function credentialState() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await probeStatus();
  cached = { at: now, value };
  return value;
}

function forget() {
  cached = null;
}

/**
 * The in-app sign-in (`login.js`), then release this runtime's held sessions. `{ ok }` needs BOTH a
 * completed login and a probe that does not say signed out.
 */
async function signIn() {
  let outcome = { ok: false };
  try {
    outcome = await require('./login').signIn();
  } catch (_) { /* a thrown flow is a failed one */ }
  forget(); // the probe is a click-rate cache, and this is the moment it is wrong
  const state = await credentialState();
  if (!outcome.ok || state.usable === false) return { ok: false };
  const resumed = await require('../../session-auth').resumeHeldSessions('codex');
  return { ok: true, resumed };
}

const descriptor = {
  interactiveSignIn: true,
  probe: 'cli-status',
  // The operator's own `codex login` can also restore it, so a held agent re-probes on the next message.
  reprobeOnWake: true,
};

module.exports = { credentialState, forget, probeStatus, signIn, descriptor };

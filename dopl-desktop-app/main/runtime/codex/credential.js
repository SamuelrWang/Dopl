// Is this machine signed in to Codex? `codex login status`'s exit code is the answer (no secret is read);
// a spawn failure or timeout is unknown and fails open — the launch itself fails loudly if signed out.

const STATUS_TIMEOUT_MS = 5000;
// Same 5s window as the Claude lane's probe cache: a burst of launches spawns one child, not one each.
const CACHE_MS = 5000;

let cached = null; // { at, value }

function runStatus() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish({ usable: true, source: 'probe-timeout' }), STATUS_TIMEOUT_MS);
    try {
      const { execFile } = require('child_process');
      // The file the probe and spawn use; an unresolvable one stays unknown (`available()` owns that).
      const found = require('./resolve-bin').resolveCodexBin();
      if (!found.ok) { clearTimeout(timer); finish({ usable: true, source: 'probe-unavailable' }); return; }
      execFile(found.path, ['login', 'status'], { timeout: STATUS_TIMEOUT_MS }, (err) => {
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
  const value = await runStatus();
  cached = { at: now, value };
  return value;
}

// `null` (a declared absence, not a failed flow): `codex login` needs a browser or terminal, not Dopl.
function signIn() {
  return null;
}

const descriptor = {
  // null → no sign-in button; the UI shows a settings pointer instead (hide-on-absent).
  interactiveSignIn: null,
  probe: 'cli-status',
};

module.exports = { credentialState, signIn, descriptor };

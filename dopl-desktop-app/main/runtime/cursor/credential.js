// THE CREDENTIAL LANE — is this machine signed in to THIS runtime?
//
// Two documented credential shapes (`cursor-research.md`): `CURSOR_API_KEY` (user or
// service-account key) and `agent login` / `status`. The env key is checked FIRST (no child
// process); otherwise `cursor-agent status` answers, and no secret is read, printed or returned.
// ⚠ FAILS OPEN ON AN UNEXPECTED ERROR, like the other lanes: the probe is advisory, and a launch
// with a truly missing credential fails loudly and recoverably (`normalize.js`'s auth sentinel).
// ⚠ A CLEAN NON-ZERO EXIT IS AN ANSWER: `status` signals by exit code, so that alone is SIGNED OUT.
// ⚠ A MISSING BINARY IS NOT "SIGNED OUT": delivery is `path` and no `cursor-agent` ships, so a
// machine signed in via `CURSOR_API_KEY` may have no CLI at all.
// ⚠ `signIn()` IS `null`, A DECLARATION: `agent login` drives a browser flow this app cannot
// complete in its own window (§5 item X21), so the UI shows a pointer, never a dead button.
// ⚠ EVERY REQUIRE IS LAZY: `main/runtime/index.js` must stay requireable from plain Node
// (`session-profiles.js` asks the registry for every gate decision).

const STATUS_TIMEOUT_MS = 5000;
// A burst of launches would otherwise spawn one child process each to learn one fact.
const CACHE_MS = 5000;

// The documented environment credential.
const API_KEY_ENV = 'CURSOR_API_KEY';

let cached = null; // { at, value }

function runStatus() {
  return new Promise((resolve) => {
    // ⚠ CHECKED FIRST, WITHOUT A CHILD PROCESS: a key in the environment IS the credential here.
    const key = process.env && process.env[API_KEY_ENV];
    if (typeof key === 'string' && key.trim()) {
      resolve({ usable: true, source: 'api-key-env' });
      return;
    }
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish({ usable: true, source: 'probe-timeout' }), STATUS_TIMEOUT_MS);
    try {
      const { execFile } = require('child_process');
      execFile('cursor-agent', ['status'], { timeout: STATUS_TIMEOUT_MS }, (err) => {
        clearTimeout(timer);
        // ⚠ THREE OUTCOMES, NOT TWO: a spawn failure (no binary, EACCES, killed) is UNKNOWN and
        // fails open; a clean non-zero exit is SIGNED OUT.
        if (err && (err.code === 'ENOENT' || err.code === 'EACCES' || err.killed)) {
          finish({ usable: true, source: 'probe-unavailable' });
          return;
        }
        finish(err
          ? { usable: false, source: 'status-nonzero' }
          : { usable: true, source: 'cli-status' });
      });
    } catch (_) {
      clearTimeout(timer);
      finish({ usable: true, source: 'probe-threw' });
    }
  });
}

/**
 * Is there a usable credential for this runtime on this machine?
 * `{ usable, source }` — `source` names WHICH answer this is, for the diag line.
 * Async: the probe may be a child process.
 */
async function credentialState() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await runStatus();
  cached = { at: now, value };
  return value;
}

/**
 * ⚠ `null`, NOT `{ ok: false }`: an absent capability's method still EXISTS and answers `null`;
 * `{ ok: false }` would be a flow that ran and failed.
 */
function signIn() {
  return null;
}

/** `null`: Dopl holds no Cursor credential of its own. */
function signOut() {
  return null;
}

// Descriptor half.
const descriptor = {
  // ⚠ null => no sign-in button; the UI shows a settings pointer instead (hide-on-absent).
  interactiveSignIn: null,
  probe: 'env-or-cli-status',
};

module.exports = { credentialState, signIn, signOut, descriptor };

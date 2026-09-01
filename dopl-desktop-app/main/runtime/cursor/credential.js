// THE CREDENTIAL LANE — is this machine signed in to THIS runtime, and can we fix it in place?
//
// ⚠ THIS RUNTIME HAS TWO CREDENTIAL SHAPES AND THE RESEARCH NAMES BOTH, which is why this is the
// one adapter whose `envKeys` is not empty. `cursor-research.md` documents `CURSOR_API_KEY` (user
// keys OR service-account keys), an `--api-key` flag, and `agent login` / `logout` / `status`. An
// environment key is a first-class, documented credential here — on the other native runtime the
// research named none, and writing one there would have been a guess dressed as a declaration.
//
// ⚠ THE PROBE IS THE PLATFORM'S OWN. `cursor-agent status` answers exactly the question Dopl
// needs, the same way `codex login status` does, and no secret is read, printed, or returned. The
// env key is checked FIRST because it is the cheaper and stronger answer: a key in the environment
// is a credential this process can see directly, with no child process at all.
//
// ⚠ IT FAILS OPEN ON AN UNEXPECTED ERROR, exactly as both other lanes do. Refusing to launch
// because a probe was unreadable would take the machine off the air for a question that is only
// advisory: the launch itself will fail loudly and recoverably if the credential really is
// missing, and `normalize.js`'s auth sentinel is what catches it there.
// ⚠ BUT A CLEAN NON-ZERO EXIT IS AN ANSWER, NOT AN ERROR. `status` signals through its exit code,
// so a non-zero exit with no spawn failure means SIGNED OUT — the one case reported as unusable.
// ⚠ AND A MISSING BINARY IS NOT "SIGNED OUT". `packaging.delivery` is `path` and this release
// ships no `cursor-agent`, so a machine can be perfectly signed in via `CURSOR_API_KEY` with no
// CLI on PATH at all. Collapsing the two is how a machine with a working credential came to be
// told channel requests could not be answered.
//
// ⚠ AND `signIn()` IS `null`, WHICH IS A DECLARATION AND NOT A GAP. `agent login` drives a browser
// flow; nothing in the research says this app can complete it inside its own window. A capability
// a runtime lacks is HIDDEN, never grayed — so `credential.interactiveSignIn` is `null`, the UI
// shows a pointer instead of a button, and the operator signs in where Cursor expects them to.
// §5 item X21 asks whether a driveable in-place flow exists; until it answers, offering a button
// that opens nothing would be the control that lies.
//
// ⚠ EVERY REQUIRE IS LAZY. `main/runtime/index.js` must stay requireable from a plain Node
// harness, because `main/session-profiles.js` — a pure module two suites evaluate standalone —
// asks the registry for every gate decision.

const STATUS_TIMEOUT_MS = 5000;
// ⚠ THE SAME 5s WINDOW THE OTHER LANES CACHE THEIR PROBE FOR, and for the same reason: triage asks
// this once per pass and a wake storm would otherwise spawn one child process per candidate to
// learn one fact.
const CACHE_MS = 5000;

// The documented environment credential. ⚠ ALSO `descriptor.envKeys`, so the ambient-fence note in
// `launch-spec.js` and this probe cannot disagree about which name is a credential rather than a
// permission knob.
const API_KEY_ENV = 'CURSOR_API_KEY';

let cached = null; // { at, value }

function runStatus() {
  return new Promise((resolve) => {
    // ⚠ CHECKED FIRST AND WITHOUT A CHILD PROCESS. A key in the environment IS the credential on
    // this runtime; asking a CLI that may not be installed about it would be slower and wronger.
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
        // ⚠ THE THREE OUTCOMES ARE NOT TWO. A spawn failure (no binary, EACCES) is UNKNOWN and
        // fails open — this release ships no CLI, so its absence is the EXPECTED state and must
        // never read as "signed out". A clean non-zero exit is SIGNED OUT.
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
 *
 * ⚠ ASYNC, like the other native runtime's and unlike Claude's, because this probe may be a child
 * process rather than a file stat. Every caller in core already awaits or ignores the answer.
 */
async function credentialState() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await runStatus();
  cached = { at: now, value };
  return value;
}

/**
 * ⚠ `null`, NOT `{ ok: false }`. The contract's rule is that a method whose CAPABILITY is absent
 * still EXISTS and answers `null` — a missing method is a broken adapter, a `null` return is a
 * declared absence, and `{ ok: false }` would be a flow that ran and failed. See the header.
 */
function signIn() {
  return null;
}

// Descriptor half.
const descriptor = {
  // ⚠ null => no sign-in button; the UI shows a settings pointer instead (hide-on-absent).
  interactiveSignIn: null,
  probe: 'env-or-cli-status',
  // The sentinels that mean "no credential", in the two shapes they arrive in. ⚠ The in-stream one
  // is a PATTERN and is declared unverified: `normalize.js` owns the matcher, and what a
  // signed-out SDK actually throws is §5 item X18.
  sentinels: ['status-nonzero', 'auth-shaped-error'],
  // ⚠ NOT EMPTY, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE — see the header. This list is
  // read as "the vars a scrub must PRESERVE", and on this runtime there is a documented one.
  envKeys: [API_KEY_ENV],
};

module.exports = { credentialState, signIn, descriptor, API_KEY_ENV, STATUS_TIMEOUT_MS };

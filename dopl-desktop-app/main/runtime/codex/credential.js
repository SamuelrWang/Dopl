// THE CREDENTIAL LANE — is this machine signed in to THIS runtime, and can we fix it in place?
//
// ⚠ THE PROBE IS THE PLATFORM'S OWN, AND THAT IS A REAL IMPROVEMENT OVER THE CLAUDE LANE.
// `codex login status` exits 0 when this machine is logged in (`codex-research.md` §3), which is a
// first-party answer to exactly the question Dopl needs — where the Claude lane has to stat a file
// and read an account id, because opening the credential store pops an OS prompt on a cross-app
// read. So this asks the CLI and stops there; no secret is read, printed, or returned.
//
// ⚠ IT FAILS OPEN ON AN UNEXPECTED ERROR, exactly as the Claude lane does. Refusing to launch
// because a probe was unreadable would take the machine off the air for a question that is only
// advisory: the launch itself will fail loudly and recoverably if the credential really is missing.
// ⚠ BUT A CLEAN NON-ZERO EXIT IS AN ANSWER, NOT AN ERROR. `login status` is documented to signal
// through its exit code, so a non-zero exit with no spawn failure means SIGNED OUT — that is the
// one case this reports as unusable.
//
// ⚠ AND `signIn()` IS `null`, WHICH IS A DECLARATION AND NOT A GAP. `codex login` drives an OAuth
// flow through a browser and `--device-auth` drives a device-code flow through a terminal; neither
// is something this app can complete inside its own window the way it drives the bundled Claude
// binary's sign-in. A capability a runtime lacks is HIDDEN, never grayed — so
// `credential.interactiveSignIn` is `null`, the UI shows a pointer instead of a button, and the
// operator signs in where Codex expects them to. §5 item C20 asks whether a driveable in-place
// flow exists; until it answers, offering a button that opens nothing would be the control that
// lies.
//
// ⚠ EVERY REQUIRE IS LAZY. `main/runtime/index.js` must stay requireable from a plain Node
// harness, because `main/session-profiles.js` — a pure module two suites evaluate standalone —
// asks the registry for every gate decision.

const STATUS_TIMEOUT_MS = 5000;
// ⚠ THE SAME 5s WINDOW THE CLAUDE LANE CACHES ITS PROBE FOR, and for the same reason: a burst of
// launches asks this once each, and without the cache each would spawn one child process to learn
// one fact.
const CACHE_MS = 5000;

let cached = null; // { at, value }

function runStatus() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish({ usable: true, source: 'probe-timeout' }), STATUS_TIMEOUT_MS);
    try {
      const { execFile } = require('child_process');
      execFile('codex', ['login', 'status'], { timeout: STATUS_TIMEOUT_MS }, (err) => {
        clearTimeout(timer);
        // ⚠ THE THREE OUTCOMES ARE NOT TWO. A spawn failure (no binary, EACCES) is UNKNOWN and
        // fails open — `available()` is the probe that owns "is there a codex at all", and
        // collapsing the two is how a machine with a perfectly good binary came to be told
        // channel requests could not be answered. A clean non-zero exit is SIGNED OUT.
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

/**
 * Is there a usable credential for this runtime on this machine?
 * `{ usable, source }` — `source` names WHICH answer this is, for the diag line.
 *
 * ⚠ ASYNC HERE WHERE THE CLAUDE LANE IS SYNCHRONOUS, because this probe is a child process rather
 * than a file stat. Every caller in core already awaits or ignores the answer.
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
  probe: 'cli-status',
  // The sentinels that mean "no credential", in the two shapes they arrive in. ⚠ The in-stream
  // one is a PATTERN and is declared unverified: `normalize.js` owns the matcher, and what a
  // signed-out `codex app-server` actually puts in the stream is §5 item C20.
  sentinels: ['login-status-nonzero', 'auth-shaped-error'],
  // ⚠ EMPTY BECAUSE THE RESEARCH NAMES NONE, NOT BECAUSE NONE EXISTS. `codex-research.md` §3
  // documents `--with-api-key` and `--with-access-token` reading from STDIN, and no environment
  // variable at all. Writing `OPENAI_API_KEY` here would be a guess dressed as a declaration, and
  // this list is read as "the vars a scrub must PRESERVE" — a wrong entry would either preserve
  // something irrelevant or, worse, imply the scrub had been reasoned about when it had not.
  envKeys: [],
};

module.exports = { credentialState, signIn, descriptor };

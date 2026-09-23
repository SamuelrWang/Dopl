// The Codex CLI compatibility floor, and the methods this adapter sends (release-gate data).

// Every method the adapter sends (`launch-spec.js`, `models.js`). A method added there belongs here
// in the same change; `scripts/codex-app-server-schema.js` mirrors it into the fixture and the
// contract suite checks the installed CLI declares every one.
const REQUIRED_METHODS = Object.freeze([
  'initialize', 'thread/start', 'thread/resume',
  'turn/start', 'turn/steer', 'turn/interrupt', 'model/list',
]);

// Measured from `codex-cli 0.155.1` (`npm run codex:schema`); re-measure, never edit by hand. A floor
// only: a newer CLI is not refused, because the method check catches a genuinely incompatible one.
const SUPPORTED_CLI = Object.freeze({ min: '0.155.1', measuredFrom: '0.155.1' });

/** `"codex-cli 0.31.0"` → `[0, 31, 0]`. Returns `null` when no dotted number is present. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Is this `codex --version` output at or above the floor? `{ ok, verdict, reason }`. */
function versionGate(version) {
  const detected = parseVersion(version);
  if (!detected) {
    return { ok: false, verdict: 'unreadable', reason: `Dopl could not read a Codex version out of \`${version}\`.` };
  }
  if (compareVersion(detected, parseVersion(SUPPORTED_CLI.min)) < 0) {
    return {
      ok: false,
      verdict: 'too-old',
      reason: `Codex ${version} is older than the ${SUPPORTED_CLI.min} this Dopl build supports. Upgrade the Codex CLI.`,
    };
  }
  return { ok: true, verdict: 'supported', reason: '' };
}

module.exports = { REQUIRED_METHODS, SUPPORTED_CLI, parseVersion, versionGate };

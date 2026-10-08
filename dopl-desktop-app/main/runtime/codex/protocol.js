// The Codex CLI compatibility floor, and the methods this adapter sends (release-gate data).

// Every method the adapter sends (`launch-spec.js`, `models.js`). A method added there belongs here
// in the same change; `scripts/codex-app-server-schema.js` mirrors it into the fixture and the
// contract suite checks the installed CLI declares every one. (The LIVE check is `required-shape.js`.)
const REQUIRED_METHODS = Object.freeze([
  'initialize', 'thread/start', 'thread/resume',
  'turn/start', 'turn/steer', 'turn/interrupt', 'model/list', 'mcpServerStatus/list',
  'account/login/start', 'account/login/cancel', 'config/read',
]);

// The CLI this adapter was built and measured against (`npm run codex:schema`); re-measure, never edit by
// hand. A RECORD, NOT A GATE (2026-10-08): it pins packaging (`packaging.js › versionPin`), and nothing
// refuses a build for its version — the shape gate (`shape.js`, `required-shape.js`) does, from the build's
// own protocol description.
const SUPPORTED_CLI = Object.freeze({ measuredFrom: '0.155.1' });

/** `"codex-cli 0.31.0"` → `[0, 31, 0]`. Returns `null` when no dotted number is present. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

/** Can Dopl read a version out of this `codex --version` output? `{ ok, verdict, reason }`. A version Dopl
 *  cannot read is no build identity (nothing is keyed or reused for it), so it is refused here. */
function versionGate(version) {
  if (!parseVersion(version)) {
    return { ok: false, verdict: 'unreadable', reason: `Dopl could not read a Codex version out of \`${version}\`.` };
  }
  return { ok: true, verdict: 'readable', reason: '' };
}

module.exports = { REQUIRED_METHODS, SUPPORTED_CLI, parseVersion, versionGate };

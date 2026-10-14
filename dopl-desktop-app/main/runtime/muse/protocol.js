// The Muse Session Protocol (MSP) facts this adapter sends, and the version read (release-gate data).

// Every method the adapter sends (`launch-spec.js`, `approval.js`, `models.js`, `login.js`). A method added
// there belongs here in the same change. (The LIVE check is `required-shape.js` against the build's own
// `muse schema` export, `shape.js`.) `account/*` are experimental-surface methods: `client.js` opts in.
const REQUIRED_METHODS = Object.freeze([
  'initialize', 'session/start', 'session/resume', 'turn/start', 'turn/interrupt', 'approval/decide',
  'model/list', 'account/read', 'account/loginStart', 'account/loginCancel',
]);

// The build this adapter was measured against (muse 1.4.7-R6101.1, darwin arm64, 2026-10-13). A RECORD,
// NOT A GATE: protocol fit is the shape gate's question (`shape.js`, `required-shape.js`).
const SUPPORTED_CLI = Object.freeze({ measuredFrom: '1.4.7-R6101.1', schemaVersion: 1 });

// The envelope version Dopl reads (`initialize › schema.version`); the fingerprint changes per release
// and is only recorded (the TS SDK treats a fingerprint mismatch as a warning, measured in its source).
const SCHEMA_VERSION = 1;

/** `"Muse Code 1.4.7 (1.4.7-R6101.1)"` → `[1, 4, 7]`, or null when no dotted number is present. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

/** The full release string (`1.4.7-R6101.1`) when `--version` prints one, else the dotted triple. */
function releaseOf(text) {
  const t = String(text || '');
  const full = /\((\d+\.\d+\.\d+-R[0-9.]+)\)/.exec(t) || /\b(\d+\.\d+\.\d+-R[0-9.]+)\b/.exec(t);
  if (full) return full[1];
  const v = parseVersion(t);
  return v ? v.join('.') : null;
}

/** Can Dopl read a version out of this `muse --version` output? `{ ok, verdict, reason }`. */
function versionGate(version) {
  if (!parseVersion(version)) {
    return { ok: false, verdict: 'unreadable', reason: `Dopl could not read a Muse version out of \`${version}\`.` };
  }
  return { ok: true, verdict: 'readable', reason: '' };
}

/** Refuse an `initialize` answer whose envelope this adapter cannot read. */
function assertSchema(init) {
  const v = init && init.schema && init.schema.version;
  if (v !== SCHEMA_VERSION) {
    throw new Error(`Muse answered protocol envelope version ${JSON.stringify(v)}; this Dopl reads version ${SCHEMA_VERSION}.`);
  }
}

module.exports = { REQUIRED_METHODS, SUPPORTED_CLI, SCHEMA_VERSION, parseVersion, releaseOf, versionGate, assertSchema };

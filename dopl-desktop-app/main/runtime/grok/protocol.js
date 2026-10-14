// The Agent Client Protocol (ACP v1) facts this adapter sends to `grok agent --no-leader stdio`, and the
// version read (release-gate data). Grok's extension methods are wire-prefixed `_x.ai/…` (`x.ai/models/list`
// answers -32601; `_x.ai/models/list` works — LIVE, `g2-init-new.ndjson`).

// Every method the adapter SENDS (`client.js`, `launch-spec.js`, `models.js`). A method added there belongs
// here in the same change. (The live check is `required-shape.js` against the build's own `initialize`
// answer, `shape.js`.) `session/cancel` is a NOTIFICATION — as a request it is -32601 (LIVE).
const REQUIRED_METHODS = Object.freeze([
  'initialize', 'session/new', 'session/load', 'session/prompt', 'session/cancel',
  'session/set_config_option', '_x.ai/interject', '_x.ai/models/list',
]);

// The server→client requests Dopl answers (`approval.js`). Anything else is shown and refused.
const SERVER_REQUESTS = Object.freeze({
  PERMISSION: 'session/request_permission',
  HOOK: '_x.ai/hooks/run',
});

// The build this adapter was measured against (grok 1.0.52 (0920c8169e27), macOS aarch64, 2026-10-13). A
// RECORD, NOT A GATE: protocol fit is the shape gate's question (`shape.js`, `required-shape.js`).
const SUPPORTED_CLI = Object.freeze({ measuredFrom: '1.0.52 (0920c8169e27)', protocolVersion: 1 });

// The ACP major version Dopl speaks and reads back (`initialize.result.protocolVersion`).
const PROTOCOL_VERSION = 1;

/** `"grok 1.0.52 (0920c8169e27)"` → `[1, 0, 52]`, or null when no dotted number is present. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

/** The release string `1.0.52`, or null. */
function releaseOf(text) {
  const v = parseVersion(text);
  return v ? v.join('.') : null;
}

/** Can Dopl read a version out of this `grok --version` output? `{ ok, verdict, reason }`. */
function versionGate(version) {
  if (!parseVersion(version)) {
    return { ok: false, verdict: 'unreadable', reason: `Dopl could not read a Grok version out of \`${version}\`.` };
  }
  return { ok: true, verdict: 'readable', reason: '' };
}

/** Refuse an `initialize` answer in a protocol version this adapter cannot read. */
function assertProtocol(init) {
  const v = init && init.protocolVersion;
  if (v !== PROTOCOL_VERSION) {
    throw new Error(`Grok answered ACP protocol version ${JSON.stringify(v)}; this Dopl reads version ${PROTOCOL_VERSION}.`);
  }
}

module.exports = {
  REQUIRED_METHODS, SERVER_REQUESTS, SUPPORTED_CLI, PROTOCOL_VERSION, parseVersion, releaseOf, versionGate, assertProtocol,
};

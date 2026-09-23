// RUNTIME-OWNED COPY — every operator-facing sentence about a runtime, built from that runtime's own
// descriptor (`label`) instead of one vendor's name. No per-runtime branch and no vendor literal:
// `test/runtime-copy.test.mjs` scans this source. `''` from `named` is the UNKNOWN answer, and each
// sentence carries its own unnamed form. Electron-free (`session-profiles.js` reaches the registry).

const capability = require('./capability');

function named(descriptor) {
  return descriptor && typeof descriptor.label === 'string' ? descriptor.label.trim() : '';
}

/** The runtime's own name for itself; never a vendor literal and never an id. */
function runtimeLabel(descriptor) {
  return named(descriptor) || 'the agent runtime';
}

/** Can Dopl drive this runtime's sign-in from inside the app? The one reader of `interactiveSignIn`. */
const canSignIn = (d) => !!(d && d.credential && d.credential.interactiveSignIn);

/** The sign-in action's label, or `null` when there is no in-app flow (hide, never gray). */
function signInAction(descriptor) {
  return canSignIn(descriptor) ? `Sign in to ${runtimeLabel(descriptor)}` : null;
}

// ── THE STRUCTURED RUNTIME ERROR CODES ───────────────────────────────────────────────────────
//
// A closed, vendor-neutral set: the CODE crosses the boundary and the sentence is rebuilt here at
// render time. An unknown code renders the generic sentence, never a raw key.
const RUNTIME_ERROR_CODES = [
  'runtime-missing',      // nothing of this runtime could be resolved on this machine
  'runtime-signed-out',   // resolved, but this machine holds no credential for it
  'runtime-incompatible', // resolved and signed in, but it speaks a protocol this build does not
  'runtime-start-failed', // the child could not be started at all
  'runtime-crashed',      // it started and then the stream ended with an error
  'runtime-interrupted',  // Dopl stopped it (quit, restart, operator End)
  'mcp-unreachable',      // the Dopl MCP server did not connect for this session
  'resume-refused',       // a capability refusal — the conversation cannot be continued
];

const ERROR_BODIES = {
  'runtime-missing': (n) => `No ${n} runtime was found on this Mac, so this agent could not start.`,
  'runtime-signed-out': (n) => `This Mac is not signed in to ${n}. That is separate from your Dopl login. Sign in and the request runs.`,
  'runtime-incompatible': (n) => `The ${n} installed on this Mac is not a version Dopl can drive. Update it and try again.`,
  'runtime-start-failed': (n) => `Dopl could not start ${n} on this Mac.`,
  'runtime-crashed': (n) => `${n} stopped answering and the agent ended.`,
  'runtime-interrupted': (n) => `Dopl stopped this ${n} agent.`,
  'mcp-unreachable': (n) => `${n} could not reach Dopl's own tools, so the agent ended rather than running without them.`,
  'resume-refused': (n) => `Dopl will not continue this ${n} conversation.`,
};

const isRuntimeErrorCode = (code) => RUNTIME_ERROR_CODES.indexOf(code) !== -1;

/**
 * One structured runtime error in this runtime's words: `{ code, title, body, action, detail }`.
 * `action` only on the signed-out code and only with an in-app flow. `detail` is the producer's own
 * sentence, passed through unparsed; the producers are the redaction boundary.
 */
function errorCopy(descriptor, code, detail) {
  const name = runtimeLabel(descriptor);
  const known = isRuntimeErrorCode(code);
  const body = known
    ? ERROR_BODIES[code](name)
    : `${name} stopped answering and the agent ended.`;
  return {
    code: known ? code : null,
    title: `${name} could not finish`,
    body: body,
    action: code === 'runtime-signed-out' ? signInAction(descriptor) : null,
    detail: typeof detail === 'string' && detail ? detail : null,
  };
}

/** What an awaited tool promise is denied with while the session is held. The AGENT reads this. */
function heldToolDenial(descriptor) {
  return `Sign in to ${runtimeLabel(descriptor)} to continue`;
}

/** The steer a session is woken with once the credential is back. */
function resumeNudge(descriptor) {
  return `${runtimeLabel(descriptor)} sign-in is restored on this Mac. Continue where you left off.`;
}

/**
 * Why a running agent's model cannot be switched on this runtime (`null` when it can). It asks
 * `capability.canSwitchModelLive` rather than re-reading the field; `'unverified'` and `false` get
 * different words.
 */
function liveModelSwitchRefusal(descriptor) {
  if (capability.canSwitchModelLive(descriptor)) return null;
  const declared = descriptor && descriptor.session ? descriptor.session.liveModelSwitch : null;
  const name = runtimeLabel(descriptor);
  return declared === 'unverified'
    ? `Switching the model of a running ${name} agent has not been measured, so Dopl will not claim it worked. Start a new agent on the model you want.`
    : `${name} cannot change a running agent's model. Start a new agent on the model you want.`;
}

/** "This machine cannot run an agent at all", in the selected runtime's words. One short line. */
function noRuntimeCopy(descriptor) {
  const name = named(descriptor);
  return name ? `No ${name} runtime on this Mac` : 'No agent runtime on this Mac';
}

module.exports = {
  runtimeLabel,
  canSignIn,
  RUNTIME_ERROR_CODES,
  errorCopy,
  heldToolDenial,
  resumeNudge,
  liveModelSwitchRefusal,
  noRuntimeCopy,
};

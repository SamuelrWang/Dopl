// RUNTIME-OWNED COPY — every operator-facing sentence about a RUNTIME, built from that
// runtime's own descriptor instead of from one vendor's name (2026-09-21, U10).
//
// ⚠ WHY THIS FILE EXISTS. Core said `No Claude runtime on this Mac` and `Sign in to Claude` on
// paths every runtime reaches. A signed-out Codex session therefore told the operator to sign in
// to Claude, and a machine with a perfectly good Codex install was told it had no runtime — two
// sentences that are not merely wrong but ACTIONABLY wrong: they send the operator to fix a
// credential the session does not use. The plan's verification bar is that a search of shared
// UI/core paths finds no hardcoded Claude error copy outside Claude-OWNED adapter and sign-in
// surfaces, and this module is where the shared half went.
//
// ⚠ IT IS A SIBLING OF `capability.js`, NOT A PART OF IT, and the seam is reason-to-change:
// `capability.js` answers what an ABSENT capability means to a CONTROL; `selection-vocabulary.js`
// answers what a DURABLE LAUNCH SELECTION is validated against; this answers WHAT THE OPERATOR IS
// TOLD when a runtime refuses, is missing, is signed out, or dies. Those three clocks are
// independent and `capability.js` is at its own §1 ceiling of reasons already.
//
// ⚠ EVERY SENTENCE IS BUILT FROM `descriptor.label`, WHICH IS THE ADAPTER'S OWN WORD FOR ITSELF.
// There is deliberately NO per-runtime branch and no vendor literal anywhere below —
// `test/runtime-copy.test.mjs` scans this file's source for one — so a FOURTH adapter gets
// correct copy by registering, not by someone remembering to add an arm here.
//
// ⚠ AND THE ACTION IS A CAPABILITY, NOT A STRING. `credential.interactiveSignIn` is `true` only
// on a runtime Dopl can actually drive a sign-in for; the others answer `null`, and the rule for
// an absent capability is HIDE, NEVER GRAY (`capability.js`'s header). So `signInAction` answers
// `null` there and a surface renders the sentence with NO button, instead of a button that opens
// nothing. `capability.js › hasInteractiveSignIn` is the predicate; this is its copy.
//
// ⚠ NOTHING HERE READS A STORE, A FILE, THE ENVIRONMENT OR THE NETWORK, and it requires nothing —
// so `main/session-profiles.js` (a pure module two suites evaluate standalone) can keep reaching
// the registry, and a renderer-side mirror can be held equal to it by a test rather than by
// discipline (`src/features/channels/lib/runtime-copy.ts`).

/**
 * The descriptor's own label, or `''` when there is none.
 *
 * ⚠ THE EMPTY STRING IS THE **UNKNOWN** ANSWER AND EVERY SENTENCE BELOW BRANCHES ON IT (INVARIANTS
 * §11: unknown is not empty). A descriptor nobody sent is the plain-browser / older-desktop case,
 * and inventing a name there is the exact defect this module removes — but so is grafting a
 * placeholder into a sentence built for a real one ("No the agent runtime runtime on this Mac").
 * Each sentence therefore carries its OWN unnamed form, worded to read.
 */
function named(descriptor) {
  return descriptor && typeof descriptor.label === 'string' ? descriptor.label.trim() : '';
}

/** The runtime's own name for itself. ⚠ NEVER a vendor literal and never an id: `label` is the
 *  one field `contract.js › descriptorProblems` already refuses to register an adapter without. */
function runtimeLabel(descriptor) {
  return named(descriptor) || 'the agent runtime';
}

/** Can Dopl drive this runtime's sign-in from inside the app? Mirrors `capability.js`. */
const canSignIn = (d) => !!(d && d.credential && d.credential.interactiveSignIn);

/**
 * The SIGN-IN ACTION's label, or `null` when this runtime has no in-app flow.
 *
 * ⚠ `null` IS THE POINT. Codex declares `interactiveSignIn: null` because `codex login` drives an
 * OAuth flow Dopl cannot complete in its own window; a button there would be a control that lies.
 * The SENTENCE still gets said ({@link signedOutBody}) — what is hidden is the affordance.
 */
function signInAction(descriptor) {
  return canSignIn(descriptor) ? `Sign in to ${runtimeLabel(descriptor)}` : null;
}

/** The in-flight label while that flow is open. `null` for the same reason. */
function signInWorking(descriptor) {
  return canSignIn(descriptor) ? `Opening the ${runtimeLabel(descriptor)} sign-in…` : null;
}

/**
 * Where the operator signs in when Dopl cannot do it for them.
 * ⚠ IT NAMES NO COMMAND. A command is a runtime FACT this module does not hold and must not
 * guess — the adapter's own diagnostics carry one if it has one.
 */
function signInPointer(descriptor) {
  return `Sign in to ${runtimeLabel(descriptor)} the way ${runtimeLabel(descriptor)} expects, then try again.`;
}

// ── THE STRUCTURED RUNTIME ERROR CODES ───────────────────────────────────────────────────────
//
// ⚠ A CLOSED, VENDOR-NEUTRAL SET, AND THE CODE IS WHAT TRAVELS. A generic SDK string is not
// something a surface can branch on, count, or translate; it is also the one thing that carries a
// vendor's words into a projection every runtime shares. So the CODE crosses the boundary and the
// SENTENCE is rebuilt here from the descriptor at the moment of rendering — which is what makes a
// Codex failure readable as a Codex failure on a row that was frozen before anyone asked.
//
// ⚠ THE SET IS CLOSED ON PURPOSE, exactly like the reducer's event vocabulary and the seven-word
// refusal wire: an unknown code renders the GENERIC sentence rather than a raw key, and a new code
// is a change here plus its producer, never a string a producer invents.
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

// ⚠ TEMPLATES OVER `label`, NOT SENTENCES. Every body below is a function of the runtime's own
// name, so the table has one row per CONDITION and zero rows per runtime.
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

/** Is this one of the codes above? ⚠ An unknown one is not an error here — it is the GENERIC
 *  arm, because a projection frozen by a newer build must not render a raw key at an operator. */
const isRuntimeErrorCode = (code) => RUNTIME_ERROR_CODES.indexOf(code) !== -1;

/**
 * ONE STRUCTURED RUNTIME ERROR, in this runtime's words.
 *
 * `{ code, title, body, action, detail }` — `action` is `null` on every runtime with no in-app
 * sign-in and on every code that a sign-in would not fix, which is the hide-never-gray rule
 * applied to a remedy instead of to a control.
 *
 * ⚠ `detail` IS PASSED THROUGH, NEVER PARSED. It is the adapter's own sentence (a resume refusal,
 * a resolver's reason) and it is the one part of this shape allowed to name a runtime, because it
 * came FROM one. ⚠ It is also the one part that must never carry a token, a prompt, an approval
 * payload or a full filesystem path — the producers are the redaction boundary, not this.
 */
function errorCopy(descriptor, code, detail) {
  const name = runtimeLabel(descriptor);
  const known = isRuntimeErrorCode(code);
  const body = known
    ? ERROR_BODIES[code](name)
    // ⚠ THE GENERIC ARM NAMES THE RUNTIME AND NOT THE CONDITION. A build that does not know the
    // code still knows whose failure it was, which is the half that was missing before.
    : `${name} stopped answering and the agent ended.`;
  return {
    code: known ? code : null,
    title: `${name} could not finish`,
    body: body,
    // A sign-in only remedies the signed-out condition. Offering it under "crashed" would send
    // the operator to fix something that is not broken.
    action: code === 'runtime-signed-out' ? signInAction(descriptor) : null,
    detail: typeof detail === 'string' && detail ? detail : null,
  };
}

// ── THE AUTH HOLD ────────────────────────────────────────────────────────────────────────────
//
// ⚠ THREE CREDENTIALS, ONE OF WHICH MATTERS, and the copy has to name it (the argument is
// `claude/credential.js`'s and it is TRUE OF EVERY RUNTIME): operators conflate their Dopl login,
// the vendor's desktop app login, and the CLI credential held by THIS Mac. A spawned session
// rides the third and nothing else, which is why every sentence below says "this Mac" and none of
// them says "not logged in".

/** The banner an auth hold paints, as data. `action` is `null` where there is no in-app flow. */
function authHoldCopy(descriptor, kind) {
  const name = runtimeLabel(descriptor);
  const preflight = kind !== 'error';
  return {
    title: `${name} sign-in needed on this Mac`,
    body: preflight
      ? `This session has not started. Your agent signs in to ${name} separately from Dopl, and this Mac has no ${name} sign-in yet. Sign in and the request runs.`
      : `The session paused because this Mac is not signed in to ${name}. This is separate from your Dopl login. Sign in and the session picks up where it stopped.`,
    action: signInAction(descriptor) || signInPointer(descriptor),
    // ⚠ WHETHER THE ACTION IS A BUTTON. A surface must not infer it from the string.
    actionable: canSignIn(descriptor),
  };
}

/**
 * What an AWAITED TOOL PROMISE is denied with while the session is held.
 * ⚠ THE AGENT READS THIS, not the operator, and it is still runtime-honest: an agent told to sign
 * in to a runtime it is not running on has been handed a false statement about its own machine.
 */
function heldToolDenial(descriptor) {
  return `Sign in to ${runtimeLabel(descriptor)} to continue`;
}

/** The steer a session is woken with once the credential is back. */
function resumeNudge(descriptor) {
  return `${runtimeLabel(descriptor)} sign-in is restored on this Mac. Continue where you left off.`;
}

/**
 * Why a RUNNING agent's model cannot be switched on this runtime. `null` when it can.
 *
 * ⚠ THE TWIN OF `capability.js › interruptRefusal`, AND IT REFUSES A CONTROL RATHER THAN A LAUNCH.
 * It exists because `capability.js › canSwitchModelLive` had no consumer in `main/` at all: a
 * runtime whose live handle has no model verb was still RECORDED as switched, which is the one
 * thing `session-reopen.js › setModelByTask`'s own header forbids ("a recorded pick nothing
 * applied is a lie") — and the recorded value is what the NEXT launch assembly reads.
 * ⚠ `'unverified'` AND `false` GET DIFFERENT WORDS ON PURPOSE: one is a measurement nobody took
 * and the other is a measurement that came back no, and the operator can act on the difference
 * (report it, or stop asking).
 */
function liveModelSwitchRefusal(descriptor) {
  const declared = descriptor && descriptor.session ? descriptor.session.liveModelSwitch : null;
  if (declared === true) return null;
  const name = runtimeLabel(descriptor);
  return declared === 'unverified'
    ? `Switching the model of a running ${name} agent has not been measured, so Dopl will not claim it worked. Start a new agent on the model you want.`
    : `${name} cannot change a running agent's model. Start a new agent on the model you want.`;
}

/** "This machine cannot run an agent at all", in the selected runtime's words.
 *  ⚠ ONE SHORT LINE, per the minimal-copy ruling — a label, not an explanation. */
function noRuntimeCopy(descriptor) {
  const name = named(descriptor);
  return name ? `No ${name} runtime on this Mac` : 'No agent runtime on this Mac';
}

/**
 * The signed-out fact, as a launch refusal beside a button the operator just pressed.
 * ⚠ THE SENTENCE DOES NOT DEPEND ON THERE BEING A BUTTON. `signInAction` is `null` on a runtime
 * with no in-app flow, and the operator still has to be told which credential is missing.
 */
function signedOutLaunchCopy(descriptor) {
  const name = named(descriptor);
  return name ? `Sign in to ${name} to start an agent` : 'Sign in to your agent runtime to start an agent';
}

module.exports = {
  named, // '' when the descriptor carried no label — the UNKNOWN answer every sentence branches on
  runtimeLabel,
  canSignIn,
  signInAction,
  signInWorking,
  signInPointer,
  RUNTIME_ERROR_CODES,
  isRuntimeErrorCode,
  errorCopy,
  authHoldCopy,
  heldToolDenial,
  resumeNudge,
  liveModelSwitchRefusal, // U10: `capability.js › canSwitchModelLive`'s first consumer's sentence
  noRuntimeCopy,
  signedOutLaunchCopy,
};

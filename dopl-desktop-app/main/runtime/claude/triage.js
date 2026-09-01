// THE TRIAGE LAUNCH SHAPE — ⚠ A SECOND SPAWN SHAPE, WITH ITS OWN FENCE, AND IT IS NOT A SESSION.
//
// ⚠ MOVED HERE FROM `main/session-triage.js › triageOptions` ON 2026-08-31 (runtime-adapter port,
// step 3 / §2.3 item 7). It was the SECOND independent assembly of a run on this platform and the
// first design draft missed it entirely — which matters because every field in it is a FENCE, and
// a fence that only one of two spawn shapes applies is not a fence. What stayed in core is the
// CLAIMING logic: the timeout, the concurrency, the tie-break by spawn order and the budget
// ceiling are all Dopl's and identical on any runtime.
//
// ── THE FENCE ────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS RUN READS GUEST TEXT AND MUST NOT BE ABLE TO ACT ON IT. Four layers, each closing a
// different door, and `descriptor.triage` declares every one so a future runtime cannot ship this
// call with a layer silently missing:
//   mcpServers: {}      no Dopl server at all — no channel read, no post, no knowledge, and
//                       nothing to stamp a workspace against. A triage run cannot reach Dopl.
//   canUseTool: deny    EVERY tool call is refused. ⚠ THIS IS THE LOAD-BEARING ONE: this platform
//                       has no "offer no tools" option (`options.tools = []` means NO BOUND, i.e.
//                       everything), so the positive bound cannot express what is wanted here and
//                       the gate has to. A runtime with no equivalent declares
//                       `triage.toolSurface: 'none'` and means it, or it does not run triage.
//   maxTurns: 1         one assistant turn. Even a denied tool call cannot be retried.
//                       ⚠ `triage.turnBound: null` IS LAUNCH-BLOCKING: an unbounded triage turn
//                       reading untrusted text is an unfenced one.
//   permissionMode      pinned + `settingSources: []`, so no local settings file and no
//                       permission-mode knob can short-circuit that gate. The scrubbed env
//                       already drops the env knobs and closes the account-connector lane.
// ⚠ `disallowedTools` CARRIES THE CREDENTIAL-PATH RULES ANYWAY, belt to the gate's braces: a
// pre-approved read is SHADOWED past the gate in a real session, and copying the deny list costs
// nothing and cannot become the one difference that matters.
// ⚠ THE cwd IS THE OS TEMP DIR, NOT THE CHANNEL FOLDER. A real session gets the operator's chosen
// working directory; the router has no business knowing it exists, and no tool with which to look.
//
// ⚠ IT REUSES THE SESSION CREDENTIAL PATH RATHER THAN AN API KEY, and that is a rule, not a
// convenience: THE DESKTOP HAS NO API KEY AND MUST NOT ACQUIRE ONE. Triage authenticates exactly
// as a session does, so there is one credential story, one place it can break, and a signed-out
// Mac produces no triage rather than a second, differently-shaped auth failure.

const os = require('os');

// ⚠ EVERY REQUIRE HERE IS LAZY, AND IT IS A LOAD-ORDER CONTRACT. `session-auth.js` reads
// `session-profiles.js`, which asks `main/runtime/index.js` for every gate decision — so a
// top-level require would close that loop and leave the registry half-built at exactly the
// moment a gate asks it for a deny list. `loader.js` pulls `electron` besides.
const loader = () => require('./loader');
const sessionAuth = () => require('../../session-auth');
const sessionModel = () => require('../../session-model');

// ⚠ THE DATED ID IS THE RULING'S OWN VALUE and it is coerced through the frozen table rather than
// spelled as argv. `session-model.js › aliasForModelId` maps it to the alias the bundled CLI
// resolves — that module's header explains why an alias is what reaches a child process, and why
// this exact id is the lossy row in that map. Naming the id here and the alias there is what keeps
// the ruling's value and the argv-safe value from drifting into two literals.
// ⚠ NEVER INHERITED FROM THE SESSION PICKER. A router question is not the agent's work, and
// spending the operator's chosen model on it would make the tier's cost ceiling meaningless.
const TRIAGE_MODEL_ID = 'claude-haiku-4-5-20251001';

/** The options ONE triage call runs with. Every field here is a fence — see the header. */
function triageOptions(abortController) {
  const options = {
    cwd: os.tmpdir(), // never the channel folder
    model: sessionModel().aliasForModelId(TRIAGE_MODEL_ID),
    maxTurns: 1,
    allowedTools: [], // nothing SHADOWED past the gate
    disallowedTools: loader().buildSecretPathDenyRules(),
    mcpServers: {}, // no dopl surface at all
    settingSources: [],
    permissionMode: 'default',
    env: sessionAuth().withStoredCredential(loader().buildScrubbedEnv()),
    abortController: abortController,
    includePartialMessages: false,
    // ⚠ THE ONLY THING THAT CAN EXPRESS "no tools" — see THE FENCE. Async because the platform
    // awaits it; the shape is the gate's own deny branch.
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'triage runs no tools' }),
  };
  const bin = loader().resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  return options;
}

/** The text the model answered, or '' — the ONE place a raw model string is read. */
function answerText(msg) {
  if (!msg || msg.type !== 'result') return '';
  if (msg.subtype !== 'success') return ''; // an error result is a PASS, like everything else
  return typeof msg.result === 'string' ? msg.result : '';
}

/**
 * ONE triage run, as a two-verb handle core drives.
 *
 * ⚠ `start()` AND `answerText()` ARE THE ONLY THINGS CORE TOUCHES. Everything else about the call
 * — the model, the fence, the prompt mode (this runtime takes a plain string here, unlike every
 * real session's streaming iterable) — is inside. The claim/pass verdict, the 8s bound, the
 * concurrency and the deterministic tie-break stay in `main/session-triage.js`, which is what
 * makes them identical on every runtime.
 */
function triageSpec(request) {
  const req = request || {};
  const options = triageOptions(req.abortController);
  return {
    start() {
      return loader().peekSdk().query({ prompt: req.prompt, options });
    },
    answerText,
    options, // read only by the fence tests, never by the claiming logic
  };
}

// Descriptor half — ⚠ every field is a fence, declared so a missing one is a REFUSAL and not a
// quiet gap. `main/runtime/contract.js` and the conformance suite read this.
const descriptor = {
  model: TRIAGE_MODEL_ID,
  turnBound: 1, // null would be launch-blocking: an unbounded triage turn is an unfenced one
  cwdFence: 'tmp', // never the channel folder
  toolSurface: 'deny-callback', // this runtime cannot express "no tools" any other way
  mcpSurface: 'none', // the empty set, expressible here; null would mean "no way to say it"
  ambientIsolation: true, // settingSources: [] — no operator settings file is read
  envScrub: true,
};

module.exports = { triageSpec, triageOptions, answerText, TRIAGE_MODEL_ID, descriptor };

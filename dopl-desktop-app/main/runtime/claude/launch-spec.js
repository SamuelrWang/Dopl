// THE LAUNCH SHAPE — ⚠ THE ONE ASSEMBLY POINT FOR EVERY SPAWN ON THIS RUNTIME.
//
// ⚠ MOVED HERE FROM `main/session-query.js › buildSdkOptions` ON 2026-08-31 (runtime-adapter
// port, step 3). What changed is that core no longer knows what is IN the object:
// `buildLaunchSpec` answers an OPAQUE payload and `start` / `resume` are the only things that
// open it.
//
// ⚠ THIS HEADER CLAIMED "byte-identical to what shipped" AND THE CLAIM WAS RETRACTED 2026-09-01.
// It was false of this very file: `buildOptions` appended two tool names to `allowedTools` and
// mounted a second MCP server that DOES NOT EXIST AT HEAD. The honest statement for the port is
// BEHAVIOUR-PRESERVING WITH SEVEN DECLARED OBSERVABLE DIFFERENCES, and the enumerated list is
// `docs/INVARIANTS.md` §11.0g — read it before assuming an existing Claude session behaves as it
// did. ⚠ "byte-identical" IS AN INSTRUCTION NOT TO LOOK, which is exactly why it may not be
// asserted by a file that has drifted; what IS still true of this file is narrower and is stated
// below. The pins, the ordering and the gate wiring below really did move unchanged.
//
// SECURITY: fresh launch, parked resume, recreated shell and post-sign-in relaunch ALL come
// through here, so the pre-approval shadow rule, the held gate, the scrubbed env, the deny list,
// the ambient-config isolation and the pinned permission mode hold identically on all of them.
// `options.resume` is the only field that ever differs between a cold launch and a resume.
//
// ⚠ THE THREE PINS THAT ARE NOT PREFERENCES:
//   `settingSources: []`      the operator's global allow-list can never shadow a gate. It also
//                             makes this runtime's own connector kill-switch unreadable, which is
//                             why the env var below exists — tightening the sandbox removed the
//                             switch.
//   `permissionMode: 'default'` any wider mode STOPS THE PLATFORM CALLING THE GATE AT ALL, which
//                             kills the outbound consent card and the hard-deny path together.
//                             This is why Dopl's widest Axis-A mode is not the platform's bypass.
//   `includePartialMessages: false` the outbound card shows the operator the bytes a post will
//                             send, so a streamed tool input must be the WHOLE, FINAL input. And
//                             NO input-rewriting hook layer is ever set: a second rewriter could
//                             change the input the card already painted.

const loader = require('./loader');
const tools = require('./tools');
const axisB = require('./axis-b');
const agentOps = require('../../agent-self-ops');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionAuth = require('../../session-auth');
const sessionOutbound = require('../../session-outbound');
const sessionModel = require('../../session-model');
const sessionCredential = require('../../session-credential');
const { diag } = require('../../diag');

function buildOptions(s, dispatch, emitQuiet) {
  const cfg = tools.buildSessionToolConfig(s.profile);
  const options = {
    // Item 7: the per-channel folder (else ~/Downloads) as the cwd. Context (§H-9), not a fence.
    cwd: channelDirs.sessionSpawnDir(s.channelId),
    // ⚠ THE PROFILE'S LIST, WHOLE AND UNEXTENDED. This read `cfg.preApproved.concat(agentOps
    // .AGENT_OPS_TOOL_NAMES)` until 2026-09-01 (D7.2): the two agent-ops verbs were appended HERE,
    // downstream of the table, so they were shadowed past `canUseTool` on every profile —
    // `read_only` included — without appearing in the table the descriptor mirrors, the deepEqual
    // pins read, or `grantDecision` consults. They are now declared per profile in `tools.js ›
    // buildSessionToolConfig` (see its AGENT-OPS note), which is where a deny list can refuse one.
    // ⚠ NOTHING MAY BE ADDED TO THIS LINE. An `allowedTools` entry the profile table does not
    // declare is a shadow no profile can refuse, which is the whole of the defect above.
    allowedTools: cfg.preApproved, // pre-approved => SHADOWED, no button (§A.5)
    // C1: the profile's hard-deny PLUS the credential-path rules — a pre-approved read is SHADOWED
    // and never reaches the gate, so only this tool-bound layer can fence userData / the CLI's
    // own config directory.
    disallowedTools: cfg.disallowedTools.concat(loader.buildSecretPathDenyRules()),
    // v2.x: buildMcpServers PINS this session's workspace (X-Workspace-Id), so a call that omits
    // `workspace=` auto-targets instead of being refused; a per-call `workspace=` still wins.
    // 🔒 CONTAINER LOCK (plan §4.4 B1): `sessionBearer(s)` is the child credential
    // `session-credential.js` stamped on this session at spawn when its workspace is a SHARED
    // link container, and '' for every other session. It REPLACES the device token, so a locked
    // session — and anything it shells out to, which inherits the same credential — is refused
    // every other workspace server-side. The `X-Workspace-Id` pin below it stays a hint that
    // grants nothing; this is the part that actually refuses.
    // ⚠ Read HERE rather than minted here: this function is synchronous and is re-entered by
    // every spawn shape, park/resume included, so the credential must already be on `s`.
    mcpServers: loader.buildMcpServers(cfg.doplToolsPolicy, s.workspaceId, sessionCredential.sessionBearer(s)),
    settingSources: [], // ALWAYS — the global allow-list can never shadow a gate
    permissionMode: 'default', // FIX M2: pin — a wider mode short-circuits the held gate
    // FIX M2: strip permission-mode env knobs, keep auth (loader). Q6: withStoredCredential adds
    // this runtime's OAuth token only when our own setup-token is this machine's ONLY credential.
    env: sessionAuth.withStoredCredential(loader.buildScrubbedEnv()),
    // C6: the gate is unchanged; the wrapper only resolves the card an ALLOWED post painted.
    canUseTool: sessionOutbound.wrapGate(s, axisB.makeCanUseTool(s, dispatch, diag), emitQuiet), // diag: the forced-thread-tag conflict log (the bridge stays electron-free)
    abortController: s.abortController,
    includePartialMessages: false, // LOAD-BEARING for v2.7 L3 (FIX F4) — see the header
  };
  // F2 — THIS RUN'S SLOT KEY onto the dopl entry (X-Dopl-Session-Id), which the server turns into
  // the reserved `metadata.session_id`. `store.slotKey` is the ONE definition of a slot — (channel,
  // agent) for a team session, (channel, thread) for every other shape — so the stamp names exactly
  // the registry slot this run occupies, and two concurrent sessions of ONE agent handle stamp two
  // DIFFERENT values (which is the whole point: nothing on the wire could tell them apart). Applied
  // here rather than inside buildMcpServers because that builder answers "what MCP server does this
  // app offer", the same answer for every spawn. A LABEL, not a lock: nothing here limits how many
  // run, and a missing slot stamps nothing.
  loader.withSessionStamp(options.mcpServers, store.slotKey(s));
  // THIS SESSION'S ROLE onto the same entry (X-Dopl-Tool-Profile), so the server can offer a
  // narrower tool set than the whole surface. Same seam and the same rules as the stamp above:
  // applied here rather than inside `buildMcpServers`, because that builder answers "what MCP
  // server does this app offer" and this is a per-run fact. ⚠ NARROWING-ONLY AND IT GRANTS
  // NOTHING — `s.profile` is the profile this spawn is already contained at, normalized through
  // the same fail-closed read, and a value the server does not recognize is served everything.
  loader.withToolProfileStamp(options.mcpServers, s.profile);
  // AGENT-DRIVEN AGENT MANAGEMENT (2026-08-31): the in-process rename/end server, mounted
  // BESIDE the dopl entry (never inside it — the dopl entry is the pinned literal above).
  // Null (SDK namespace not cached yet, or a harness) mounts nothing and the launch proceeds:
  // a display/stop verb must never break a spawn. The own-agents-only argument, the shadow
  // argument and the self-end refusal all live in agent-self-ops.js's header.
  const agentOpsServer = axisB.makeAgentOpsServer(s);
  if (agentOpsServer) options.mcpServers[agentOps.SERVER_KEY] = agentOpsServer;
  if (cfg.builtinTools.length) options.tools = cfg.builtinTools; // positive bound; [] => full offers all, gated
  const bin = loader.resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  // THE PER-SESSION MODEL. `s.model` survives park/resume and the post-sign-in relaunch for
  // free, because every one of those shapes re-enters through this one assembly point on the
  // SAME session object. `modelArg` re-coerces against the frozen enum HERE, at the last step
  // before the value becomes an argv flag on a child process, so nothing upstream is trusted; a
  // 'default' (or anything unrecognized) sets no field at all, which is the platform's own pick.
  const model = sessionModel.modelArg(s.model);
  if (model) options.model = model;
  if (s.resumeSdkId) options.resume = s.resumeSdkId;
  return options;
}

/**
 * The OPAQUE launch payload core hands straight back to `start` / `resume`.
 *
 * ⚠ THE PROMPT IS PART OF IT. This runtime consumes a push-based async iterable as the live
 * prompt (`session-io.js › makePushIterator`), so the prompt and the options are one launch
 * shape here and could be two calls elsewhere. Core must not hold that difference.
 * ⚠ ONE ARGUMENT, CARRYING THE ENGINE'S TWO INJECTED HANDLES. The held gate needs the dispatch
 * and the replay-aware quiet emitter, and this module must not require the engine back; the
 * contract's single-argument signature is what keeps that a request object rather than a growing
 * parameter list core would have to keep in step per runtime.
 */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  return { prompt: s.pushIterator, options: buildOptions(s, req.dispatch, req.emitQuiet) };
}

/**
 * Start a run. ⚠ SYNCHRONOUS BY CONTRACT: core assigns the returned handle to the session
 * IMMEDIATELY, and an await between "the child exists" and "something points at it" is how the
 * two-children bug happened — a second child still holding this session's channel access, with
 * nothing left to stop it.
 */
function start(spec) {
  const sdk = loader.peekSdk();
  return sdk.query({ prompt: spec.prompt, options: spec.options });
}

/**
 * Resume a parked conversation.
 *
 * ⚠ IT IS A NEW CHILD PROCESS, WHICH IS WHY `priorHandle` IS IGNORED HERE. On this runtime a
 * resume differs from a cold launch by exactly one field — the conversation id already written
 * into `spec.options` — so there is no live handle to re-attach to. A runtime that re-attaches
 * uses the second argument; the signature exists for it.
 * ⚠ AND THE COST BASELINES RESET. `session-park.js › resumeParked` zeroes both delta baselines on
 * the assumption that this runtime restarts cumulative usage on a resumed query. That assumption
 * is declared as `descriptor.session.usageResetsOnResume` and is LAUNCH-BLOCKING when
 * unverified — a runtime that CONTINUES the total makes every delta negative, clamps it to zero,
 * and silently stops the cost cap firing.
 */
function resume(spec, _priorHandle) {
  return start(spec);
}

module.exports = { buildLaunchSpec, buildOptions, start, resume };

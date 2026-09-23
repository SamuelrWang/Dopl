// THE LAUNCH SHAPE — the one assembly point for every spawn on this runtime (fresh launch, parked
// resume, post-sign-in relaunch), so every pin below holds on all of them; `options.resume` is the
// only field that differs. The pins that are not preferences:
//   `settingSources: []`             the operator's global allow-list can never shadow the gate.
//   `permissionMode: 'default'`      any wider mode stops the platform calling the gate at all
//                                    (Dopl's gate implements bypass; deliberate).
//   `includePartialMessages: false`  the outbound card shows the exact final bytes a post sends,
//                                    and no input-rewriting hook is ever set.

const loader = require('./loader');
const tools = require('./tools');
const axisB = require('./axis-b');
const agentOps = require('../../agent-self-ops');
const channelDirs = require('../../channel-dirs');
const store = require('../../session-store');
const sessionAuth = require('../../session-auth');
const models = require('./models');
const sessionCredential = require('../../session-credential');
const sessionDirected = require('../../session-directed');
const fold = require('./fold');
const { diag } = require('../../diag');

// The runaway backstop for a query that never reaches another `result` — NOT the operator turn cap
// (deleted by ruling), not per profile, not settable. 8000 = 40 × the old 200-turn default, so it
// cannot fire in an ordinary session; one number on every spawn shape, so a park cannot shed it.
const SESSION_MAX_TURNS = 8000;

function buildOptions(s, dispatch) {
  const cfg = tools.buildSessionToolConfig(s.profile);
  const options = {
    // The per-channel folder (else ~/Downloads): context (§H-9), not a fence.
    cwd: channelDirs.sessionSpawnDir(s.channelId),
    // The profile table's list, whole: pre-approved = shadowed past the gate, so nothing may be
    // appended here (an entry the table does not declare is a shadow no profile can refuse).
    allowedTools: cfg.preApproved,
    // Hard-deny plus the credential-path rules: a shadowed read never reaches the gate, so only this
    // layer fences userData and the CLI's own config directory.
    disallowedTools: cfg.disallowedTools.concat(loader.buildSecretPathDenyRules()),
    // `sessionBearer(s)`: the container-locked child credential minted at spawn for a shared link
    // container ('' otherwise). It replaces the device token and is what refuses other workspaces
    // server-side; `X-Workspace-Id` is only a hint. Read, not minted: this function is synchronous.
    mcpServers: loader.buildMcpServers(cfg.doplToolsPolicy, s.workspaceId, sessionCredential.sessionBearer(s)),
    settingSources: [],
    permissionMode: 'default',
    // Permission knobs scrubbed; the stored OAuth token added only when it is this Mac's only credential.
    env: sessionAuth.withStoredCredential(loader.buildScrubbedEnv()),
    // `diag` is injected so the gate bridge stays electron-free.
    canUseTool: axisB.makeCanUseTool(s, dispatch, diag),
    abortController: s.abortController,
    includePartialMessages: false,
    maxTurns: SESSION_MAX_TURNS,
  };
  // This run's slot key (X-Dopl-Session-Id → the server's `metadata.session_id`): a label, not a lock.
  loader.withSessionStamp(options.mcpServers, store.slotKey(s));
  // This run's profile (X-Dopl-Tool-Profile): the server may only narrow the surface; it grants nothing.
  loader.withToolProfileStamp(options.mcpServers, s.profile);
  // The in-process rename/end server, beside the dopl entry; null mounts nothing (never breaks a spawn).
  const agentOpsServer = axisB.makeAgentOpsServer(s);
  if (agentOpsServer) options.mcpServers[agentOps.SERVER_KEY] = agentOpsServer;
  // Omitted when empty: what `[]` means to the SDK is disputed (F-427).
  if (cfg.builtinTools.length) options.tools = cfg.builtinTools;
  const bin = loader.resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  // The row's own launch value on the live roster; absent is the runtime default (`models.js › launchArg`).
  const model = models.launchArg(s.model);
  if (model) options.model = model;
  if (s.resumeSdkId) options.resume = s.resumeSdkId;
  return options;
}

/** The opaque launch payload core hands back to `start` / `resume`; the prompt (a push iterable on
 *  this runtime) is part of it. */
function buildLaunchSpec(request) {
  const req = request || {};
  const s = req.session;
  return { prompt: s.pushIterator, options: buildOptions(s, req.dispatch), session: s };
}

/** Start a run. SYNCHRONOUS by contract: core assigns the handle at once, and an await between "the
 *  child exists" and "something points at it" is the two-children bug. */
function start(spec) {
  const sdk = loader.peekSdk();
  // A push the CLI folds into the running turn joins that turn (`fold.js`, P4-05).
  const watch = fold.makeFoldWatch((text) => sessionDirected.steerJoined(spec.session, text));
  return fold.observeQuery(sdk.query({ prompt: watch.stamp(spec.prompt), options: spec.options }), watch.observe);
}

/** Resume a parked conversation: a new child with `options.resume` set, so `priorHandle` is unused. */
function resume(spec, _priorHandle) {
  return start(spec);
}

module.exports = { buildLaunchSpec, buildOptions, start, resume, SESSION_MAX_TURNS };

// The session-mode gate: `grantDecision`'s order, its four verdicts, the reason codes, both message axes and
// every own-channel lane — Dopl's on every runtime. The Axis-A vocabulary (tool names, modes) is the runtime
// adapter's, asked through `session-profiles-runtime.js`; core holds no copy.
// Two axes: A (toolMode, the runtime's words) is what MY agent may do here; B (messageMode, Dopl's four) is what
// crosses. A can never auto-approve a message op and B can never auto-approve a work tool. PURE: the suites
// slice the table below and inject its free vars.

const { makeGrantDetail, GATE_REASONS } = require('./session-gate-reason');
const { containerOnlyDenies } = require('./session-audience');
const { makeGrantKeyFor, POST_GRANT, postFieldsOk } = require('./session-grant-keys');
const { mcpShortName, canonicalDoplName, isDoplToolName } = require('./mcp-tool-names');
// The op-scoped reads of the mixed write tools (OQ-1's `dopl_kb`, then `dopl_agent` / `dopl_workspaces`).
const { isKnowledgeReadCall } = require('./knowledge-ops');
const { isDoplReadOpCall } = require('./dopl-read-ops');
const {
  OWN_CHANNEL_MARKER_KIND, OWN_CHANNEL_THREAD_NEW, OWN_CHANNEL_ESCALATE_KIND, OWN_CHANNEL_OUTBOUND_OPS,
  OWN_CHANNEL_SEND_OPS, OWN_CHANNEL_ARTIFACT_OPS,
  isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelEscalate, isOwnChannelOutbound,
  isOwnChannelArtifact, isOwnChannelOutboundCall,
} = require('./session-own-outbound');
const { channelOpKey } = require('./channel-op-key');
// The own-machine lanes: launch (depth-bounded), direct (buys a turn) and manage (rename/end/posture), each its
// own list on the same two-axis conjunction, so none answers through another's ruling.
const { isOwnMachineLaunch, launchLaneVerdict } = require('./session-own-launch');
const { isOwnMachineDirect, directLaneVerdict } = require('./session-own-direct');
const { isOwnMachineManage, manageLaneVerdict, manageAllowReason, OWN_MACHINE_MANAGE_OPS } = require('./session-own-manage');
const { DOPL_READ_TOOLS, DOPL_WRITE_TOOLS, DOPL_READ_REFERENCE } = require('./session-dopl-tools');
const {
  runtimeFor,
  buildSessionToolConfig, toolModeAllows, normalizeToolMode, floorWindowlessTool, toolModesFor,
  windowlessFloorRefusal, axisBOpScopedWarning, isClassifiedTool, editToolsFor,
  TOOL_MODES, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS, ESCALATION_TOOLS, EDIT_TOOLS,
} = require('./session-profiles-runtime');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');
const { operatorToolVerdict, isOperatorTool } = require('./operator-tools');

// ─── BEGIN SESSION-PROFILE TABLE (extracted by session-profiles/sdk-grant tests) ───

// Match by SHORT NAME under any server prefix (the client's, not ours): a miss drops a message op into Axis A.
// Over-matching is the safe direction — Axis B gates everything but its own-channel lanes.
const CHANNEL_SHORT_NAME = mcpShortName(DOPL_CHANNEL_TOOL);
function isChannelTool(toolName) {
  const short = mcpShortName(typeof toolName === 'string' ? toolName : '');
  return short === CHANNEL_SHORT_NAME || short.indexOf(CHANNEL_SHORT_NAME + '_') === 0;
}

// A delivery post into the session's OWN channel (unset or exactly its id; a slug is another channel). It only
// decides which grant KEY a post belongs to.
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'send') return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// The inbound half's read set, keyed `<op>.<action>` (F-578). `rooms` is here only BY ACTION: four of its
// actions write; `rooms.list` enumerates every channel, so it stays gated.
const OWN_CHANNEL_READ_OPS = ['read', 'status', 'rooms.threads', 'rooms.members'];

// The membership half, shared with the gate reason so the explainer has no second copy of the key rule.
function isOwnChannelReadCall(input) {
  return OWN_CHANNEL_READ_OPS.indexOf(channelOpKey(input)) !== -1;
}

// A HELD read (`read` with `wait_ms`) is DENIED on a desktop-run session: the message itself wakes it, so a hold
// only costs tokens, and a gate would ask a human about a call that could not help (T85).
const AWAIT_OP = 'read';
function isAwaitOp(input) {
  return !!input && input.op === AWAIT_OP && input.wait_ms != null;
}

// The read twin of isOwnChannelPost, same scoping rule.
function isOwnChannelRead(input, sessionChannelId) {
  const i = input || {};
  if (!isOwnChannelReadCall(i)) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

const grantKeyFor = makeGrantKeyFor({ isChannelTool, isOwnChannelPost, editToolsFor });

// AXIS B, Dopl's enum on every runtime. The INBOUND half is enforced at the inbound gate, the OUTBOUND half
// here, only for the session's OWN channel; everything cross-channel gates (the exfil surface).
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

function normalizeMessageMode(mode) {
  return MESSAGE_MODES.indexOf(mode) === -1 ? 'ask' : mode;
}
function autoInboundMode(mode) {
  const m = normalizeMessageMode(mode);
  return m === 'auto_inbound' || m === 'auto_both';
}
function autoOutboundMode(mode) {
  const m = normalizeMessageMode(mode);
  return m === 'auto_outbound' || m === 'auto_both';
}

// The windowless floor, the ONE statement of it (F-236): a windowless session has no accept surface, so a held
// reply would be held forever. It raises the IN half to auto and never touches the OUT half; the launch lane
// applies the same function (`channel-prefs.js`), pinned by session-mode-floor.test.
function floorWindowlessMessage(mode) {
  const m = normalizeMessageMode(mode);
  if (m === 'auto_inbound' || m === 'auto_both') return m;
  return m === 'auto_outbound' ? 'auto_both' : 'auto_inbound';
}

// Its inverse, the private turn's gate: the OUT half withdrawn, the IN half kept (reads stay possible).
function privateTurnMessageMode(mode) {
  const m = normalizeMessageMode(mode);
  if (m === 'auto_both') return 'auto_inbound';
  if (m === 'auto_outbound') return 'ask';
  return m;
}

/**
 * The per-call verdict: 'deny' (hard-denied, unopenable), 'preapproved' (shadowed past the callback, never the
 * channel tool), 'allow' (a task grant or a posture), 'gate' (ask). ORDER IS THE CONTRACT: hard-deny ->
 * audience belt -> operator-tool turn -> Axis-B channel branch -> preapproved -> scoped grant -> Axis A
 * (+ an operator tool at Full) -> knowledge read -> gate.
 * `a.runtime` names which vocabulary steps 1 and 4 are asked in; absent is the default runtime.
 */
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const rt = runtimeFor(a.runtime);
  const cfg = rt.toolConfigFor(a.profile);
  // Canonicalized once so every list agrees on the server; the GRANT KEY keeps the raw name (the shape shown).
  const name = canonicalDoplName(a.toolName);
  // 1. Hard deny: unopenable by a grant or the widest mode (so that mode is never the platform's bypass switch).
  if (cfg.disallowedTools.indexOf(name) !== -1) return 'deny';
  // 1.5 The audience belt, ahead of `preApproved` (which shadows past the bridge) (plan §4.4 B2).
  if (containerOnlyDenies(a, isDoplToolName)) return 'deny';
  // 1.6 "Use my tools": an operator tool on a turn that may not use it, ahead of any grant (`operator-tools.js`).
  const operator = operatorToolVerdict(a, name);
  if (operator === 'deny') return 'deny';
  // 2. THE INVARIANT: a message op branches to Axis B here and never reaches Axis A.
  if (isChannelTool(a.toolName)) {
    // A post whose `to`/`kind` is not a string cannot be described honestly: fail closed.
    if (!postFieldsOk(a.input)) return 'gate';
    if (isAwaitOp(a.input)) return 'deny';
    // Only a grant for THIS exact shape (no bare-name fallback: one read grant must not open `open`).
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId, a.runtime)) !== -1) return 'allow';
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    // Own-channel markers, thread opens, decision cards and artifact folds ride the same out half (arguments in
    // `session-own-outbound.js`).
    if (autoOutboundMode(a.messageMode) && isOwnChannelOutbound(a.input, a.channelId)) return 'allow';
    // The own-machine lanes need BOTH axes (launch also a depth bound); each module carries its argument.
    if (isOwnMachineLaunch(a.input, a.channelId)) return launchLaneVerdict(a, autoOutboundMode(a.messageMode));
    if (isOwnMachineDirect(a.input, a.channelId)) return directLaneVerdict(a, autoOutboundMode(a.messageMode));
    if (isOwnMachineManage(a.input, a.channelId)) return manageLaneVerdict(a, autoOutboundMode(a.messageMode));
    // An own-channel READ follows the IN half: it sends nothing.
    if (autoInboundMode(a.messageMode) && isOwnChannelRead(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(name) !== -1) return 'preapproved';
  // 3. A scoped standing grant, keyed on the shape the operator saw.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId, a.runtime)) !== -1) return 'allow';
  // 4. Axis A in this runtime's own words; an unknown mode allows nothing.
  if (operator === 'allow' || rt.axisAAllows(a.toolMode, name)) return 'allow';
  // 5. An op-scoped READ of a mixed write tool (`dopl-read-ops.js`), after Axis A so it narrows nothing: a
  // whole-tool verdict would pick the write surface, and a windowless miss is a deny (OQ-1).
  if (isDoplReadOpCall(name, a.input) && rt.axisAAllows(a.toolMode, DOPL_READ_REFERENCE)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

// The explainer is built outside the table (it may never move a gate) from the table's own predicates, asked
// of the same runtime the gate asked.
const grantDecisionDetail = makeGrantDetail(grantDecision, {
  isChannelTool, isOwnChannelPost, isOwnChannelRead, postFieldsOk, grantKeyFor,
  OWN_CHANNEL_READ_OPS, isOwnChannelReadCall, normalizeToolMode, isAwaitOp,
  canonicalDoplName, isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelEscalate, isOwnChannelOutbound,
  isOwnChannelArtifact, isOwnChannelOutboundCall,
  OWN_CHANNEL_OUTBOUND_OPS, isOwnMachineLaunch, isOwnMachineDirect,
  isOwnMachineManage, manageAllowReason,
  toolModeAllows, isKnowledgeReadCall, isDoplReadOpCall,
  isClassifiedTool,
  containerOnlyDenies, isDoplTool: isDoplToolName, buildSessionToolConfig, isOperatorTool,
});

module.exports = {
  buildSessionToolConfig, grantDecision, isOwnChannelPost,
  isOwnChannelRead, OWN_CHANNEL_READ_OPS,
  isOwnChannelReadCall,
  channelOpKey,
  isAwaitOp,
  isOwnChannelMarker, OWN_CHANNEL_MARKER_KIND, isOwnChannelThreadOpen, OWN_CHANNEL_THREAD_NEW,
  isOwnChannelEscalate, OWN_CHANNEL_ESCALATE_KIND,
  isOwnChannelArtifact, OWN_CHANNEL_ARTIFACT_OPS, OWN_CHANNEL_SEND_OPS,
  isOwnChannelOutboundCall,
  isOwnChannelOutbound, OWN_CHANNEL_OUTBOUND_OPS,
  isOwnMachineManage, OWN_MACHINE_MANAGE_OPS, manageAllowReason,
  isKnowledgeReadCall, isDoplReadOpCall,
  DOPL_READ_REFERENCE,
  mcpShortName, canonicalDoplName,
  grantDecisionDetail, GATE_REASONS,
  grantKeyFor,
  POST_GRANT,
  isChannelTool,
  // The default runtime's Axis-A list and taxonomy, for callers with no session (no gate decision reads them).
  TOOL_MODES, MESSAGE_MODES,
  EDIT_TOOLS, ESCALATION_TOOLS, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS,
  DOPL_READ_TOOLS, DOPL_WRITE_TOOLS,
  normalizeToolMode, normalizeMessageMode, toolModeAllows, isClassifiedTool, autoInboundMode,
  toolModesFor,
  // One answer to "does this posture consent to posting", shared with `session-private.js`.
  autoOutboundMode,
  floorWindowlessMessage,
  floorWindowlessTool,
  windowlessFloorRefusal,
  axisBOpScopedWarning,
  privateTurnMessageMode,
};

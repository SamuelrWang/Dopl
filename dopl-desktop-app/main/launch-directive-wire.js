// The launch-directive WIRE contract: `directiveFrom` narrows a realtime frame or polled row to the
// fields this desktop acts on, `decideBody` builds the answer. The server owns the shapes
// (`schema-launch.ts`); the suites drive both halves against its source. Pure below the sentinel.

// ─── BEGIN LAUNCH-DIRECTIVE-WIRE (pure; unit-tested via source extraction) ───────────────

// Every list, bound and pattern lives in the vocabulary leaf; re-exported verbatim below.
const vocab = require('./launch-directive-vocab');
const {
  DIRECTIVE_TABLE, ROUTES,
  STATUS_PENDING, STATUS_CLAIMED, STATUS_LAUNCHED, STATUS_DONE, STATUS_REFUSED, STATUS_EXPIRED,
  STATUSES,
  KIND_LAUNCH, KIND_END, KIND_RENAME, KIND_SET_MODE, KINDS, KINDS_NEEDING_LAUNCH_CONSENT,
  TOOL_MODES, APPLIED_TOOL_MODES, SETTING_RE, MESSAGE_MODES, REFUSAL_REASONS,
  TARGET_NAME_MAX, AGENT_ID_RE, RUNTIME_ID_RE, GOAL_MAX, IDENTITY_NAME_MAX, MODEL_MAX, text,
} = vocab;

// One of the censused UUID copies (`test/uuid-rule-parity.test.mjs`); it refuses a non-UUID `id` /
// `channel_id` off an untrusted realtime frame.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first candidate spelling (snake, then camel) that is a member of `order`, else ''. */
function pickMode(order, ...candidates) {
  for (const c of candidates) {
    const v = String(c == null ? '' : c);
    if (v && order.indexOf(v) !== -1) return v;
  }
  return '';
}

// Hand copy (main cannot import `src/`): `session-launch-op.js › colorKey`, the state push and the
// column CHECKs. `''` (not null) is "not asked", one spelling of absent across this row.
const AGENT_COLOR_RE = /^agent-(0[1-9]|1[0-6])$/;
function colorKey(value) {
  return typeof value === 'string' && AGENT_COLOR_RE.test(value) ? value : '';
}

/** A runtime-id SHAPE or ''; membership is the registry's question (`launch-directive-spawn.js`). */
function runtimeId(value) {
  return typeof value === 'string' && RUNTIME_ID_RE.test(value.trim())
    ? value.trim() : '';
}

/** `true` / `false` / `null` (did not ask); `'true'`/`'false'` read too — a stringified `false` must not become `null`. */
function triState(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

/**
 * A realtime frame (snake) or a claim DTO (camel) → the fields this desktop will act on, or null.
 * A NARROWING, not an authorisation — the authenticated CLAIM decides; an unrecognised key never
 * reaches a caller. `id` and `channelId` must be UUIDs. `operatorUserId` is carried, not trusted:
 * the caller re-checks it (the realtime filter is workspace-wide).
 */
function directiveFrom(raw, workspaceId) {
  const r = raw || {};
  const id = String(r.id || '');
  const channelId = String(r.channel_id || r.channelId || '');
  if (!UUID_RE.test(id) || !UUID_RE.test(channelId)) return null;
  const identityId = String(r.identity_id || r.identityId || '');
  // The realtime row says `task_id`, the server DTO `threadId`; `taskId` is this tree's wire name.
  const taskId = String(r.task_id || r.threadId || r.taskId || '');
  const status = String(r.status || '');
  const targetAgentId = String(r.target_agent_id || r.targetAgentId || '');
  return {
    id: id,
    // Unknown kind → `launch`, the fully gated branch (never dispatched blind, never left undecided).
    kind: KINDS.indexOf(String(r.kind || '')) === -1 ? KIND_LAUNCH : String(r.kind),
    workspaceId: String(r.workspace_id || r.workspaceId || workspaceId || ''),
    channelId: channelId,
    // '' = channel-level; a non-UUID collapses to it rather than entering a session key.
    taskId: UUID_RE.test(taskId) ? taskId : '',
    operatorUserId: String(r.operator_user_id || r.operatorUserId || ''),
    goal: text(r.goal, GOAL_MAX),
    model: text(r.model, MODEL_MAX),
    // '' = did not ask (the identity/channel/default chain applies); never inferred from `model`.
    runtime: runtimeId(r.runtime || r.runtimeId),
    // Interpolated into `/api/agent-identities/<id>/resolve`, so a non-UUID collapses to ''.
    identityId: UUID_RE.test(identityId) ? identityId : '',
    // Carried even with no id: a null id beside a name is the DELETION signal (`ON DELETE SET NULL`).
    identityName: text(r.identity_name || r.identityName, IDENTITY_NAME_MAX),
    color: colorKey(r.color || r.colorKey),
    // Bounded, not sanitised: `agent-names.js › sanitizeName` refuses rather than strips. '' = not asked.
    agentName: text(r.agent_name || r.agentName, TARGET_NAME_MAX),
    // An end/rename TARGET (an input; `agentId` is a launch's output). '' refuses — no oldest-agent guess.
    targetAgentId: AGENT_ID_RE.test(targetAgentId) ? targetAgentId : '',
    // null = not a rename, '' = the rename's CLEAR; one char over the bound so `sanitizeName` refuses.
    targetName: typeof r.target_name === 'string' || typeof r.targetName === 'string'
      ? String(r.target_name !== undefined && r.target_name !== null
        ? r.target_name : r.targetName).slice(0, TARGET_NAME_MAX + 1)
      : null,
    // `set_agent_mode`'s axes; '' = that axis was not asked (an unknown word collapses to it).
    targetToolMode: TOOL_MODES.indexOf(String(r.target_tool_mode || r.targetToolMode || '')) === -1
      ? '' : String(r.target_tool_mode || r.targetToolMode),
    targetMessageMode: MESSAGE_MODES.indexOf(String(r.target_message_mode || r.targetMessageMode || '')) === -1
      ? '' : String(r.target_message_mode || r.targetMessageMode),
    // A launch's ASKED start posture — separate from `target*` — clamped later by `launch-posture.js`.
    startToolMode: pickMode(TOOL_MODES, r.start_tool_mode, r.startToolMode),
    startMessageMode: pickMode(MESSAGE_MODES, r.start_message_mode, r.startMessageMode),
    // Tri-state: `true` ask on, `false` ask off, `null` inherit the channel setting.
    chain: triState(r.chain),
    status: STATUSES.indexOf(status) === -1 ? '' : status,
    agentId: String(r.agent_id || r.agentId || ''),
  };
}

/** A `launch()` skip → a word in the closed vocabulary; anything else (`disabled` included) is `no-bridge`. */
function refusalFor(skipped) {
  const s = String(skipped || '');
  return REFUSAL_REASONS.indexOf(s) === -1 ? 'no-bridge' : s;
}

function claimBody(directiveId) {
  return { directiveId: String(directiveId || '') };
}

/**
 * The decision body: LAUNCHED with an agent id, `done` (a non-launch kind), or REFUSED with a word —
 * never none. Order is correctness: `agentId` first, then `done`, then the refusal. `applied*` is
 * emitted only when there IS a value (absent = "not reported", what an older desktop sends) and
 * narrowed to the column CHECK vocab, so a real launch is never refused at rest.
 */
function decideBody(directiveId, outcome) {
  const o = outcome || {};
  const agentId = String(o.agentId || '');
  if (agentId) {
    const body = { directiveId: String(directiveId || ''), status: STATUS_LAUNCHED, agentId: agentId };
    if (APPLIED_TOOL_MODES.indexOf(o.appliedTools) !== -1) body.appliedTools = o.appliedTools;
    if (MESSAGE_MODES.indexOf(o.appliedMessages) !== -1) body.appliedMessages = o.appliedMessages;
    // `false` is a report ("may NOT launch workers"), hence `typeof`, not truthiness.
    if (typeof o.appliedChain === 'boolean') body.appliedChain = o.appliedChain;
    if (typeof o.appliedAgentName === 'string' && o.appliedAgentName.trim() !== '') {
      body.appliedAgentName = o.appliedAgentName.trim();
    }
    if (RUNTIME_ID_RE.test(String(o.appliedRuntime || ''))) {
      body.appliedRuntime = String(o.appliedRuntime);
    }
    if (typeof o.appliedModel === 'string' && o.appliedModel.trim() !== '') {
      body.appliedModel = o.appliedModel.trim().slice(0, MODEL_MAX);
    }
    if (SETTING_RE.test(String(o.appliedSetting || ''))) body.appliedSetting = String(o.appliedSetting);
    return body;
  }
  // No id on `done`: the row already names its target. No `appliedChain`: a re-posture decides none.
  if (o.done === true) {
    const body = { directiveId: String(directiveId || ''), status: STATUS_DONE };
    if (APPLIED_TOOL_MODES.indexOf(o.appliedTools) !== -1) body.appliedTools = o.appliedTools;
    if (MESSAGE_MODES.indexOf(o.appliedMessages) !== -1) body.appliedMessages = o.appliedMessages;
    return body;
  }
  return {
    directiveId: String(directiveId || ''),
    status: STATUS_REFUSED,
    refusalReason: refusalFor(o.refused),
  };
}

// ─── END LAUNCH-DIRECTIVE-WIRE ───────────────────────────────────────────────────────────

module.exports = {
  DIRECTIVE_TABLE,
  ROUTES,
  STATUSES,
  STATUS_PENDING,
  STATUS_CLAIMED,
  STATUS_LAUNCHED,
  STATUS_DONE,
  STATUS_REFUSED,
  STATUS_EXPIRED,
  KINDS,
  KIND_LAUNCH,
  KIND_END,
  KIND_RENAME,
  KIND_SET_MODE,
  KINDS_NEEDING_LAUNCH_CONSENT,
  TOOL_MODES,
  APPLIED_TOOL_MODES,
  MESSAGE_MODES,
  AGENT_ID_RE,
  RUNTIME_ID_RE,
  REFUSAL_REASONS,
  GOAL_MAX,
  IDENTITY_NAME_MAX,
  TARGET_NAME_MAX,
  directiveFrom,
  refusalFor,
  claimBody,
  decideBody,
};

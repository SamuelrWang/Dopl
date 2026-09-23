// The New Agent button end to end (the body of `sessions:launch`) and its approval twin. Called from inside
// the literal `appWindowOnly('sessions:launch', …)` registration (the sender belt reads that shape); the
// payload is still untrusted here, so every id is re-validated.

const { isUuid } = require('./ipc-guards');
const { isAgentId } = require('./agent-id');
const { diag } = require('./diag');

// One of the sixteen agent colour keys, or null ("let the server pick", never a refusal). A local copy of
// the set main cannot import (the web's `AGENT_COLOR_KEYS`, contracts, the MCP server, the column CHECKs);
// anchored both ends because the value lands in a CSS custom property name.
const AGENT_COLOR_RE = /^agent-(0[1-9]|1[0-6])$/;
function colorKey(value) {
  return typeof value === 'string' && AGENT_COLOR_RE.test(value) ? value : null;
}

// Absent, null and '' ask for no identity (a byte-identical blank launch). A present-but-malformed id is NOT
// a blank launch: the resolve answers `no-identity` for it (F-1).
function wantsIdentity(value) {
  return value != null && value !== '';
}

/**
 * A windowless requester-side agent, spawned IDLE (no query until its first message) and answered with its
 * ADDRESS `{ ok, agentId }`. The clicking human is the consent. `taskId` null or '' means a CHANNEL-level
 * agent (keyed `<channel>::<agent>`); otherwise it must be a first-class thread's UUID.
 */
async function launchFromButton(payload) {
  const p = payload || {};
  if (!isUuid(p.channelId)) return { ok: false };
  const channelLevel = p.taskId == null || p.taskId === '';
  if (!channelLevel && !isUuid(p.taskId)) return { ok: false };
  const engine = require('./session-engine');
  const channelPrefs = require('./channel-prefs');
  const targeting = require('./targeting');
  const listener = require('./channel-listener');
  // Containment comes from MAIN's watched-channel DTO, never the payload, and before the identity is even
  // fetched: an identity widens prompt content only (INVARIANTS §5A). Narrowed for a shared room (F-510).
  const toolProfile = targeting.resolveLaunchToolProfile(listener.watchedChannel(p.channelId));
  const workspaceId = typeof p.workspaceId === 'string' ? p.workspaceId : null;

  // The sheet's ephemeral overrides (model, field values), narrowed by main — the only validator of this
  // payload (F-281). Absent is the only spelling of "no override".
  const overrides = require('./identity-resolve').narrowOverrides(p.overrides);

  let identity = null;
  if (wantsIdentity(p.identityId)) {
    const res = await require('./identity-resolve').resolveAgentIdentity(p.identityId, workspaceId);
    // F-1..F-4: refuse, never degrade to a blank agent.
    if (!res.ok) return { ok: false, reason: res.reason };
    identity = res.identity;
    // First use of ANOTHER member's identity on this machine needs a machine-local approval (OQ-3): a refusal
    // round trip carrying main's resolved instructions verbatim, so the operator approves the text that will run.
    if (!identity.authoredByCaller && !channelPrefs.isIdentityApproved(p.identityId)) {
      diag('sessions:launch: foreign identity awaiting first-use approval', String(p.identityId).slice(0, 8));
      return {
        ok: false,
        reason: 'identity-approval',
        identity: { name: identity.name, instructions: identity.instructions },
      };
    }
    // Field overrides after the approval: the instructions being approved are never overridable.
    identity = require('./identity-resolve').applyOverrides(identity, overrides);
  }
  // A blank launch with typed instructions still runs as an instructions-only role (F-695).
  if (!identity) identity = require('./identity-resolve').applyOverrides(null, overrides);

  const title = typeof p.threadTitle === 'string' ? p.threadTitle.slice(0, 200) : '';
  // Display/seed text only (a spawn-idle session has no first turn); the identity's role comes first, the goal last.
  const goal = defaultGoal(channelLevel, title);

  // The runtime first (pick -> identity's -> channel's -> default; an unusable pick or identity runtime refuses
  // `no-sdk`), because the identity's model counts only if THAT runtime offers it.
  const launchDefault = require('./runtime/launch-default');
  const resolved = await launchDefault.resolveLaunchRuntime({ pick: p.runtime, identity, channelId: p.channelId });
  if (!resolved.ok) {
    diag('sessions:launch: runtime', resolved.runtimeId, 'is not usable here — refusing (no-sdk)');
    return { ok: false, reason: resolved.reason };
  }
  const runtimeId = resolved.runtimeId;
  // The sheet's pick (refused by the funnel if unknown), else the identity's model on this runtime (skipped when
  // absent or bound to another runtime), else '' — the funnel spends the runtime default.
  const model = overrides.model
    || await launchDefault.identityModelFor(runtimeId, identity && identity.model, identity && identity.runtime);

  const res = await engine.launchRequesterSession({
    channelId: p.channelId,
    taskId: channelLevel ? '' : p.taskId,
    workspaceId,
    // The panel's pre-minted id, accepted by shape (else a fresh mint); a live-slot collision answers `busy`.
    agentId: isAgentId(p.agentId) ? p.agentId : undefined,
    goal,
    counterpartyId: isUuid(p.counterpartyId) ? p.counterpartyId : null,
    direct: p.direct === true,
    context: {
      channelName: typeof p.channelName === 'string' ? p.channelName.slice(0, 120) : '',
      taskTitle: channelLevel ? null : (title || null),
      channelId: p.channelId,
      workspaceId,
      taskId: channelLevel ? '' : p.taskId,
      // The framing cannot infer channel-level from an absent thread id, so the launch that knows states it.
      scope: channelLevel ? 'channel' : 'thread',
      workspaceSegment: typeof p.workspaceSegment === 'string' ? p.workspaceSegment : null,
      // Captured at spawn and never re-read: the session keeps its spawn-time identity content.
      identity,
    },
    toolProfile,
    mode: 'interactive',
    windowless: true,
    // The durable posture of the LAUNCH runtime, consumed here only: the click is the human decision (H2).
    startModes: channelPrefs.launchStartModes(p.channelId, runtimeId),
    // A runtime may come off the payload (registered adapters enforce every profile); a tool profile never may.
    runtime: runtimeId,
    model,
    // Normalized here (main is the only validator); no precedence chain — a colour is unique per channel.
    color: colorKey(p.color),
    idle: true,
    // The ONE lane that passes depth 0: a human at this machine's own button (F-320).
    launchDepth: 0,
    // Lets the durable posture reach an idle spawn: the click is that human.
    operatorArmed: true,
  });
  if (res && res.agentId) return { ok: true, agentId: res.agentId, sessionId: res.sessionId || null };
  // `detail` is the refusal's sentence when there is one (e.g. `no-model`: what this machine offers).
  return Object.assign({ ok: false, reason: (res && res.skipped) || 'unknown' },
    res && typeof res.detail === 'string' && res.detail ? { detail: res.detail } : {});
}

/** Record a machine-local first-use approval for another member's identity. It grants the PROMPT only,
 *  starts nothing, and its store is unreachable from any Dopl endpoint. */
function approveIdentity(payload) {
  const p = payload || {};
  if (!isUuid(p.identityId)) return { ok: false };
  return { ok: require('./channel-prefs').approveIdentity(p.identityId) === true };
}

function defaultGoal(channelLevel, title) {
  if (channelLevel) return 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.';
  const which = title ? `the thread "${title}"` : 'this thread';
  return `Join ${which} as my agent: read it with dopl_channel (op "read", thread=<id>) and carry the work forward.`;
}

module.exports = { launchFromButton, approveIdentity, wantsIdentity, defaultGoal };

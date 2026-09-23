// The directive lane's SPAWN: one claimed launch row becoming one session through the ordinary
// funnel (`deps.launch`). The watcher (`launch-directives.js`) decides WHETHER to act; this builds
// WHAT is launched. `deps` is injected per call, so the module holds no state.

const channelPrefs = require('./channel-prefs');
const wire = require('./launch-directive-wire');
const sessionModel = require('./session-model');
const launchPosture = require('./launch-posture');
const { diag } = require('./diag');

/**
 * The launch runtime (C3, ruling R5): pick → identity's runtime → channel's → default. A pick or an
 * identity runtime this Mac cannot run is REFUSED `no-sdk`, never swapped for another vendor.
 */
async function launchRuntime(pick, identity, channelId) {
  const r = await require('./runtime/launch-default').resolveLaunchRuntime({ pick, identity, channelId });
  if (r && r.ok) return { id: String(r.runtimeId || '') };
  diag('launch-directive: runtime', String((r && r.runtimeId) || pick || '(identity)'),
    'is not usable here (' + String((r && r.reason) || 'unknown') + ') — REFUSING rather than falling back');
  return { refused: 'no-sdk' };
}

/** The runtime reported as `appliedRuntime`: `''` is named as the default adapter, never silence. */
function appliedRuntimeId(id) {
  if (id) return id;
  try { return require('./runtime').DEFAULT_ID || ''; } catch (_err) { return ''; }
}

/** The model reported as `appliedModel`: the adapter's `modelArg` answer where it has one. */
function appliedModelId(runtimeId, modelArg) {
  try {
    const rt = require('./runtime').runtimeFor(runtimeId);
    if (rt && typeof rt.modelArg === 'function') {
      const r = rt.modelArg(modelArg || '');
      if (r && r.ok && r.id) return r.id;
    }
  } catch (_err) { /* fall through to what this lane applied */ }
  return modelArg || '';
}

/**
 * The model on every runtime (P3-09): the directive's pick, else the identity's model when THIS
 * runtime offers it, else `''`. The funnel refuses an unknown pick (`no-model`), fails open on an
 * unreadable roster and fills the runtime default.
 */
async function resolveModel(runtimeId, d, identity) {
  return sessionModel.chainModel(d.model)
    || require('./runtime/launch-default').identityModelFor(runtimeId, identity && identity.model);
}

/**
 * The start posture in the LAUNCH runtime's words (R3/R4): the ceiling is that runtime's record
 * (`launchPostureFor`), the native bag `launchStartModes`'. A tool word the runtime does not offer
 * is not applied (that axis runs at the channel posture); clamp in the runtime's order, then floor.
 * Only the axes the directive ASKED are pinned as the session's own pick (C2); the rest follow the
 * channel live.
 */
function planPosture(d, runtimeId, chainAllowed) {
  const profiles = require('./session-profiles');
  const order = profiles.toolModesFor(runtimeId); // that runtime's words, narrowest first
  const askedTools = d.startToolMode && order.indexOf(d.startToolMode) !== -1 ? d.startToolMode : '';
  if (d.startToolMode && !askedTools) {
    diag('launch-directive: tool mode', d.startToolMode, 'is not a', runtimeId || 'default-runtime',
      'word — that axis launches at the channel posture');
  }
  const plan = launchPosture.resolveLaunch({
    requested: { tools: askedTools, messages: d.startMessageMode },
    ceiling: channelPrefs.launchPostureFor(d.channelId, runtimeId),
    chainRequested: d.chain,
    chainAllowed,
    floorMessages: profiles.floorWindowlessMessage,
    toolOrder: order,
  });
  if (plan.clamped) {
    diag('launch-directive: posture CLAMPED to this channel\'s stored pair — asked',
      String(d.startToolMode || '-') + '/' + String(d.startMessageMode || '-'),
      'applied', plan.modes.tools + '/' + plan.modes.messages);
  }
  const start = channelPrefs.launchStartModes(d.channelId, runtimeId) || {};
  const hand = { tools: plan.modes.tools, messages: plan.modes.messages, native: { ...(start.native || {}) } };
  if (askedTools || d.startMessageMode) hand.pinned = { tools: !!askedTools, messages: !!d.startMessageMode };
  return { hand, chain: plan.chain };
}

/**
 * Spawn through the funnel → `{ refused: <word> }` or `{ agentId, applied* }`, every `applied*` the
 * RESOLVED value handed to `deps.launch`, never the request.
 * Every CONTAINMENT input comes from this machine, never the directive: the tool profile from
 * `channel-listener.js › watchedChannel` (unwatched → `no-bridge`), narrowed `full` →
 * `channel_agent` in a shared room; the posture from the operator's record for the launch runtime,
 * which a directive may only narrow; `windowless: true`. The directive supplies goal, model,
 * runtime, identity id, name, colour and posture/chain REQUESTS; a denied chain request refuses.
 * The identity is resolved HERE under the operator's credential, AFTER the profile is decided:
 * refuse, never degrade (a blank agent wearing no identity goes unnoticed). No first-use approval
 * on this lane: the launch toggle is the standing consent (OQ-3).
 */
async function spawn(d, deps) {
  // An explicit runtime this machine cannot run is refused before any work.
  let runtime = null;
  if (d.runtime) {
    runtime = await launchRuntime(d.runtime, null, d.channelId);
    if (runtime.refused) return { refused: runtime.refused };
  }
  // Answered first: a denied chain REFUSES (`no-chain`, naming the setting) where a posture clamps.
  const chainAllowed = channelPrefs.getAgentChain(d.channelId);
  if (launchPosture.resolveChain(d.chain, chainAllowed).refused) {
    diag('launch-directive: chaining asked for and NOT enabled here —', launchPosture.CHAIN_SETTING,
      'is off for this channel; the operator turns it on in the channel Settings tab');
    return { refused: 'no-chain', setting: launchPosture.CHAIN_SETTING };
  }
  const channel = deps.watchedChannel ? deps.watchedChannel(d.channelId) : null;
  if (!channel) {
    return { refused: 'no-bridge' };
  }
  const targeting = require('./targeting');
  const channelLevel = d.taskId === '';

  let identity = null;
  if (d.identityId) {
    // `no-identity` for a 404 (deleted, invisible to this operator, or another tenancy — one answer),
    // `busy` otherwise; passed through, `refusalFor` is the closed-vocabulary gate.
    const resolved = await require('./identity-resolve').resolveAgentIdentity(d.identityId, d.workspaceId);
    if (!resolved.ok) return { refused: resolved.reason };
    identity = resolved.identity;
  } else if (d.identityName) {
    // A null id beside a snapshot name = the identity was DELETED before the claim (E-4): refuse.
    diag('launch-directive: identity deleted before claim —', String(d.identityName).slice(0, 40));
    return { refused: 'no-identity' };
  }

  // No pick: the identity's runtime, then the channel's — so it waits for the identity.
  if (!runtime) {
    runtime = await launchRuntime('', identity, d.channelId);
    if (runtime.refused) return { refused: runtime.refused };
  }
  const plan = planPosture(d, runtime.id, chainAllowed);
  const modelArg = await resolveModel(runtime.id, d, identity);
  const res = await deps.launch({
    channelId: d.channelId,
    taskId: d.taskId,
    workspaceId: d.workspaceId || null,
    runtime: runtime.id,
    goal: d.goal || require('./session-launch-op').defaultGoal(channelLevel, ''),
    counterpartyId: null,
    direct: false,
    context: {
      channelName: String(channel.name || '').slice(0, 120),
      taskTitle: null,
      channelId: d.channelId,
      workspaceId: d.workspaceId || null,
      taskId: d.taskId,
      scope: channelLevel ? 'channel' : 'thread',
      workspaceSegment: null,
      // Captured at spawn and never re-read: a later edit or deletion neither changes nor stops it.
      identity,
    },
    // The DESTINATION's profile, read on this machine (the other two lanes make the same call).
    toolProfile: targeting.resolveLaunchToolProfile(channel),
    mode: 'interactive',
    windowless: true,
    startModes: plan.hand,
    model: modelArg,
    // Applied, never verified: unique among live agents, and a create-time 409 is only a courtesy.
    color: d.color,
    // Only this lane passes `launchChain` (read per directive). A goal RUNS; no goal stands by — a
    // directive's author is an agent, whose unaddressed posts could never wake an idle shell.
    launchChain: plan.chain, idle: !d.goal,
    operatorArmed: true, // FIX-4: the operator armed this lane, so a handed-in posture is honoured
  });
  // The name is committed AFTER the launch (it is keyed on the agent id) through `commitRename`,
  // which also refreshes the summary peers read. The `try` wraps only the commit (F-736): a logging
  // throw must not lose the stored name, which is the address an orchestrator uses.
  if (res && res.agentId) {
    let stored = null;
    try {
      const asked = d.agentName || '';
      if (!asked) {
        diag('launch-directive: directive carried NO agent name — falling back to',
          NEW_AGENT_NAME, '(an older client sends none; a NEWER one that asked for a name and'
          + ' landed here has lost it upstream of this machine)');
      }
      stored = require('./agent-identity-commit')
        .commitRename(res.agentId, asked || NEW_AGENT_NAME);
    } catch (err) {
      diag('launch-directive: could not store the agent name —', err && err.message);
    }
    const applied = stored && stored.ok ? stored.name : null;
    if (!applied) {
      diag('launch-directive: the agent name was REFUSED by the store —',
        (stored && stored.reason) || 'no reason given',
        '— agent', res.agentId, 'is running UNNAMED');
    }
    return {
      agentId: res.agentId,
      appliedTools: plan.hand.tools,
      appliedMessages: plan.hand.messages,
      appliedChain: plan.chain,
      appliedAgentName: applied,
      appliedRuntime: appliedRuntimeId(runtime.id),
      appliedModel: appliedModelId(runtime.id, typeof res.model === 'string' ? res.model : modelArg),
    };
  }
  return { refused: wire.refusalFor(res && res.skipped) };
}

// Hand copy of `src/shared/lib/agent-name.ts › NEW_AGENT_NAME` (main cannot import it).
const NEW_AGENT_NAME = 'New Agent';

module.exports = { spawn };

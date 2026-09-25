// The directive lane's SPAWN: one claimed launch row becoming one session through the ordinary
// funnel (`deps.launch`). The watcher (`launch-directives.js`) decides WHETHER to act; this builds
// WHAT is launched. `deps` is injected per call, so the module holds no state.

const channelPrefs = require('./channel-prefs');
const wire = require('./launch-directive-wire');
const { pickOf } = require('./runtime/selection-vocabulary');
const launchPosture = require('./launch-posture');
const permissionLevel = require('./runtime/permission-level');
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
  return pickOf(d.model)
    || require('./runtime/launch-default').identityModelFor(runtimeId, identity && identity.model, identity && identity.runtime);
}

/**
 * The start posture in the LAUNCH runtime's words (R3/R4). An asked level becomes that runtime's tool
 * mode; a word it does not offer is not applied (that axis runs at the channel level). The tool mode
 * clamps to the channel level's (`launchPostureFor`) in the runtime's order, and the containment
 * value follows the NARROWER of the applied mode's level and the channel's, so a narrower ask never
 * keeps a wider sandbox. Only the axes the directive ASKED are pinned as the session's own pick (C2).
 */
function planPosture(d, runtimeId, chainAllowed) {
  const profiles = require('./session-profiles');
  const desc = require('./runtime').descriptorFor(runtimeId);
  const askedTools = d.startToolMode ? permissionLevel.toolWordFor(desc, d.startToolMode) : '';
  if (d.startToolMode && !askedTools) {
    diag('launch-directive: tool mode', d.startToolMode, 'is not a level or a', runtimeId || 'default-runtime',
      'word — that axis launches at the channel level');
  }
  const ceiling = channelPrefs.launchPostureFor(d.channelId, runtimeId);
  const plan = launchPosture.resolveLaunch({
    requested: { tools: askedTools, messages: d.startMessageMode },
    ceiling,
    chainRequested: d.chain,
    chainAllowed,
    floorMessages: profiles.floorWindowlessMessage,
    toolOrder: profiles.toolModesFor(runtimeId),
  });
  if (plan.clamped) {
    diag('launch-directive: posture CLAMPED to this channel\'s stored pair — asked',
      String(d.startToolMode || '-') + '/' + String(d.startMessageMode || '-'),
      'applied', plan.modes.tools + '/' + plan.modes.messages);
  }
  const L = permissionLevel.LEVELS;
  const appliedLevel = L[Math.min(L.indexOf(permissionLevel.levelOf(desc, plan.modes.tools, ceiling.native)), L.indexOf(ceiling.level))];
  const native = permissionLevel.levelSettings(desc, appliedLevel).native;
  const hand = { tools: plan.modes.tools, messages: plan.modes.messages, native };
  if (askedTools || d.startMessageMode) hand.pinned = { tools: !!askedTools, messages: !!d.startMessageMode };
  return { hand, chain: plan.chain, setting: permissionLevel.settingText(desc, hand.tools, native) };
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
  const asked = d.agentName || '';
  if (!asked) {
    diag('launch-directive: directive carried NO agent name — falling back to',
      NEW_AGENT_NAME, '(an older client sends none; a NEWER one that asked for a name and'
      + ' landed here has lost it upstream of this machine)');
  }
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
    // The funnel commits it through `commitRename` (unique per channel, refreshes the summary peers read)
    // after registration and BEFORE the first turn, so a goal launch's first turn states it.
    agentName: asked || NEW_AGENT_NAME,
  });
  if (res && res.agentId) {
    // The STORED name (the uniqueness suffix included), never the ask; null = refused or not stored.
    const applied = typeof res.agentName === 'string' && res.agentName ? res.agentName : null;
    if (!applied) {
      diag('launch-directive: the agent name was not stored — agent', res.agentId, 'is running UNNAMED');
    }
    return {
      agentId: res.agentId,
      appliedTools: plan.hand.tools,
      appliedMessages: plan.hand.messages,
      appliedChain: plan.chain,
      appliedAgentName: applied,
      appliedRuntime: appliedRuntimeId(runtime.id),
      appliedModel: appliedModelId(runtime.id, typeof res.model === 'string' ? res.model : modelArg),
      appliedSetting: plan.setting,
    };
  }
  return { refused: wire.refusalFor(res && res.skipped) };
}

// Hand copy of `src/shared/lib/agent-name.ts › NEW_AGENT_NAME` (main cannot import it).
const NEW_AGENT_NAME = 'New Agent';

module.exports = { spawn };

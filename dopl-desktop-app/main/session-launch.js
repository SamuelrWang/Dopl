// The spawn funnel: `launch`, its two lanes, and every question asked BEFORE a session exists (who may spawn,
// what id it wears, which refusal a caller gets). The refusal shapes are a wire contract — `trigger.js` and the
// directive lane answer peers with them. No electron: the engine's handles arrive via bind().

const store = require('./session-store');
const { newAgentId, isAgentId } = require('./agent-id');
const sessionWindowless = require('./session-windowless');
const launchBudget = require('./launch-budget');
// Pure: the windowless-floor refusal and the Axis-B warning, both asked of the runtime's own declaration.
const profiles = require('./session-profiles');
// Producers for `context.ontologies` / `context.roster`; each requires lazily and never throws (F-681).
const ontologyReach = require('./ontology-reach');
const { diag } = require('./diag');
const roomRoster = require('./room-roster');
const launchDefault = require('./runtime/launch-default');

let deps = { sessions: null, acquireRuntime: null, startSession: null, liveOnThread: null, sessionOn: null };

// `bind` rebuilds `deps` from a literal: a handle the engine passes and this list omits is dropped silently.
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    acquireRuntime: (d && d.acquireRuntime) || null,
    startSession: (d && d.startSession) || null,
    liveOnThread: (d && d.liveOnThread) || null,
    sessionOn: (d && d.sessionOn) || null,
  };
}

async function launch(a) {
  // The only spawn shape is windowless (F-228).
  if (!a.windowless) return { skipped: 'disabled' };
  // Mint the instance id at the one funnel: a caller may hand one in (a resume) but not invent a shape.
  const agentId = isAgentId(a.agentId) ? a.agentId : newAgentId();
  const slot = { channelId: a.channelId, taskId: a.taskId, agentId: agentId };
  const key = store.slotKey(slot);
  // No `busy` law: several agents per thread is normal; the concurrency ceiling bounds the machine. `trigger.js`
  // still handles `busy` (the post-await re-check below).
  if (sessionWindowless.liveCount(deps.sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS) return { skipped: 'cap' };
  // The chained-launch budget over TIME, spent only by a chained spawn and before any await (same `cap` word).
  if (a.launchChain === true && !launchBudget.spend(a.channelId)) {
    diag('session-launch: chained launch over budget', String(a.channelId || '').slice(0, 8));
    return { skipped: 'cap' };
  }
  let rt;
  // The runtime is forwarded, never invented: absent (or unknown) is the default adapter. `no-sdk` is a wire
  // word meaning "no agent runtime on this machine" on every runtime.
  try { rt = await deps.acquireRuntime(a.runtime); } catch (err) {
    diag('session-engine: agent runtime unavailable', err && err.message);
    return { skipped: 'no-sdk' };
  }
  // FIX #7: re-check after the await (slot-scoped, so only an id collision trips it).
  if (hasLiveSession(slot)) return { skipped: 'busy' };
  if (isAuthHeldSession(slot, rt && rt.id)) return { skipped: 'auth-hold' };
  // Asked before anything registers, so a signed-out launch leaves no record behind (P4-07).
  if (await credentialMissing(rt)) return { skipped: 'auth-hold' };
  // A model the runtime does not offer is REFUSED with a sentence, never swapped; before `startSession`, so
  // there is nothing to roll back.
  const modelRefusal = await refuseUnknownModel(a.runtime, a.model);
  if (modelRefusal) {
    diag('session-launch: model refused —', modelRefusal);
    return { skipped: 'no-model', detail: modelRefusal };
  }
  // No pick -> the runtime's own default, here and only here (and only a model its catalog just proved).
  const model = await launchDefault.withRuntimeDefault(rt, a.model);
  // A runtime with no orderable windowless tool floor would deny every read: refused before registration.
  // `disabled`, not a new wire word — the refusal set is closed (schema, service, copy map, migration CHECK).
  const floorRefusal = profiles.windowlessFloorRefusal(a.runtime);
  if (floorRefusal) {
    diag('session-launch: windowless launch refused —', floorRefusal);
    return { skipped: 'disabled' };
  }
  // A WARNING, not a refusal: an unreadable op fails closed at the gate, so the boundary holds.
  const opScopedWarning = profiles.axisBOpScopedWarning(a.runtime);
  if (opScopedWarning) diag('session-launch: Axis B is not op-scoped on this runtime —', opScopedWarning);
  // One funnel, three lanes, so the producers sit here (F-510). Neither can refuse a launch, and a key is added
  // only when there is something to say, so an unreached context stays byte-identical.
  const ontologies = await ontologyReach.fetchOntologyReach(a.workspaceId);
  const roster = await roomRoster.fetchRoomRoster({
    channelId: a.channelId,
    workspaceId: a.workspaceId,
    selfAgentId: agentId,
    selfUserId: a.selfUserId || null,
    memberCount: a.memberCount,
  });
  const extra = {};
  if (ontologies.length) extra.ontologies = ontologies;
  if (roster && (roster.agents.length || roster.people.length || roster.read === 'failed')) {
    extra.roster = roster;
  }
  const context = Object.keys(extra).length ? { ...(a.context || {}), ...extra } : a.context;
  const s = await deps.startSession({
    key,
    agentId,
    channelId: a.channelId,
    taskId: a.taskId,
    workspaceId: a.workspaceId,
    side: a.side,
    profile: a.toolProfile,
    mode: a.mode,
    context,
    counterpartyId: a.counterpartyId,
    direct: a.direct,
    firstMessage: a.firstMessage,
    // The posture a HUMAN chose for this launch — the only way one reaches a spawn (H2).
    startModes: a.startModes,
    model,
    // A colour grants nothing; the server may overrule it (unique per channel). It must be on this literal or it
    // is dropped silently (the bind() trap, F-510).
    color: a.color,
    windowless: a.windowless === true,
    // F-320's bound, forwarded, never defaulted: only the New Agent button passes 0; a `|| 0` here would invert it.
    launchDepth: a.launchDepth,
    // The channel's chaining setting, passed by the directive lane alone; never an ambient store read (H2).
    launchChain: a.launchChain === true,
    // Spawn idle: registered with prepared context, no query until the first message.
    parkedShell: a.idle === true,
    operatorArmed: a.operatorArmed === true,
    triggerSeq: a.triggerSeq,
  }, rt);
  if (!s) return { skipped: 'disabled' };
  if (s.authHold === true) return { skipped: 'auth-hold' };
  // The answer is the ADDRESS (and the model it launched with, for the directive echo).
  return { sessionId: s.sessionId, agentId: agentId, model };
}

/** The sentence refusing `model` on `runtimeId`, or null. Waits for the roster only when a model was named;
 *  fails OPEN — a roster Dopl cannot read is not evidence a model does not exist. */
async function refuseUnknownModel(runtimeId, model) {
  const v = typeof model === 'string' ? model.trim() : '';
  if (!v || v === 'default') return null;
  try {
    const adapter = require('./runtime').resolve(runtimeId);
    const catalogs = require('./runtime/model-catalog');
    const catalog = await catalogs.settle(adapter);
    return catalogs.modelRefusal(catalog, v, adapter.descriptor.label);
  } catch (err) {
    diag('session-launch: model roster unreadable, launch goes ahead —', err && err.message);
    return null;
  }
}

/** Does this runtime say, for certain, that this Mac has no credential? A failed probe is not a no. */
async function credentialMissing(rt) {
  if (!rt || typeof rt.credentialState !== 'function') return false;
  try {
    const state = await rt.credentialState();
    return !!state && state.usable === false;
  } catch (_) {
    return false;
  }
}

function launchResponderSession(a) {
  return launch({ ...a, side: 'responder', firstMessage: a.message });
}
function launchRequesterSession(a) {
  return launch({ ...a, side: 'requester', firstMessage: a.goal });
}

// With no `agentId` this asks about the THREAD; `launch()` re-checks its exact slot.
function hasLiveSession(a) {
  if (a && a.agentId) {
    const s = deps.sessions.get(store.slotKey(a));
    return !!(s && !s.settled);
  }
  return deps.liveOnThread(a).length > 0;
}

// H1: is any agent on this THREAD held on the sign-in for the runtime this launch uses? A thread, not the slot
// (a fresh instance id never collides); scoped by runtime (P4-22). The caller posts auth-hold, not a busy lie.
function isAuthHeldSession(slot, runtimeId) {
  return deps.liveOnThread(slot).some((s) => s.state && s.state.authHeld === true && s.runtimeId === runtimeId);
}

module.exports = {
  bind,
  launch,
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
};

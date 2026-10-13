// The spawn funnel: `launch`, its two lanes, and every question asked BEFORE a session exists (who may spawn,
// what id it wears, which refusal a caller gets). The refusal shapes are a wire contract — `trigger.js` and the
// directive lane answer peers with them. No electron: the engine's handles arrive via bind().

const store = require('./session-store');
const { newAgentId, isAgentId } = require('./agent-id');
const sessionWindowless = require('./session-windowless');
const launchBudget = require('./launch-budget');
// Pure: the windowless-floor refusal and the Axis-B warning, both asked of the runtime's own declaration.
const profiles = require('./session-profiles');
const operatorTools = require('./operator-tools');
// Producers for `context.ontologies` / `context.roster`; each requires lazily and never throws (F-681).
const ontologyReach = require('./ontology-reach');
// "Would a session launched now get the Dopl MCP server at all?" — requires lazily and never throws.
const deliveryPath = require('./delivery-path');
const { diag } = require('./diag');
const roomRoster = require('./room-roster');
const launchDefault = require('./runtime/launch-default');
const credentials = require('./runtime-credentials');

let deps = {
  sessions: null, acquireRuntime: null, startSession: null, liveOnThread: null, sessionOn: null, selfUserId: null,
};

// `bind` rebuilds `deps` from a literal: a handle the engine passes and this list omits is dropped silently.
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    acquireRuntime: (d && d.acquireRuntime) || null,
    startSession: (d && d.startSession) || null,
    liveOnThread: (d && d.liveOnThread) || null,
    sessionOn: (d && d.sessionOn) || null,
    // The signed-in operator's id (the engine's H2 identity), read at launch time — never off a caller's payload.
    selfUserId: (d && typeof d.selfUserId === 'function') ? d.selfUserId : null,
  };
}

async function launch(a) {
  // The only spawn shape is windowless (F-228).
  // ⚠ `detail` CARRIES THE HONEST SENTENCE (2026-10-11). `disabled`'s shipped line is the generic "The
  // agent could not be started", and the renderer prefers `detail` over it whenever main sent one
  // (`use-launch-controls.ts`), exactly as the model and protocol refusals below already rely on.
  // ⚠ `detail` IS SPELLED FIRST, deliberately. `device-token-no-cli.test.mjs` greps this function's raw
  // source for the `disabled` word followed immediately by a detail field, because the MUTE refusal must
  // come back from `delivery-path.js › muteRefusal` AS GIVEN rather than be rebuilt here. That rule
  // still holds in full — `return muteRefusal;` below is untouched — and its pattern is simply wider
  // than its subject: it cannot tell the mute refusal's shape from any other refusal's.
  if (!a.windowless) return { detail: 'Dopl only starts windowless agents.', skipped: 'disabled' };
  // ⚠ ONE SPELLING OF THE CONCURRENCY CEILING, AND IT IS LOCAL (2026-10-11). The expression
  // `liveCount(...) >= MAX_CONCURRENT_SESSIONS` was written out three times — once here and twice in
  // `session-park.js › startResume` — and only the park's two copies had ever learned that the ceiling
  // must be re-asked after an await. The divergence is what the duplication bought, so each side now
  // asks a named helper and no call site can disagree with its neighbour.
  // ⚠ INSIDE `launch` RATHER THAN AT MODULE SCOPE, and that is a test-harness constraint rather than a
  // design one: `test/_session-launch-funnel-harness.mjs` brace-matches THIS function out of the file
  // and evaluates it with its module bindings injected by name, so a module-level helper is simply
  // undefined there. `session-park.js` carries the twin of this helper for the same kind of reason.
  // RESIDUAL, stated: the two should be one export; that is a three-file change across files this wave
  // does not own.
  const atCap = () => sessionWindowless.liveCount(deps.sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS;
  // Mint the instance id at the one funnel: a caller may hand one in (a resume) but not invent a shape.
  const agentId = isAgentId(a.agentId) ? a.agentId : newAgentId();
  const slot = { channelId: a.channelId, taskId: a.taskId, agentId: agentId };
  const key = store.slotKey(slot);
  // No `busy` law: several agents per thread is normal; the concurrency ceiling bounds the machine. `trigger.js`
  // still handles `busy` (the post-await re-check below).
  if (atCap()) return { skipped: 'cap' };
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
  // Asked before anything registers, so a signed-out launch leaves no record behind (P4-07). The refusal raises
  // the runtime's sign-in prompt, unless the caller shows its own sign-in beside it (the New Agent dialog).
  if (isAuthHeldSession(slot, rt && rt.id) || await credentialMissing(rt)) {
    if (a.showsSignIn !== true) credentials.needSignIn(rt && rt.id);
    return { skipped: 'auth-hold' };
  }
  // A model the runtime does not offer is REFUSED with a sentence, never swapped; before `startSession`, so
  // there is nothing to roll back.
  const modelRefusal = await refuseUnknownModel(a.runtime, a.model);
  if (modelRefusal) {
    diag('session-launch: model refused —', modelRefusal);
    return { skipped: 'no-model', detail: modelRefusal };
  }
  // A build that no longer speaks the protocol Dopl reads — or one Dopl could not check — is REFUSED, never run
  // unchecked: a renamed safety field would otherwise be silently ignored by the vendor (`runtime/sdk-shape.js`).
  // `no-sdk` is the closed set's "this runtime cannot run here"; `detail` carries the sentence.
  const shapeRefusal = await refuseUnreadableProtocol(a.runtime);
  if (shapeRefusal) {
    diag('session-launch: protocol refused —', shapeRefusal);
    return { skipped: 'no-sdk', detail: shapeRefusal };
  }
  // NEVER RUN A MUTE AGENT, AND SAY SO BEFORE "started" (2026-10-10). A session with no Dopl bearer gets NO
  // `dopl` MCP server (`runtime/claude/mcp.js › buildMcpServers` returns {}) and `mcp-connect-guard.js` ends it
  // `mcp-unreachable` — after `session-launch-op.js` has already answered the clicking human `{ ok: true }`.
  // That guard is the backstop; this is the same ruling where it can still be read. Before `startSession`, so
  // there is nothing to roll back, and it covers all three lanes because all three go mute identically.
  // ⚠ `disabled` + `detail`, never a new wire word, and a probe that cannot read answers '' (fail OPEN) —
  // both reasoned out in `delivery-path.js`.
  const muteRefusal = deliveryPath.muteRefusal(await deliveryPath.deliveryBlockedReason());
  if (muteRefusal) {
    diag('session-launch: no Dopl delivery path —', muteRefusal.detail);
    return muteRefusal;
  }
  // No pick -> the runtime's own default, here and only here (and only a model its catalog just proved).
  const model = await launchDefault.withRuntimeDefault(rt, a.model);
  // Per-model picks (effort): the runtime's vocabulary, then what THIS model offers on the live catalog.
  const dimensions = await offeredDimensions(a.runtime, model, a.dimensions);
  // A runtime with no orderable windowless tool floor would deny every read: refused before registration.
  // `disabled`, not a new wire word — the refusal set is closed (schema, service, copy map, migration CHECK).
  // ⚠ AND IT SAYS WHICH (2026-10-11). `floorRefusal` is a readable sentence naming the runtime and the
  // reason, and it used to be thrown away into the diag log while the clicking human got the generic
  // "The agent could not be started". `detail` is the field the renderer already prefers over that copy
  // (`use-launch-controls.ts`), which the model and protocol refusals above already use. `detail` is
  // spelled first for the reason given at the `!a.windowless` arm at the top of this function.
  const floorRefusal = profiles.windowlessFloorRefusal(a.runtime);
  if (floorRefusal) {
    diag('session-launch: windowless launch refused —', floorRefusal);
    return { detail: floorRefusal, skipped: 'disabled' };
  }
  // A WARNING, not a refusal: an unreadable op fails closed at the gate, so the boundary holds.
  const opScopedWarning = profiles.axisBOpScopedWarning(a.runtime);
  if (opScopedWarning) diag('session-launch: Axis B is not op-scoped on this runtime —', opScopedWarning);
  // One funnel, three lanes, so the producers sit here (F-510). Neither can refuse a launch, and a key is added
  // only when there is something to say, so an unreached context stays byte-identical.
  const ontologies = await ontologyReach.fetchOntologyReach(a.workspaceId);
  // The signed-in operator, resolved HERE for every lane (New Agent, responder, directive) so none can forget it;
  // null while unresolved, and the roster then fails open.
  let selfUserId = null;
  try { selfUserId = (deps.selfUserId && deps.selfUserId()) || null; } catch (_) { selfUserId = null; }
  const roster = await roomRoster.fetchRoomRoster({
    channelId: a.channelId,
    workspaceId: a.workspaceId,
    selfAgentId: agentId,
    selfUserId,
    memberCount: a.memberCount,
  });
  const extra = {};
  if (ontologies.length) extra.ontologies = ontologies;
  if (roster && (roster.agents.length || roster.people.length || roster.read === 'failed')) {
    extra.roster = roster;
  }
  const context = Object.keys(extra).length ? { ...(a.context || {}), ...extra } : a.context;
  // ⚠ THE CEILING, RE-ASKED AFTER THE AWAITS (2026-10-11). The check at the top of this function ran
  // a run of awaits ago — the runtime probe, the credential probe, two refusal checks, the delivery-path
  // probe, the model default, the offered dimensions, the ontology reach and the room roster — and `trigger.js` fires
  // `void launchResponderSession(...)`, so two Allow clicks interleave through every one of them. Both
  // passed a cap that was true when they asked and false by the time they spawned, and the machine
  // ended up over `MAX_CONCURRENT_SESSIONS` with no refusal anywhere. The post-await re-check above is
  // SLOT-scoped (a fresh instance id never collides), so it could not catch this.
  // ⚠ HERE, IMMEDIATELY BEFORE `startSession`, because `startSession` registers the session in the
  // engine's Map SYNCHRONOUSLY (before its own first await) — so nothing can take the last slot
  // between this question and the registration that answers it. The same `cap` word and the same
  // precedent as `session-park.js › startResume`, which re-asks after its one await for this reason.
  if (atCap()) return { skipped: 'cap' };
  const s = await deps.startSession({
    key,
    agentId,
    channelId: a.channelId,
    taskId: a.taskId,
    workspaceId: a.workspaceId,
    side: a.side,
    profile: a.toolProfile,
    // Read once here for all three lanes, from main's own roster and store, never the payload.
    operatorTools: operatorTools.launchScope(a.channelId, a.toolProfile),
    mode: a.mode,
    context,
    counterpartyId: a.counterpartyId,
    direct: a.direct,
    firstMessage: a.firstMessage,
    // The posture a HUMAN chose for this launch — the only way one reaches a spawn (H2).
    startModes: a.startModes,
    model,
    dimensions,
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
    // The pushed first turn is the operator's (the directive lane alone): it opens no peer window.
    firstTurnFromOperator: a.firstTurnFromOperator === true,
    triggerSeq: a.triggerSeq,
    // The name the launcher asked for; `startSession` commits it (unique per channel) before the first turn.
    // Absent = no commit here (the New Agent button renames after its idle launch, before any turn).
    agentName: typeof a.agentName === 'string' ? a.agentName : undefined,
  }, rt);
  // ⚠ THERE IS NO `if (!s)` ARM (deleted 2026-10-11), because `startSession` cannot answer falsy. Its
  // four returns are `null` (behind `if (!sessionWindowless.attachSurface(s, spec))`), `{ authHold: true }`
  // and the session twice — and `attachSurface` is `s.windowless = true; return true;`, unconditionally
  // true, so that `null` is unreachable. The arm answered it with a bare `{ skipped: 'disabled' }`, i.e.
  // the generic "could not be started" for a case that cannot happen. A THROW out of `startSession`
  // propagates, as it always did, and was never this arm's business.
  // ⚠ WHAT KEEPS THAT TRUE is not this comment: `session-launch-refusal-detail.test.mjs` pins
  // `attachSurface` as unconditionally true, so a surface that could really fail to attach fails that
  // case and names this arm as the other half it needs back.
  if (s.authHold === true) return { skipped: 'auth-hold' };
  // The answer is the ADDRESS (and the model and the STORED name, for the directive echo).
  const agentName = (s.context && typeof s.context.agentName === 'string' && s.context.agentName) || null;
  // ⚠ `agent_started` (Samuel's spec, 2026-10-09 — KB dopl-development "Notification Spec Samuel
  // 2026-10-09"). HERE, at the one funnel all three lanes pass through (New Agent, responder,
  // directive), and only once a session really exists — after the two skip returns above, so a
  // refused launch never claims one started.
  //
  // ⚠ WHY NOT THE CHANNEL MESSAGE: `task_started` is dropped at `targeting.js › classify` by the
  // `kind !== 'message'` guard and always was, which is why this needed a new emit rather than a
  // new arm. It is a LOCAL fact about this machine's spawns, so a local emit is also the honest
  // place for it.
  //
  // ⚠ COALESCED: a fan-out where one agent launches several must be ONE notice, not one each
  // (Samuel). The route holds a short window and names the total.
  // ⚠ BEST-EFFORT AND LAST: a notification may never change whether a launch succeeded, so this
  // sits after everything the answer depends on and cannot throw into it.
  // ⚠ LAZY REQUIRE, like `refuseUnknownModel`'s `./runtime` below, and for this file's stated
  // reason: "No electron" at the top. The route reaches electron (lazily itself), and this
  // module's own dependency set must stay free of it.
  try {
    require('./notification-route').raiseCoalesced('agent_started', (count) => ({
      title: count > 1 ? `${count} agents started` : 'An agent started',
      body: count > 1
        ? 'They are running on this computer.'
        : `${agentName || 'An agent'} is running in "${(a.context && a.context.channelName) || 'a channel'}".`,
    }));
  } catch (err) {
    diag('session-launch: agent_started notice failed —', (err && err.message) || 'error');
  }
  return { sessionId: s.sessionId, agentId: agentId, model, agentName };
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

/** The sentence refusing a launch on `runtimeId` for its protocol, or null. Fails CLOSED: a check that could not
 *  run refuses (with its cause) — the opposite of the model roster, because what is at stake is Dopl's restrictions. */
async function refuseUnreadableProtocol(runtimeId) {
  let adapter;
  try { adapter = require('./runtime').resolve(runtimeId); } catch (err) {
    return `Dopl could not load this runtime to check it (${(err && err.message) || 'unknown runtime'}).`;
  }
  try {
    return await require('./runtime/sdk-shape').launchShapeRefusal(adapter);
  } catch (err) {
    return `Dopl could not check this runtime's protocol (${(err && err.message) || 'unknown error'}), so it will not start it.`;
  }
}

/** `a.dimensions` narrowed to what the runtime declares AND the launched model offers on a READY catalog.
 *  A catalog that cannot vouch (loading, stale) drops them: the platform picks its own default rather than be
 *  sent a value no read proved this model offers. Never throws. */
async function offeredDimensions(runtimeId, model, raw) {
  try {
    const registry = require('./runtime');
    const adapter = registry.resolve(runtimeId);
    const picks = registry.capability.launchDimensionPicks(adapter.descriptor, raw);
    if (!Object.keys(picks).length) return {};
    const catalogs = require('./runtime/model-catalog');
    const out = catalogs.offeredDimensions(await catalogs.settle(adapter), model, picks);
    for (const key of Object.keys(picks)) {
      if (!(key in out)) diag(`session-launch: ${key}=${picks[key]} is not offered by this model — dropped (the platform picks)`);
    }
    return out;
  } catch (err) {
    diag('session-launch: dimension picks unreadable — none sent', err && err.message);
    return {};
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

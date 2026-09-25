// The session engine: the imperative shell. It owns one runtime query per live session and executes
// the pure reducer's effect descriptors; which runtime is `main/runtime/index.js`'s answer. Every
// session is windowless. Imports no electron; everything stateful is injected into the split modules.

const crypto = require('crypto');
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const sessionReopen = require('./session-reopen');
const sessionAnswerPermission = require('./session-answer-permission');
const sessionSummary = require('./session-summary');
const sessionPark = require('./session-park'); const sessionBoot = require('./session-boot');
const framing = require('./prompt-framing');
const sessionAuth = require('./session-auth'); const mcpGuard = require('./mcp-connect-guard');
const { initialSessionState, sessionReducer, idleTimeout } = require('./session-reducer');
const sessionEffects = require('./session-effects');
const { floorWindowlessMessage, toolModesFor } = require('./session-profiles');
const runtimeRegistry = require('./runtime'); const acquireRuntime = runtimeRegistry.acquire;
const sessionQuery = require('./session-query'); const { buildLaunchSpec, startQuery, consume } = sessionQuery;
const sessionNarration = require('./session-narration');
const sessionGate = require('./session-gate');
const sessionWindowless = require('./session-windowless');
const agentHistory = require('./agent-history');
const sessionPrivate = require('./session-private');
const sessionDirected = require('./session-directed');
const sessionRegistry = require('./session-registry');
const { liveOnThread, sessionOn, noteSiblings } = sessionRegistry;
const sessionTeardown = require('./session-teardown');
const { teardownHandles } = require('./session-handles');
const { settle, narrationFor } = sessionTeardown;
const sessionPermissions = require('./session-permissions');
const { denyPendingPermissions, resolvePerm } = sessionPermissions;
const sessionLaunch = require('./session-launch');
const { launchResponderSession, launchRequesterSession, hasLiveSession } = sessionLaunch;

const { readCaps, refreshTray, runLifecycle, setLifecycleHandlers } = require('./session-engine-host');

const sessions = new Map();
let selfUserId = null;
function setSelfIdentity(id) { selfUserId = id || null; }

// Helpers take the engine's handles by injection (none requires back); read at call time, so order is free.
sessionPark.bind({
  sessions, acquireRuntime, buildLaunchSpec, consume, dispatch, startSession, hasLiveSession,
  preflightMcp: sessionQuery.preflightMcp, holdIfNoCredential: sessionAuth.holdIfNoRuntimeCredential,
}); sessionBoot.bind({ sessions, runLifecycle, scheduleIdle });
sessionQuery.bind({ dispatch, scheduleIdle });
sessionAuth.bind({ sessions, dispatch, denyPending: denyPendingPermissions, teardown: teardownHandles });
mcpGuard.bind({ acquireRuntime, startQuery, dispatch, denyPending: denyPendingPermissions, resumeParked: sessionPark.resumeParked, abortInFlight: sessionQuery.abortInFlight });
sessionGate.bind({ sessions, dispatch });
sessionReopen.bind({ sessions, refreshTray, dispatch, openAgentWindow: (t) => require('./agent-window').openAgentWindow(t) });
sessionAnswerPermission.bind({ resolveSession: sessionReopen.resolveSession, dispatch });
sessionSummary.bind({ sessions, endedRecords: agentHistory.listEnded }); sessionNarration.bind({ sessions });
// `nameOf` is the rename store's read (electron-backed, so lazy): the framing's `ctx.agentName`.
sessionRegistry.bind({ sessions, nameOf: (id) => require('./agent-names').displayNameFor(id) });
// `selfUserId` is the operator identity the listener resolved (H2): every launch lane's roster reads it here.
sessionLaunch.bind({ sessions, acquireRuntime, startSession, liveOnThread, sessionOn, selfUserId: () => selfUserId });
sessionTeardown.bind({ sessions, baseRecord: (s) => io.baseRecord(s), denyPendingPermissions, refreshTray, sessionOn });

const baseRecord = io.baseRecord;

/** The one dispatch funnel. Answers whether an effect resolved a LIVE held-tool promise (FIX F1). */
function dispatch(s, event) {
  // A turn ended: spend one unit of the private window (a fact about the session object, not reducer state).
  if (event && event.type === 'result') { sessionPrivate.closePrivateTurn(s); sessionPrivate.closePeerTurn(s); }
  if (event && (event.type === 'steer' || event.type === 'inbound_arrived')) s.awaitingDirective = false;
  const wasInFlight = sessionPrivate.turnInFlight(s.state);
  const { state, effects } = sessionReducer(s.state, event);
  s.state = state; sessionSummary.noteActivity(s, event); sessionNarration.note(s, event); sessionDirected.observe(s, event);
  let resolvedLive = false;
  for (const eff of effects) resolvedLive = runEffect(s, eff) === true || resolvedLive;
  notePeerPush(s, event, effects, wasInFlight);
  return resolvedLive;
}

// A push the operator did not author (anyone else's channel message, a direction) opens the peer window,
// AFTER the effects: a wake resets the windows first (F-372). Its text lets a joined push pay its turn back.
function notePeerPush(s, event, effects, wasInFlight) {
  const inbound = effects.find((e) => e.type === 'pushInbound' && e.fromOperator !== true);
  const directed = event && event.type === 'steer' && event.directed === true && effects.some((e) => e.type === 'pushTurn');
  if (inbound || directed) sessionPrivate.openPeerTurn(s, wasInFlight, inbound ? inbound.message : event.text);
}

function runEffect(s, eff) {
  switch (eff.type) {
    case 'emit':
      // The ended line is minted here: `settle` freezes the ring into history right after.
      if (eff.payload && eff.payload.type === 'ended') sessionNarration.noteEnded(s, eff.payload);
      emit(s, eff.payload);
      break;
    case 'persist':
      // A park saves the full record; the effect's phase is authoritative (state may read awaiting_inbound).
      if (eff.phase === 'parked') store.saveRecord({ ...baseRecord(s), phase: eff.phase });
      else store.setRecordPhase(s.key, eff.phase);
      break;
    case 'scheduleIdle': scheduleIdle(s); break;
    case 'resolvePermission':
      return resolvePerm(s, eff.requestId, eff.decision);
    // Both pushes refresh the sibling roster first: `withSeed` may build a spawn-idle agent's FIRST turn here.
    case 'pushTurn':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, eff.text), eff.priority === 'now' ? 'now' : undefined));
      break;
    case 'pushInbound':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName, eff.addressing, eff.authorNote, s.doplToolSet, io.replyFor(s, eff.replyTo)))));
      break;
    case 'interruptQuery':
      // The interrupted turn still ends with a `result`; the direction it was answering lapses (P4-08).
      sessionDirected.resetDirected(s);
      if (s.query && typeof s.query.interrupt === 'function') {
        try { s.query.interrupt().catch(() => {}); } catch (_) { /* best effort */ }
      } else if (s.query) {
        diag('session-engine: interrupt ignored — this runtime declares none', String(s.runtimeId || ''));
      }
      break;
    case 'abortQuery':
      // A torn-down query owes no results: the private window and the directed capture reset with it.
      sessionPrivate.resetPrivateTurn(s); sessionPrivate.resetPeerTurn(s);
      sessionDirected.resetDirected(s);
      // The runtime's handle too: a Codex child ends only on `close()` (P4-14).
      teardownHandles(s);
      break;
    case 'denyPending':
      sessionPrivate.resetPrivateTurn(s); sessionPrivate.resetPeerTurn(s);
      sessionDirected.resetDirected(s);
      denyPendingPermissions(s, 'Session paused');
      break;
    case 'clearIdle': if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; } break;
    case 'resumeQuery': sessionPark.resumeParked(s); break;
    case 'lifecycle': runLifecycle(s, eff.kind, eff.extra, eff.body); break;
    case 'settle': settle(s, eff.outcome); break;
    default: diag('session-engine: unknown effect', eff && eff.type);
  }
}

// Only a held gate has a receiver: `session-windowless.js` bridges it to a consent row or a notification.
function emit(s, payload) {
  sessionWindowless.claimGate(s, payload, (rid, d) => dispatch(s, { type: 'permission_decision', requestId: rid, decision: d }));
}
function scheduleIdle(s) {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  // One timer per session; a parked session waits on the abandonment bound.
  const t = idleTimeout(s.state);
  s.idleTimer = setTimeout(() => { if (!s.settled) dispatch(s, { type: t.type }); }, t.ms);
}

/** Build, register and launch one session (every spawn shape). The nonce is minted here so the first
 *  turn's fence and every fed continuation share it. */
async function startSession(spec, rt) {
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  // A stored posture reaches a spawn only when a caller executing a human decision hands it in (H2); a
  // parked shell refuses it unless `operatorArmed`. The runtime's `native` settings ride the same gate.
  const armedModes = spec.startModes;
  const operatorArmed = spec.operatorArmed === true;
  const startModes = armedModes && (!spec.parkedShell || operatorArmed)
    ? { toolMode: armedModes.tools, messageMode: spec.windowless === true ? floorWindowlessMessage(armedModes.messages) : armedModes.messages, native: armedModes.native, pinned: armedModes.pinned }
    : {};
  const state = initialSessionState({ mode: spec.mode, side: spec.side, ...readCaps(spec), ...startModes, toolModes: toolModesFor(rt && rt.id) });
  // The windowless message floor at the one construction site, for shapes that hand in nothing (F-236).
  if (spec.windowless === true) state.messageMode = floorWindowlessMessage(state.messageMode);
  // The turn counter rehydrates on every resume shape (P4-10).
  state.turns = Number(spec.turns) || 0;
  // Spawn idle: registered with no query; the first fed turn resumes it (`wakeEffects`).
  if (spec.parkedShell) { state.phase = 'parked'; state.parked = true; state.activity = 'parked'; }
  const context = { ...(spec.context || {}), channelId: spec.channelId, workspaceId: spec.workspaceId };
  const s = {
    key: spec.key,
    sessionId,
    sdkSessionId: spec.resumeSdkId || null,
    // Stamped at spawn, never re-read: the conversation handle, tool vocabulary and modes are one runtime's.
    runtimeId: (rt && rt.id) || runtimeRegistry.DEFAULT_ID,
    channelId: spec.channelId,
    taskId: spec.taskId || '',
    workspaceId: spec.workspaceId,
    side: state.side,
    // Containment stamps: absent `launchDepth` reads as the cap at the gate; `launchChain` only `=== true`.
    profile: spec.profile, launchDepth: spec.launchDepth, launchChain: spec.launchChain === true,
    // "Use my tools" scope, stamped at launch: what the adapter loads. The gate still asks per turn.
    operatorTools: spec.operatorTools || '',
    mode: state.mode,
    counterpartyId: spec.counterpartyId || null,
    bind: spec.bind === 'room' ? 'room' : 'pair',
    // The instance id: third key segment, the pill's name, the @-mention handle and the post stamp.
    agentId: spec.agentId || null,
    // Only `=== true`: the outbound card names a recipient only when the server addresses the post.
    direct: spec.direct === true,
    counterpartyName: (spec.context && (spec.context.authorName || spec.context.targetName)) || null,
    // Coerced against this session's runtime vocabulary; the adapter re-coerces before argv.
    model: runtimeRegistry.capability.launchModelPick(
      runtimeRegistry.descriptorFor((rt && rt.id) || null), spec.model
    ),
    // The colour this spawn ASKED for; the server resolves it (unique per channel across members).
    color: spec.color || null,
    state,
    context, // display identity + the channel/workspace ids the framing addresses
    nonce,
    // Built below, once the session is registered and named (`firstTurnFor`).
    firstTurn: '',
    resumeSdkId: spec.resumeSdkId || null,
    startedAt: Date.now(),
    // Token delta baseline: `tokensSpent` is not in the record, so both start at 0.
    lastTotalTokens: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [],
    // A shell with nothing to resume starts a new conversation, so its first turn carries the full framing.
    freshRun: spec.parkedShell === true && !spec.resumeSdkId,
    freshFraming: spec.parkedShell === true && !spec.resumeSdkId,
    launchGoal: spec.parkedShell === true ? String(spec.firstMessage == null ? '' : spec.firstMessage) : '',
    // True while spawn-idle and undirected: only a message naming this agent (or a 1:1) reaches it.
    awaitingDirective: spec.parkedShell === true,
    idleTimer: null,
    settled: false,
    lastInboundSeq: Number.isFinite(Number(spec.triggerSeq)) ? Number(spec.triggerSeq) : null,
    // Own posts' client_msg_ids: the fan-out's self-filter (bounded in session-dispatch).
    ownPostIds: new Set(),
    // Rehydrated with slack so a resume never re-mints an id the server holds (idempotency discards it).
    ownPostSeq: store.resumedPostSeq(spec.ownPostSeq),
    query: null, abortController: null, pushIterator: null,
  };
  // The cross-account stamp, written once: the registry outlives a sign-out, and the direct lane fences on it.
  s.operatorUserId = selfUserId || null;
  // Registration is a projection move: the pill must not wait for the first dispatch.
  sessions.set(s.key, s); sessionSummary.touch();
  store.saveRecord(baseRecord(s));
  // A surface that cannot attach un-registers the session.
  if (!sessionWindowless.attachSurface(s, spec)) {
    sessions.delete(s.key); sessionSummary.touch();
    return null;
  }
  // The credential hold rolls the registration back BEFORE the spawn-idle return, so a signed-out
  // New Agent answers auth-hold rather than an address.
  const credentialHeld = await sessionAuth.holdIfNoRuntimeCredential(s, rt);
  if (credentialHeld) { sessions.delete(s.key); sessionSummary.touch(); return { authHold: true }; }
  // The tool set this session speaks (DMP-013), known before the first turn spells a call in it.
  await sessionQuery.stampToolSet(s);
  nameAndFrame(s, spec, rt);
  // Spawn idle starts no child (a held query would hold channel access unwatched); the timer arms the
  // abandonment bound, since no reducer event has run yet.
  if (spec.parkedShell) {
    scheduleIdle(s);
    diag('session spawned IDLE (no query until the first message)', 'agent', String(s.agentId || ''), 'thread', String(s.taskId || '').slice(0, 8));
    return s;
  }
  await startQuery(s, rt);
  return s;
}

/** After registration, before any turn: commit the launch's name — registered, so the uniqueness rule sees this
 *  channel's live siblings and excludes this agent — stamp the context's id + name, then build the first turn
 *  off that context, so it states the FINAL name on every runtime. */
function nameAndFrame(s, spec, rt) {
  if (typeof spec.agentName === 'string') commitLaunchName(s, spec.agentName);
  noteSiblings(s);
  s.firstTurn = firstTurnFor(s, spec, rt);
}

/** The first user turn, off the stamped context. A parked shell pushes nothing now: `launchGoal` carries the
 *  goal to its wake turn (`takeFraming`); a resume pushes its raw nudge. */
function firstTurnFor(s, spec, rt) {
  if (spec.parkedShell) return '';
  if (spec.rawFirstTurn) return spec.rawFirstTurn;
  return framing.buildFencedTurn({ side: spec.side, message: spec.firstMessage, context: { ...s.context, profile: spec.profile, operatorTools: s.operatorTools, toolSet: s.doplToolSet, mcpDiscovery: io.discoveryFor(rt && rt.id) }, nonce: s.nonce });
}

/** Store the name a launch asked for through the one rename door (uniqueness + sanitizer + summary flush).
 *  Never fails a launch: a refusal or a throw leaves the agent unnamed, which the caller reports. */
function commitLaunchName(s, wanted) {
  try {
    const res = require('./agent-identity-commit').commitRename(s.agentId, wanted);
    if (!res || !res.ok) diag('session-engine: launch name REFUSED —', (res && res.reason) || 'no reason given', '— agent', String(s.agentId || ''), 'runs unnamed');
  } catch (err) {
    diag('session-engine: could not store the launch name —', err && err.message);
  }
}

/** App start: a record that was live when the app died ends with an interrupted echo and an opt-in
 *  resume offer; a parked one is re-parked or ended visibly (F-694); the prune runs after both. */
async function init() {
  const records = store.loadRecords();
  for (const key of Object.keys(records)) {
    const rec = records[key];
    if (!rec || store.reloadDisposition(rec.phase) !== 'resume') continue;
    store.setRecordPhase(key, 'ended');
    runLifecycle({ channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId, key, sdkSessionId: store.getSdkSessionId(key) }, 'task_failed', { interrupted: true }, sessionEffects.terminalBody({ interrupted: true }));
    const sdkId = store.getSdkSessionId(key);
    if (sdkId) sessionPark.offerResume(rec, sdkId);
  }
  try { sessionBoot.reparkDormant(); } catch (err) { diag('session-engine: repark failed', err && err.message); }
  try { store.pruneRecords({ keep: new Set(sessions.keys()) }); } catch (err) { diag('session-engine: prune failed', err && err.message); }
}

module.exports = {
  init,
  setLifecycleHandlers,
  setSelfIdentity,
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
  liveOnThread,
  sessionOn,
  feedInbound: sessionGate.feedInbound,
  listLiveSessions: sessionReopen.listLiveSessions, listOrphanRisk: sessionReopen.listOrphanRisk, endLiveSessions: sessionReopen.endLiveSessions,
  reopenByTask: sessionReopen.reopenByTask, controlByTask: sessionReopen.controlByTask, setModeByTask: sessionReopen.setModeByTask, messageByTask: sessionReopen.messageByTask,
  setModelByTask: sessionReopen.setModelByTask,
  answerPermissionByTask: sessionAnswerPermission.answerPermissionByTask,
  // The work lane for an ADDRESS (channel, thread, agent), live or frozen.
  narrationFor,
};

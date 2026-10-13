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
// The continuous-work cap's clock: live frames re-arm the idle TTL, this bounds how long they may.
const workCap = require('./session-work-cap');
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
  // A turn ended: spend one unit of the private window, and END THE WORK STRETCH — the continuous-work cap
  // measures unbroken work, so the next stretch starts from its own first frame rather than inheriting this
  // one's age (`session-work-cap.js`).
  if (event && event.type === 'result') {
    sessionPrivate.closePrivateTurn(s); sessionPrivate.closePeerTurn(s); endWorkStretch(s);
  }
  // ⚠ BEFORE THE EFFECTS RUN: the live-frame arm's own `scheduleIdle` reads this set in its timer
  // callback, so a `tool_use` must already be counted and a `tool_result` must already be gone.
  noteToolFrame(s, event);
  if (event && (event.type === 'steer' || event.type === 'inbound_arrived')) s.awaitingDirective = false;
  const wasInFlight = sessionPrivate.turnInFlight(s.state);
  const { state, effects } = sessionReducer(s.state, event);
  s.state = state; sessionSummary.noteActivity(s, event); sessionNarration.note(s, event); sessionDirected.observe(s, event);
  let resolvedLive = false;
  for (const eff of effects) resolvedLive = runEffect(s, eff) === true || resolvedLive;
  notePeerPush(s, event, effects, wasInFlight);
  return resolvedLive;
}

/**
 * WHICH TOOL CALLS THE RUNTIME HAS STARTED AND NOT YET ANSWERED (2026-10-11, review item 3).
 *
 * ⚠ THE DEFECT IT CLOSES, which "never park mid-work" did NOT close. The only re-arm sources are
 * `tool_use`, `tool_result`, `assistant` and `thinking`; there is no heartbeat, and the normalizer's
 * `context` frames are consumed by `session-io.js › applyCoreEvents` and deliberately never dispatched.
 * So ONE long tool call emits `tool_use` at T and then nothing at all until it returns: a twenty-minute
 * `Bash` or `Task` call hit `idle_timeout` at T+15m and `abortQuery` tore the query down mid-call, which
 * is precisely the defect the work re-arm was introduced to fix. A stream of SHORT calls was covered; the
 * single long one, which is the case the ruling was written about, was not.
 *
 * ⚠ IDS, NOT A COUNT. Parallel calls are ordinary, and a count that drifted by one would either hold a
 * quiet session open forever or park a working one. An id whose result never arrives just sits here until
 * the turn's own boundary clears it.
 * ⚠ AND THE BOUNDARY CLEARS IT, which is what bounds the set: `endWorkStretch` runs at every place
 * `workCap.noteBoundary` does — the turn end and every query teardown — so nothing survives its turn.
 * ⚠ `tool_use` ONLY, not `outbound_post`. A gated own-channel post waits on a HUMAN, not on work, and
 * `TOOL_GATE_TTL_MS` already bounds that wait; holding the park open for it is a different ruling.
 */
function noteToolFrame(s, event) {
  const type = event && event.type;
  if (type !== 'tool_use' && type !== 'tool_result') return;
  const id = event.payload && event.payload.toolUseId;
  if (!id) return;
  if (!s.toolsInFlight) s.toolsInFlight = new Set();
  if (type === 'tool_use') s.toolsInFlight.add(id);
  else s.toolsInFlight.delete(id);
}

/** Is a tool call still outstanding on this session? */
function toolInFlight(s) {
  return !!(s.toolsInFlight && s.toolsInFlight.size);
}

/** THE WORK STRETCH IS OVER: the continuous-work clock and the in-flight set, cleared together. Both
 *  measure the same span, so a site that cleared one and not the other would leave the other lying. */
function endWorkStretch(s) {
  workCap.noteBoundary(s);
  if (s.toolsInFlight) s.toolsInFlight.clear();
}

// A push the operator's account did not author (another member's or their agent's message) opens the peer window,
// AFTER the effects: a wake resets the windows first (F-372). Its text lets a joined push pay its turn back.
// A direction is never one: only the operator's own account can file it (`agent-directions.js`; Samuel, 2026-09-25).
function notePeerPush(s, event, effects, wasInFlight) {
  const inbound = effects.find((e) => e.type === 'pushInbound' && e.fromOperator !== true);
  if (inbound) sessionPrivate.openPeerTurn(s, wasInFlight, inbound.message);
}

function runEffect(s, eff) {
  switch (eff.type) {
    case 'emit':
      // The ended line is minted here: `settle` freezes the ring into history right after.
      if (eff.payload && eff.payload.type === 'ended') sessionNarration.noteEnded(s, eff.payload);
      emit(s, eff.payload);
      break;
    case 'persist':
      // A park saves the full record.
      if (eff.phase === 'parked') store.saveRecord({ ...baseRecord(s), phase: eff.phase });
      else store.setRecordPhase(s.key, eff.phase);
      break;
    case 'scheduleIdle': scheduleIdle(s, eff); break;
    case 'resolvePermission':
      return resolvePerm(s, eff.requestId, eff.decision);
    // Both pushes refresh the sibling roster first: `withSeed` may build a spawn-idle agent's FIRST turn here.
    case 'pushTurn':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, eff.text), eff.priority === 'now' ? 'now' : undefined));
      break;
    case 'pushInbound':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName, eff.addressing, eff.authorNote, s.doplToolSet, io.replyFor(s, eff.replyTo), eff.source, eff.catchUpSeq, s))));
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
      // ⚠ AND SO DOES THE WORK STRETCH. Park, crash and end all run this, so it is the one place that
      // catches every teardown — and a stamp left behind by a stretch that parked hours ago would make the
      // FIRST frame of the next one read as already past the cap and park it instantly, on a loop.
      // ⚠ AND THE IN-FLIGHT TOOL SET WITH IT: a torn-down query owes no tool results, so an id left
      // behind would hold the NEXT stretch's park open against a tool nothing is running.
      endWorkStretch(s);
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
    // The drop report (`session-drop-notice.js`): a park that posted nothing, or an end nobody
    // chose. Beside the lifecycle marker, never instead of it — the marker is for the waiting
    // peer, this is for whoever launched the agent.
    case 'notice': require('./session-drop-notice').report(s, eff); break;
    case 'settle':
      // The cause, stamped before the teardown freezes history off `s` (`session-teardown.js`).
      if (eff.endCode && !s.endCode) s.endCode = eff.endCode;
      settle(s, eff.outcome);
      break;
    default: diag('session-engine: unknown effect', eff && eff.type);
  }
}

// Only a held gate has a receiver: `session-windowless.js` bridges it to a consent row or a notification.
function emit(s, payload) {
  sessionWindowless.claimGate(s, payload, (rid, d) => dispatch(s, { type: 'permission_decision', requestId: rid, decision: d }));
}
/**
 * ONE TIMER PER SESSION; a parked session waits on the abandonment bound.
 *
 * ⚠ A WORK RE-ARM IS CLAMPED TO THE CONTINUOUS-WORK CAP (2026-10-10, Samuel's "never park mid-work"). Live
 * frames re-arm this timer so a long task is not parked mid-tool-call, and `session-work-cap.js` is what
 * stops that from making a runaway loop unparkable: the stretch is stamped by its first frame, and once two
 * hours of UNBROKEN work have passed the timer is armed at zero and the ordinary `idle_timeout` parks the
 * session, resumable, exactly as a quiet one parks today.
 * ⚠ THE CLAMP ONLY EVER SHORTENS, and only an `idle_timeout`. The LAUNCH WATCHDOG (`inactive`) and the
 * ABANDONMENT bound are other questions on other clocks — a cap that could shorten the watchdog would
 * end a launch the transport can still recover.
 * ⚠ AND A WORK RE-ARM NOW LEAVES THOSE TWO TIMERS ALONE ENTIRELY (2026-10-11, review item 4). The CLAMP
 * was gated on `t.type === 'idle_timeout'`; the ARMING was not. So a live frame arriving while the
 * session was still `launching` re-armed the WATCHDOG at a full five minutes, unclamped, on every
 * frame — an unboundedly extendable bound on a runtime that streams before `system/init`, which is the
 * one thing `session-launch-watchdog.js`'s case exists to prevent. This doc claimed those were "left
 * exactly as they were" while the code moved one of them.
 * ⚠ AND A TOOL STILL IN FLIGHT HOLDS THE ORDINARY PARK OPEN (2026-10-11, review item 3). The timer may
 * expire in the middle of a single long tool call, because nothing streams between its `tool_use` and
 * its `tool_result`; when it does, the park is DEFERRED rather than taken — but only while
 * `session-work-cap.js` still has room, so a tool that never returns parks at the two-hour cap exactly
 * as a runaway loop does. The cap reaching zero is also what stops the deferral being a busy loop.
 */
function scheduleIdle(s, eff) {
  const t = idleTimeout(s.state);
  const work = !!(eff && eff.from === 'work');
  if (work && t.type !== 'idle_timeout' && s.idleTimer) return;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  const ms = work && t.type === 'idle_timeout' ? workCap.workIdleMs(s, t.ms, Date.now()) : t.ms;
  s.idleTimer = setTimeout(() => {
    if (s.settled) return;
    if (t.type === 'idle_timeout' && toolInFlight(s) && workCap.capMsLeft(s, Date.now()) > 0) {
      scheduleIdle(s, { from: 'work' });
      return;
    }
    dispatch(s, { type: t.type });
  }, ms);
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
    // Per-model picks (effort), coerced against this runtime's vocabulary; the adapter reads them at argv.
    dimensions: runtimeRegistry.capability.launchDimensionPicks(
      runtimeRegistry.descriptorFor((rt && rt.id) || null), spec.dimensions
    ),
    // The colour this spawn ASKED for; the server resolves it (unique per channel across members).
    color: spec.color || null,
    state,
    context, // display identity + the channel/workspace ids the framing addresses
    nonce,
    // Built below, once the session is registered and named (`firstTurnFor`).
    firstTurn: '',
    firstTurnFromOperator: spec.firstTurnFromOperator === true,
    resumeSdkId: spec.resumeSdkId || null,
    startedAt: Date.now(),
    // Token delta baseline: `tokensSpent` is not in the record, so both start at 0.
    lastTotalTokens: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    // A shell with nothing to resume starts a new conversation, so its first turn carries the full framing.
    freshRun: spec.parkedShell === true && !spec.resumeSdkId,
    freshFraming: spec.parkedShell === true && !spec.resumeSdkId,
    launchGoal: spec.parkedShell === true ? String(spec.firstMessage == null ? '' : spec.firstMessage) : '',
    // True while spawn-idle and undirected: only a message naming this agent (or a 1:1) reaches it.
    awaitingDirective: spec.parkedShell === true,
    idleTimer: null,
    settled: false,
    lastInboundSeq: Number.isFinite(Number(spec.triggerSeq)) ? Number(spec.triggerSeq) : null,
    catchUp: io.initialCatchUp(spec), // the wake's `since=` mark (`session-seed.js › initialCatchUp`)
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
  // ⚠ THIS BRANCH IS CURRENTLY DEAD, SAID OUT LOUD (2026-10-11, review item 5). `attachSurface` has been
  // `s.windowless = true; return true;` since F-228 retired the window branch, so `!attachSurface(...)`
  // cannot be true and this `return null` cannot be reached — which is why `session-launch.js`'s
  // `if (!s) return { skipped: 'disabled' }` arm, whose ONLY job was to answer it, is deleted.
  // ⚠ IT IS KEPT HERE RATHER THAN DELETED WITH IT, for two reasons: `session-summary.test.mjs` counts the
  // registry mutations in this function (the registration plus its two rollbacks), and a surface that
  // really could fail would need this branch back. The pairing is NOT left to memory —
  // `session-launch-refusal-detail.test.mjs` pins `attachSurface` as unconditionally true, so the day it
  // stops being true that case fails and names both halves.
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
  // WHAT WOKE IT, AT THE TOP OF ITS OWN STREAM (#3081). ⚠ AFTER `nameAndFrame`, so the frame lands
  // behind the first turn it describes rather than ahead of a session that may still fail to start,
  // and BEFORE `startQuery`, so it is the ring's first entry and sorts above the agent's thinking.
  // ⚠ RESPONDER ONLY, AND NEVER A PARKED SHELL — `session-narration.js › noteLaunchMessage` carries
  // both gates' arguments: a requester's `firstMessage` is the operator's own goal with no sender,
  // and a shell's rides `launchGoal` to a wake turn that dispatches its own `inbound_arrived`.
  if (spec.side === 'responder' && !spec.parkedShell) {
    sessionNarration.noteLaunchMessage(s, {
      message: spec.firstMessage,
      authorName: s.context && s.context.authorName,
      // WHAT KIND OF AUTHOR WOKE IT, and its name when that author is an agent (2026-10-12) —
      // off the same launch context the label above comes from (`trigger.js`), so the launch
      // card is painted by the same rule as every later inbound one.
      authorKind: s.context && s.context.authorKind,
      authorAgentName: s.context && s.context.authorAgentName,
      authorAgentColor: s.context && s.context.authorAgentColor,
    });
  }
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
    const sdkId = store.getSdkSessionId(key);
    runLifecycle({ channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId, key, sdkSessionId: sdkId }, 'task_failed', { interrupted: true }, sessionEffects.terminalBody({ interrupted: true }));
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

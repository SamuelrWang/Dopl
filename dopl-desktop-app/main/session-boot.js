// What a DORMANT (parked) record becomes at app start — two outcomes, never a third (F-694): RE-PARKED (an
// Idle pill rebuilt in the registry, woken by the next addressed message through the ordinary lazy path; no
// query starts here) or ENDED visibly (phase flip, interrupted lifecycle, a history entry so an Ended card
// exists). A runtime that refuses resume ends here: re-parked, it would be an Idle pill nothing can wake.

const crypto = require('crypto');
const store = require('./session-store');
const { initialSessionState } = require('./session-state');
const { floorWindowlessMessage } = require('./session-profiles');
// The record readers (`contextFromRecord`, `knownProfile`) are session-park's: one meaning of a record.
const sessionPark = require('./session-park');
const sessionSummary = require('./session-summary');
const agentHistory = require('./agent-history');
const sessionEffects = require('./session-effects');
const runtimeRegistry = require('./runtime');
const runtimeCapability = runtimeRegistry.capability;
const runtimeTruth = require('./session-runtime-truth');
const { diag } = require('./diag');

// ─── BEGIN SESSION-BOOT-PURE (injectable; unit-tested via source extraction) ──────

// Everything above is a free var from here down; no import and no platform reference below (source-scanned).
let deps = null;

// The registry, the lifecycle runner and `scheduleIdle`; read at call time.
function bind(d) {
  deps = d || null;
}

// Only a record parked within 24h is re-parked: the question is whether the operator would recognise the pill.
// An older one ends quietly by the same route (it is not dropped).
const REPARK_WINDOW_MS = 24 * 60 * 60 * 1000;

// The MOST RECENT of parkedAt / lastActivityAt / startedAt (startedAt is the floor for an older record);
// null means OLD at the caller, never unknown-means-recent.
function recordFreshness(rec) {
  let best = 0;
  for (const field of ['parkedAt', 'lastActivityAt', 'startedAt']) {
    const n = Number(rec && rec[field]);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best > 0 ? best : null;
}

function withinReparkWindow(rec, now) {
  const at = recordFreshness(rec);
  if (at === null) return false;
  return now - at <= REPARK_WINDOW_MS;
}

/**
 * A dormant record -> the parked session object `resumeParked` expects. Not `startSession`: that needs a
 * runtime handle, rolls back on a signed-out Mac (the invisibility this module ends), and mints a new identity
 * and start time. `nonce` is minted fresh; `operatorUserId` is null (fail-closed) so a DIRECTED 1:1 refuses
 * until the session has really resumed; `awaitingDirective` is false (it was directed long ago).
 */
function parkedSessionFromRecord(key, rec, sdkId) {
  const state = initialSessionState({ mode: rec.mode, side: rec.side, toolModes: runtimeCapability.toolModes(runtimeRegistry.descriptorFor(rec.runtimeId)) });
  // The windowless message floor, as `startSession` applies it (F-236).
  state.messageMode = floorWindowlessMessage(state.messageMode);
  // The turn counter rehydrates for display (P4-10).
  state.turns = Number(rec.turns) || 0;
  state.phase = 'parked';
  state.parked = true;
  state.activity = 'parked';
  const profile = sessionPark.knownProfile(rec.profile);
  // The record's usage-baseline word; `resumeParked` decides the token baseline from it on the next resume.
  const recordedBaseline = runtimeTruth.durableRuntimeTruth(rec).usageBaseline;
  return {
    key: key,
    sessionId: rec.sessionId,
    // Both handles: `resumeParked` reads either, and the conversation id is what makes this a resume.
    sdkSessionId: sdkId,
    resumeSdkId: sdkId,
    // Never re-read live: this conversation belongs to one runtime.
    runtimeId: rec.runtimeId || null,
    channelId: rec.channelId,
    taskId: rec.taskId || '',
    workspaceId: rec.workspaceId,
    side: state.side,
    profile: profile,
    // The launch stamps are restored, never minted; absent reads as the cap at the gate.
    launchDepth: rec.launchDepth, launchChain: rec.launchChain === true,
    mode: state.mode,
    counterpartyId: rec.counterpartyId || null,
    bind: rec.bind === 'room' ? 'room' : 'pair',
    agentId: rec.agentId || null,
    direct: rec.direct === true,
    counterpartyName: rec.counterpartyName || null,
    // Re-coerced in the stored runtime's own vocabulary.
    model: runtimeCapability.launchModelPick(
      runtimeRegistry.descriptorFor(rec.runtimeId || null), rec.model
    ),
    usageBaseline: recordedBaseline,
    state: state,
    context: sessionPark.contextFromRecord(rec),
    nonce: crypto.randomBytes(8).toString('hex'),
    firstTurn: '',
    startedAt: Number(rec.startedAt) || 0,
    // `tokensSpent` is not in the record, so its baseline starts at 0 too.
    lastTotalTokens: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [],
    // Not a fresh shell: the resume carries the ROLE block, so the first woken turn is not re-framed.
    freshRun: false,
    freshFraming: false,
    launchGoal: '',
    awaitingDirective: false,
    idleTimer: null,
    settled: false,
    lastInboundSeq: null,
    ownPostIds: new Set(),
    // Slack over the stored counter: a crash leaves it below ids the server already holds.
    ownPostSeq: store.resumedPostSeq(rec.ownPostSeq),
    operatorUserId: null,
    query: null,
    abortController: null,
    pushIterator: null,
    windowless: true,
  };
}

/**
 * The interrupted-end route for a record that can never be resumed. The HISTORY ENTRY is what makes the
 * Ended card exist. `opts.quiet` skips the channel post (a record parked weeks ago is not news). `why`
 * reaches the diag log only; the card says "Ended" and nothing more, so no `diag` or `endCode` is stored.
 */
function endInterrupted(key, rec, why, opts) {
  const quiet = !!(opts && opts.quiet);
  store.setRecordPhase(key, 'ended');
  if (!quiet) deps.runLifecycle(
    { channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId, key: key, sdkSessionId: store.getSdkSessionId(key) },
    'task_failed',
    { interrupted: true },
    sessionEffects.terminalBody({ interrupted: true }),
  );
  agentHistory.record({
    key: key,
    agentId: rec.agentId,
    sessionId: rec.sessionId,
    channelId: rec.channelId,
    taskId: rec.taskId,
    workspaceId: rec.workspaceId,
    channelName: rec.channelName,
    threadTitle: rec.taskTitle,
    identityName: rec.identityName,
    startedAt: rec.startedAt,
    endedAt: Date.now(),
    diag: null,
    runtimeId: rec.runtimeId || null,
    entries: [],
  });
  diag('session-boot: ended dormant agent —', why, '| agent', String(rec.agentId || ''), 'channel', String(rec.channelId || '').slice(0, 8), 'thread', String(rec.taskId || '').slice(0, 8));
}

/** The boot pass, after `init()`'s interrupted scan and before the prune. Each record is independent: one that
 *  throws is logged by key and counted as neither outcome, and the pass continues. */
function reparkDormant() {
  const records = store.loadRecords();
  const keys = Object.keys(records);
  let reparked = 0;
  let ended = 0;
  for (const key of keys) {
    let outcome = '';
    try {
      outcome = reparkOne(key, records[key]);
    } catch (err) {
      // The whole key (bounded): a short slice would drop the agent, the half that says which card is missing.
      diag('session-boot: a dormant record threw and the pass CONTINUED — key', String(key).slice(0, 80),
        '|', (err && err.message) || String(err));
      continue;
    }
    if (outcome === 'reparked') reparked += 1;
    else if (outcome === 'ended') ended += 1;
  }
  // Registration is a projection move, for the ended half too (read from history at projection time).
  if (reparked || ended) sessionSummary.touch();
  diag('session-boot: dormant records', String(reparked + ended), '→ re-parked', String(reparked), 'ended', String(ended));
  return { reparked: reparked, ended: ended };
}

// One record's whole decision: 'reparked', 'ended', or '' for a record this pass does not own.
function reparkOne(key, rec) {
  if (!rec || typeof rec !== 'object') return '';
  if (store.reloadDisposition(rec.phase) !== 'dormant') return '';
  // Never overwrite a live key: a launch racing `init()` may already own this slot.
  if (deps.sessions.has(key)) return '';
  if (!withinReparkWindow(rec, Date.now())) {
    endInterrupted(key, rec, 'this agent was parked longer ago than the re-park window, so the app ended it instead of reviving it', { quiet: true });
    return 'ended';
  }
  const sdkId = store.getSdkSessionId(key);
  // No conversation id is ordinary (a spawn-idle agent never started a query): it ends, it does not vanish.
  const refusal = sdkId
    ? runtimeCapability.resumeRefusal(runtimeRegistry.descriptorFor(rec.runtimeId))
    : 'no conversation id in the resume map: this agent never started a query';
  if (refusal) { endInterrupted(key, rec, refusal); return 'ended'; }
  const s = parkedSessionFromRecord(key, rec, sdkId);
  deps.sessions.set(key, s);
  // Arm the abandonment bound: no reducer event has run on this object to arm one.
  deps.scheduleIdle(s);
  diag('session-boot: re-parked dormant agent (Idle; resumes on the next addressed message)', 'agent', String(s.agentId || ''), 'channel', String(s.channelId || '').slice(0, 8), 'thread', String(s.taskId || '').slice(0, 8));
  return 'reparked';
}

// ─── END SESSION-BOOT-PURE ────────────────────────────────────────────────────────

module.exports = {
  bind,
  parkedSessionFromRecord,
  endInterrupted,
  reparkDormant,
  REPARK_WINDOW_MS,
  withinReparkWindow,
};

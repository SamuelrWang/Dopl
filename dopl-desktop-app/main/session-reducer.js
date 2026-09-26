// The session lifecycle state machine: `sessionReducer(state, event) -> { state, effects }`, the single
// decision point the engine executes. PURE: effects are side-effect-free descriptors, no text outlives one
// event, and the pending/grant sets are arrays so states deep-equal in the extraction tests.

// Required above the sentinel: inside the block these are free vars, and test/_reducer-block.mjs prepends
// the effects and state blocks to evaluate the set standalone.
const { gateActivity, endEffects, endReasonOf, parkEffects, terminalBody } = require('./session-effects');
const {
  DEFAULT_IDLE_MS, MESSAGE_MODES, coerceMode, toolModesOf, initialSessionState, nextIdleMs, idleTimeout,
} = require('./session-state');
const { narrowTo, narrowMessageMode } = require('./launch-posture');

// ─── BEGIN SESSION-REDUCER (pure; unit-tested via source extraction) ─────────

function clone(state, patch) {
  return Object.assign({}, state, patch);
}
function addUnique(arr, v) {
  return arr.indexOf(v) === -1 ? arr.concat([v]) : arr;
}
function without(arr, v) {
  return arr.filter(function (x) { return x !== v; });
}

// P1 lazy resume: wake a PARKED session before a turn is pushed (the resume reuses the same launch-spec path).
// An auth-held session is never woken: only the release path restarts it, after `auth_release` (H1).
function wakeEffects(state) {
  return state.parked && state.authHeld !== true ? [{ type: 'resumeQuery' }] : [];
}

// FEED one counterparty turn, waking a parked session first; a pushed turn is not idle. `addressing`,
// `replyTo` and `fromOperator` are carried, never read, here.
function feedInboundEffects(state, event) {
  const effects = wakeEffects(state);
  effects.push({ type: 'pushInbound', message: event.message, authorName: event.authorName, authorNote: event.authorNote || null, addressing: event.addressing || null, replyTo: event.replyTo || '', ...(event.fromOperator === true ? { fromOperator: true } : {}) });
  effects.push({ type: 'scheduleIdle' });
  return effects;
}

function sessionReducer(state, event) {
  // Terminal: a settled session ignores every later event.
  if (state.phase === 'ended') return { state: state, effects: [] };
  const type = event && event.type;

  // FIX #5: a parked session stays inert to its drained tail; only wake triggers, timers and controls act.
  if (state.parked === true && (type === 'tool_result' || type === 'outbound_post' || type === 'result'
      || type === 'permission_request')) {
    return { state: state, effects: [] };
  }

  if (type === 'launched') {
    return {
      state: clone(state, { phase: 'running' }),
      effects: [
        { type: 'persist', phase: 'running' },
        { type: 'lifecycle', kind: 'task_started', extra: {} },
        { type: 'scheduleIdle' },
      ],
    };
  }

  if (type === 'tool_result') {
    const p = event.payload || {};
    const id = p.toolUseId;
    // FIX F3: a DENIED own-channel post was counted before the decision; its failing result un-counts it.
    if (p.ok === false && id && state.postedToolUseIds.indexOf(id) !== -1) {
      const remaining = without(state.postedToolUseIds, id);
      return { state: clone(state, { postedToolUseIds: remaining, postedThisTurn: remaining.length > 0 }), effects: [] };
    }
    return { state: state, effects: [] };
  }

  // The agent posted to its own channel: recorded so the turn ends awaiting the peer. A held gate outranks "working".
  if (type === 'outbound_post') {
    const id = event.payload && event.payload.toolUseId;
    const posted = id ? addUnique(state.postedToolUseIds, id) : state.postedToolUseIds;
    return { state: clone(state, { postedThisTurn: true, activity: gateActivity(state, 'working'), postedToolUseIds: posted }), effects: [] };
  }

  if (type === 'permission_request') {
    // A shape already granted for the task allows with no button; `name` is the SCOPED grant key.
    if (state.allowForTask.indexOf(event.name) !== -1) {
      return { state: state, effects: [{ type: 'resolvePermission', requestId: event.requestId, decision: 'allow' },
        { type: 'scheduleIdle' }] };
    }
    return {
      state: clone(state, {
        phase: 'awaiting_permission',
        activity: 'awaiting_permission',
        pendingPermissions: addUnique(state.pendingPermissions, event.requestId),
      }),
      // The emit reaches the gate bridge (`session-windowless.js › claimGate`); an open card re-arms the TTL.
      effects: [{ type: 'emit', payload: event.payload }, { type: 'scheduleIdle' }],
    };
  }

  if (type === 'permission_decision') {
    // FAIL CLOSED: only the two explicit allows grant; anything else, forged strings included, is a deny (FIX M1).
    const sdkDecision = event.decision === 'allow-once' || event.decision === 'allow-task' ? 'allow' : 'deny';
    const nextAllow = event.decision === 'allow-task' ? addUnique(state.allowForTask, event.name) : state.allowForTask;
    const nextPending = without(state.pendingPermissions, event.requestId);
    // A stale click on a PARKED session must not flip it to running; only a steer or an inbound turn wakes it.
    const phase = state.parked ? 'parked' : (nextPending.length ? 'awaiting_permission' : 'running');
    const activity = state.parked ? 'parked' : (nextPending.length ? 'awaiting_permission' : 'working');
    const effects = [{ type: 'resolvePermission', requestId: event.requestId, decision: sdkDecision }];
    // Answering a card is activity, except on a parked session, which has no live turn to keep alive.
    if (!state.parked) effects.push({ type: 'scheduleIdle' });
    return {
      state: clone(state, { phase: phase, activity: activity, allowForTask: nextAllow, pendingPermissions: nextPending }),
      effects: effects,
    };
  }

  if (type === 'set_tool_mode' || type === 'set_message_mode') {
    // One axis, coerced fail-closed against the session's own words. No drain: pendingPermissions holds ids only,
    // so a drain could let the TOOL axis answer a MESSAGE op. `pinned` stores a per-agent pick (clamped by the
    // caller); an unpinned set is the channel's value and never stamps one, and a picked session narrows to it (C2).
    const tools = type === 'set_tool_mode';
    const list = tools ? toolModesOf(state) : MESSAGE_MODES;
    const mode = coerceMode(list, event.mode);
    const k = tools ? 'tool' : 'message';
    const pick = state[k + 'ModeSet'] === true ? state[k + 'Pick'] : '';
    const next = clone(state, event.pinned === true
      ? { [k + 'ModeSet']: true, [k + 'Pick']: mode, [k + 'Mode']: mode }
      : { [k + 'Mode']: !pick ? mode : tools ? narrowTo(pick, mode, list) : narrowMessageMode(pick, mode) });
    return { state: next, effects: [] };
  }

  if (type === 'result') {
    // Turn end: count it, clear the per-turn post record. A turn that posted waits on the peer, else idle.
    const turns = state.turns + 1;
    const ns = clone(state, { turns: turns, postedThisTurn: false, postedToolUseIds: [] });
    const activity = state.postedThisTurn ? 'awaiting_peer' : 'idle';
    return { state: clone(ns, { activity: activity }), effects: [{ type: 'scheduleIdle' }] };
  }

  if (type === 'inbound_arrived') {
    // Inbound consent is retired (2026-08-22): a counterparty turn is always fed. A held session is never
    // woken, so nothing could read it; `session-gate.js › feedInbound` refuses it first, and this is the belt.
    if (state.authHeld === true) return { state: state, effects: [] };
    return { state: clone(state, { phase: 'running', activity: 'working', parked: false }), effects: feedInboundEffects(state, event) };
  }

  if (type === 'steer') {
    // Operator input: the second lazy-resume trigger. A parked query has nothing to interrupt, so a `now` steer
    // only interrupts a live one.
    const waking = state.parked === true;
    const effects = waking ? [{ type: 'resumeQuery' }] : [];
    if (event.priority === 'now' && !waking) effects.push({ type: 'interruptQuery' });
    effects.push({ type: 'pushTurn', text: event.text, priority: event.priority || 'next' });
    effects.push({ type: 'scheduleIdle' });
    return { state: clone(state, { phase: waking ? 'running' : state.phase, activity: 'working', parked: false }), effects: effects };
  }

  if (type === 'interrupt') {
    return { state: clone(state, { phase: 'interrupted' }), effects: [{ type: 'interruptQuery' }] };
  }

  if (type === 'end') {
    // One terminal, several causes: the reason chooses the SENTENCE only (`endReasonOf`).
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', endReasonOf(event)) };
  }

  if (type === 'idle_timeout') {
    // PARK, do not end; already parked is a no-op (read `parked`, not `phase`: FIX #17). The posture and the
    // grants survive the park (M2) and the park arms the abandonment bound; one-shot resolvers and the per-turn
    // post counters still clear.
    if (state.parked === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: 'parked', parked: true, activity: 'parked',
        pendingPermissions: [], postedThisTurn: false, postedToolUseIds: [] }),
      effects: parkEffects({ armAbandon: true }),
    };
  }

  if (type === 'abandon_timeout') {
    // M2: a parked session nobody came back to ENDS (terminal beats wakeable); a live one ignores a stale timer.
    if (state.parked !== true) return { state: state, effects: [] };
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'abandoned') };
  }

  if (type === 'auth_hold') {
    // H1: the hold as reducer state. A hold IS a park (same effects, dormant on restart) that also resets both
    // axes to this runtime's narrowest words and every standing grant (a per-agent pick survives, C2): the arm
    // belonged to the run whose credential failed. No abandonment timer; idempotent.
    if (state.authHeld === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: 'parked', parked: true, activity: 'parked',
        authHeld: true, toolMode: toolModesOf(state)[0], messageMode: MESSAGE_MODES[0],
        allowForTask: [], pendingPermissions: [], postedThisTurn: false, postedToolUseIds: [] }),
      effects: parkEffects({ lifecycle: true }),
    };
  }

  if (type === 'auth_release') {
    // Clears the hold and nothing else: the caller's steer does the waking. Idempotent.
    if (state.authHeld !== true) return { state: state, effects: [] };
    return { state: clone(state, { authHeld: false }), effects: [] };
  }

  if (type === 'inactive') {
    // The calm terminal: the launch watchdog (C-4) and the quit sweep (`session-reopen.js › endLiveSessions`).
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'inactive') };
  }

  if (type === 'crash') {
    // FIX #1a: a parked session's torn-down query may reject; that must not settle it.
    if (state.parked === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: 'ended' }),
      effects: [
        // C3: abort FIRST, so the transport never outlives an "ended"; the echo matches the reload path's.
        { type: 'abortQuery' },
        { type: 'settle', outcome: 'interrupted' },
        { type: 'lifecycle', kind: 'task_failed', extra: { interrupted: true }, body: terminalBody({ interrupted: true }) },
      ],
    };
  }

  return { state: state, effects: [] };
}

// ─── END SESSION-REDUCER ─────────────────────────────────────────────────────

module.exports = {
  DEFAULT_IDLE_MS,
  initialSessionState,
  sessionReducer,
  nextIdleMs,
  idleTimeout,
};

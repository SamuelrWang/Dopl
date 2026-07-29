// Session lifecycle state machine (v1.9 Session Window, Track T1).
//
// PURE module: no electron / SDK / fs / path / crypto references anywhere in the
// extracted block below, so test/session-reducer.test.mjs slices the sentinel
// block and evaluates it verbatim in a plain Node context (same idiom as
// classify / tool-profiles / consent-watcher's WATCHER-PURE block).
//
// `sessionReducer(state, event) -> { state, effects }` is the single decision
// point for the imperative shell (session-engine.js). The shell feeds it SDK /
// IPC / timer events and EXECUTES the returned effects — every effect is a
// side-effect-FREE descriptor ({ type, ... }), never a callback or a live handle.
// The reducer NEVER holds message/prompt text longer than one event and NEVER
// builds a prompt string (framing lives in prompt-framing.buildFencedTurn, applied
// by the shell), so it stays a pure function of (state, event).
//
// The conceptual `pendingPermissions` / `allowForTask` Sets (contract §A.3) are
// represented as dedup arrays here so the reducer stays a pure value-in/value-out
// function that deep-equals cleanly in the source-extraction test; membership
// semantics are identical.

// ─── BEGIN SESSION-REDUCER (pure; unit-tested via source extraction) ─────────

// Loop-safety defaults (contract §A.2). turn cap bounds a two-agent exchange;
// idle TTL ends a stalled session (task stays open, resumable); cost cap is opt-in
// (0 => disabled).
const DEFAULT_TURN_CAP = 24;
const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_COST_CAP_USD = 0; // 0 => disabled

function clone(state, patch) {
  return Object.assign({}, state, patch);
}
function addUnique(arr, v) {
  return arr.indexOf(v) === -1 ? arr.concat([v]) : arr;
}
function without(arr, v) {
  return arr.filter(function (x) {
    return x !== v;
  });
}

// Fresh state for a launching session. `mode` gates the inbound path (interactive
// pauses each counterparty reply for release; autonomous auto-continues under the
// caps). Caps fall back to the documented defaults on an invalid value.
function initialSessionState(opts) {
  const o = opts || {};
  const turnCap = Number.isFinite(o.turnCap) && o.turnCap > 0 ? o.turnCap : DEFAULT_TURN_CAP;
  const costCapUsd = Number.isFinite(o.costCapUsd) && o.costCapUsd > 0 ? o.costCapUsd : DEFAULT_COST_CAP_USD;
  const idleMs = Number.isFinite(o.idleMs) && o.idleMs > 0 ? o.idleMs : DEFAULT_IDLE_MS;
  return {
    phase: 'launching',
    mode: o.mode === 'autonomous' ? 'autonomous' : 'interactive',
    side: o.side === 'requester' ? 'requester' : 'responder',
    turns: 0,
    costUsd: 0,
    turnCap: turnCap,
    costCapUsd: costCapUsd,
    idleMs: idleMs,
    pendingPermissions: [], // requestIds awaiting a button (models a Set)
    allowForTask: [], // tool names the operator granted for the whole task (models a Set)
    // Item 10: per-session auto-approve. Default OFF (fail-closed, ask each time); a
    // launch ALWAYS starts false (never persisted). When ON, session-io.makeCanUseTool
    // flips a live GATE to allow; hard-deny stays immovable.
    autoApprove: false,
    hasPendingInbound: false,
    // Item 3: the coarse activity the status pill shows (working|idle|awaiting_peer|
    // awaiting_permission|awaiting_inbound). A launching/running session is `working`;
    // `postedThisTurn` records whether the agent sent an op=post this turn so the
    // turn-end transition can pick `awaiting_peer` vs `idle`.
    activity: 'working',
    postedThisTurn: false,
  };
}

// Idle timer duration for the current state (contract lists nextIdleMs among the
// pure helpers). Constant today; a hook for phase-aware backoff later.
function nextIdleMs(state) {
  return state.idleMs;
}
function turnCapReached(state) {
  return state.turns >= state.turnCap;
}
function costCapReached(state) {
  return state.costCapUsd > 0 && state.costUsd >= state.costCapUsd;
}

// The effect triple shared by every non-close_task end (operator End, turn/idle/
// cost cap): abort the query, tell the renderer, settle the session record. These
// ends leave the channel TASK open (resumable) — no task_finished/failed echo.
function endedEmit(state, outcome, reason, summary) {
  const payload = { type: 'ended', outcome: outcome, totalCostUsd: state.costUsd, reason: reason };
  if (summary !== undefined) payload.summary = summary;
  return { type: 'emit', payload: payload };
}
function endEffects(state, outcome, reason, summary) {
  return [
    { type: 'abortQuery' },
    endedEmit(state, outcome, reason, summary),
    { type: 'settle', outcome: outcome },
  ];
}

function sessionReducer(state, event) {
  // Terminal: a settled session ignores every later event (idempotency — a Stop
  // then a crash, or a double End, must not re-emit or re-post).
  if (state.phase === 'ended') return { state: state, effects: [] };
  const type = event && event.type;

  if (type === 'launched') {
    return {
      state: clone(state, { phase: 'running' }),
      effects: [
        { type: 'persist', phase: 'running' },
        { type: 'emit', payload: event.payload },
        { type: 'lifecycle', kind: 'task_started', extra: {} },
        { type: 'scheduleIdle' },
      ],
    };
  }

  // Pass-through render events (no state change): assistant turns and tool cards.
  if (type === 'assistant' || type === 'tool_use' || type === 'tool_result') {
    return { state: state, effects: [{ type: 'emit', payload: event.payload }] };
  }

  // Item 2: the agent SENT a message to the peer (dopl_channel op=post into its own
  // channel, classified in session-io.isOutboundPost). Unlike a bare tool_use, this
  // flows THROUGH the reducer so it can record `postedThisTurn` (item 3 feeds the
  // turn-end `awaiting_peer` transition). The turn is still in flight -> `working`;
  // a status is emitted only if the activity actually changed (no spam per block).
  if (type === 'outbound_post') {
    const effects = [{ type: 'emit', payload: event.payload }];
    if (state.activity !== 'working') {
      effects.push({ type: 'emit', payload: { type: 'status', phase: state.phase, activity: 'working' } });
    }
    return { state: clone(state, { postedThisTurn: true, activity: 'working' }), effects: effects };
  }

  if (type === 'permission_request') {
    // A tool the operator already granted for the whole task short-circuits with
    // no button (checked FIRST — this Set is the correct home for a task grant;
    // mutating allowedTools mid-session would silently drop the callback, §A.5).
    if (state.allowForTask.indexOf(event.name) !== -1) {
      return { state: state, effects: [{ type: 'resolvePermission', requestId: event.requestId, decision: 'allow' }] };
    }
    return {
      state: clone(state, {
        phase: 'awaiting_permission',
        activity: 'awaiting_permission', // item 3: rides the awaiting_permission phase
        pendingPermissions: addUnique(state.pendingPermissions, event.requestId),
      }),
      effects: [{ type: 'emit', payload: event.payload }],
    };
  }

  if (type === 'permission_decision') {
    // FIX M1: FAIL CLOSED — only the two explicit allow decisions grant; every other
    // value (deny, or an unrecognized/forged string) resolves DENY. The engine's
    // resolvePerm applies the same rule, so main is authoritative on both layers.
    const sdkDecision = event.decision === 'allow-once' || event.decision === 'allow-task' ? 'allow' : 'deny';
    const nextAllow = event.decision === 'allow-task' ? addUnique(state.allowForTask, event.name) : state.allowForTask;
    const nextPending = without(state.pendingPermissions, event.requestId);
    const phase = nextPending.length ? 'awaiting_permission' : 'running';
    // Back to the in-flight turn once the last button clears; the renderer already
    // learns this from permission_resolved, so no extra status emit here.
    const activity = nextPending.length ? 'awaiting_permission' : 'working';
    return {
      state: clone(state, { phase: phase, activity: activity, allowForTask: nextAllow, pendingPermissions: nextPending }),
      effects: [
        { type: 'resolvePermission', requestId: event.requestId, decision: sdkDecision },
        { type: 'emit', payload: { type: 'permission_resolved', requestId: event.requestId, decision: event.decision } },
      ],
    };
  }

  if (type === 'set_auto_approve') {
    // Item 10 — the per-session auto-approve toggle. ENABLE: flip the flag AND drain
    // the pending gate queue so the dock clears — resolve each parked request `allow`
    // and echo a `permission_resolved: allow-once` for it, then re-enter running/
    // working; emit `auto_approve` so the posture label updates live. DISABLE: flip the
    // flag; future gate calls prompt again. This ONLY affects the live-gate path — the
    // hard-deny belt (grantDecision 'deny') is decided in canUseTool and never here.
    if (event.enabled) {
      const effects = [];
      for (const id of state.pendingPermissions) {
        effects.push({ type: 'resolvePermission', requestId: id, decision: 'allow' });
        effects.push({ type: 'emit', payload: { type: 'permission_resolved', requestId: id, decision: 'allow-once' } });
      }
      effects.push({ type: 'emit', payload: { type: 'auto_approve', enabled: true } });
      return {
        state: clone(state, { autoApprove: true, pendingPermissions: [], phase: 'running', activity: 'working' }),
        effects: effects,
      };
    }
    return {
      state: clone(state, { autoApprove: false }),
      effects: [{ type: 'emit', payload: { type: 'auto_approve', enabled: false } }],
    };
  }

  if (type === 'result') {
    // Turn end. costUsd/turns accumulate for the SAFETY caps (item 6 keeps every cap;
    // only the display-only `usage` emit is dropped — no cost meter in v2). Reset
    // postedThisTurn now that the turn closed. `costUsd` stays internal for costCap.
    const turnCost = Number(event.turnCostUsd) || 0;
    const turns = state.turns + 1;
    const costUsd = state.costUsd + turnCost;
    const ns = clone(state, { turns: turns, costUsd: costUsd, postedThisTurn: false });
    if (turnCapReached(ns)) {
      return { state: clone(ns, { phase: 'ended' }), effects: endEffects(ns, 'ended', 'turn_cap') };
    }
    if (costCapReached(ns)) {
      return { state: clone(ns, { phase: 'ended' }), effects: endEffects(ns, 'ended', 'cost_cap') };
    }
    // Item 3: a turn that POSTED to the peer is now waiting on a reply; otherwise the
    // session is idle. The status emit REPLACES the old usage emit.
    const activity = state.postedThisTurn ? 'awaiting_peer' : 'idle';
    return {
      state: clone(ns, { activity: activity }),
      effects: [
        { type: 'emit', payload: { type: 'status', phase: 'running', activity: activity } },
        { type: 'scheduleIdle' },
      ],
    };
  }

  if (type === 'inbound_arrived') {
    if (state.mode === 'autonomous') {
      // Auto-fed counterparty turn: show it (item 1: `counterparty` supersedes the
      // old `inbound` emit), then push it as the next user turn. A peer reply clears
      // the activity back to `working` (item 3); status emitted only on change.
      const effects = [
        { type: 'emit', payload: { type: 'counterparty', from: event.authorName, text: event.message } },
        { type: 'pushInbound', message: event.message, authorName: event.authorName },
      ];
      if (state.activity !== 'working') {
        effects.push({ type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } });
      }
      return { state: clone(state, { phase: 'running', activity: 'working' }), effects: effects };
    }
    // Interactive: hold the reply as a pending inbound the operator releases.
    return {
      state: clone(state, { phase: 'awaiting_inbound', activity: 'awaiting_inbound', hasPendingInbound: true }),
      effects: [
        { type: 'emit', payload: { type: 'inbound_pending', pendingId: event.pendingId, from: event.authorName, text: event.message } },
      ],
    };
  }

  if (type === 'inbound_released') {
    return {
      state: clone(state, { phase: 'running', activity: 'working', hasPendingInbound: false }),
      effects: [
        { type: 'pushInbound', message: event.message, authorName: event.authorName },
        { type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } },
      ],
    };
  }

  if (type === 'steer') {
    // The operator injected a turn -> back to `working` (item 3). Status emitted only
    // when the activity actually changed (steering while already working is silent).
    const effects = [];
    if (event.priority === 'now') effects.push({ type: 'interruptQuery' });
    effects.push({ type: 'pushTurn', text: event.text, priority: event.priority || 'next' });
    if (state.activity !== 'working') {
      effects.push({ type: 'emit', payload: { type: 'status', phase: state.phase, activity: 'working' } });
    }
    return { state: clone(state, { activity: 'working' }), effects: effects };
  }

  if (type === 'interrupt') {
    return {
      state: clone(state, { phase: 'interrupted' }),
      effects: [{ type: 'interruptQuery' }, { type: 'emit', payload: { type: 'status', phase: 'interrupted' } }],
    };
  }

  if (type === 'end') {
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'operator') };
  }

  if (type === 'close_task') {
    const kind = event.outcome === 'completed' ? 'task_finished' : 'task_failed';
    return {
      state: clone(state, { phase: 'ended' }),
      effects: [
        { type: 'closeTask', outcome: event.outcome, summary: event.summary },
        { type: 'abortQuery' },
        { type: 'lifecycle', kind: kind, extra: {} },
        endedEmit(state, event.outcome, 'close_task', event.summary),
        { type: 'settle', outcome: event.outcome },
      ],
    };
  }

  if (type === 'idle_timeout') {
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'idle', 'idle') };
  }

  if (type === 'cost_cap') {
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'cost_cap') };
  }

  if (type === 'crash') {
    // Query threw / render window gone: settle interrupted and post the SAME
    // task_failed{interrupted:true} echo the reload path posts, so the requester's
    // web card settles to "Interrupted" rather than pulsing forever.
    return {
      state: clone(state, { phase: 'ended' }),
      effects: [
        { type: 'settle', outcome: 'interrupted' },
        { type: 'lifecycle', kind: 'task_failed', extra: { interrupted: true } },
        { type: 'emit', payload: { type: 'error', message: 'Session ended unexpectedly.' } },
      ],
    };
  }

  return { state: state, effects: [] };
}

// ─── END SESSION-REDUCER ─────────────────────────────────────────────────────

module.exports = {
  DEFAULT_TURN_CAP,
  DEFAULT_IDLE_MS,
  DEFAULT_COST_CAP_USD,
  initialSessionState,
  sessionReducer,
  nextIdleMs,
  turnCapReached,
  costCapReached,
};

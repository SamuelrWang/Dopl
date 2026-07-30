// Session lifecycle state machine (v1.9 Session Window, Track T1).
//
// PURE module: no electron / SDK / fs / path / crypto references anywhere in the
// extracted block below, so test/session-reducer.test.mjs slices the sentinel block and
// evaluates it verbatim in a plain Node context (same idiom as classify / tool-profiles).
//
// `sessionReducer(state, event) -> { state, effects }` is the single decision point for
// the imperative shell (session-engine.js), which EXECUTES the returned effects — every
// effect is a side-effect-FREE descriptor ({ type, ... }), never a callback or a live
// handle. The reducer NEVER holds message/prompt text longer than one event and NEVER
// builds a prompt string (framing lives in prompt-framing / session-io, applied by the
// shell), so it stays a pure function of (state, event). The conceptual
// pendingPermissions / allowForTask Sets (§A.3) are dedup ARRAYS here so the state
// deep-equals cleanly in the extraction test; membership semantics are identical.

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

// Fresh state for a launching session. `mode` is the task's declared engagement mode
// (display + the durable record); as of v2.5 D1 it NO LONGER gates the inbound path —
// every counterparty turn waits on an Accept unless auto-approve or the standing task
// grant is on. Caps fall back to the documented defaults on an invalid value.
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
    // v2.5 D1/D4: the standing INBOUND grant ("Accept for this task") — when true an inbound turn
    // is fed with no Accept. Like allowForTask it lives for the life of the in-memory session
    // object: it survives a park (unlike autoApprove, FIX #3) and is NEVER persisted, so a
    // recreated shell re-gates. FOLLOW-UP F5: a parked session can therefore still auto-feed peer
    // replies with the operator away; whether park should drop it too is a product call.
    inboundForTask: false,
    hasPendingInbound: false,
    // P1 (v1.7.4): true while the session is PARKED — the live SDK query is torn down but
    // the session object + window survive, so an inbound turn or operator input can lazily
    // resume it (options.resume). Never persisted; a fresh launch starts live. Distinct
    // from `phase` because a parked session HOLDING a reply sits at phase
    // 'awaiting_inbound' (FIX #6) yet still needs a resume when the operator accepts.
    parked: false,
    // Item 3: the coarse activity the status pill shows (working|idle|awaiting_peer|
    // awaiting_permission|awaiting_inbound). A launching/running session is `working`;
    // `postedThisTurn` records whether the agent sent an op=post this turn so the
    // turn-end transition can pick `awaiting_peer` vs `idle`.
    activity: 'working',
    postedThisTurn: false,
    // FIX F3: the tool_use ids of the posts that streamed THIS turn. The outbound bubble is
    // emitted while the tool_use streams, BEFORE canUseTool resolves, so a denied post must
    // be un-counted when its failing tool_result lands; else the turn ends 'awaiting_peer'
    // ("Waiting for reply") on a message that never left the machine.
    postedToolUseIds: [],
  };
}

// Idle timer duration for the current state (§A.2 lists nextIdleMs among the pure
// helpers). Constant today; a hook for phase-aware backoff later.
function nextIdleMs(state) {
  return state.idleMs;
}
function turnCapReached(state) {
  return state.turns >= state.turnCap;
}
function costCapReached(state) {
  return state.costCapUsd > 0 && state.costUsd >= state.costCapUsd;
}

// FIX #6 — a PENDING inbound card WINS the displayed status: `phase` carries the gate (nothing
// below clobbers it while a card waits, so the pill keeps reading "Message waiting") while
// `activity` still tells the truth, so the send button morphs to Pause on a mid-flight turn.
function gatePhase(state, phase) {
  return state && state.hasPendingInbound === true ? 'awaiting_inbound' : phase;
}

// The effect set shared by every non-close_task end (operator End, turn/cost cap): abort
// the query, tell the renderer, settle the record. These leave the channel TASK open
// (resumable) — no task_finished. P3: a real end ALSO posts a CALM lifecycle (endLifecycle)
// so the web card stops pulsing "Working…". Idle never reaches here; it PARKS instead.
function endedEmit(state, outcome, reason, summary) {
  const payload = { type: 'ended', outcome: outcome, totalCostUsd: state.costUsd, reason: reason };
  if (summary !== undefined) payload.summary = summary;
  return { type: 'emit', payload: payload };
}

// P3: the calm lifecycle a real end posts. turn/cost caps ride extra:{capped:true} (the
// web renders "Limit reached", task stays open); the operator End button rides
// extra:{ended:true}. Both ride metadata exactly like `interrupted` — no server-stamped
// reserved keys, no closeTask. Any other reason posts nothing (null), as it does today.
function endLifecycle(reason) {
  if (reason === 'turn_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Turn limit reached' };
  if (reason === 'cost_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Cost limit reached' };
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_failed', extra: { ended: true }, body: 'Session ended' };
  return null;
}
function endEffects(state, outcome, reason, summary) {
  const effects = [{ type: 'abortQuery' }];
  const lc = endLifecycle(reason);
  if (lc) effects.push(lc);
  effects.push(endedEmit(state, outcome, reason, summary));
  effects.push({ type: 'settle', outcome: outcome });
  return effects;
}

// P1: idle no longer ENDS the session — it PARKS it. Deny any awaited canUseTool promise
// fail-closed, tear down the live query, clear (never re-arm) the idle timer, persist phase
// 'parked', tell the renderer. NOT settled: no `settle`, no `win.destroy`, no registry
// removal, sdkSessionId retained — so a lazy wake can resume it.
function parkEffects(state) {
  const effects = [
    { type: 'denyPending' },
    { type: 'abortQuery' },
    { type: 'clearIdle' },
    { type: 'persist', phase: 'parked' },
    { type: 'emit', payload: { type: 'status', phase: gatePhase(state, 'parked') } },
    // `paused` drops the one-line inline note (renderer owns the copy), distinct from the
    // P2 reopen shell's `notice`. FIX #17: a park that happens while a message is HELD
    // says so — "wait for a reply" is wrong when the reply is already here, waiting.
    { type: 'emit', payload: state && state.hasPendingInbound === true ? { type: 'paused', gated: true } : { type: 'paused' } },
  ];
  // FIX #6 (v2.3): clear the renderer's permission dock for anything awaiting a button.
  // Main denies each fail-closed (denyPending) before the abort, so a parked, query-less
  // session must not keep showing a live-looking prompt. Renderer drops each on resolve.
  for (const id of (state && state.pendingPermissions) || []) {
    effects.push({ type: 'emit', payload: { type: 'permission_resolved', requestId: id, decision: 'deny' } });
  }
  return effects;
}

// P1 LAZY RESUME: effects to wake a PARKED session before a turn is pushed. resumeQuery
// rebuilds the SDK query on the SAME session object through the SAME buildSdkOptions path
// (options.resume = sdkSessionId), so the security model is byte-identical. A live session
// needs none of it, so this is a no-op there.
function wakeEffects(state) {
  return state.parked ? [{ type: 'resumeQuery' }] : [];
}

// v2.5 D1 — is an inbound turn allowed to reach the agent WITHOUT an Accept? Only two
// ways: the auto-approve toggle (item 10 / D4) or the standing "Accept for this task"
// grant. Default state is neither, so the gate holds.
function inboundAutoAccepted(state) {
  return state.autoApprove === true || state.inboundForTask === true;
}

// v2.5 D1 — FEED a counterparty turn: the byte-equivalent of the pre-gate autonomous path.
// Show it as a `counterparty` bubble, push it as the next user turn, clear the activity
// back to `working` (statused only on change). A PARKED session wakes FIRST (resumeQuery)
// so the push lands on the fresh iterator (P1 lazy resume).
function feedInboundEffects(state, event) {
  const effects = wakeEffects(state);
  effects.push({ type: 'emit', payload: { type: 'counterparty', from: event.authorName, text: event.message } });
  effects.push({ type: 'pushInbound', message: event.message, authorName: event.authorName });
  if (state.activity !== 'working') {
    effects.push({ type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } });
  }
  return effects;
}

function sessionReducer(state, event) {
  // Terminal: a settled session ignores every later event (idempotency — a Stop
  // then a crash, or a double End, must not re-emit or re-post).
  if (state.phase === 'ended') return { state: state, effects: [] };
  const type = event && event.type;

  // FIX #5: a PARKED session stays INERT to the SDK messages its torn-down query buffered
  // and drains after the abort — a stray assistant / tool / result / outbound /
  // permission_request must NOT re-arm the idle timer, run the cap endEffects, or stash a
  // resolver on a query-less session. Only the wake triggers (inbound_arrived /
  // inbound_released / steer), idle_timeout, and the operator / terminal controls act.
  if (state.parked === true && (type === 'assistant' || type === 'tool_use' || type === 'tool_result'
      || type === 'outbound_post' || type === 'result' || type === 'permission_request')) {
    return { state: state, effects: [] };
  }

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
  if (type === 'assistant' || type === 'tool_use') {
    return { state: state, effects: [{ type: 'emit', payload: event.payload }] };
  }

  // FIX F3 — a tool_result is a pass-through, EXCEPT the FAILING result of an own-channel post.
  // That bubble was emitted while the tool_use streamed (before canUseTool resolved), so a Deny
  // (or any error) drops the id here, and postedThisTurn with it when nothing else went out.
  if (type === 'tool_result') {
    const p = event.payload || {};
    const id = p.toolUseId;
    if (p.ok === false && id && state.postedToolUseIds.indexOf(id) !== -1) {
      const remaining = without(state.postedToolUseIds, id);
      return {
        state: clone(state, { postedToolUseIds: remaining, postedThisTurn: remaining.length > 0 }),
        effects: [{ type: 'emit', payload: event.payload }],
      };
    }
    return { state: state, effects: [{ type: 'emit', payload: event.payload }] };
  }

  // Item 2: the agent SENT a message to the peer (dopl_channel op=post into its own channel,
  // classified in session-io.isOutboundPost). Unlike a bare tool_use it flows THROUGH the reducer
  // so it can record `postedThisTurn` (item 3's turn-end `awaiting_peer`). In flight -> `working`.
  if (type === 'outbound_post') {
    const effects = [{ type: 'emit', payload: event.payload }];
    if (state.activity !== 'working') {
      effects.push({ type: 'emit', payload: { type: 'status', phase: state.phase, activity: 'working' } });
    }
    // FIX F3: remember WHICH post this was, so a deny/failure can un-count it below.
    const id = event.payload && event.payload.toolUseId;
    const posted = id ? addUnique(state.postedToolUseIds, id) : state.postedToolUseIds;
    return { state: clone(state, { postedThisTurn: true, activity: 'working', postedToolUseIds: posted }), effects: effects };
  }

  if (type === 'permission_request') {
    // A tool the operator already granted for the whole task short-circuits with no
    // button (checked FIRST — mutating allowedTools mid-session would silently drop the
    // callback, §A.5, so this Set is the only correct home for a task grant).
    if (state.allowForTask.indexOf(event.name) !== -1) {
      return { state: state, effects: [{ type: 'resolvePermission', requestId: event.requestId, decision: 'allow' }] };
    }
    return {
      state: clone(state, {
        phase: gatePhase(state, 'awaiting_permission'), // FIX #6: a held card keeps the phase
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
    // FIX #6: a stale dock click on a PARKED session must NOT flip it to running — only a
    // steer or an inbound turn resumes a parked session. Keep phase parked; the resolve +
    // permission_resolved echo below are harmless no-ops (park already cleared both docks).
    // FIX #6: gatePhase keeps a held inbound card's phase through a dock click too.
    const phase = gatePhase(state, state.parked ? 'parked' : (nextPending.length ? 'awaiting_permission' : 'running'));
    // Back to the in-flight turn once the last button clears; the renderer already
    // learns this from permission_resolved, so no extra status emit here.
    const activity = state.parked ? 'parked' : (nextPending.length ? 'awaiting_permission' : 'working');
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
      // FIX #10: a PARKED session has NO live query, so the flip must not claim
      // running/working — only the flag + the echo land, and a wake still needs a steer or
      // an accepted message. FIX #6: a held inbound card keeps the phase it owns.
      const patch = { autoApprove: true, pendingPermissions: [] };
      if (state.parked !== true) { patch.phase = gatePhase(state, 'running'); patch.activity = 'working'; }
      return { state: clone(state, patch), effects: effects };
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
    const ns = clone(state, { turns: turns, costUsd: costUsd, postedThisTurn: false, postedToolUseIds: [] });
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
        // FIX #6: the turn-end status no longer overwrites a still-pending gate card.
        { type: 'emit', payload: { type: 'status', phase: gatePhase(ns, 'running'), activity: activity } },
        { type: 'scheduleIdle' },
      ],
    };
  }

  if (type === 'inbound_arrived') {
    // v2.5 D1 — THE INBOUND GATE, now universal. A counterparty turn NEVER reaches
    // the agent before the operator accepts it: mode no longer decides (the v2.2
    // autonomous auto-continuation is gone), only an explicit opt-in does.
    if (inboundAutoAccepted(state)) {
      return { state: clone(state, { phase: 'running', activity: 'working', parked: false }), effects: feedInboundEffects(state, event) };
    }
    // HOLD it as a pending inbound the operator answers (Accept / Accept for this
    // task / Decline). If the session was PARKED, KEEP the parked flag (do not wake
    // yet) — a parked query must not run just to hold a reply; the ACCEPT resumes it.
    // FIX #1: the hold also STATUSES. The renderer's pill only ever moves on a `status`
    // event, so a card used to land under a pill still reading "Paused" / "Waiting for
    // reply" / "Working" — the one state where the operator has to act read as idle.
    return {
      state: clone(state, { phase: 'awaiting_inbound', activity: 'awaiting_inbound', hasPendingInbound: true }),
      effects: [
        { type: 'emit', payload: { type: 'inbound_pending', pendingId: event.pendingId, from: event.authorName, text: event.message } },
        { type: 'emit', payload: { type: 'status', phase: 'awaiting_inbound', activity: 'awaiting_inbound' } },
      ],
    };
  }

  // v2.5 D1 — ACCEPT (plus the `inbound_released` legacy alias, kept for a mid-wave caller
  // and the v2.3 tests): feed the held reply as the next turn. P1: if the session parked
  // while the reply was held, the accept is the wake trigger. `inbound_accept_for_task`
  // ALSO records the standing grant (survives parks, never persisted).
  if (type === 'inbound_accept' || type === 'inbound_accept_for_task' || type === 'inbound_released') {
    const effects = wakeEffects(state);
    effects.push({ type: 'pushInbound', message: event.message, authorName: event.authorName });
    effects.push({ type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } });
    if (event.pendingId) {
      effects.push({ type: 'emit', payload: { type: 'inbound_resolved', pendingId: event.pendingId, decision: type === 'inbound_accept_for_task' ? 'accepted-task' : 'accepted' } });
    }
    const patch = { phase: 'running', activity: 'working', hasPendingInbound: false, parked: false };
    if (type === 'inbound_accept_for_task') patch.inboundForTask = true;
    return { state: clone(state, patch), effects: effects };
  }

  if (type === 'inbound_decline') {
    // v2.5 D1 — DECLINE is LOCAL: the message is dropped, never fed, and NOTHING is written
    // to the server (no calm echo — the peer sees no reply to a declined mid-task message).
    // A parked session STAYS parked (a decline is not a wake trigger); a live one returns to
    // idle. No standing grant is recorded either way.
    const parked = state.parked === true;
    return {
      state: clone(state, { phase: parked ? 'parked' : 'running', activity: parked ? 'parked' : 'idle', hasPendingInbound: false }),
      effects: [
        { type: 'emit', payload: { type: 'inbound_resolved', pendingId: event.pendingId, decision: 'declined' } },
        { type: 'emit', payload: { type: 'status', phase: parked ? 'parked' : 'running', activity: parked ? 'parked' : 'idle' } },
      ],
    };
  }

  if (type === 'steer') {
    // The operator injected a turn -> back to `working` (item 3), statused only when the
    // activity actually changed. P1: operator input is the second LAZY-RESUME trigger — it
    // wakes a parked session back to `running`, and a parked query has nothing live to
    // interrupt so a priority:'now' steer skips interruptQuery while waking.
    const waking = state.parked === true;
    const effects = waking ? [{ type: 'resumeQuery' }] : [];
    if (event.priority === 'now' && !waking) effects.push({ type: 'interruptQuery' });
    effects.push({ type: 'pushTurn', text: event.text, priority: event.priority || 'next' });
    // FIX #6: typing does not answer the gate, so a still-held card keeps the phase; the
    // activity goes back to `working` so the send button can offer Pause.
    const nextPhase = gatePhase(state, waking ? 'running' : state.phase);
    if (state.activity !== 'working') {
      effects.push({ type: 'emit', payload: { type: 'status', phase: nextPhase, activity: 'working' } });
    }
    return { state: clone(state, { phase: nextPhase, activity: 'working', parked: false }), effects: effects };
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
    // P1: PARK, do not end. Already parked (a stale timer that survived the clear) is a
    // no-op. NOT a terminal transition — the session stays resumable via a lazy wake.
    // FIX #3: reset autoApprove OFF so a counterparty-driven lazy resume cannot run with
    // auto-approve still armed while the operator is away (a recreated shell also starts OFF).
    // FIX #17: the guard reads `parked`, not `phase` — a parked session HOLDING a message
    // sits at phase 'awaiting_inbound' with parked===true, and the old phase check let a
    // stale timer re-run the whole park (a second deny/abort/persist) on it.
    // FIX F6: the per-turn post counters go too. The park deny-closes every awaited card, so a
    // gated post is "Not sent" — leaving postedThisTurn set let the next turn end
    // 'awaiting_peer' ("Waiting for reply") beside it.
    if (state.parked === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: gatePhase(state, 'parked'), parked: true, activity: 'parked', autoApprove: false,
        pendingPermissions: [], postedThisTurn: false, postedToolUseIds: [] }),
      effects: parkEffects(state),
    };
  }

  if (type === 'cost_cap') {
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'cost_cap') };
  }

  if (type === 'crash') {
    // FIX #1a: PARK is the only path that aborts the query WITHOUT settling, so the
    // torn-down query's consume loop can surface a non-AbortError rejection (e.g. "process
    // exited with code 143"). That must NOT settle+destroy a parked session (a spurious
    // task_failed{interrupted}); a parked crash is inert and stays resumable.
    if (state.parked === true) return { state: state, effects: [] };
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

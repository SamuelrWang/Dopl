// Session lifecycle state machine (v1.9 Session Window, Track T1).
//
// PURE module: no electron / SDK / fs / path / crypto references anywhere in the extracted block below, so
// test/session-reducer.test.mjs slices the sentinel block and evaluates it verbatim in a plain Node context
// (same idiom as classify / tool-profiles).
//
// `sessionReducer(state, event) -> { state, effects }` is the single decision point for the imperative shell
// (session-engine.js), which EXECUTES the returned effects — every effect is a side-effect-FREE descriptor
// ({ type, ... }), never a callback or a live handle. It NEVER holds message/prompt text longer than one event
// and NEVER builds a prompt string (framing lives in prompt-framing / session-io, applied by the shell), so it
// stays a pure function of (state, event). The conceptual pendingPermissions / allowForTask Sets (§A.3) are dedup ARRAYS so the state deep-equals cleanly in the extraction test; membership semantics are identical.

// §2 SPLIT: the pure EFFECT BUILDERS live in session-effects.js and the STATE SHAPE (defaults,
// initialSessionState, the cap readers, the mode tables) in session-state.js. Both are required
// here at module scope, ABOVE the sentinel, so inside the block below they are free vars —
// which is what lets test/_reducer-block.mjs prepend those modules' blocks and evaluate the set
// with no `require` in scope, exactly as before the splits.
const { gatePhase, endedEmit, endEffects, modesEmit, parkEffects } = require('./session-effects');
const {
  DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD, TOOL_MODES, MESSAGE_MODES,
  coerceMode, initialSessionState, nextIdleMs, idleTimeout, turnCapReached, costCapReached,
} = require('./session-state');

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

// P1 LAZY RESUME: wake a PARKED session before a turn is pushed. resumeQuery rebuilds the SDK query
// on the SAME session object through the SAME buildSdkOptions path (options.resume = sdkSessionId),
// so the security model is byte-identical; a live session is a no-op here.
//
// H1 — AN AUTH-HELD SESSION IS NOT WAKE-RESUMABLE; the guard is explicit, not incidental. The
// hold used to live ONLY as `s.authHold` in session-auth.js, invisible here, so this saw nothing
// but `parked` and resumed sessions on a Mac with NO Claude Code credential: a peer follow-up
// under an auto_both preset -> inboundAutoAccepted -> feedInboundEffects -> here -> resumeQuery
// spawned the SDK with no credential re-check, and a later sign-in then started a SECOND query
// beside it (two claude children for one request, the orphan still holding this session's
// pre-approved dopl_channel access). Only the sign-in path may restart a held session, and it
// dispatches `auth_release` first — the credential must be verified back BEFORE anything spawns.
function wakeEffects(state) {
  return state.parked && state.authHeld !== true ? [{ type: 'resumeQuery' }] : [];
}

// v2.5 D1 / v2.9 AXIS B — is an inbound turn allowed to reach the agent WITHOUT an Accept? Only
// two ways: AXIS B set to auto_inbound / auto_both, or the standing "Accept for this session" grant.
// Default state is neither, so the gate holds. session-gate.autoInbound answers the same question
// for the live queue and MUST agree (pinned by test).
// H1: an AUTH-HELD session auto-accepts NOTHING, whatever the axes say. Auto-accept means "feed
// this straight to the agent" and there is no agent — the push would land on a closed iterator
// and vanish. HOLDING it is the honest answer: the card lands beside the sign-in button, so the
// operator sees both what is waiting and what to do first, and the ordinary accept delivers it
// once the credential is back. The peer's message is never eaten, it just waits for a human.
function inboundAutoAccepted(state) {
  if (state.authHeld === true) return false;
  const m = state.messageMode;
  return m === 'auto_inbound' || m === 'auto_both' || state.inboundForTask === true;
}

// v2.5 D1 — FEED a counterparty turn: the byte-equivalent of the pre-gate autonomous path. Show it
// as a `counterparty` bubble, push it as the next user turn, clear the activity back to `working`
// (statused only on change). A PARKED session wakes FIRST (resumeQuery) so the push lands on the
// fresh iterator (P1 lazy resume).
// The push effect for ONE inbound turn. It used to carry a per-turn `threadId` from
// channel-deliver, so the first turn of a room-bound shell could be told to read the exchange it
// was joining; that producer is deleted (channels rollback, 2026-08-05) and the value was `''`
// end to end, so the effect is the two fields the engine's `pushInbound` case actually reads.
function pushInboundEffect(event) {
  return { type: 'pushInbound', message: event.message, authorName: event.authorName };
}

function feedInboundEffects(state, event) {
  const effects = wakeEffects(state);
  effects.push({ type: 'emit', payload: { type: 'counterparty', from: event.authorName, text: event.message } });
  effects.push(pushInboundEffect(event));
  if (state.activity !== 'working') {
    effects.push({ type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } });
  }
  effects.push({ type: 'scheduleIdle' }); // FIX 3: a turn was just pushed — this session is not idle
  return effects;
}

function sessionReducer(state, event) {
  // Terminal: a settled session ignores every later event (a Stop then a crash, or a double End,
  // must not re-emit or re-post). FIX #5 below keeps a PARKED one inert to its drained SDK tail.
  if (state.phase === 'ended') return { state: state, effects: [] };
  const type = event && event.type;

  // FIX #5: a stray assistant/tool/result/outbound/permission_request from that tail must NOT re-arm
  // the idle timer, run the cap endEffects, or stash a resolver on a query-less session. Only the
  // wake triggers (inbound_arrived/inbound_released/steer), idle_timeout and the operator /
  // terminal controls act.
  // `context` joins that list for the same reason `result` is on it: the meter describes a turn
  // this session is running, and a parked shell is not running one — a measurement arriving from
  // the drained tail would repaint a gauge for a query that no longer exists.
  if (state.parked === true && (type === 'assistant' || type === 'tool_use' || type === 'tool_result'
      || type === 'outbound_post' || type === 'result' || type === 'context' || type === 'permission_request')) {
    return { state: state, effects: [] };
  }

  if (type === 'launched') {
    // AUDIT F8: gatePhase, like every other phase flip. This branch set 'running' flat, so a
    // resumed SDK booting under a HELD inbound card clobbered the "Message waiting" pill to
    // "Working" while the card was still unanswered (the persist effect wrote it to disk too).
    const phase = gatePhase(state, 'running');
    return {
      state: clone(state, { phase: phase }),
      effects: [
        { type: 'persist', phase: phase },
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

  // FIX F3 — a tool_result is a pass-through, EXCEPT the FAILING result of an own-channel post, whose
  // bubble was painted before canUseTool resolved: a Deny drops the id here, and postedThisTurn too.
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

  // Item 2: the agent SENT a message to the peer (op=post into its own channel, per
  // session-io.isOutboundPost). It flows THROUGH the reducer so it records `postedThisTurn`.
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
    // A shape already granted for the task short-circuits with no button (checked FIRST — mutating
    // allowedTools mid-session silently drops the callback, §A.5, so this Set is the only home for a
    // task grant). `name` is the SCOPED grant key, never the bare tool name.
    if (state.allowForTask.indexOf(event.name) !== -1) {
      return { state: state, effects: [{ type: 'resolvePermission', requestId: event.requestId, decision: 'allow' },
        { type: 'scheduleIdle' }] };
    }
    return {
      state: clone(state, {
        phase: gatePhase(state, 'awaiting_permission'), // FIX #6: a held card keeps the phase
        activity: 'awaiting_permission', // item 3: rides the awaiting_permission phase
        pendingPermissions: addUnique(state.pendingPermissions, event.requestId),
      }),
      // FIX 3 (2026-08-02) — RE-ARM THE IDLE TIMER. It was dispatched from `launched` and
      // `result` and NOWHERE else, so the 15-minute TTL measured time since the last turn
      // ENDED, not idleness. A card the operator was reading for sixteen minutes therefore
      // parked underneath them: parkEffects deny-closed the very request on screen and reset
      // both axes. A session with an open card is the opposite of idle; say so.
      effects: [{ type: 'emit', payload: event.payload }, { type: 'scheduleIdle' }],
    };
  }

  if (type === 'permission_decision') {
    // FIX M1: FAIL CLOSED — only the two explicit allow decisions grant; every other value (deny,
    // or an unrecognized/forged string) resolves DENY. The engine's resolvePerm applies the same
    // rule, so main is authoritative on both layers.
    const sdkDecision = event.decision === 'allow-once' || event.decision === 'allow-task' ? 'allow' : 'deny';
    const nextAllow = event.decision === 'allow-task' ? addUnique(state.allowForTask, event.name) : state.allowForTask;
    const nextPending = without(state.pendingPermissions, event.requestId);
    // FIX #6: a stale dock click on a PARKED session must NOT flip it to running — only a steer
    // or an inbound turn resumes one. Keep phase parked; the resolve + permission_resolved echo
    // are harmless no-ops (park cleared both docks), and gatePhase keeps a held card's phase.
    const phase = gatePhase(state, state.parked ? 'parked' : (nextPending.length ? 'awaiting_permission' : 'running'));
    // Back to the in-flight turn once the last button clears; the renderer already learns that
    // from permission_resolved, so no extra status emit here.
    const activity = state.parked ? 'parked' : (nextPending.length ? 'awaiting_permission' : 'working');
    // FIX 3: answering a card IS activity, so the TTL restarts from the answer. Skipped for a
    // PARKED session, which has no live turn to keep alive — a stale dock click must not
    // re-arm a timer on a shell that is deliberately dormant (its idle_timeout is a no-op
    // anyway, but arming one there would be arming it for nothing).
    const effects = [
      { type: 'resolvePermission', requestId: event.requestId, decision: sdkDecision },
      { type: 'emit', payload: { type: 'permission_resolved', requestId: event.requestId, decision: event.decision } },
    ];
    if (!state.parked) effects.push({ type: 'scheduleIdle' });
    return {
      state: clone(state, { phase: phase, activity: activity, allowForTask: nextAllow, pendingPermissions: nextPending }),
      effects: effects,
    };
  }

  if (type === 'set_tool_mode' || type === 'set_message_mode') {
    // v2.9 — set ONE axis, coerced fail-closed (unknown => most restrictive); the `modes` echo
    // re-paints the header posture live. NO DRAIN: the old set_auto_approve(true) resolved every
    // request already parked on a button, which cannot survive the split. `pendingPermissions`
    // holds requestIds only, so the reducer cannot tell a queued Bash from a queued `op=open
    // direct:true`, and a blanket drain would let the TOOL axis answer a MESSAGE operation — the
    // very invariant this contract establishes. A mode change governs the NEXT call; anything
    // already waiting keeps its buttons (fail-closed). The INBOUND half of Axis B still drains,
    // because that queue holds messages and nothing else (session-ipc -> gate.drainInbound).
    const patch = type === 'set_tool_mode'
      ? { toolMode: coerceMode(TOOL_MODES, event.mode) }
      : { messageMode: coerceMode(MESSAGE_MODES, event.mode) };
    const next = clone(state, patch);
    return { state: next, effects: [modesEmit(next)] };
  }

  if (type === 'result') {
    // Turn end. costUsd/turns accumulate for the SAFETY caps (item 6 keeps every cap; only the
    // display-only `usage` emit is dropped). Reset postedThisTurn now the turn closed.
    const turnCost = Number(event.turnCostUsd) || 0;
    const turns = state.turns + 1;
    const costUsd = state.costUsd + turnCost;
    // 2026-08-02: `event.model` was computed by session-io and then thrown away here. It is the
    // model that really served this turn, so a mid-session Query.setModel shows up on the header
    // and in the meter's denominator at the NEXT turn end rather than waiting for a fresh `init`
    // that a live switch never produces. Absent (an older event) keeps what we had.
    const model = typeof event.model === 'string' && event.model ? event.model : state.model;
    const ns = clone(state, { turns: turns, costUsd: costUsd, model: model, postedThisTurn: false, postedToolUseIds: [] });
    if (turnCapReached(ns)) {
      return { state: clone(ns, { phase: 'ended' }), effects: endEffects(ns, 'ended', 'turn_cap') };
    }
    if (costCapReached(ns)) {
      return { state: clone(ns, { phase: 'ended' }), effects: endEffects(ns, 'ended', 'cost_cap') };
    }
    // Item 3: a turn that POSTED is waiting on a reply; otherwise idle. This REPLACES the usage emit.
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

  if (type === 'context') {
    // THE CONTEXT METER (2026-08-02) — "how full is this session's window". session-model
    // measured the prompt the model last saw and, when it knows that model, its window size.
    // It is a SEPARATE event from `result` on purpose: the cost path is load-bearing for the
    // caps, and a measurement that fails to arrive (an unknown usage shape, a turn with no
    // assistant message) must change nothing about it. Coerced here as well as there, so a
    // junk number can never reach the renderer as a percentage.
    const tokens = Number(event.tokens) > 0 ? Number(event.tokens) : 0;
    const window = Number(event.window) > 0 ? Number(event.window) : null;
    const model = typeof event.model === 'string' && event.model ? event.model : state.model;
    // After Claude Code auto-compacts, the next turn's prompt is SMALLER and this simply
    // reports the smaller number: the meter corrects itself with no special handling.
    return {
      state: clone(state, { contextTokens: tokens, contextWindow: window, model: model }),
      effects: [{ type: 'emit', payload: { type: 'context', tokens: tokens, window: window, model: model || null } }],
    };
  }

  if (type === 'inbound_arrived') {
    // v2.5 D1 — THE INBOUND GATE, now universal. A COUNTERPARTY turn NEVER reaches the agent
    // before the operator accepts it: only an explicit AXIS B / task opt-in feeds it. A second
    // arm used to bypass for `event.selfAuthored` — the operator's OWN message routed to their
    // OWN team agent, which had already had its human decision. Nothing writes that flag since
    // channel-agents.deliverToAgent was deleted (channels rollback, 2026-08-05), and every
    // feedInbound caller excludes own-authored messages, so AXIS B is the whole opt-out.
    if (inboundAutoAccepted(state)) {
      return { state: clone(state, { phase: 'running', activity: 'working', parked: false }), effects: feedInboundEffects(state, event) };
    }
    // HOLD it as a pending inbound the operator answers (Accept / Accept for this task /
    // Decline). A PARKED session KEEPS the parked flag (do not wake yet) — a parked query must
    // not run just to hold a reply; the ACCEPT resumes it. FIX #1: the hold also STATUSES,
    // because the pill only moves on a `status` event, so the card used to land under a pill
    // still reading "Paused" / "Working" — the one state needing the operator read as idle.
    return {
      state: clone(state, { phase: 'awaiting_inbound', activity: 'awaiting_inbound', hasPendingInbound: true }),
      effects: [
        { type: 'emit', payload: { type: 'inbound_pending', pendingId: event.pendingId, from: event.authorName, text: event.message } },
        { type: 'emit', payload: { type: 'status', phase: 'awaiting_inbound', activity: 'awaiting_inbound' } },
      ],
    };
  }

  // v2.5 D1 — ACCEPT (plus the `inbound_released` legacy alias, kept for a mid-wave caller and the
  // v2.3 tests): feed the held reply as the next turn. P1: if the session parked while the reply was
  // held, the accept is the wake trigger. `inbound_accept_for_task` ALSO records the standing grant,
  // which a park now clears (C9).
  if (type === 'inbound_accept' || type === 'inbound_accept_for_task' || type === 'inbound_released') {
    const effects = wakeEffects(state);
    effects.push(pushInboundEffect(event));
    effects.push({ type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } });
    if (event.pendingId) {
      effects.push({ type: 'emit', payload: { type: 'inbound_resolved', pendingId: event.pendingId, decision: type === 'inbound_accept_for_task' ? 'accepted-task' : 'accepted' } });
    }
    // FIX 3: an accepted reply is a turn being pushed, so the TTL restarts. A HELD session
    // is the exception for the same reason wakeEffects declines to resume it: nothing runs.
    if (state.authHeld !== true) effects.push({ type: 'scheduleIdle' });
    // H1 belt: session-gate.decideInbound refuses an ACCEPT on a held session before the head
    // is shifted, so this is not normally reachable — but `inbound_released` is a legacy alias
    // other callers may still dispatch, and a held session must never come out of this branch
    // claiming to run. wakeEffects already declined to resume it; keep the state honest too.
    const patch = state.authHeld === true
      ? { hasPendingInbound: false }
      : { phase: 'running', activity: 'working', hasPendingInbound: false, parked: false };
    if (type === 'inbound_accept_for_task') patch.inboundForTask = true;
    return { state: clone(state, patch), effects: effects };
  }

  if (type === 'inbound_decline') {
    // v2.5 D1 — DECLINE is LOCAL: the message is dropped, never fed, and NOTHING is written to the
    // server (no calm echo — the peer sees no reply to a declined mid-task message). A parked
    // session STAYS parked (a decline is not a wake trigger); a live one returns to idle.
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
    // The operator injected a turn -> back to `working` (item 3), statused only when the activity
    // actually changed. P1: operator input is the second LAZY-RESUME trigger — it wakes a parked
    // session, and a parked query has nothing live to interrupt, so a priority:'now' steer skips
    // interruptQuery while waking.
    const waking = state.parked === true;
    const effects = waking ? [{ type: 'resumeQuery' }] : [];
    if (event.priority === 'now' && !waking) effects.push({ type: 'interruptQuery' });
    effects.push({ type: 'pushTurn', text: event.text, priority: event.priority || 'next' });
    // FIX #6: typing does not answer the gate, so a still-held card keeps the phase; the activity
    // goes back to `working` so the send button can offer Pause.
    const nextPhase = gatePhase(state, waking ? 'running' : state.phase);
    if (state.activity !== 'working') {
      effects.push({ type: 'emit', payload: { type: 'status', phase: nextPhase, activity: 'working' } });
    }
    effects.push({ type: 'scheduleIdle' }); // FIX 3: the operator just typed — restart the TTL
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
    // P1: PARK, do not end. Already parked (a stale timer that survived the clear) is a no-op; NOT
    // terminal, the session stays resumable via a lazy wake. FIX #17: the guard reads `parked`, not
    // `phase` — a parked session HOLDING a message sits at 'awaiting_inbound' with parked===true,
    // so the old phase check let a stale timer re-run the whole park on it.
    //
    // M2 (2026-08-05) — THE POSTURE AND THE GRANTS NOW SURVIVE THE PARK, per Samuel's contract:
    // set it and it behaves as set for the rest of the session, the for-task grants included.
    // WHAT USED TO RESET AND WHY (the reasoning is real, and is re-sited, not deleted — the full
    // argument is at session-state.ABANDONED_MS and docs/ENGINEERING.md §12.4): FIX #3 (v2.9)
    // both axes, so a counterparty-driven lazy resume could not run pre-authorized while the
    // operator was away; MEDIUM-3 (C9) `inboundForTask`, so a peer could not restart a parked
    // query and drive turns unwatched; FIX F1 `allowForTask`, where one reply approved for-task
    // before the operator walked away let the woken agent post with NO card. Every one is an AWAY
    // threat, and fifteen quiet minutes was a bad proxy for away. It is answered twice elsewhere
    // now: this park ARMS THE ABANDONMENT BOUND (a session nobody comes back to ENDS, and ended
    // beats disarmed — it cannot be woken at all), and the real boundary was always the PROFILE's
    // hard-deny + containment, which no posture and no grant can widen.
    // FIX F6 SURVIVES: the per-turn post counters still clear (the park deny-closed the very post
    // they counted), and so does `pendingPermissions` — one-shot resolvers on a query being torn
    // down are not a posture.
    if (state.parked === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: gatePhase(state, 'parked'), parked: true, activity: 'parked',
        pendingPermissions: [], postedThisTurn: false, postedToolUseIds: [] }),
      effects: parkEffects(state, { resetPosture: false, armAbandon: true }),
    };
  }

  if (type === 'abandon_timeout') {
    // M2 — a PARKED session nobody came back to. The park kept the operator's posture on the bet
    // that they are coming back; this is where that bet expires, hours later. ENDING is the honest
    // state and the STRONGER away-guard: `phase: 'ended'` is terminal at the top of this function,
    // so no peer reply, no stale dock click and no drained SDK tail can wake it, where the old
    // silent downgrade left it wakeable. A later peer reply recreates a DORMANT shell from the
    // durable record, at manual/ask like every other spawn nobody approved (FIX 1b).
    // A LIVE session ignores it — a stale timer must never end a session being worked in.
    if (state.parked !== true) return { state: state, effects: [] };
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'abandoned') };
  }

  if (type === 'auth_hold') {
    // H1 — THE HOLD, AS REDUCER STATE. session-auth.js owns the DECISION (no Claude Code
    // credential here, or an auth-shaped SDK failure) and the window painting; this records the
    // one bit the rest of the machine must agree on. A hold IS a park — same effects, same
    // durable phase — so it is dormant on restart, reopenable and LRU-evictable, and parkEffects
    // fail-closes every awaited canUseTool promise before the abort. It resets both axes and
    // every standing grant, and it is now the ONLY park that does (M2 above): a hold is a session
    // whose CREDENTIAL is gone, which relaunches through startQuery on sign-in rather than
    // resuming in place, so the arm it was given belongs to the run that ended (the H2 arm cannot
    // survive a hold either). It arms NO abandonment timer — a held session is waiting on a human
    // clicking Sign in, and ending it would destroy the window carrying that button.
    // IDEMPOTENT: a second hold changes nothing and emits nothing, so two failures cannot stack
    // two banners, two parks or two denyPending sweeps.
    if (state.authHeld === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: gatePhase(state, 'parked'), parked: true, activity: 'parked',
        authHeld: true, toolMode: 'manual', messageMode: 'ask', inboundForTask: false,
        allowForTask: [], pendingPermissions: [], postedThisTurn: false, postedToolUseIds: [] }),
      effects: parkEffects(state),
    };
  }

  if (type === 'auth_release') {
    // The credential is back and session-auth is about to relaunch. This clears the hold and
    // NOTHING else: the caller drives the restart (a preflight hold re-runs startQuery, an
    // error hold takes the ordinary steer -> resume), and both go through the single
    // supersede-first startQuery, so releasing can never itself spawn anything. Idempotent, so
    // a double sign-in click releases once.
    if (state.authHeld !== true) return { state: state, effects: [] };
    return { state: clone(state, { authHeld: false }), effects: [] };
  }

  if (type === 'cost_cap') {
    return { state: clone(state, { phase: 'ended' }), effects: endEffects(state, 'ended', 'cost_cap') };
  }

  if (type === 'crash') {
    // FIX #1a: PARK is the only path that aborts the query WITHOUT settling, so the torn-down
    // query's consume loop can surface a non-AbortError rejection (e.g. "process exited with code
    // 143"). That must NOT settle+destroy a parked session (a spurious task_failed{interrupted});
    // a parked crash is inert and stays resumable.
    if (state.parked === true) return { state: state, effects: [] };
    // Query threw / render window gone: settle interrupted and post the SAME
    // task_failed{interrupted:true} echo the reload path posts, so the requester's web card
    // settles to "Interrupted" rather than pulsing forever.
    //
    // C3 (CRITICAL): `abortQuery` comes FIRST. A crash used to settle a session whose SDK query
    // was still live, so the transport kept running behind a window that had already said "ended"
    // — every other terminal path (end / cap / close_task) aborts first, and this one must too.
    return {
      state: clone(state, { phase: 'ended' }),
      effects: [
        { type: 'abortQuery' },
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
  idleTimeout, // M2: the ONE timer decision (bound + event), re-exported for session-engine
  turnCapReached,
  costCapReached,
};

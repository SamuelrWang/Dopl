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

// §2 SPLIT: the pure EFFECT BUILDERS live in session-effects.js. They are required here at
// module scope, ABOVE the sentinel, so inside the block below they are free vars — which is
// what lets test/_reducer-block.mjs prepend that module's block and evaluate the pair with no
// `require` in scope, exactly as before the split.
const { gatePhase, endedEmit, endEffects, modesEmit, parkEffects } = require('./session-effects');

// ─── BEGIN SESSION-REDUCER (pure; unit-tested via source extraction) ─────────

// Loop-safety defaults (contract §A.2). turn cap bounds a two-agent exchange; idle TTL ends a
// stalled session (task stays open, resumable); cost cap is opt-in (0 => disabled).
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
  return arr.filter(function (x) { return x !== v; });
}

// Fresh state for a launching session. `mode` is the task's declared engagement mode (display + the
// durable record); as of v2.5 D1 it NO LONGER gates the inbound path — every counterparty turn waits
// on an Accept unless AXIS B or the standing grant says otherwise. Caps (and, v3.1, both axes) fall
// back to the documented defaults on an absent or invalid value.
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
    allowForTask: [], // scoped grant KEYS granted for the task (models a Set); cleared on park
    // v2.9 THE TWO AXES (session-profiles owns the tables + the resolution). toolMode = AXIS A
    // (manual|accept_edits|auto|bypass): what MY agent may do on THIS machine, NEVER a message op;
    // messageMode = AXIS B (ask|auto_inbound|auto_outbound|auto_both): what crosses between machines,
    // NEVER a work tool. Per-session, never persisted, RESET on park (v2.3 FIX #3). v3.1: the START
    // may come from the channel preset (channel-context.startingModes), coerced fail-closed here.
    toolMode: coerceMode(TOOL_MODES, o.toolMode),
    messageMode: coerceMode(MESSAGE_MODES, o.messageMode),
    // v2.5 D1/D4: the standing INBOUND grant ("Accept for this session") — when true an inbound turn
    // is fed with no Accept. Like allowForTask it lives for the life of the in-memory session
    // object and is NEVER persisted. MEDIUM-3 (C9): it is now reset on park with the two axes, so
    // a peer cannot restart a parked query and drive turns with the operator away.
    inboundForTask: false,
    hasPendingInbound: false,
    // P1 (v1.7.4): true while the session is PARKED — the live SDK query is torn down but the
    // session object + window survive, so an inbound turn or operator input can lazily resume it
    // (options.resume). Never persisted. Distinct from `phase` because a parked session HOLDING a
    // reply sits at phase 'awaiting_inbound' (FIX #6) yet still needs a resume on Accept.
    parked: false,
    // H1: TRUE while this session is held on the "Sign in to Claude" action (the preflight
    // found no Claude Code credential, or a live query failed auth-shaped). A held session is
    // PARKED but, unlike an idle park, must NOT be woken by an inbound turn — there is no
    // credential to spawn with. It lives HERE rather than on the session object because
    // wakeEffects and inboundAutoAccepted, the two places that decide whether to spawn, can
    // only see state. Never persisted: a credential is a fact about the machine, not a record.
    authHeld: false,
    // Item 3: the coarse activity the status pill shows (working|idle|awaiting_peer|awaiting_
    // permission|awaiting_inbound). A launching/running session is `working`; `postedThisTurn`
    // records whether the agent posted this turn, so turn-end can pick `awaiting_peer` vs `idle`.
    activity: 'working',
    postedThisTurn: false,
    // FIX F3: the tool_use ids of the posts that streamed THIS turn. The outbound bubble is
    // emitted BEFORE canUseTool resolves, so a denied post must be un-counted when its failing
    // tool_result lands; else the turn ends "Waiting for reply" on a message that never left.
    postedToolUseIds: [],
  };
}

// Idle timer duration (§A.2). Constant today; a hook for phase-aware backoff later.
function nextIdleMs(state) {
  return state.idleMs;
}
function turnCapReached(state) {
  return state.turns >= state.turnCap;
}
function costCapReached(state) {
  return state.costCapUsd > 0 && state.costUsd >= state.costCapUsd;
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

// v2.9 THE MODE TABLES, duplicated ON PURPOSE: session-profiles.js is canonical, but this block is
// evaluated standalone (source extraction) and is the STATE OWNER, so it defends its own field fail-
// closed — for a mid-session change AND for the v3.1 preset it starts from. test/session-permission-
// axes pins the copies (here, session-profiles, the preload, the renderer).
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];
function coerceMode(list, value) {
  return list.indexOf(value) === -1 ? list[0] : value; // [0] is the most restrictive
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
  // Terminal: a settled session ignores every later event (a Stop then a crash, or a double End,
  // must not re-emit or re-post). FIX #5 below keeps a PARKED one inert to its drained SDK tail.
  if (state.phase === 'ended') return { state: state, effects: [] };
  const type = event && event.type;

  // FIX #5: a stray assistant/tool/result/outbound/permission_request from that tail must NOT re-arm
  // the idle timer, run the cap endEffects, or stash a resolver on a query-less session. Only the
  // wake triggers (inbound_arrived/inbound_released/steer), idle_timeout and the operator /
  // terminal controls act.
  if (state.parked === true && (type === 'assistant' || type === 'tool_use' || type === 'tool_result'
      || type === 'outbound_post' || type === 'result' || type === 'permission_request')) {
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
    return {
      state: clone(state, { phase: phase, activity: activity, allowForTask: nextAllow, pendingPermissions: nextPending }),
      effects: [
        { type: 'resolvePermission', requestId: event.requestId, decision: sdkDecision },
        { type: 'emit', payload: { type: 'permission_resolved', requestId: event.requestId, decision: event.decision } },
      ],
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
    const ns = clone(state, { turns: turns, costUsd: costUsd, postedThisTurn: false, postedToolUseIds: [] });
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

  if (type === 'inbound_arrived') {
    // v2.5 D1 — THE INBOUND GATE, now universal. A counterparty turn NEVER reaches the agent
    // before the operator accepts it: the task's engagement mode no longer decides (the v2.2
    // autonomous auto-continuation is gone), only an explicit AXIS B / task opt-in does.
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
    effects.push({ type: 'pushInbound', message: event.message, authorName: event.authorName });
    effects.push({ type: 'emit', payload: { type: 'status', phase: 'running', activity: 'working' } });
    if (event.pendingId) {
      effects.push({ type: 'emit', payload: { type: 'inbound_resolved', pendingId: event.pendingId, decision: type === 'inbound_accept_for_task' ? 'accepted-task' : 'accepted' } });
    }
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
    // WHAT RESETS, AND WHY EACH ONE: FIX #3 (v2.9) both axes, so a counterparty-driven lazy resume
    // cannot run pre-authorized while the operator is away; MEDIUM-3 (C9) `inboundForTask`, which
    // survived a park and let a peer restart a parked query and drive turns with nobody watching;
    // FIX F6 the per-turn post counters, or the next turn reads "Waiting for reply" beside a post
    // the park deny-closed; FIX F1 (v2.9 review) `allowForTask` — contract §B3 and the comment in
    // session-profiles both DOCUMENTED it as cleared on park and nothing cleared it, so one benign
    // reply approved for-task before the operator walked away let the woken agent post arbitrary
    // content with NO card, under a header honestly reading "Asking before messages in and out".
    // A standing grant is consent given to a WATCHED window; the park is the moment that window
    // stopped being watched, so grants die with the posture that framed them.
    if (state.parked === true) return { state: state, effects: [] };
    return {
      state: clone(state, { phase: gatePhase(state, 'parked'), parked: true, activity: 'parked',
        toolMode: 'manual', messageMode: 'ask', inboundForTask: false, allowForTask: [],
        pendingPermissions: [], postedThisTurn: false, postedToolUseIds: [] }),
      effects: parkEffects(state),
    };
  }

  if (type === 'auth_hold') {
    // H1 — THE HOLD, AS REDUCER STATE. session-auth.js owns the DECISION (no Claude Code
    // credential here, or an auth-shaped SDK failure) and the window painting; this records the
    // one bit the rest of the machine must agree on. A hold IS a park — same effects, same
    // durable phase — so it is dormant on restart, reopenable and LRU-evictable, and parkEffects
    // fail-closes every awaited canUseTool promise before the abort. It resets both axes and
    // every standing grant for idle_timeout's reason: consent was given to a WATCHED window, and
    // one waiting on a sign-in button is not one (so the H2 arm cannot survive a hold either).
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
  turnCapReached,
  costCapReached,
};

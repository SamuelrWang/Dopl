// session-effects.js — the reducer's EFFECT BUILDERS (pure).
//
// ⚠ Every function returns a side-effect-FREE effect descriptor ({ type, ... }) — never a
// callback, never a live handle. session-engine.js EXECUTES them; nothing here reads or writes.
// ⚠ NO electron / SDK / fs / require references inside the sentinel block: test/_reducer-block
// .mjs slices it, PREPENDS it to the session-reducer block and evaluates the pair verbatim in
// plain Node. session-reducer.js requires these names ABOVE its own sentinel, so inside its
// block they are free vars.

// ─── BEGIN SESSION-EFFECTS (pure; unit-tested via source extraction) ─────────

// ⚠ A PENDING inbound card WINS the displayed status: `phase` carries the gate (nothing may
// clobber it while a card waits, so the pill keeps reading "Message waiting") while `activity`
// tells the truth, so the send button still morphs to Pause on a mid-flight turn.
function gatePhase(state, phase) {
  return state && state.hasPendingInbound === true ? 'awaiting_inbound' : phase;
}

// The effect set shared by every end (operator End, turn/cost cap): abort the query, tell the
// renderer, settle the record. ⚠ Leaves the channel TASK untouched — no task_finished, and
// since thread closing was removed (wiring plan Phase 4, 2026-08-18) there is no other end that
// touches it either. A real end ALSO posts a CALM lifecycle so the web card stops pulsing
// "Working…". ⚠ Idle never reaches here; it PARKS instead.
function endedEmit(state, outcome, reason, summary) {
  const payload = { type: 'ended', outcome: outcome, totalCostUsd: state.costUsd, reason: reason };
  if (summary !== undefined) payload.summary = summary;
  return { type: 'emit', payload: payload };
}

// The calm lifecycle a real end posts. All ride metadata like `interrupted` — no server-stamped
// keys, and nothing that touches the thread row. Any other reason posts nothing.
//
// ⚠ A LOCAL SESSION ENDING IS NOT A THREAD FAILURE. `task_failed` is TERMINAL whatever metadata
// rides it: group-thread.ts folds it into `endEvent` and computeStatus reads a terminal marker
// as the exchange's OUTCOME, so one member parking their own window paints the SHARED thread as
// failed on the peer's card. The operator End therefore posts a NON-TERMINAL `session_ended`:
// kind `task_progress`, which group-thread treats as an ENTRY and never as an endEvent, while
// still reaching `calmEndStatus` so the card stops saying "Working…".
// ⚠ A METADATA MARKER, NOT A NEW KIND: `channel_messages.kind` carries a CHECK constraint, so a
// first-class `session_ended` kind is a schema change deployed ahead of every desktop that
// would write it, for a render hint. The marker is reserved server-side like the calm flags.
// ⚠ THE CAPS STAY TERMINAL: a turn/cost cap is this machine refusing to continue, not a window
// being tidied away, and the peer is owed that as an outcome.
//
// ⚠ THE SILENT TERMINALS MUST POST. `abandoned` (the COMMON path: request -> task_started ->
// 15min idle -> silent park -> 12h -> end) and the auth-preflight hold (`launch()` answers with
// a sessionId, so trigger.js takes the success branch and no query ever runs) each used to post
// NOTHING, so the requester's card pulsed "Working…" indefinitely on exactly the endings nobody
// chose.
// ⚠ IT WAS THREE, AND THE THIRD IS GONE (corrected 2026-08-20): "the window-budget EVICTION
// (`settle()` bypasses the reducer)". That LRU went with the window (`session-park.js`), and
// the surviving ceiling REFUSES a launch rather than reclaiming a live session — so no session
// is ever ended to make room, and "a window budget reclaimed" is not one of the things this
// note has to avoid saying.
// ⚠ ONE WORDING FOR BOTH: which of the two it was is a fact about the OTHER machine (nobody
// came back; no Claude Code credential), and the second would report the operator's
// circumstances to a counterparty. No blame, no cause, no em dash.
// A real terminal arriving later cannot double-post: `trigger-outcomes.js › onEnded` drops a
// repeat of the same (thread, cycle) marker, and the deterministic clientMsgId dedupes it
// server-side. ⚠ That reader said `session-window.onEnded` until 2026-08-20 — the module is
// deleted and the handler MOVED (its own header records the move), so the dedupe is live and
// the citation was not.
const INACTIVE_NOTE = 'This session went inactive.';

function endLifecycle(reason) {
  if (reason === 'turn_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Turn limit reached' };
  if (reason === 'cost_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Cost limit reached' };
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: 'Session ended' };
  // C-5: the 12h abandonment and the launch watchdog (C-4). ⚠ "and the LRU eviction" stood
  // here until 2026-08-20; there is no eviction (see the header).
  if (reason === 'abandoned' || reason === 'inactive') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: INACTIVE_NOTE };
  }
  return null;
}

// ⚠ AN ABANDONMENT KEEPS ITS WINDOW. Every other end is something the operator watched happen;
// an abandonment fires hours later with nobody present, and destroying the window makes a
// transcript vanish from the desktop of someone who stepped away — indistinguishable from a
// crash. Costs nothing: `phase: 'ended'` is what stops a peer reply, a stale dock click or a
// drained SDK tail from waking the session, and `settle` still denies every pending permission,
// closes the iterator, aborts the query and drops the map entry.
function endEffects(state, outcome, reason, summary) {
  const lc = endLifecycle(reason);
  return [{ type: 'abortQuery' }].concat(lc ? [lc] : [],
    [endedEmit(state, outcome, reason, summary),
      { type: 'settle', outcome: outcome, keepWindow: reason === 'abandoned' }]);
}

// The header posture echo: ⚠ ONE shape for BOTH axes, so the renderer never sees half a one.
function modesEmit(state) {
  return { type: 'emit', payload: { type: 'modes', tool: state.toolMode, message: state.messageMode } };
}

// ⚠ A PARK THAT TAKES THE POSTURE AWAY MUST SAY SO — otherwise the selects just move and the
// experience is "I set Bypass and it keeps turning itself off" with no event to attach it to.
// ⚠ Emitted ONLY when there was really something to reset, so it can never claim a change that
// did not happen. Belongs to the ONE park that still resets: the AUTH HOLD.
// Copy lives in main because main knows whether the reset happened; it goes out as an ordinary
// `notice`, which the view-model renders via textContent. No em dash.
const POSTURE_RESET_NOTE = 'Paused. Tools and Messages reset to Manual / Ask.';
function postureWasReset(state) {
  return !!state && (state.toolMode !== 'manual' || state.messageMode !== 'ask');
}

// Idle PARKS the session, never ends it: deny any awaited canUseTool promise fail-closed, tear
// down the live query, clear the idle timer, persist phase 'parked', tell the renderer.
// ⚠ NOT settled: no `settle`, no `win.destroy`, no registry removal, and sdkSessionId is
// RETAINED so a lazy wake can resume it.
//
// TWO PARKS, TWO POSTURE ANSWERS, explicit at both call sites:
//   `resetPosture: true`  (default; AUTH_HOLD) — disarm both axes and SAY SO. A hold is a
//                         session whose credential is gone; it relaunches through startQuery.
//   `resetPosture: false` (IDLE park) — ⚠ the operator's posture is theirs for the session. No
//                         modes echo, no note: the renderer's selects move ONLY on a `modes`
//                         event, so they go on showing what the operator set.
//   `lifecycle: true`     ⚠ AUTH HOLD ONLY. A preflight hold answers `launch()` with a
//                         live-looking sessionId, so trigger.js takes its success branch and
//                         NOTHING is posted — no task_started, no reply, no end — while the
//                         requester's card pulses. The IDLE park must NOT pass it: it is a
//                         15-minute pause the operator is expected back from, and its
//                         abandonment bound already posts if they are not. Idempotent for
//                         free — the reducer's auth_hold branch returns no effects once
//                         `authHeld` is set.
//   `armAbandon: true`    RE-ARMS the timer instead of clearing it. session-engine's
//                         scheduleIdle reads `parked` off the state just stored, so this arms
//                         the hours-scale ABANDONMENT bound (`abandon_timeout`), never another
//                         15-minute idle TTL. ⚠ IDLE park only: an auth-held session waits on a
//                         human clicking "Sign in", and ending it destroys that button.
function parkEffects(state, opts) {
  const o = opts || {};
  const resetPosture = o.resetPosture !== false;
  const effects = [
    { type: 'denyPending' },
    { type: 'abortQuery' },
    o.armAbandon === true ? { type: 'scheduleIdle' } : { type: 'clearIdle' },
    { type: 'persist', phase: 'parked' },
  ];
  if (o.lifecycle === true) effects.push(endLifecycle('inactive')); // the peer is told, once
  if (resetPosture) {
    // ⚠ A park that DISARMS both axes says so — a silent reset leaves the control reading "on"
    // over a session that will ask again.
    effects.push(modesEmit({ toolMode: 'manual', messageMode: 'ask' }));
  }
  effects.push({ type: 'emit', payload: { type: 'status', phase: gatePhase(state, 'parked') } });
  // `paused` drops the one-line inline note (renderer owns the copy), distinct from the reopen
  // shell's `notice`. ⚠ A park while a message is HELD says so — "wait for a reply" is wrong
  // when the reply is already here.
  effects.push({ type: 'emit', payload: state && state.hasPendingInbound === true ? { type: 'paused', gated: true } : { type: 'paused' } });
  if (resetPosture && postureWasReset(state)) {
    effects.push({ type: 'emit', payload: { type: 'notice', level: 'info', text: POSTURE_RESET_NOTE } });
  }
  // ⚠ Clear the renderer's permission dock for anything awaiting a button: main denies each
  // fail-closed (denyPending) before the abort, so a parked, query-less session must not keep
  // showing a live-looking prompt.
  for (const id of (state && state.pendingPermissions) || []) {
    effects.push({ type: 'emit', payload: { type: 'permission_resolved', requestId: id, decision: 'deny' } });
  }
  return effects;
}

// ─── END SESSION-EFFECTS ─────────────────────────────────────────────────────

module.exports = {
  gatePhase,
  endedEmit,
  endLifecycle,
  endEffects,
  modesEmit,
  parkEffects,
  postureWasReset, // did this park actually take a posture away?
  POSTURE_RESET_NOTE,
  INACTIVE_NOTE, // the one wording all three silent terminals use
};

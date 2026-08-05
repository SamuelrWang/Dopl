// session-effects.js — the reducer's EFFECT BUILDERS (pure).
//
// Extracted from session-reducer.js to hold that AT-CAP file (§2, 500 lines) under the cap
// while H1 adds the auth-hold state. Everything here is a pure function from state to a
// side-effect-FREE effect descriptor ({ type, ... }) — never a callback, never a live handle;
// session-engine.js is what EXECUTES them. Nothing here reads or writes anything.
//
// SOURCE EXTRACTION: no electron / SDK / fs / require references inside the sentinel block, so
// test/_reducer-block.mjs slices this block, PREPENDS it to the session-reducer block, and
// evaluates the pair verbatim in a plain Node context. session-reducer.js requires these names
// at module scope (above its own sentinel), so inside its block they are free vars — the same
// arrangement session-park.js uses for its injected deps, and the reason the split costs the
// reducer's own truth-table tests nothing.

// ─── BEGIN SESSION-EFFECTS (pure; unit-tested via source extraction) ─────────

// FIX #6 — a PENDING inbound card WINS the displayed status: `phase` carries the gate (nothing below
// clobbers it while a card waits, so the pill keeps reading "Message waiting") while `activity` tells
// the truth, so the send button still morphs to Pause on a mid-flight turn.
function gatePhase(state, phase) {
  return state && state.hasPendingInbound === true ? 'awaiting_inbound' : phase;
}

// The effect set shared by every non-close_task end (operator End, turn/cost cap): abort the query, tell the
// renderer, settle the record. These leave the channel TASK open (resumable) — no task_finished. P3: a real end
// ALSO posts a CALM lifecycle so the web card stops pulsing "Working…". Idle never reaches here; it PARKS instead.
function endedEmit(state, outcome, reason, summary) {
  const payload = { type: 'ended', outcome: outcome, totalCostUsd: state.costUsd, reason: reason };
  if (summary !== undefined) payload.summary = summary;
  return { type: 'emit', payload: payload };
}

// P3: the calm lifecycle a real end posts. turn/cost caps ride extra:{capped:true} (the web renders
// "Limit reached", task stays open). Both ride metadata like `interrupted` — no server-stamped keys,
// no closeTask. Any other reason posts nothing.
//
// P1-7 (Samuel's decision 3, 2026-08-04) — A LOCAL SESSION ENDING IS NOT A THREAD FAILURE.
// The operator End used to post `task_failed` + { ended: true }. The flag kept the CHIP calm, but
// the KIND is terminal: group-thread.ts folds a task_failed into `endEvent` and computeStatus reads
// a terminal marker as the exchange's OUTCOME, so one member parking their own window painted the
// SHARED thread as failed on the peer's card. Nothing had failed — the thread was open, still
// routing, and the other member could still be working it. One machine's session had stopped.
//
// So the End posts a NON-TERMINAL `session_ended`: kind `task_progress`, which group-thread treats
// as an ENTRY and never as an endEvent, so there is no path by which it can become an outcome. The
// card still stops saying "Working…" — `groupThread` reads the marker into `calmEndStatus` — which
// was the only thing the terminal kind was ever buying.
//
// WHY A METADATA MARKER AND NOT A NEW KIND: `channel_messages.kind` carries a CHECK constraint
// (verified against the live database), so a first-class `session_ended` kind is a schema change
// deployed ahead of every desktop that would write it, for a render hint. The marker is reserved
// server-side on the same terms as the five calm flags, so it is no more forgeable than they are.
//
// THE CAPS STAY TERMINAL, deliberately. A turn/cost cap is this machine refusing to continue, not a
// window being tidied away, and the peer is owed that as an outcome.
function endLifecycle(reason) {
  if (reason === 'turn_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Turn limit reached' };
  if (reason === 'cost_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Cost limit reached' };
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: 'Session ended' };
  return null;
}

// M2b (2026-08-05, Samuel's call) — AN ABANDONMENT KEEPS ITS WINDOW.
// Every other end is something the operator watched happen: they clicked End, or a cap fired
// while they were there, so tidying the window away is the tail of an action they took. An
// abandonment fires hours later with nobody present, and destroying the window makes a
// transcript disappear from the desktop of someone who only stepped away — indistinguishable
// from a crash, and the one end where the operator has no idea it happened.
// It costs NOTHING that mattered: the window is UI. `phase: 'ended'` is what stops a peer
// reply, a stale dock click or a drained SDK tail from waking the session, and `settle` still
// denies every pending permission, closes the iterator, aborts the query and drops the map
// entry. What survives is a painted, inert transcript the operator can read and close.
function endEffects(state, outcome, reason, summary) {
  const lc = endLifecycle(reason);
  return [{ type: 'abortQuery' }].concat(lc ? [lc] : [],
    [endedEmit(state, outcome, reason, summary),
      { type: 'settle', outcome: outcome, keepWindow: reason === 'abandoned' }]);
}

// v2.9 — the header posture echo: ONE shape for BOTH axes, so the renderer never sees half a one.
function modesEmit(state) {
  return { type: 'emit', payload: { type: 'modes', tool: state.toolMode, message: state.messageMode } };
}

// FIX 3 (2026-08-02) — A PARK THAT TAKES THE POSTURE AWAY MUST SAY SO.
// The park resets both axes and modesEmit drags the selects back to Manual / Ask, but nothing
// ever STATED that the posture the operator chose had been revoked: the controls just moved.
// So the reported experience was "I set Bypass and it keeps turning itself off" with no event
// anywhere in the window to attach that to. The line is emitted ONLY when there was really
// something to reset, so it can never claim a change that did not happen — a session already
// sitting at manual/ask parks exactly as quietly as it does today.
// M2 (2026-08-05): saying it was never the whole answer, and the IDLE park no longer resets at
// all. This copy now belongs to the ONE park that still does — the AUTH HOLD, where the reset is
// about a session with no credential rather than about an operator who might be away.
// Copy lives here rather than in the renderer because main is what knows whether the reset
// happened; it goes out as an ordinary `notice`, which the view-model already renders via
// textContent. No em dash, and it names the two controls it is talking about.
const POSTURE_RESET_NOTE = 'Paused. Tools and Messages reset to Manual / Ask.';
function postureWasReset(state) {
  return !!state && (state.toolMode !== 'manual' || state.messageMode !== 'ask');
}

// P1: idle no longer ENDS the session — it PARKS it. Deny any awaited canUseTool promise fail-closed, tear down
// the live query, clear the idle timer, persist phase 'parked', tell the renderer. NOT settled: no
// `settle`, no `win.destroy`, no registry removal, and sdkSessionId is retained, so a lazy wake can resume it.
//
// M2 (2026-08-05) — TWO PARKS, TWO POSTURE ANSWERS, so the option is explicit at both call sites.
//   `resetPosture: true`  (the default, and what AUTH_HOLD passes) — the v2.9 FIX #3 behaviour,
//                         byte-for-byte: disarm both axes and SAY SO. A hold is a session whose
//                         credential is gone; it relaunches through startQuery when the operator
//                         signs in, and H1's reasoning for disarming it is untouched here.
//   `resetPosture: false` (the IDLE park) — the operator's posture is theirs for the session.
//                         No modes echo and no note, because nothing was taken away; the
//                         renderer's selects move ONLY on a `modes` event, so they go on showing
//                         what the operator set, which is now the truth.
//   `armAbandon: true`    RE-ARMS the timer instead of clearing it. session-engine's scheduleIdle
//                         reads `parked` off the state the reducer just stored, so what that arms
//                         is the hours-scale ABANDONMENT bound firing `abandon_timeout`, never
//                         another 15-minute idle TTL — one handle, one teardown path, and a wake's
//                         own scheduleIdle overwrites it. Only the idle park asks for it: an
//                         auth-held session is waiting on a human clicking "Sign in", and ending
//                         it would destroy the window carrying that button.
function parkEffects(state, opts) {
  const o = opts || {};
  const resetPosture = o.resetPosture !== false;
  const effects = [
    { type: 'denyPending' },
    { type: 'abortQuery' },
    o.armAbandon === true ? { type: 'scheduleIdle' } : { type: 'clearIdle' },
    { type: 'persist', phase: 'parked' },
  ];
  if (resetPosture) {
    // FIX #3 (v2.9): a park that DISARMS both axes says so. The old toggle reset was silent and
    // the checkbox went on reading "on" over a session that would ask again.
    effects.push(modesEmit({ toolMode: 'manual', messageMode: 'ask' }));
  }
  effects.push({ type: 'emit', payload: { type: 'status', phase: gatePhase(state, 'parked') } });
  // `paused` drops the one-line inline note (renderer owns the copy), distinct from the P2
  // reopen shell's `notice`. FIX #17: a park that happens while a message is HELD says so —
  // "wait for a reply" is wrong when the reply is already here, waiting.
  effects.push({ type: 'emit', payload: state && state.hasPendingInbound === true ? { type: 'paused', gated: true } : { type: 'paused' } });
  if (resetPosture && postureWasReset(state)) {
    effects.push({ type: 'emit', payload: { type: 'notice', level: 'info', text: POSTURE_RESET_NOTE } });
  }
  // FIX #6 (v2.3): clear the renderer's permission dock for anything awaiting a button. Main
  // denies each fail-closed (denyPending) before the abort, so a parked, query-less session must
  // not keep showing a live-looking prompt. Renderer drops each on resolve.
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
  postureWasReset, // FIX 3: did this park actually take a posture away?
  POSTURE_RESET_NOTE,
};

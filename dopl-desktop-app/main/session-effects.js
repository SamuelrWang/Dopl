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
// "Limit reached", task stays open); the operator End rides extra:{ended:true}. Both ride metadata
// like `interrupted` — no server-stamped keys, no closeTask. Any other reason posts nothing.
function endLifecycle(reason) {
  if (reason === 'turn_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Turn limit reached' };
  if (reason === 'cost_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Cost limit reached' };
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_failed', extra: { ended: true }, body: 'Session ended' };
  return null;
}

function endEffects(state, outcome, reason, summary) {
  const lc = endLifecycle(reason);
  return [{ type: 'abortQuery' }].concat(lc ? [lc] : [],
    [endedEmit(state, outcome, reason, summary), { type: 'settle', outcome: outcome }]);
}

// v2.9 — the header posture echo: ONE shape for BOTH axes, so the renderer never sees half a one.
function modesEmit(state) {
  return { type: 'emit', payload: { type: 'modes', tool: state.toolMode, message: state.messageMode } };
}

// P1: idle no longer ENDS the session — it PARKS it. Deny any awaited canUseTool promise fail-closed, tear down
// the live query, clear (never re-arm) the idle timer, persist phase 'parked', tell the renderer. NOT settled: no
// `settle`, no `win.destroy`, no registry removal, and sdkSessionId is retained, so a lazy wake can resume it.
function parkEffects(state) {
  const effects = [
    { type: 'denyPending' },
    { type: 'abortQuery' },
    { type: 'clearIdle' },
    { type: 'persist', phase: 'parked' },
    // FIX #3 (v2.9): the park DISARMS both axes, so say so. The old toggle reset was silent and
    // the checkbox went on reading "on" over a session that would ask again.
    modesEmit({ toolMode: 'manual', messageMode: 'ask' }),
    { type: 'emit', payload: { type: 'status', phase: gatePhase(state, 'parked') } },
    // `paused` drops the one-line inline note (renderer owns the copy), distinct from the P2
    // reopen shell's `notice`. FIX #17: a park that happens while a message is HELD says so —
    // "wait for a reply" is wrong when the reply is already here, waiting.
    { type: 'emit', payload: state && state.hasPendingInbound === true ? { type: 'paused', gated: true } : { type: 'paused' } },
  ];
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
};

// The reducer's effect builders: each returns a side-effect-free descriptor the engine executes. The block
// is sliced and prepended to the reducer's by test/_reducer-block.mjs, so it may not require anything.

// ─── BEGIN SESSION-EFFECTS (pure; unit-tested via source extraction) ─────────

// A held permission outranks "working", so a blocked agent never reads as busy. A display truth rule, not a gate.
function gateActivity(state, activity) {
  const pending = state && state.pendingPermissions;
  return pending && pending.length > 0 ? 'awaiting_permission' : activity;
}

// The `ended` emit every end shares: abort the query, tell the work lane why, settle the record.
function endedEmit(outcome, reason, summary) {
  const payload = { type: 'ended', outcome: outcome, reason: reason };
  if (summary !== undefined) payload.summary = summary;
  return { type: 'emit', payload: payload };
}

// The calm lifecycle notes an end (or a hold) posts so the peer's card stops pulsing "Working…". No local
// detail — why this machine stopped is not a counterparty's business — and no em dash.
const INACTIVE_NOTE = 'This session went inactive.';

// A hold is a PAUSE that needs a person, not an end; distinct from trigger-outcomes' AUTH_HELD_REPLY (a reply).
const AUTH_HELD_NOTE = 'This session is paused: the agent sign-in on this machine needs attention.';

// A park-on-claim end names its cause: a person joining is already visible to everyone reading it.
const CLAIMED_NOTE = 'Session ended because a person joined this channel.';

// A terminal post carries the reason its metadata already knows. `declined`/`dropped`/`capped` have no
// producer left but the flags stay reserved server-side and the web renders them (INVARIANTS §5).
const TERMINAL_BODIES = {
  interrupted: 'Ended',
  capped: 'Limit reached',
  declined: 'Request declined',
  dropped: 'Reply was not sent',
};

// Fixed order, so two flags on one post give one body on every machine.
const TERMINAL_FLAG_ORDER = ['declined', 'dropped', 'interrupted', 'capped'];
function terminalBody(extra) {
  const e = extra || {};
  for (const key of TERMINAL_FLAG_ORDER) if (e[key] === true) return TERMINAL_BODIES[key];
  return undefined;
}

// The closed set of end names a caller may pass (`session-reopen.js › controlByTask` forwards, never
// validates); an unknown name is the operator's own End, never silence.
const END_EVENT_REASONS = ['claimed'];
function endReasonOf(event) {
  const named = event && typeof event.reason === 'string' ? event.reason : null;
  return named && END_EVENT_REASONS.indexOf(named) !== -1 ? named : 'operator';
}

// The operator End posts a NON-TERMINAL `session_ended` marker (task_progress): `task_failed` would paint the
// shared thread failed, and `channel_messages.kind` has a CHECK, so the marker rides metadata.
function endLifecycle(reason) {
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: 'Session ended' };
  if (reason === 'claimed') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: CLAIMED_NOTE };
  }
  if (reason === 'abandoned' || reason === 'inactive') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: INACTIVE_NOTE };
  }
  if (reason === 'auth_hold') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: AUTH_HELD_NOTE };
  }
  return null;
}

// The same end worded for the operator's own work lane (the privacy argument above does not apply there);
// an unknown reason renders itself rather than nothing.
function endedStatusText(reason) {
  if (!reason || typeof reason !== 'string') return null;
  if (reason === 'operator') return 'Ended by you';
  if (reason === 'claimed') return 'Ended because a person joined this channel';
  if (reason === 'inactive') return 'Ended after going inactive';
  if (reason === 'abandoned') return 'Ended after being left parked';
  return reason;
}

// The shared end: abort first, the calm note, the `ended` emit, then settle.
function endEffects(state, outcome, reason, summary) {
  const lc = endLifecycle(reason);
  return [{ type: 'abortQuery' }].concat(lc ? [lc] : [],
    [endedEmit(outcome, reason, summary), { type: 'settle', outcome: outcome }]);
}

/**
 * PARK, never end: deny held tool calls fail-closed, tear down the query, persist `parked`, keep the
 * conversation id so a lazy wake can resume. `lifecycle` (the auth hold) posts the pause note, since a
 * held launch posts nothing else; `armAbandon` (the idle park) arms the abandonment bound instead of
 * clearing the timer.
 */
function parkEffects(opts) {
  const o = opts || {};
  const effects = [
    { type: 'denyPending' },
    { type: 'abortQuery' },
    o.armAbandon === true ? { type: 'scheduleIdle' } : { type: 'clearIdle' },
    { type: 'persist', phase: 'parked' },
  ];
  if (o.lifecycle === true) effects.push(endLifecycle('auth_hold'));
  return effects;
}

// ─── END SESSION-EFFECTS ─────────────────────────────────────────────────────

module.exports = {
  gateActivity,
  terminalBody,
  TERMINAL_BODIES,
  endedEmit,
  endLifecycle,
  endReasonOf,
  END_EVENT_REASONS,
  endedStatusText,
  endEffects,
  parkEffects,
  INACTIVE_NOTE,
  AUTH_HELD_NOTE,
  CLAIMED_NOTE,
};

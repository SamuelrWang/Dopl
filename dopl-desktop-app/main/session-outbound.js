// C6 (FIX F2) — MAIN RESOLVES THE OUTBOUND CARD IT PAINTED.
//
// `io.postWillGate` PREDICTS, while the tool_use streams, whether an own-channel post will
// stop on an operator button, and the renderer paints the pending decision card from that
// prediction. `canUseTool` decides for real a moment later. When the two disagree — the post
// was pre-approved, carried a standing "allow for this session" grant, or the session's mode
// auto-allowed it, none of which dispatch anything — main never resolved the card, so a
// message that had ALREADY BEEN DELIVERED sat in the transcript reading "awaiting your
// approval" forever (and the operator could not answer it: the card has no requestId, so its
// buttons stay hidden).
//
// The fix is to emit, on an ALLOW verdict, the SAME two events an operator Send produces,
// keyed on `opts.toolUseID`: `outbound_gate` hands the card a requestId (and CREATES the card
// from the authorized bytes when no artifact landed at all — the F5 path), then
// `permission_resolved{allow-once}` marks it sent. No view-model change is needed; both
// events are already part of its vocabulary.
//
// IDEMPOTENT by construction, which is what makes it safe to run on every allow: on the
// GATED path the operator's own decision already resolved the card, and the view-model
// ignores both events for a card that is not pending (markOutboundGated requires an open
// artifact, markOutboundDecided a `pending` one). A DENY verdict emits nothing at all — the
// decision that produced it owns the card.
//
// Split out of session-engine.js to hold that file under the hard 500-line cap (§2), and
// because keeping it electron-free (crypto + session-io only) lets the regression test drive
// the real wrapper directly instead of slicing it out of an electron-bound module.

const crypto = require('crypto');
const io = require('./session-io');

// The two events an allowed own-channel post emits. `to` is a display NAME and `ownChannel`
// a boolean — never another channel's id (§H-9) — exactly like the gate payload in
// session-io.makeCanUseTool, so the card is stamped with the same shape either way.
// v2.9 MEDIUM-2: `to`/`postKind` come from io.withPostSurface — the SAME helper the gated
// path uses — so an AUTO-ALLOWED post (Axis B auto_outbound, or a standing grant) paints the
// call's REAL addressee and lifecycle kind instead of the session's assumed counterparty.
// The helper adds those fields only when the call really carried them, so a plain reply's
// payload is byte-identical to the one this function returned before.
function outboundResolveEvents(requestId, toolUseId, input, counterpartyName) {
  return [
    io.withPostSurface({
      type: 'outbound_gate',
      requestId,
      toolUseId,
      ownChannel: true,
      text: input && input.body != null ? String(input.body) : '',
    }, input, counterpartyName),
    { type: 'permission_resolved', requestId, decision: 'allow-once' },
  ];
}

// Wrap the session's canUseTool bridge. Every non-post call passes through UNTOUCHED (same
// object, same promise) so the gate's policy path is byte-identical; an own-channel post has
// its verdict observed and, when it is an allow, resolves its own card. `emit(s, payload)` is
// the engine's QUIET emitter: an auto-allowed post needs nothing from the operator, so it
// must never reshow a hidden window.
function wrapCanUseTool(s, inner, emit) {
  return function canUseTool(name, input, opts) {
    const result = inner(name, input, opts);
    const toolUseId = opts && opts.toolUseID;
    if (!toolUseId || !io.isOutboundPost(name, input, s.channelId)) return result;
    return Promise.resolve(result).then((verdict) => {
      if (verdict && verdict.behavior === 'allow') {
        const events = outboundResolveEvents(crypto.randomUUID(), toolUseId, input, s.counterpartyName);
        for (const ev of events) emit(s, ev);
      }
      return verdict;
    });
  };
}

module.exports = { wrapCanUseTool, outboundResolveEvents };

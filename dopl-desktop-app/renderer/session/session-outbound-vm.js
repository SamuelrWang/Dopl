// The OUTBOUND DECISION CARD's fold (v2.7 L3), split out of session-viewmodel.js.
//
// §2 SPLIT (2026-08-02): session-viewmodel.js sits at the hard 500-line cap, and the model
// picker + context meter needed a `model` and a `context` case in its reducer. This is the same
// seam session-labels.js / session-format.js / session-history-vm.js already took: a coherent
// slice of the view-model in its own file, required at module scope and RE-EXPORTED verbatim,
// so `vm.markOutboundGated(...)` / `vm.markOutboundDecided(...)` are unchanged for session.js
// and for every test.
//
// WHAT LIVES HERE is the two transitions a post's own stream item makes after it is painted:
//   markOutboundGated   main minted a requestId in canUseTool -> this card can be answered
//   markOutboundDecided a decision landed for that requestId -> sent / not sent, in place
// WHAT DOES NOT is the `outbound_post` case that CREATES the item: that is one branch of
// reduceEvent's switch and belongs with the switch. The seam is "an item that already exists".
//
// PURE, and DOM-free like the rest of the view-model: plain data in, plain data out, never a
// mutation of the state handed in.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionOutboundVM = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // v2.7 L3 — hand a post's artifact the requestId main minted in canUseTool, matched on the
  // tool_use id both carry. It stamps an UNDECIDED artifact: one already pending, and also one
  // painted as a DELIVERY because AXIS B was permissive when the tool_use streamed and the operator
  // tightened it before canUseTool ran (main really is awaiting a decision in that race, so the
  // record must ask for one, not claim the peer has it). A RESOLVED artifact is never reopened.
  // FIX F4: the gate carries the AUTHORIZED BYTES (`ev.text`, the body canUseTool holds) and they
  // WIN over the streamed copy — the operator approves the surface the decision covers. FIX F5:
  // with NO artifact for this tool_use (a replay that dropped it) those bytes CREATE the card, so
  // a post can never gate invisibly with three buttons nowhere to be found.
  // 2026-08-02: `gateReason` rides along on BOTH paths. main stamps the code on every gate
  // payload and session-render turns it into the card's one-line "why"; this whitelist used to
  // drop it on the floor, so the inline card's reason row was dead code from the day it landed.
  function markOutboundGated(state, ev) {
    const toolUseId = ev && ev.toolUseId;
    const requestId = ev && ev.requestId;
    if (!toolUseId || !requestId) return state;
    const mine = (it) => it.kind === "outbound" && it.toolUseId === toolUseId;
    const open = (it) => mine(it) && (it.status === "pending" || it.status == null);
    const ownChannel = ev.ownChannel === true; // fail-suspicious: only an explicit true
    if (!state.items.some(mine)) {
      if (ev.text == null) return state; // nothing to show; a bodiless gate creates nothing
      const to = ev.to == null ? null : String(ev.to);
      const created = { kind: "outbound", toolUseId, to, text: String(ev.text), avatarKey: "self", status: "pending", requestId, ownChannel };
      // MEDIUM-2 again, and conditionally: a plain reply's created card is unchanged.
      if (ev.addressed === true) created.addressed = true;
      if (ev.postKind) created.postKind = String(ev.postKind);
      if (ev.gateReason) created.gateReason = String(ev.gateReason);
      return { ...state, items: state.items.concat([created]) };
    }
    if (!state.items.some(open)) return state;
    const gate = (it) => {
      const next = { ...it, status: "pending", requestId, ownChannel: it.ownChannel === true || ownChannel };
      if (ev.text != null) next.text = String(ev.text); // the bytes under decision, not the stream copy
      // MEDIUM-2: the ADDRESSEE under decision wins over the streamed guess for the same reason
      // the bytes do — the card must describe the call canUseTool is holding.
      if (ev.addressed === true) { next.to = ev.to == null ? next.to : String(ev.to); next.addressed = true; }
      else if (ev.to != null && !next.to) next.to = String(ev.to);
      if (ev.postKind) next.postKind = String(ev.postKind);
      if (ev.gateReason) next.gateReason = String(ev.gateReason);
      return next;
    };
    return { ...state, items: state.items.map((it) => (open(it) ? gate(it) : it)) };
  }

  // v2.7 L3 — the decision for a pending post: the two explicit allows DELIVER it, EVERYTHING else
  // (deny, a park's deny echo, a forged string) marks it not sent. Matched by requestId only.
  const OUTBOUND_SENT = { "allow-once": true, "allow-task": true };
  function markOutboundDecided(state, requestId, decision) {
    const hit = (it) => it.kind === "outbound" && it.status === "pending" && it.requestId === requestId;
    if (!requestId || !state.items.some(hit)) return state;
    const status = OUTBOUND_SENT[decision] === true ? "sent" : "not_sent";
    return { ...state, items: state.items.map((it) => (hit(it) ? { ...it, status } : it)) };
  }

  return { markOutboundGated, markOutboundDecided };
});

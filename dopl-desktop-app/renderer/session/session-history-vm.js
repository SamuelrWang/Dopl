// Pure view-model layer for the READ-ONLY channel history a reopened shell replays (v2.5 D3).
//
// Split out of session-viewmodel.js to respect the HARD 500-line-per-file cap (§2), the same
// discipline as the earlier session-labels.js / session-format.js splits. It has NO dependencies
// (not even the view-model), is DOM / electron / fs free, and is UMD-wrapped: a plain <script>
// in the sandboxed renderer (attaching `globalThis.DoplSessionHistoryVM`), a require() under
// node --test. session-viewmodel.js reduces `case "history"` through it.
//
// v3.0 FIX Q2 — this module is also where a replayed entry is stamped with the SAME `role` +
// `avatarKey` a LIVE bubble carries. The history entries used to reach the renderer with a lane
// and nothing else, so the only recipe that could apply was `.history-entry` (a transparent,
// dashed twin that matched no live surface and carried no avatar). Stamping the role here means
// the renderer paints an earlier exchange with the live surfaces, one layer up, with no second
// opinion about who authored what.
//
// It produces PLAIN DATA only, never markup; the renderer prints every string via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionHistoryVM = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The divider introducing a reopened window's channel history. Renderer copy, no em dash.
  const HISTORY_NOTE = "History from the channel";

  // One replayed entry as a stream item. FAIL TO THE HUMAN: `agent` (stamped by
  // main/session-history.js from the row's author kind) must be an EXPLICIT true to read as the
  // operator's own agent — anything else on this side is the operator, which is the claim that
  // over-attributes nothing. The peer's side is always the counterparty, whatever the row says.
  // Display only: no ids, no controls, no pendingId — a history bubble can never be answered.
  function historyEntryItem(e) {
    const them = !!e && e.lane === "them";
    return {
      kind: "history",
      from: e && e.from ? String(e.from) : "",
      text: e && e.text == null ? "" : String(e.text),
      lane: them ? "them" : "me",
      role: them ? "counterparty" : e && e.agent === true ? "agent" : "operator",
      avatarKey: them ? "peer" : "self",
    };
  }

  // The whole stream slice a `history` event contributes: ONE divider, then the entries in
  // order. Empty in, empty out — a shell with nothing to replay adds no divider either.
  function historyItems(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return [];
    return [{ kind: "history_divider", text: HISTORY_NOTE }].concat(list.map(historyEntryItem));
  }

  return { HISTORY_NOTE, historyEntryItem, historyItems };
});

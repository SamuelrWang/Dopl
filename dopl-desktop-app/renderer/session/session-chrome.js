// Pure CHROME helpers for the Dopl session window (v1.7.5 D1/D5/D7):
//
//   - headerIdentity(init)   -> {title, subtitle, avatarName, hasPeer}
//   - windowTitle(init)      -> the native title-bar string
//   - sendButtonMode(state)  -> 'send' | 'pause'
//   - sendButtonLabel(mode)  -> the aria-label for that mode
//   - growHeight(...)        -> the composer's next height in px
//   - streamLane(item)       -> 'me' | 'them' | null   (chat-style alignment)
//   - laneClass(item)        -> the lane CSS class, or "" for a full-width item
//
// Split out of session-viewmodel.js purely to respect the HARD 500-line-per-file
// cap (§2) — same discipline as the session-render.js split. Like the view-model
// this module is DOM / electron / fs free and UMD-wrapped: a plain <script> in the
// sandboxed renderer (attaching `globalThis.DoplSessionChrome`), a require() under
// node --test. It produces STRINGS and NUMBERS only, never markup; session.js
// prints every one of them via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionChrome = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The view-model owns the shared string discipline (collapse to one line + cap).
  // It is reached the same way this file is: a require() under node, the renderer
  // global in the sandbox (session.html loads session-viewmodel.js first).
  const vm =
    typeof module === "object" && typeof require === "function"
      ? require("./session-viewmodel.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionVM) || null;

  // Bound every identity string the same way prompt-framing.sanitizeName bounds a
  // counterparty-controlled display name: one line, 80 chars. The value is then
  // printed via textContent only, so a hostile name stays display data.
  const NAME_CAP = 80;
  function identityName(value) {
    if (vm && typeof vm.oneLine === "function") return vm.oneLine(value, NAME_CAP);
    const s = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    return s.length > NAME_CAP ? s.slice(0, NAME_CAP - 1).trimEnd() + "…" : s;
  }

  // ── D1: header + window identity ────────────────────────────────────────────
  // ONE priority order drives the header title, the header subtitle, the avatar
  // initials, and the native window title:
  //     taskTitle -> peer name (init.from) -> channelName -> "Session".
  // The subtitle carries the next identity down, and only when the title is the
  // task title, so the peer / channel name is never printed twice.
  function headerIdentity(init) {
    const info = init || {};
    const taskTitle = identityName(info.taskTitle);
    const peer = identityName(info.from);
    const channel = identityName(info.channelName);
    const title = taskTitle || peer || channel || "Session";
    // The avatar is ALWAYS drawn: the peer when we know one, else the title — a
    // group channel or a bare shell still gets a token, never a black box.
    return {
      title,
      subtitle: taskTitle ? peer || channel || "" : "",
      avatarName: peer || title,
    };
  }

  // The native title-bar string: the same priority, prefixed with the product name.
  function windowTitle(init) {
    return "Dopl · " + headerIdentity(init).title;
  }

  // ── D5: the send button morphs into a pause control while a turn runs ───────
  // RUNNING means the agent is mid-turn: activity 'working'. Anything else (idle,
  // awaiting a reply, awaiting a permission, parked, ended) keeps the send affordance,
  // so a queued steer is always one click away.
  //
  // FIX #6: 'awaiting_inbound' counts as a work phase here. The gate carries on `phase`
  // (a pending card pins it, so the pill keeps reading "Message waiting") while `activity`
  // still says what the agent is doing — so a turn that is genuinely mid-flight can be
  // paused even though a message is waiting. Pinning on phase alone made the button lie.
  const WORK_PHASES = { running: true, awaiting_inbound: true };
  function sendButtonMode(state) {
    const s = state || {};
    return WORK_PHASES[s.phase] === true && s.activity === "working" ? "pause" : "send";
  }

  const SEND_LABEL = { send: "Send", pause: "Pause the agent" };
  function sendButtonLabel(mode) {
    return SEND_LABEL[mode] || SEND_LABEL.send;
  }

  // ── D7: composer auto-grow ──────────────────────────────────────────────────
  // Grow with the content up to exactly `maxLines` line-heights, then stay fixed
  // and scroll. `padding` is the textarea's vertical padding, which is part of both
  // scrollHeight and the border-box height, so it rides inside the clamp. Returns a
  // px number; a degenerate line-height falls back to the raw scrollHeight.
  function growHeight(scrollHeight, lineHeight, maxLines, padding) {
    const lh = num(lineHeight);
    const sh = Math.max(0, num(scrollHeight));
    if (lh <= 0) return sh;
    const pad = Math.max(0, num(padding));
    const lines = Math.max(1, Math.floor(num(maxLines) || 3));
    return Math.max(lh + pad, Math.min(sh, lh * lines + pad));
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  // ── chat-style stream lanes (v2.7 L1) ───────────────────────────────────────
  // The window is a two-sided conversation between THIS MACHINE and the PEER, not a
  // log. The RIGHT lane is everything that originates here — the operator's typed
  // turns, HIS agent's spoken text, AND the agent's command/tool activity. The LEFT
  // lane is only what the peer actually sends back. Everything that is a DECISION or a
  // system line keeps the full stream width. The decision is keyed on the view-model
  // item KIND — NEVER on the item text:
  //
  //   turn (ANY role: operator/user AND assistant/agent) -> 'me'   (this machine)
  //   tool                                               -> 'me'   (the agent's own work)
  //   counterparty                                       -> 'them' (the peer's reply)
  //   history (v2.5 D3)                                  -> its OWN stamped lane
  //                                          ('me' | 'them'), computed in main from the
  //                                          message author so a replayed thread aligns
  //                                          like live turns
  //   outbound | outbound_pending | inbound_pending | notice | history_divider |
  //   anything else                                      -> null
  //
  // v2.7 CHANGED two of these: an assistant/agent turn moved from 'them' to 'me' (it is
  // HIS agent speaking, not the peer), and a tool card moved from un-laned to 'me'. null
  // still means "no lane": the outbound decision card + delivered record, inbound gate
  // cards, the history divider, notices, and the permission dock keep full width — a
  // decision is neither side of the conversation.
  // v2.8: `peer_message` (the operator's OWN words, addressed to the peer's agent) is this
  // machine's output too, so it joins the right lane. It is NOT a turn (my agent never saw
  // it) and NOT an outbound (my agent did not draft it).
  const ME_KINDS = { turn: true, tool: true, peer_message: true };
  const LANE_CLASS = { me: "lane-me", them: "lane-them" };

  function streamLane(item) {
    const it = item || {};
    if (ME_KINDS[it.kind] === true) return "me";
    if (it.kind === "counterparty") return "them";
    if (it.kind === "history") return it.lane === "them" ? "them" : "me";
    return null;
  }

  // The lane CSS class for an item, or "" when the item is not conversational.
  function laneClass(item) {
    const lane = streamLane(item);
    return lane ? LANE_CLASS[lane] : "";
  }

  return {
    headerIdentity,
    windowTitle,
    sendButtonMode,
    sendButtonLabel,
    growHeight,
    streamLane,
    laneClass,
  };
});

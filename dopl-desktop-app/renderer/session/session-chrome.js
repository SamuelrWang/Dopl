// Pure CHROME helpers for the Dopl session window:
//   - headerIdentity(init)   -> {title, subtitle, avatarName}
//   - windowTitle(init)      -> the native title-bar string
//   - sendButtonMode(state)  -> 'send' | 'pause'
//   - sendButtonLabel(mode)  -> the aria-label for that mode
//   - growHeight(...)        -> the composer's next height in px
//   - streamLane(item)       -> 'me' | 'them' | null
//   - laneClass(item)        -> the lane CSS class, or "" for a full-width item
//
// ⚠ DOM / electron / fs free and UMD-wrapped: a plain <script> in the sandboxed renderer
// (attaching `globalThis.DoplSessionChrome`), a require() under node --test.
// ⚠ STRINGS and NUMBERS only, never markup; session.js prints them via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionChrome = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The view-model owns the shared string discipline (one line + cap), reached the same way
  // this file is. ⚠ session.html must load session-viewmodel.js first.
  const vm =
    typeof module === "object" && typeof require === "function"
      ? require("./session-viewmodel.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionVM) || null;

  // ⚠ Bound every identity string like prompt-framing.sanitizeName does: one line, 80 chars.
  // Printed via textContent only, so a hostile name stays display data.
  const NAME_CAP = 80;
  function identityName(value) {
    if (vm && typeof vm.oneLine === "function") return vm.oneLine(value, NAME_CAP);
    const s = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    return s.length > NAME_CAP ? s.slice(0, NAME_CAP - 1).trimEnd() + "…" : s;
  }

  // ── header + window identity ────────────────────────────────────────────────
  // ⚠ ONE priority order drives the header title, subtitle, avatar initials and native window
  // title: taskTitle -> peer name (init.from) -> channelName -> "Session". The subtitle carries
  // the NEXT identity down, and only when the title is the thread title, so the peer / channel
  // name is never printed twice.
  // Wire name `task` == domain name `thread`: `init.taskTitle` keeps the WIRE spelling here and
  // in session.html's `#taskTitle`; what the operator READS says "thread".
  function headerIdentity(init) {
    const info = init || {};
    const taskTitle = identityName(info.taskTitle);
    const peer = identityName(info.from);
    const channel = identityName(info.channelName);
    const title = taskTitle || peer || channel || "Session";
    // ⚠ The avatar is ALWAYS drawn: the peer when known, else the title — a group channel or
    // bare shell still gets a token, never a black box.
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

  // ── The send button morphs into a pause control while a turn runs ───────────
  // ⚠ THE ONLY INTERRUPT CONTROL (the header "Stop" button is gone), so the predicate must be
  // "a LIVE phase pauses unless the activity says the agent is RESTING" — never "phase running
  // AND activity working", which leaves three states unpausable: `running` with a NULL activity
  // (the whole FIRST turn — nothing emits a status until it ENDS), `awaiting_permission` (a
  // tool call mid-flight; Deny releases ONE call, interrupt stops the turn), and
  // `awaiting_inbound` with a null/working activity.
  // A resting phase (consent / parked / interrupted / ended) and an UNKNOWN phase keep Send, so
  // the button can never offer to pause nothing. ⚠ `launching` is deliberately NOT live: it is
  // only the pre-`init` window, and "End session" still aborts a booting query.
  const LIVE_PHASES = { running: true, awaiting_inbound: true, awaiting_permission: true };
  const RESTING_ACTIVITIES = { idle: true, awaiting_peer: true, parked: true };
  function sendButtonMode(state) {
    const s = state || {};
    if (LIVE_PHASES[s.phase] !== true) return "send";
    return RESTING_ACTIVITIES[s.activity] === true ? "send" : "pause";
  }

  // ── The "Thinking" chip ─────────────────────────────────────────────────────
  // TRUE while a turn is in flight and the agent has rendered NOTHING for it yet.
  // ⚠ The window runs with includePartialMessages:false (LOAD-BEARING for the outbound card),
  // so there is no token stream to hang this on — the honest signal is the TRANSCRIPT itself.
  // ⚠ State only; thinking CONTENT is never displayed.
  //   appears — the turn was pushed and the session is live.
  //   clears  — the first agent artifact renders, the turn ends, a card takes over, or the
  //             session parks / interrupts / ends.
  const AGENT_ITEM_KINDS = { tool: true, outbound: true };
  function isAgentOutput(item) {
    const it = item || {};
    if (it.kind === "turn") return it.role !== "operator" && it.role !== "user";
    return AGENT_ITEM_KINDS[it.kind] === true;
  }

  function thinkingVisible(state) {
    const s = state || {};
    if (s.ended || sendButtonMode(s) !== "pause") return false; // nothing running -> nothing to say
    const items = Array.isArray(s.items) ? s.items : [];
    return !isAgentOutput(items[items.length - 1]);
  }

  const SEND_LABEL = { send: "Send", pause: "Pause the agent" };
  function sendButtonLabel(mode) {
    return SEND_LABEL[mode] || SEND_LABEL.send;
  }

  // ── composer auto-grow ──────────────────────────────────────────────────────
  // Grow to exactly `maxLines` line-heights, then stay fixed and scroll. ⚠ `padding` is the
  // textarea's vertical padding, part of BOTH scrollHeight and the border-box height, so it
  // rides inside the clamp. A degenerate line-height falls back to the raw scrollHeight.
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

  // ── chat-style stream lanes ─────────────────────────────────────────────────
  // A two-sided conversation between THIS MACHINE and the PEER, not a log. RIGHT lane =
  // everything originating here (operator turns, this agent's text, its tool activity); LEFT
  // lane = only what the peer sends back; DECISION and system items keep full stream width.
  // ⚠ Keyed on the view-model item KIND, NEVER on item text:
  //   turn (ANY role, operator AND agent)  -> 'me'
  //   tool                                 -> 'me'   (the agent's own work)
  //   peer_message                         -> 'me'   (the operator's words to the peer's
  //                                          agent — NOT a turn, my agent never saw it, and
  //                                          NOT an outbound, my agent did not draft it)
  //   counterparty                         -> 'them'
  //   history                              -> its OWN stamped lane ('me' | 'them'), computed
  //                                          in main from the message author so a replayed
  //                                          thread aligns like live turns
  //   outbound | outbound_pending | inbound_pending | notice | history_divider | anything
  //                                        -> null (full width; a decision is neither side)
  const ME_KINDS = { turn: true, tool: true, peer_message: true };
  const LANE_CLASS = { me: "lane-me", them: "lane-them" };

  function streamLane(item) {
    const it = item || {};
    if (ME_KINDS[it.kind] === true) return "me";
    if (it.kind === "counterparty") return "them";
    if (it.kind === "history") return it.lane === "them" ? "them" : "me";
    return null;
  }

  // The lane CSS class, or "" when the item is not conversational.
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
    thinkingVisible,
    isAgentOutput,
  };
});

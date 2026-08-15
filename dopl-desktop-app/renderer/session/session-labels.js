// Pure STATUS / POSTURE / FOLDER label strings for the Dopl session window.
//
//   - statusText(phase, activity)              -> the status-pill text
//   - statusDotKey(phase, activity)            -> the status-dot class key (colour)
//   - folderLabel(folder)                      -> the working-directory pill label
//   - permissionPostureText(toolMode, messageMode, profile) -> the two-axis posture line
//   - bypassNoticeText(toolMode)               -> the per-session bypass danger line
//   - permissionPostBody(perm)                 -> the drafted body of a gated post (D2)
//   - postDestinationText(perm)                -> WHERE that post is going (FIX #9; v2.x names the peer)
//
// ⚠ NO dependencies at all (not even the view-model), DOM / electron / fs free, and
// UMD-wrapped: a plain <script> in the sandboxed renderer (attaching
// `globalThis.DoplSessionLabels`), a require() under node --test. session-viewmodel.js
// re-exports every function here.
// ⚠ STRINGS only, never markup; session.js prints them via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionLabels = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PHASE_LABEL = {
    launching: "Launching",
    consent: "Consent",
    running: "Running",
    // A parked (idle-paused) session — resumable, NOT ended. Composer stays enabled.
    parked: "Paused",
    awaiting_permission: "Awaiting permission",
    // ⚠ `awaiting_inbound` is the INBOUND GATE: a counterparty message held HERE, waiting on
    // the operator. "Awaiting reply" says the inverse (waiting on the peer).
    awaiting_inbound: "Message waiting",
    interrupted: "Interrupted",
    ended: "Ended",
  };
  const ACTIVITY_LABEL = {
    working: "Working",
    idle: "Idle",
    awaiting_peer: "Waiting for reply",
    awaiting_permission: "Awaiting permission",
    // A counterparty message held at the inbound gate, awaiting Accept.
    awaiting_inbound: "Message waiting",
  };

  // The status-pill text. When a turn is RUNNING the finer `activity` wins;
  // otherwise the coarse phase label is shown.
  function statusText(phase, activity) {
    const ph = phase || "launching";
    if (ph === "running" && activity) return ACTIVITY_LABEL[activity] || PHASE_LABEL[ph] || ph;
    return PHASE_LABEL[ph] || (ph.charAt(0).toUpperCase() + ph.slice(1));
  }

  // The status-dot class key (colour) — `act-<activity>` while running, else `is-<phase>`.
  function statusDotKey(phase, activity) {
    const ph = phase || "launching";
    if (ph === "running" && activity) return "act-" + activity;
    return "is-" + ph;
  }

  // The folder-pill label: the abbreviated dir short-form. The engine always emits a REAL
  // resolved dir, so the null case is only the pre-event render.
  function folderLabel(folder) {
    const label = folder && folder.label;
    return label ? String(label) : "~/Downloads";
  }

  // ── THE TWO-AXIS posture line ───────────────────────────────────────────────
  // Each axis states in plain words what it does, and the permissive tool modes NAME the
  // reach. Fixed copy, sentence case, NO em dash (§H-13).
  // ⚠ Unknown values fall back to the most restrictive line, so a garbled mode can never read
  // as more permissive than it is.
  // ⚠ The `auto` line must name workspace WRITES: `auto` gates them, and omitting them
  // understates data leaving this machine into rows every workspace member can read.
  const TOOL_POSTURE = {
    manual: "Asking before each command",
    accept_edits: "Auto approving file edits",
    auto: "Auto approving local edits and lookups, asking for shell, web and workspace writes",
    bypass: "Auto approving every command the tool profile allows",
  };
  const MESSAGE_POSTURE = {
    ask: "Asking before messages in and out",
    auto_inbound: "Auto accepting incoming messages",
    auto_outbound: "Auto sending outgoing messages",
    auto_both: "Messages flow automatically",
  };
  function toolPostureText(mode) {
    return TOOL_POSTURE[mode] || TOOL_POSTURE.manual;
  }
  function messagePostureText(mode) {
    return MESSAGE_POSTURE[mode] || MESSAGE_POSTURE.ask;
  }

  // ⚠ BOTH axes, ALWAYS, with the tool-profile label as trailing context. One axis is never
  // shown without the other — a half-stated posture is how one switch comes to read as one
  // thing.
  function permissionPostureText(toolMode, messageMode, profileLabel) {
    const label = profileLabel == null ? "" : String(profileLabel).trim();
    return "Tools: " + toolPostureText(toolMode) +
      " · Messages: " + messagePostureText(messageMode) +
      (label ? " · " + label : "");
  }

  // The danger callout for the one mode that hands over the whole machine. ⚠ Per SESSION, and
  // dies with it (and with a park) — the operator must be told at the moment they pick it.
  // "" for every other mode, which hides the chip.
  function bypassNoticeText(toolMode) {
    return toolMode === "bypass" ? "Bypass is on for this session only" : "";
  }

  // What a gated dopl_channel post is about to send. The dock shows it verbatim
  // (textContent), so the operator approves WHAT is being said, not just that a tool ran.
  // "" for every other tool / op, and for a non-string body.
  function permissionPostBody(perm) {
    const p = perm || {};
    const name = p.name == null ? "" : String(p.name);
    if (name.indexOf("dopl_channel") === -1) return "";
    const input = p.inputFull;
    if (!input || typeof input !== "object" || input.op !== "post") return "";
    return typeof input.body === "string" ? input.body : "";
  }

  // The DESTINATION of that post. Without it the cross-channel exfil case (Read a file,
  // op=post it into a DM with another member) looks exactly like a normal reply to the peer.
  // Main stamps `ownChannel` on the permission payload (session-io, from isOwnChannelPost).
  // ⚠ FAIL-SUSPICIOUS: anything but an explicit true reads as ANOTHER channel, so a missing
  // marker can never make an exfil post look routine.
  // ⚠ The recipient is named ONLY when someone really is named. Main fills `to` with the
  // session's BOUND COUNTERPARTY when the call named nobody, and in a GROUP channel an
  // unaddressed post reaches no agent at all — naming one promises a reader who does not
  // exist. But in a DIRECT channel the SERVER addresses it (`resolveDirectPeer` stamps
  // `to_user_id`), so "no recipient named" understates a message that wakes the peer's agent.
  // `directChannel` separates the two and is FAIL-QUIET: anything but an explicit true keeps
  // the channel-level wording, so a launch shape without the flag cannot invent a recipient.
  // Whitespace-collapsed and capped: a label, not prose.
  const PEER_CAP = 60;
  function peerName(perm) {
    const raw = perm && perm.to != null ? String(perm.to).replace(/\s+/g, " ").trim() : "";
    return raw.length > PEER_CAP ? raw.slice(0, PEER_CAP - 1).trimEnd() + "…" : raw;
  }
  // ⚠ The kind suffix. A post can claim to be a structured lifecycle EVENT (`kind:
  // task_finished`), which the peer's UI renders as an outcome rather than chat. Main stamps
  // the real value (`postKind`, absent for a plain message) and it is named VERBATIM here, so
  // a forged completion is visible before it is approved.
  function postKindSuffix(perm) {
    const kind = perm && perm.postKind != null ? String(perm.postKind).trim() : "";
    return kind ? ", marked " + kind : "";
  }
  // `addressed` = the CALL named a recipient (`to:`), possibly a DIFFERENT member from this
  // session's counterparty — main puts the real value on `to`, so the card names who the
  // message is really for. `directChannel` = the SERVER will name one (a DM post with no `to`
  // is stamped to the other member). Two ways of knowing, one true outcome.
  const UNADDRESSED = "To: this channel, no recipient named";
  function isNamedRecipient(perm) {
    return !!perm && (perm.addressed === true || perm.directChannel === true);
  }
  function postDestinationText(perm) {
    if (!perm || perm.ownChannel !== true) return "To: another channel" + postKindSuffix(perm);
    const who = peerName(perm);
    if (isNamedRecipient(perm) && who) return "To: " + who + postKindSuffix(perm);
    return UNADDRESSED + postKindSuffix(perm);
  }

  // Is this post leaving the session's own channel? Drives the dock's warning styling.
  // ⚠ Same fail-suspicious rule: only an explicit true is the own channel.
  function isCrossChannelPost(perm) {
    return !perm || perm.ownChannel !== true;
  }

  // ── THE CONTEXT METER: "how full is this session's window", from main's per-turn
  // measurement. Two rules, both about not overstating what is known:
  // ⚠ NO DENOMINATOR, NO PERCENTAGE. `window: null` means this build does not know the model's
  //   window size, so show the raw count and stop — the operator ends sessions on this number,
  //   and a percentage from a guessed denominator is worse than no gauge.
  // ⚠ NOTHING BEFORE THE FIRST MEASUREMENT: "" renders an empty span, not a confident "0%".
  // Pure string work, no DOM; session-modes-ui.js paints via textContent.
  function compactTokens(n) {
    const v = Number(n);
    if (!(v > 0)) return "0";
    if (v >= 1000000) {
      const m = v / 1000000;
      return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + "M";
    }
    if (v >= 1000) return Math.round(v / 1000) + "k";
    return String(Math.round(v));
  }

  // Occupancy as a whole percentage, or null with no honest denominator. ⚠ Clamped at 100: a
  // prompt measuring larger than the window we believe in means our table is wrong, and "104%"
  // only ever reads as a bug.
  function contextPercent(ctx) {
    const c = ctx || {};
    const tokens = Number(c.tokens);
    const win = Number(c.window);
    if (!(tokens >= 0) || !(win > 0)) return null;
    return Math.min(100, Math.round((tokens / win) * 100));
  }

  function contextMeterText(ctx) {
    const c = ctx || {};
    const tokens = Number(c.tokens);
    if (!(tokens > 0)) return "";
    const pct = contextPercent(c);
    if (pct === null) return compactTokens(tokens) + " context";
    return compactTokens(tokens) + " / " + compactTokens(c.window) + " (" + pct + "%)";
  }

  // Amber past 75%, red past 90% — early enough to act on. ⚠ No level without a percentage:
  // an unknown window is never coloured as if it were full.
  function contextMeterLevel(ctx) {
    const pct = contextPercent(ctx);
    if (pct === null) return "";
    if (pct >= 90) return "is-full";
    if (pct >= 75) return "is-high";
    return "";
  }

  // WHY A CARD IS ASKING. Main stamps a machine-readable `gateReason` on every gate/deny
  // payload (session-profiles GATE_REASONS); ⚠ this is the ONLY place it becomes words.
  // Without it an uncovered tool under `bypass` reads as a broken toggle and a slug-addressed
  // post as a random refusal. Unknown or absent renders NO line; where there is a fix, the
  // line names it.
  const GATE_REASON = {
    "hard-denied": "Blocked for this session.",
    "not-covered-by-bypass": "Asking because the current tool setting does not cover this tool.",
    "unclassified-tool": "Asking because Dopl does not recognise this tool, so every setting asks.",
    "cross-channel-post": "Asking because this post names another channel. Address your own channel by id, not by slug.",
    "cross-channel-read": "Asking because this read names another channel. Address your own channel by id, not by slug.",
    "malformed-post-fields": "Asking because this post has a recipient or a kind that is not text.",
    "message-approval-required": "Asking because message approval is set to ask before each message.",
    "read-approval-required": "Asking because message approval is set to ask before messages come in.",
    "channel-op-approval-required": "Asking because message approval covers this channel's messages, not this operation.",
    "awaiting-approval": "Asking because tool approval is set to ask before each tool.",
  };
  // ⚠ OWN PROPERTY ONLY. A bare index on an object literal answers a FUNCTION for
  // 'constructor' and 'toString', which `|| ""` does not catch — those two words then put
  // SOURCE CODE into textContent.
  function gateReasonText(reason) {
    const k = String(reason == null ? "" : reason);
    return Object.prototype.hasOwnProperty.call(GATE_REASON, k) ? GATE_REASON[k] : "";
  }

  return {
    statusText, statusDotKey, folderLabel,
    compactTokens, contextPercent, contextMeterText, contextMeterLevel,
    gateReasonText, // the gate-reason copy (session-render re-exports it verbatim)
    // ⚠ The two-axis posture + bypass danger line. There is deliberately NO single
    // `permissionModeText`: one string cannot describe two independent postures.
    toolPostureText, messagePostureText, permissionPostureText, bypassNoticeText,
    permissionPostBody, postDestinationText, isCrossChannelPost,
  };
});

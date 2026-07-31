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
// Split out of session-viewmodel.js purely to respect the HARD 500-line-per-file cap
// (§2) while v2.5 added the inbound-gate + history reducer cases — the same discipline
// as the earlier session-chrome.js / session-render.js splits. This module has NO
// dependencies at all (not even the view-model), is DOM / electron / fs free, and is
// UMD-wrapped: a plain <script> in the sandboxed renderer (attaching
// `globalThis.DoplSessionLabels`), a require() under node --test. session-viewmodel.js
// re-exports every function here, so `vm.statusText(...)` keeps working unchanged.
//
// It produces STRINGS only, never markup; session.js prints them via textContent.

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
    // P1: a parked (idle-paused) session — resumable, NOT ended. Composer stays enabled.
    parked: "Paused",
    awaiting_permission: "Awaiting permission",
    // v2.5 D1 / FIX #1: `awaiting_inbound` is the INBOUND GATE — a counterparty message
    // is held on this machine, waiting on the operator. It used to read "Awaiting reply",
    // which says the inverse (we are waiting on the peer). The phase carries the gate now
    // (FIX #6), so this label is the one the pill shows whenever a card is pending.
    awaiting_inbound: "Message waiting",
    interrupted: "Interrupted",
    ended: "Ended",
  };
  const ACTIVITY_LABEL = {
    working: "Working",
    idle: "Idle",
    awaiting_peer: "Waiting for reply",
    awaiting_permission: "Awaiting permission",
    // v2.5 D1: a counterparty message is held at the inbound gate, awaiting Accept.
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

  // The folder-pill label (item 5): the abbreviated dir short-form. The engine
  // now always emits a REAL resolved dir (item 6 default = ~/Downloads), so the
  // null case is only the pre-event render — fall back to the same default.
  function folderLabel(folder) {
    const label = folder && folder.label;
    return label ? String(label) : "~/Downloads";
  }

  // ── v2.9: the TWO-AXIS posture line (contract D) ────────────────────────────
  // The old single line said "Auto-approving" for a switch that governed BOTH the shell and
  // outbound messages, and never named the blast radius (HIGH-4). Each axis now states, in
  // plain words, what it actually does — and the permissive tool modes name the reach
  // ("commands", "shell and web", "every command on this machine"). Fixed copy, sentence
  // case, NO em dash (§H-13). Unknown values fall back to the most restrictive line, so a
  // garbled mode can never read as more permissive than it is.
  // FIX F2 (v2.9 review): the `auto` line used to say "asking for shell and web" while the mode
  // ALSO auto-approved the workspace-write Dopl tools, which put data off this machine where
  // every workspace member can read it. `auto` now gates those too, and the line names them.
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

  // The whole status-strip line: BOTH axes, always, with the tool-profile label as trailing
  // context (item 9). One axis is never shown without the other — a half-stated posture is
  // how the operator came to believe one switch meant one thing.
  function permissionPostureText(toolMode, messageMode, profileLabel) {
    const label = profileLabel == null ? "" : String(profileLabel).trim();
    return "Tools: " + toolPostureText(toolMode) +
      " · Messages: " + messagePostureText(messageMode) +
      (label ? " · " + label : "");
  }

  // The danger callout for the one mode that hands over the whole machine. It is per SESSION
  // and dies with it (and with a park), which the operator must be told at the moment they
  // pick it, not in a tooltip. "" for every other mode, which hides the chip.
  function bypassNoticeText(toolMode) {
    return toolMode === "bypass" ? "Bypass is on for this session only" : "";
  }

  // ── v2.5 D2: what a gated dopl_channel post is about to send ────────────────
  // The dock shows the body verbatim (textContent) so the operator approves WHAT is being
  // said, not just that a tool ran. "" for every other tool / op, and for a non-string
  // body. Homed here (not in the view-model) purely for the §2 500-line cap; the
  // view-model re-exports it, so vm.permissionPostBody(...) is unchanged.
  function permissionPostBody(perm) {
    const p = perm || {};
    const name = p.name == null ? "" : String(p.name);
    if (name.indexOf("dopl_channel") === -1) return "";
    const input = p.inputFull;
    if (!input || typeof input !== "object" || input.op !== "post") return "";
    return typeof input.body === "string" ? input.body : "";
  }

  // FIX #9 — the DESTINATION of that post. The dock rendered the body with no target at
  // all, so the cross-channel exfil case D2 exists to catch (Read a file, op=post it into
  // a DM with another member) looked exactly like a normal reply to the peer. Main stamps
  // `ownChannel` on the permission payload (session-io, from isOwnChannelPost against the
  // session's own channelId). FAIL-SUSPICIOUS: anything other than an explicit true reads
  // as another channel, so a missing marker can never make an exfil post look routine.
  //
  // v2.x named the recipient on EVERY own-channel post ("To: David's agent"), because
  // "To: this channel" read like a warning next to the cross-channel line it shares a slot
  // with. N-PARTY CORRECTION (2026-07-31): that name was only ever right in a 1:1. Main fills
  // `to` with the session's BOUND COUNTERPARTY when the call named nobody
  // (session-io.withPostSurface: "unaddressed -> the bound counterparty"), and in a GROUP
  // channel an unaddressed post reaches no agent at all, so the card promised "To: David's
  // agent" about a message no agent would read.
  //
  // BUT IT SWUNG TOO FAR (H2, same day). Dropping the name for EVERY unaddressed post
  // understated the case that is all of today's live traffic: in a DIRECT channel the SERVER
  // addresses the post — `resolveDirectPeer` stamps `to_user_id` with the other member — so
  // the agent is correctly told it needs no `to`, and the operator was then shown "no
  // recipient named" about a message that goes to David and wakes David's agent. An approval
  // card that understates the blast radius is the same defect as one that overstates it.
  // `directChannel` is the one bit that separates the two: main stamps it from the server's
  // own `isDirect` flag (channel-context / the listener's channel DTO), and it is FAIL-QUIET
  // — anything other than an explicit true leaves the channel-level wording, so a launch
  // shape that does not carry the flag can never invent a recipient.
  // Whitespace-collapsed and capped: it is a label, not prose.
  const PEER_CAP = 60;
  function peerName(perm) {
    const raw = perm && perm.to != null ? String(perm.to).replace(/\s+/g, " ").trim() : "";
    return raw.length > PEER_CAP ? raw.slice(0, PEER_CAP - 1).trimEnd() + "…" : raw;
  }
  // MEDIUM-2 — the kind suffix. A post can claim to be a structured lifecycle EVENT
  // (`kind: task_finished`), which the peer's UI renders as an outcome rather than as chat.
  // The card used to show a forged one as an ordinary reply; main stamps the real value
  // (`postKind`, absent for a plain message) and it is named here, verbatim, so a forged
  // completion is visible before it is approved.
  function postKindSuffix(perm) {
    const kind = perm && perm.postKind != null ? String(perm.postKind).trim() : "";
    return kind ? ", marked " + kind : "";
  }
  // MEDIUM-2 — `addressed` means the CALL named a recipient (`to:`), which may be a different
  // channel member from this session's counterparty. Main puts the real value on `to` and
  // flags it, so the card names who the message is really for instead of the peer it assumes.
  // H2 — `directChannel` means the SERVER will name one: a DM post with no `to` is stamped to
  // the other member before it lands. Two different ways of knowing, one true outcome.
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
  // Same fail-suspicious rule: only an explicit true is treated as the own channel.
  function isCrossChannelPost(perm) {
    return !perm || perm.ownChannel !== true;
  }

  return {
    statusText, statusDotKey, folderLabel,
    // v2.9 (contract D): the two-axis posture + the bypass danger line. `permissionModeText`
    // is GONE, not aliased — one string can no longer describe two independent postures.
    toolPostureText, messagePostureText, permissionPostureText, bypassNoticeText,
    permissionPostBody, postDestinationText, isCrossChannelPost,
  };
});

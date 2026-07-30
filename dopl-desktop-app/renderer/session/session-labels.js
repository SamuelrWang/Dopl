// Pure STATUS / POSTURE / FOLDER label strings for the Dopl session window.
//
//   - statusText(phase, activity)              -> the status-pill text
//   - statusDotKey(phase, activity)            -> the status-dot class key (colour)
//   - folderLabel(folder)                      -> the working-directory pill label
//   - permissionModeText(autoApprove, profile) -> the permission-posture line
//   - permissionPostBody(perm)                 -> the drafted body of a gated post (D2)
//   - postDestinationText(perm)                -> WHERE that post is going (FIX #9)
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

  // The permission-posture label (items 9 + 10). Off = "Asking each time",
  // on = "Auto-approving"; the tool-profile label rides along as context. Plain
  // sentence case, no em dash (§H-13). The middle dot separates mode · profile.
  function permissionModeText(autoApprove, profileLabel) {
    const mode = autoApprove ? "Auto-approving" : "Asking each time";
    const label = profileLabel == null ? "" : String(profileLabel).trim();
    return "Permissions: " + mode + (label ? " · " + label : "");
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
  function postDestinationText(perm) {
    return perm && perm.ownChannel === true ? "To: this channel" : "To: another channel";
  }

  // Is this post leaving the session's own channel? Drives the dock's warning styling.
  // Same fail-suspicious rule: only an explicit true is treated as the own channel.
  function isCrossChannelPost(perm) {
    return !perm || perm.ownChannel !== true;
  }

  return {
    statusText, statusDotKey, folderLabel, permissionModeText,
    permissionPostBody, postDestinationText, isCrossChannelPost,
  };
});

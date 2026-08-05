// Dopl session window — THE HUMAN CLOSE AFFORDANCE (P1-6, 2026-08-04).
//
// WHY IT IS BACK. v3.1 removed the close panel with a reason that was half right:
// "closing settles the SHARED thread for BOTH members, so it belongs to the thread
// rather than to one member's window". The bridge, the IPC handler and the
// reducer's `close_task` branch were deliberately left intact, and session.js said
// so in as many words: "no renderer path can reach them now."
//
// What the removal did not anticipate is that NOTHING ELSE CLOSED EITHER. No layer
// linked a responder's "I am finished" to `channel_tasks` — no trigger, nothing on
// the write path — so threads simply never closed; two have been open in
// production since the feature shipped. And Samuel's decision 2 makes the human
// the ONLY closer: an agent may now propose and nothing more. Removing the
// operator's control from the one window where they watch the work happen, while
// also removing the agent's ability to close, leaves the thread open forever
// unless they remember to go to another surface.
//
// So the control returns HERE, where the decision is actually made, and the web
// thread card keeps its own. Both call the same route.
//
// IT LIVES IN ITS OWN FILE for the reason session-modes-ui.js, session-mention-ui.js
// and session-attended-ui.js do: renderer/session/session.js sits at the hard 500-line
// §2 cap. session.js keeps ONE mount call.
//
// WHAT IT NEVER DOES: decide anything, or claim anything. It dispatches
// `session:close-task` and lets main answer; the reducer owns the close, the echo
// and the settle. Every string reaches the DOM via textContent or as a value — no
// innerHTML, exactly like the rest of this window.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionCloseUI = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ── copy (no em dashes, per the house voice) ────────────────────────────────
  // It names the CONSEQUENCE, because that is the whole reason this is a human's
  // decision rather than an agent's: the other member's thread card changes too.
  const CONFIRM_NOTE =
    "Closing settles this thread for both members and takes it off the open list. The window stays open.";

  // ── PURE: may the operator close right now? ─────────────────────────────────
  // Two conditions, and neither is about permission (the server owns that — only a
  // thread's creator or the member it is addressed to may close, and a refusal
  // comes back as a notice):
  //   NO THREAD    a session with no first-class thread id has nothing to close.
  //                `closeTask` is a no-op without one (main/session-close-task.js),
  //                so a visible control would be a button that does nothing.
  //   ALREADY ENDED  this session has settled. The thread may still be open, but
  //                this window is no longer the place to act on it.
  function canClose(state) {
    const s = state || {};
    if (!s.taskId) return false;
    return !s.ended;
  }

  /**
   * Mount the control.
   *
   * `els` supplies the three nodes from session.html; a MISSING node disables the
   * whole feature rather than throwing — this window has shipped without the panel
   * for several versions and a stale HTML must not take the session down with it.
   */
  function mount({ els, bridge, notice }) {
    if (!els || !els.closeBtn || !els.closePanel || !els.closeSummary) return null;
    let open = false;
    let busy = false;

    function paint(state) {
      const allowed = canClose(state);
      els.closeBtn.hidden = !allowed;
      if (!allowed && open) setOpen(false);
      els.closeBtn.disabled = busy;
    }

    function setOpen(next) {
      open = next;
      els.closePanel.hidden = !next;
      if (next) {
        els.closeNote.textContent = CONFIRM_NOTE;
        els.closeSummary.focus();
      } else {
        els.closeSummary.value = "";
      }
    }

    async function submit(outcome) {
      if (busy) return;
      busy = true;
      els.closeBtn.disabled = true;
      try {
        // The bridge resolves whatever main answered; a refusal (not a party to
        // the thread, no live session) surfaces as a notice rather than as a
        // silently-unchanged panel. Same discipline as the posture selects.
        const res = await bridge.closeTask(outcome, els.closeSummary.value.trim());
        if (res && res.ok === false && notice) {
          notice("That close did not apply. Open the thread in Dopl to close it there.");
        }
        setOpen(false);
      } finally {
        busy = false;
        els.closeBtn.disabled = false;
      }
    }

    els.closeBtn.addEventListener("click", () => setOpen(!open));
    els.closeCancel.addEventListener("click", () => setOpen(false));
    els.closeDone.addEventListener("click", () => submit("completed"));
    els.closeFailed.addEventListener("click", () => submit("failed"));
    setOpen(false);
    return { paint, canClose };
  }

  return { mount, canClose, CONFIRM_NOTE };
});

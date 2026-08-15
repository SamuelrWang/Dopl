// Dopl session window — THE HUMAN CLOSE AFFORDANCE.
//
// ⚠ DO NOT REMOVE IT AGAIN. It was once dropped on the reasoning that "closing settles the
// SHARED thread for BOTH members, so it belongs to the thread rather than one member's window"
// — but NOTHING ELSE CLOSES a thread: no layer links a responder's "I am finished" to
// `channel_tasks`, and an agent may only PROPOSE. Without this control a thread stays open
// forever unless the operator remembers another surface. The web thread card keeps its own;
// both call the same route.
//
// ⚠ WHAT IT NEVER DOES: decide or claim anything. It dispatches `session:close-task` and lets
// main answer; the reducer owns the close, the echo and the settle. Every string reaches the
// DOM via textContent or as a value — no innerHTML.

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
  // ⚠ Names the CONSEQUENCE — the other member's thread card changes too, which is why this is
  // a human's decision rather than an agent's.
  const CONFIRM_NOTE =
    "Closing settles this thread for both members and takes it off the open list. The window stays open.";

  // ── PURE: may the operator close right now? ─────────────────────────────────
  // ⚠ Neither condition is about PERMISSION — the server owns that (only a thread's creator or
  // its addressee may close; a refusal comes back as a notice):
  //   NO THREAD      no first-class thread id, so `closeTask` is a no-op
  //                  (main/session-close-task.js) and the control would do nothing.
  //   ALREADY ENDED  this session settled; the thread may still be open, but not from here.
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
        // ⚠ A refusal (not a party to the thread, no live session) surfaces as a NOTICE
        // rather than a silently-unchanged panel. Same discipline as the posture selects.
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

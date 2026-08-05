// Dopl session window — THE WORKING-FOLDER PILL (item 5).
//
// Split out of renderer/session/session.js at the hard 500-line §2 cap (2026-08-04),
// when the close affordance came back (P1-6). It is the same shape as every other
// control that has left that file — session-modes-ui.js, session-mention-ui.js,
// session-attended-ui.js, session-close-ui.js: one mount call in session.js, and
// everything the control DOES lives here.
//
// WHAT IT NEVER DOES: decide anything, or persist anything. The native picker and
// the per-channel store are main's (`channel-dirs`); this reads a label back and
// hands it to the caller's reducer. A change takes effect on the NEXT session
// (O-5), which is main's rule, not this file's.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionFolderUI = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Wire the pill.
   *
   * `onLabel(label)` is called with a label the bridge returned — on the initial
   * seed and on every pick. Both paths swallow their own failures: a picker the
   * operator cancelled and an unreachable bridge are the same thing to this
   * window (no change), and neither is worth a notice.
   */
  function mount({ pill, bridge, onLabel }) {
    if (!pill || !bridge) return null;
    const apply = (res) => {
      if (res && typeof res === "object") onLabel(res.label);
    };
    const swallow = () => {};
    // ONE click-to-change pill: clicking opens the native picker.
    pill.addEventListener("click", () => {
      Promise.resolve(bridge.choose()).then(apply).catch(swallow);
    });
    // Seed from the stored dir (the engine also emits `folder` on init).
    Promise.resolve(bridge.get()).then(apply).catch(swallow);
    return { apply };
  }

  return { mount };
});

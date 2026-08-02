// Dopl session window — THE STATUS-STRIP CONTROLS: the two posture selects (Tools / Messages),
// the model picker beside them, the context meter, and the ONE refusal path all three share.
//
// FIX 2 (2026-08-02): A CONTROL MUST NEVER LIE ABOUT WHAT IT DID.
// The two selects used to fire and forget: `bridge.setToolMode(value)` with the invoke promise
// discarded on both sides of the bridge. When main refused the change — which is what it did
// for EVERY change made from a pre-consent window, because that window is not in the live
// session registry — the select kept showing the value the operator picked while the gate went
// on enforcing the old one. The dangerous direction, and the one the operator reported: the
// header claims a posture nothing is applying. Now the change WAITS for main's answer, and an
// {ok:false} snaps the select back to the last value main confirmed and says so in one line.
//
// IT LIVES IN ITS OWN FILE because renderer/session/session.js sits at the hard 500-line §2
// cap, the same reason session-mention-ui.js and session-attended-ui.js exist. session.js
// keeps ONE mount call and ONE sync call; everything the controls do is here.
//
// WHAT IT NEVER DOES: decide anything. Main owns both axes (main/session-profiles.grantDecision
// for tools, the inbound gate for messages) and re-coerces every value against its own tables.
// This file moves a <select>, reads its `.value`, and repaints from what main echoed back.
// Every string reaches the DOM as a value or via the caller's textContent notice path — no
// innerHTML anywhere, exactly like the rest of this window.

// 2026-08-02 — THE MODEL PICKER joined this file rather than getting one of its own, because it
// is the SAME control problem: a <select> in the same strip that must revert when main refuses
// it, and that must go dead across the same adoption gap. It is NOT a third permission axis
// (it approves nothing, denies nothing, and reaches no gate); it is a third control.
// THE CONTEXT METER joined for the narrower reason that session.js is at its own cap: the meter
// is one textContent + one className, painted from the same `sync` the selects already use.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionModesUI = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The meter's copy is pure string work and lives with the rest of the window's strings
  // (session-labels.js), reached the way session-viewmodel.js reaches it. OPTIONAL here, unlike
  // the view-model's hard guards: a missing labels module costs a meter, not a decision.
  const labels =
    typeof module === "object" && typeof require === "function"
      ? require("./session-labels.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionLabels) || {};

  // ── copy (no em dashes, per the house voice) ────────────────────────────────
  // Deliberately does NOT name a reason: the renderer cannot know one, and guessing
  // ("the session is starting") would be the same class of lie the fix exists to remove.
  const REFUSED_NOTE = "That posture change did not apply. The control has been put back to what this session is actually enforcing.";

  // ── PURE: may the operator move these controls right now? ───────────────────
  // Three states, and the middle one is the whole point:
  //   CONSENT, undecided   YES. FIX 1 gave the pre-consent selects a real path: the pick is
  //                        stored on that card's registry entry and seeds the spawn on Accept.
  //                        They were enabled before too, which was the bug — enabled and dead.
  //   THE ADOPTION GAP     NO. Between Accept and the adopted session's first `init` (~13s in
  //                        the field: the consent row flips, the watcher polls, the SDK boots)
  //                        the card is decided and the session does not exist yet, so NEITHER
  //                        registry can answer and every change would be refused. Disable the
  //                        control rather than let it be clicked into a guaranteed revert.
  //                        The revert belt still runs underneath — this only removes the
  //                        pointless round trip, it is not what makes the window honest.
  //   LIVE / ENDED         a live session takes changes; an ended one takes nothing.
  function selectsEnabled(state) {
    const s = state || {};
    if (s.ended) return false;
    if (s.phase === "consent") return !s.consentResolved; // decided => the adoption gap
    return true;
  }

  // PURE: the value a select must fall back to, per axis, from main's confirmed pair. The
  // confirmed pair is the view-model's own state, which moves ONLY on a `modes` event from
  // main, so "last confirmed" is exactly "last thing main told us it is enforcing".
  function confirmedValue(axis, confirmed) {
    const c = confirmed || {};
    if (axis === "tool") return c.tool || "manual";
    // The model reverts to main's confirmed PICK, never to whatever is running: `default` is
    // the fail-closed member of that enum exactly as `manual` / `ask` are of theirs.
    if (axis === "model") return c.model || "default";
    return c.message || "ask";
  }

  // ── mount ───────────────────────────────────────────────────────────────────
  // opts: { els: {toolMode, messageMode}, bridge, confirmed(): {tool, message}, notice(text) }
  // `document` is never touched at module load (the discipline session-render.js is pinned on).
  function mount(opts) {
    const o = opts || {};
    const els = o.els || {};
    const bridge = o.bridge || {};
    const confirmed = typeof o.confirmed === "function" ? o.confirmed : function () { return {}; };
    const notice = typeof o.notice === "function" ? o.notice : function () {};

    const axes = [
      { axis: "tool", node: els.toolMode, send: bridge.setToolMode },
      { axis: "message", node: els.messageMode, send: bridge.setMessageMode },
      // The model rides the SAME four refusal shapes as the two above (no method, a throw, a
      // rejection, an answer that is not {ok:true}) — and it needs them just as much, because a
      // pick main never took would otherwise show over a session still running the old model.
      { axis: "model", node: els.modelMode, send: bridge.setModel },
    ];

    function revert(entry) {
      if (entry.node) entry.node.value = confirmedValue(entry.axis, confirmed());
      notice(REFUSED_NOTE);
    }

    for (const entry of axes) {
      if (!entry.node) continue;
      entry.node.addEventListener("change", function () {
        // A preload with no method at all (version skew, or the standalone stub) is a REFUSAL
        // now, not a silent shrug: nothing is behind the control, so it must not keep the
        // operator's value. That is the reverse of the old comment's "safe failure", which
        // was only safe in main and left the window overstating its own permissions.
        if (typeof entry.send !== "function") return revert(entry);
        let pending;
        try {
          pending = entry.send.call(bridge, entry.node.value);
        } catch (_err) {
          return revert(entry);
        }
        Promise.resolve(pending)
          .then(function (res) {
            if (!res || res.ok !== true) revert(entry); // main did not take it
          })
          .catch(function () { revert(entry); });
      });
    }
  }

  // THE UNCONDITIONAL REPAINT. Every control in the strip is redrawn from the view-model on
  // every render, which is the second backstop under the revert above: whatever a click left
  // behind, the next render puts main's own state back. Each node is optional (a harness, or a
  // version-skewed page, may not have it) and each value is written only when the state really
  // carries a string, so a partial state can never blank a control that is showing the truth.
  function paint(els, state) {
    const e = els || {};
    const s = state || {};
    if (e.toolMode && typeof s.toolMode === "string") e.toolMode.value = s.toolMode;
    if (e.messageMode && typeof s.messageMode === "string") e.messageMode.value = s.messageMode;
    if (e.modelMode && typeof s.modelChoice === "string") e.modelMode.value = s.modelChoice;
    // BYPASS is the one mode that hands over the whole machine, so the control itself carries
    // the danger token while it is selected.
    if (e.toolMode && e.toolMode.classList) e.toolMode.classList.toggle("is-bypass", s.toolMode === "bypass");
    // THE CONTEXT METER: empty before the first turn ends, tokens-only when main sent no
    // window, "412k / 1M (41%)" when it did. The level class is the amber/red threshold.
    if (!e.ctxMeter || typeof labels.contextMeterText !== "function") return;
    e.ctxMeter.textContent = labels.contextMeterText(s.context);
    e.ctxMeter.className = ("ctx-meter text-caption " + labels.contextMeterLevel(s.context)).trim();
  }

  // Called from session.js's renderStatus. It owns the enabled/disabled rule for the adoption
  // gap AND the repaint above, so the controller keeps exactly one call for the whole strip.
  function sync(els, state) {
    const on = selectsEnabled(state);
    for (const node of [els && els.toolMode, els && els.messageMode, els && els.modelMode]) {
      if (node) node.disabled = !on;
    }
    paint(els, state);
  }

  return { mount, sync, paint, selectsEnabled, confirmedValue, REFUSED_NOTE };
});

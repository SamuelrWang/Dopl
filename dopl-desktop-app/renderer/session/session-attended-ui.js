// Dopl session window — the ATTENDED HANDOFF button on the pre-consent card (F-118).
//
// ONE control, mounted into the consent card's own action row beside Accept: "Open in
// Claude Code". It hands this request to the operator's OWN Claude Code, with a prefilled,
// UNSUBMITTED prompt that teaches a fresh session how to join the thread over MCP. Main
// builds that prompt and opens the deep link (main/attended-handoff.js); this file owns the
// button, the copy, and what the card says afterwards.
//
// IT DECIDES NOTHING. Clicking it does not accept, deny or park the request: the consent
// row stays pending on the server, so Accept sits right there underneath and still spawns a
// Dopl session if the operator changes their mind. That is why Accept is RELABELLED rather
// than disabled once the handoff lands, and why this module never touches accept.disabled.
//
// IT LIVES IN ITS OWN FILE because session.js, session-render.js and session-viewmodel.js
// are all at the hard 500-line §2 cap. session-render.js calls ONE hook (ctx.attended) at
// the point in makeConsent where the button belongs, and everything else is here.
//
// SECURITY: every string reaches the DOM via textContent. There is no innerHTML, no
// template interpolation, and NOTHING from the request (no body, no summary, no name) is
// read here at all. The bridge call carries no argument: main resolves the consent card
// from the window, so this page has nothing to forge and no way to inject text into the
// prompt.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionAttendedUI = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ── copy (pure; no em dashes, per the house voice) ──────────────────────────
  const LABEL = "Open in Claude Code";
  const BUSY_LABEL = "Opening…";
  const OPENED_LABEL = "Opened in Claude Code";
  // Accept never goes away, but after a handoff it is no longer the obvious next step, so
  // it says what it now MEANS rather than what it used to be called.
  const SPAWN_INSTEAD = "Start a Dopl session instead";
  const BUSY_NOTE = "Opening Claude Code…";

  // What the card says once main reports which rung it used.
  function resolvedNote(route) {
    if (route === "clipboard") return "Prompt copied. Paste it into Claude Code and press Enter.";
    return "Opened in Claude Code. The prompt is waiting there, unsent. Press Enter to start it.";
  }

  // ...and when it did not happen. Never claims anything was sent.
  function failureNote(reason) {
    if (reason === "bad-id") return "This request is missing an id, so nothing was opened. Accept still works.";
    if (reason === "no-card") return "This request is no longer open on this machine.";
    return "Could not open Claude Code. Nothing was sent, and Accept still works.";
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────
  // `document` is touched only INSIDE mount, never at module load, so a node require needs
  // no DOM (the same discipline session-render.js is pinned on).
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setNote(note, text) {
    if (!note) return;
    note.textContent = text;
    if (note.classList && typeof note.classList.remove === "function") note.classList.remove("hidden");
  }

  // Mount the button into `row`, between Accept and Deny (makeConsent calls this after it
  // has appended Accept and before it appends Deny).
  //
  // VERSION SKEW: a bridge with no attendedHandoff is an older preload, and the button
  // simply does not render. A dead control that reports "unsupported" on click is worse
  // than an absent one on a card whose other two buttons work.
  // THE RECORD IS THE LOCK (FIX H-2). makeConsent keeps what this returns and its lock()
  // stamps `locked` + disables the button whenever the card reaches a terminal state (Accept,
  // Deny, expiry). From that moment this module says NOTHING more about the card: a round
  // trip still in flight must not hand the button back, must not relabel an Accept that was
  // already answered, and must not overwrite "Request declined." with a note of its own.
  function mount(row, accept, note, bridge) {
    if (!row || !bridge || typeof bridge.attendedHandoff !== "function") return null;
    const btn = el("button", "ctl btn-light", LABEL);
    btn.type = "button";
    const rec = { el: btn, locked: false };

    const fail = (reason) => {
      if (rec.locked === true) return;
      btn.disabled = false;
      btn.textContent = LABEL;
      setNote(note, failureNote(reason));
    };

    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      // Locked for the round trip so one click is one terminal window. Every deep-link
      // invocation opens a NEW one (there is no dedupe on the platform side), so a
      // double-click would genuinely open two.
      btn.disabled = true;
      btn.textContent = BUSY_LABEL;
      setNote(note, BUSY_NOTE);
      Promise.resolve(bridge.attendedHandoff())
        .then((res) => {
          if (!res || res.ok !== true) return fail(res && res.reason);
          if (rec.locked === true) return; // decided while we were out; the card is not ours
          btn.textContent = OPENED_LABEL;
          setNote(note, resolvedNote(res.route));
          // The card is now handled-attended. Accept is deliberately left ENABLED: the
          // request was never decided, so spawning a Dopl session is still on the table.
          if (accept) accept.textContent = SPAWN_INSTEAD;
        })
        .catch(() => fail("error"));
    });

    row.appendChild(btn);
    return rec;
  }

  return { mount, resolvedNote, failureNote, LABEL, BUSY_LABEL, OPENED_LABEL, SPAWN_INSTEAD, BUSY_NOTE };
});

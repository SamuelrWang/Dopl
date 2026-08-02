// The REQUEST LIFECYCLE STRIP (2026-08-02) — renderer half.
//
// One line in the window chrome saying what happened to the request the operator sent:
// Sent -> Accepted / Declined / Replied. It exists because a requester used to have no
// answer at all between pressing send and a reply landing — the peer's accept or decline
// was invisible on this machine.
//
// A SELF-CONTAINED SURFACE, on exactly the terms session-auth-ui.js is: it owns one element
// (#requestStatus, static markup in session.html) and one narrow bridge sink
// (`doplSession.request`), so it adds NOTHING to session.js / session-viewmodel.js /
// session-render.js — all three sit at the §2 500-line cap. Loaded as a plain <script> like
// every other renderer module; with no bridge (a standalone open, or an older preload) it
// binds nothing and the line simply never appears.
//
// THE COPY IS A CLOSED TABLE AND IT LIVES HERE, not on the wire. Main emits the FACT
// (`{ type: 'request_status', status }`, a reserved word from the same four), the renderer
// owns how it reads. An unknown status therefore paints NOTHING rather than echoing a string a
// payload chose. Every word reaches the element through textContent; no markup is ever built
// here, and the payload carries no id, name or body to leak in the first place.
//
// A REPLAYED EVENT REBUILDS IT. main/session-replay.js pins `request_status` in the ring
// (last-wins, one entry), so a Cmd-R reload re-delivers the current state and this repaints
// from it — there is no separate read-back call and no state kept anywhere else.

(function () {
  "use strict";

  const el = document.getElementById("requestStatus");
  if (!el) return;

  const bridge = (window.doplSession && window.doplSession.request) || null;

  // Plain voice, no em dash. "Sent" is the moment the request left; "Reply received" is
  // deliberately about the REPLY rather than the peer, because it is what the operator is
  // waiting for and the transcript below already names who wrote it.
  const TEXT = {
    sent: "Request sent",
    accepted: "Request accepted",
    declined: "Request declined",
    replied: "Reply received",
  };

  // The two outcomes that are NEWS get a token colour; the two in-flight states stay muted.
  const TONE = { declined: "is-declined", replied: "is-replied" };

  function paint(status) {
    const key = typeof status === "string" ? status : "";
    const text = Object.prototype.hasOwnProperty.call(TEXT, key) ? TEXT[key] : "";
    el.textContent = text;
    el.classList.toggle("hidden", !text);
    el.classList.toggle("is-declined", TONE[key] === "is-declined");
    el.classList.toggle("is-replied", TONE[key] === "is-replied");
  }

  paint("");

  if (bridge && typeof bridge.onStatus === "function") {
    bridge.onStatus((payload) => {
      paint(payload && payload.status);
    });
  }
})();

// The REQUEST LIFECYCLE STRIP — renderer half. One chrome line saying what happened to the
// request the operator sent: Sent -> Accepted / Declined / Replied, which is otherwise
// invisible on this machine between pressing send and a reply landing.
//
// A SELF-CONTAINED SURFACE like session-auth-ui.js: one element (#requestStatus, static markup
// in session.html) and one narrow bridge sink (`doplSession.request`). With no bridge (a
// standalone open, or an older preload) it binds nothing and the line never appears.
//
// ⚠ THE COPY IS A CLOSED TABLE AND IT LIVES HERE, not on the wire: main emits the FACT
// (`{ type: 'request_status', status }`), the renderer owns how it reads, so an unknown status
// paints NOTHING rather than echoing a string a payload chose. Every word reaches the element
// through textContent; no markup is built here.
// A REPLAYED EVENT REBUILDS IT: main/session-replay.js pins `request_status` in the ring
// (last-wins, one entry), so a reload repaints from it — no read-back call, no state kept
// anywhere else.

(function () {
  "use strict";

  const el = document.getElementById("requestStatus");
  if (!el) return;

  const bridge = (window.doplSession && window.doplSession.request) || null;

  // Plain voice, no em dash. "Reply received" is deliberately about the REPLY, not the peer —
  // the transcript below already names who wrote it.
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

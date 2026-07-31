// Q6 — the in-window "Sign in to Claude" banner (renderer half).
//
// A SELF-CONTAINED surface: it owns one element (#authNotice, static markup in session.html)
// and the narrow `doplSession.auth` bridge, so it adds NOTHING to session.js / the view-model /
// session-render.js — all three sit at the §2 500-line cap. It is loaded as a plain <script>
// like every other renderer module; with no bridge (a standalone open, or an older preload) it
// binds nothing and the banner simply never shows.
//
// SECURITY: every string reaches the DOM via textContent. There is no innerHTML, no template
// interpolation, and no id / path / token in the payload — the banner carries display copy only
// (session-auth-detect.js owns the words). The button sends NO argument: main resolves the
// session from the window, exactly like the permission dock and the inbound gate.
//
// WHY A BANNER AND NOT A STREAM BUBBLE: the dead end this replaces WAS a bubble. A bubble
// scrolls away, cannot be re-shown without another failure, and competes with the transcript's
// scroll-pin rule. This sits in the chrome, above the composer, next to the other decision
// surfaces (the permission dock, the ended banner) and disappears when it is answered.

(function () {
  "use strict";

  const bridge = (window.doplSession && window.doplSession.auth) || null;
  const el = document.getElementById("authNotice");
  if (!el) return;

  const $ = (id) => document.getElementById(id);
  const parts = {
    title: $("authTitle"),
    body: $("authBody"),
    note: $("authNote"),
    button: $("btnAuthSignIn"),
  };

  let busy = false;

  function hide() {
    el.classList.remove("is-active");
    busy = false;
    if (parts.button) parts.button.disabled = false;
    if (parts.note) {
      parts.note.textContent = "";
      parts.note.classList.add("hidden");
    }
  }

  // Paint one notice. `busy` locks the button while the sign-in flow owns the screen (the OAuth
  // page + the paste-back window), so a second click cannot stack a second flow.
  function show(notice) {
    if (!notice) return hide();
    el.classList.add("is-active");
    el.classList.toggle("is-error", notice.kind === "error");
    if (parts.title) parts.title.textContent = notice.title || "";
    if (parts.body) parts.body.textContent = notice.body || "";
    if (parts.button) {
      parts.button.textContent = notice.action || "Sign in to Claude";
      busy = notice.busy === true;
      parts.button.disabled = busy;
    }
    if (parts.note) {
      const note = notice.note || "";
      parts.note.textContent = note;
      parts.note.classList.toggle("hidden", !note);
    }
  }

  function onClick() {
    if (busy || !bridge || typeof bridge.signIn !== "function") return;
    busy = true;
    if (parts.button) parts.button.disabled = true;
    Promise.resolve(bridge.signIn())
      .then((res) => {
        // Main is authoritative: it re-paints the banner (a failed flow) or clears it (a
        // successful one, followed by the session starting). A refused invoke just hands the
        // button back so the operator can try again.
        if (res && res.ok === false && el.classList.contains("is-active")) {
          busy = false;
          if (parts.button) parts.button.disabled = false;
        }
      })
      .catch(() => {
        busy = false;
        if (parts.button) parts.button.disabled = false;
      });
  }

  if (parts.button) parts.button.addEventListener("click", onClick);

  if (bridge && typeof bridge.onNotice === "function") {
    bridge.onNotice((payload) => {
      if (payload && payload.type === "auth_cleared") hide();
      else show(payload);
    });
  }
  // A reload rebuilds this page with an empty DOM; ask main whether a hold is still open.
  if (bridge && typeof bridge.get === "function") {
    Promise.resolve(bridge.get())
      .then((notice) => { if (notice) show(notice); })
      .catch(() => {});
  }
})();

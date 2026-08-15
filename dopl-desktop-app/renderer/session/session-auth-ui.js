// The in-window "Sign in to Claude" banner — renderer half.
//
// A SELF-CONTAINED surface: one element (#authNotice, static markup in session.html) and the
// narrow `doplSession.auth` bridge. With no bridge it binds nothing and the banner never shows.
//
// ⚠ SECURITY: every string reaches the DOM via textContent — no innerHTML, no template
// interpolation, and no id / path / token in the payload (session-auth-detect.js owns the
// words). The button sends NO argument: main resolves the session from the window.
// ⚠ A BANNER, NOT A STREAM BUBBLE: a bubble scrolls away, cannot be re-shown without another
// failure, and competes with the transcript's scroll-pin rule. This sits in the chrome beside
// the other decision surfaces and disappears when answered.

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

  // Paint one notice. ⚠ `busy` locks the button while the sign-in flow owns the screen, so a
  // second click cannot stack a second flow.
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
        // ⚠ Main is authoritative: it re-paints the banner (failed flow) or clears it
        // (successful). A refused invoke just hands the button back.
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

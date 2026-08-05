// Dopl session window — the COMPOSER ADDRESSEE PILL, the DOM layer (rollback §3.2).
//
// Two surfaces and one holder:
//   attach({trigger, label, menu, getOptions, getTarget, onPick})  the pill + its menu
//   makePeerMessage(item, ctx)                                     the peer_message bubble
//   createComposer({...})                                          what session.js holds
//
// createComposer exists because renderer/session/session.js is at the hard 500-line §2 cap:
// the menu wiring, the option derivation and the target state live HERE and the controller
// keeps only the send / keydown behaviour its own tests pin.
//
// WHAT THE PILL DOES NOT DO, and it is most of what its predecessor did. The `@` popup owned
// the textarea's `input` and `blur` events, ran a caret-position state machine, and had to be
// delegated to FIRST inside the composer's one keydown handler so Enter-to-accept and
// Enter-to-send could not both fire. A pill is a button beside the field: it takes its own
// clicks, the textarea is untouched, and Enter means send in every state. The only key it
// handles is Escape, and only while the menu is open.
//
// SECURITY: every string on both surfaces reaches the DOM via textContent, and the ONLY avatar
// path is render.avatarNode (which sets img.src for a `data:` URI and nothing else), so the CSP
// `img-src 'self' data:` is never challenged. There is NO innerHTML here. The pure decisions
// (the rows, the copy, the fallback, the reducer cases) all live in session-address.js; this is
// the imperative shell it feeds. `document` is only ever touched INSIDE a factory or a mount,
// never at module load, so a node require needs no DOM.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionAddressUI = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const noop = function () {};

  // The three modules this one leans on, reached the way session-render.js reaches
  // session-chrome.js: a require() under node, the renderer global in the sandbox
  // (session.html loads all three BEFORE this file).
  const need = (name, key) =>
    typeof module === "object" && typeof require === "function"
      ? require(name)
      : (typeof globalThis !== "undefined" && globalThis[key]) || null;
  const pure = need("./session-address.js", "DoplSessionAddress");
  const render = need("./session-render.js", "DoplSessionRender");
  const chrome = need("./session-chrome.js", "DoplSessionChrome");

  function el(tag, className, text) {
    return render.el(tag, className, text);
  }
  function attr(node, key, value) {
    if (node && typeof node.setAttribute === "function") node.setAttribute(key, value);
  }
  // A synthetic event from a test harness may carry no preventDefault (the boot-dom stub
  // idiom): guard it rather than throwing inside a keystroke.
  function prevent(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  }

  // ── the pill + its menu ─────────────────────────────────────────────────────
  // The menu is absolutely positioned OUT OF FLOW above the composer field, so it can never
  // enter the composer's flex-shrink competition, and it is not inside .stream, so the scroll
  // pin and the wheel forwarding never see it either.
  function attach(spec) {
    const o = spec || {};
    const trigger = o.trigger;
    const labelNode = o.label;
    const host = o.menu;
    const getOptions = typeof o.getOptions === "function" ? o.getOptions : () => [];
    const getTarget = typeof o.getTarget === "function" ? o.getTarget : () => pure.DEFAULT_TARGET;
    const onPick = typeof o.onPick === "function" ? o.onPick : noop;
    let open = false;

    function row(option) {
      const picked = option.key === pure.resolveTarget(getTarget(), getOptions());
      const node = el("div", "target-opt" + (picked ? " is-sel" : ""));
      attr(node, "role", "menuitemradio");
      attr(node, "aria-checked", picked ? "true" : "false");
      node.appendChild(el("span", "target-opt__label", option.label));
      node.appendChild(el("span", "target-opt__hint", option.hint));
      // mousedown (not click) so the pick lands BEFORE the field's blur; preventDefault first,
      // so the composer never loses focus at all.
      node.addEventListener("mousedown", (e) => {
        prevent(e);
        onPick(option.key);
        close();
      });
      return node;
    }

    // The pill's FACE is repainted on every sync, not just on a pick: the self row's name
    // arrives from main after mount, and the peer row's arrives with `init`, so a face painted
    // once would keep saying "Message this session" over a session that has a handle.
    function paint() {
      const options = getOptions();
      if (labelNode) labelNode.textContent = pure.labelFor(getTarget(), options);
      attr(trigger, "aria-expanded", open ? "true" : "false");
      if (!host) return;
      if (!open) {
        host.classList.add("hidden");
        host.replaceChildren();
        return;
      }
      const rows = options.map(row);
      // The limit line under a menu that can only offer the self row. It is not an option, so
      // it takes role="presentation" (a menu owns its items) and never the .is-sel surface.
      const tail = [];
      const limit = pure.note(options);
      if (limit) {
        const n = el("div", "target-pop__note", limit);
        attr(n, "role", "presentation");
        tail.push(n);
      }
      host.replaceChildren(...rows, ...tail);
      host.classList.remove("hidden");
    }

    function close() {
      if (!open) return;
      open = false;
      paint();
    }

    function toggle() {
      open = !open;
      paint();
    }

    // TRUE means "consumed". Only Escape, and only while open — every other key in the composer
    // still means what it always meant, which is the point of replacing the `@` popup.
    function handleKey(e) {
      if (!open) return false;
      if (e && e.key === "Escape") {
        close();
        prevent(e);
        return true;
      }
      return false;
    }

    if (trigger && typeof trigger.addEventListener === "function") {
      trigger.addEventListener("click", toggle);
      // A click anywhere else dismisses it. `blur` is not enough: the pick itself is a mousedown
      // on a node outside the button, so blur would race the pick it is supposed to follow.
      trigger.addEventListener("blur", close);
    }
    if (host) host.classList.add("hidden");
    paint();
    return { handleKey, isOpen: () => open === true, sync: paint, close };
  }

  // ── the peer_message bubble ─────────────────────────────────────────────────
  // MY OWN words, addressed to the peer's agent: right-laned like the rest of this machine's
  // output (chrome.laneClass keys on the kind, never on the text), with a status line instead of
  // controls — there is no decision to make, only an outcome to report.
  function makePeerMessage(item, ctx) {
    const lane = chrome && typeof chrome.laneClass === "function" ? chrome.laneClass({ kind: "peer_message" }) : "";
    const root = el("div", "bubble role-peer-msg" + (lane ? " " + lane : ""));
    const head = el("div", "cp-head");
    const selfAvatar = () =>
      render.avatarNode(ctx && typeof ctx.avatarFor === "function" ? ctx.avatarFor("self") : null, "Y");
    let av = selfAvatar();
    head.appendChild(av);
    head.appendChild(el("span", "who", pure.peerMessageWho(item.to)));
    root.appendChild(head);
    const body = el("span", "body", item.text || "");
    root.appendChild(body);
    const status = el("div", "peer-msg__status");
    root.appendChild(status);
    const update = (it) => {
      const next = selfAvatar(); // a late `avatars` event repaints an existing bubble
      head.replaceChild(next, av);
      av = next;
      body.textContent = it.text || "";
      status.textContent = pure.statusText(it.status);
      root.classList.toggle("is-failed", it.status === "failed");
    };
    update(item);
    return { el: root, update };
  }

  // ── what session.js holds ───────────────────────────────────────────────────
  // ONE object over the menu, the picked target, the session's own handle and the peer send —
  // the same arrangement session-modes-ui.js has, where the module owns the control, its copy
  // AND its refusal path, and the controller keeps one mount and one paint. The options are
  // re-derived on every read, so a late `init` (the peer name rides it) and a late name read
  // both need no re-wiring; `sync()` is the one call that repaints the face.
  //
  // FIX F8, kept across the rewrite: a preload with NO sendToPeer (a version-skewed install, or
  // session.js's standalone stub, which deliberately omits it) used to return SILENTLY — the
  // draft survived, but the click did nothing and the glyph said Send. `send()` answers FALSE
  // and says so in the stream, so the caller leaves the draft in the field.
  const NO_PEER_BRIDGE = "Could not send that message to the peer. Restart Dopl and try again.";

  function createComposer(spec) {
    const o = spec || {};
    const els = o.els || {};
    const bridge = o.bridge || {};
    const notice = typeof o.notice === "function" ? o.notice : noop;
    const peerName = typeof o.getPeerName === "function" ? o.getPeerName : () => "";
    // The session's own handle, read ONCE from main. It is fixed for the life of the session KEY
    // (that is what makes it survive a park, a lazy resume and a P2 recreate, F-142), so there
    // is nothing to subscribe to. Until it answers — and forever, on a desktop whose IPC
    // predates §3.2 — the row reads "Message this session" rather than a name it does not have.
    let sessionName = "";
    const getOptions = () => pure.targetOptions({ sessionName: sessionName, peerName: peerName() });
    let target = pure.DEFAULT_TARGET;
    const onChange = typeof o.onChange === "function" ? o.onChange : noop;
    const menu = attach({
      trigger: els.targetPill, label: els.targetLabel, menu: els.targetPop, getOptions,
      getTarget: () => target,
      onPick: (key) => { target = key; onChange(); }, // picking NEVER sends
    });
    if (typeof bridge.agentName === "function") {
      Promise.resolve(bridge.agentName())
        .then((r) => { sessionName = (r && r.name) || ""; menu.sync(); })
        .catch(() => { /* the fallback row already says something true */ });
    }
    return {
      handleKey: menu.handleKey,
      isOpen: menu.isOpen,
      sync: menu.sync,
      // ALWAYS resolved against the CURRENT rows, never returned raw: a held 'peer' on a session
      // that has since lost its counterparty must collapse to the steer rather than post with no
      // addressee (session-address.resolveTarget).
      target: () => pure.resolveTarget(target, getOptions()),
      // TRUE = delivered to the bridge (fire-and-forget; the outcome comes back as
      // operator_post / operator_post_result). FALSE = nothing left this machine.
      send: (text) => {
        if (typeof bridge.sendToPeer !== "function") {
          notice(NO_PEER_BRIDGE);
          return false;
        }
        bridge.sendToPeer(text);
        return true;
      },
    };
  }

  return { attach, makePeerMessage, createComposer, NO_PEER_BRIDGE };
});

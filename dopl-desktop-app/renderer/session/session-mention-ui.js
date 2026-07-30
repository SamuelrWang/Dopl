// Dopl session window — composer @-ADDRESSING, the DOM layer (v2.8).
//
// Two surfaces and one factory:
//   attach({input, host, getOptions, onAccept})  the tag popup over the composer
//   makePeerMessage(item, ctx)                   the peer_message stream bubble
//   createComposer({...})                        what session.js actually holds
//
// createComposer exists because renderer/session/session.js is at the hard 500-line §2 cap:
// the popup wiring, the option derivation and the address parse live HERE and the controller
// keeps only the send / keydown behavior its own tests pin.
//
// SECURITY: every string on both surfaces reaches the DOM via textContent, and the ONLY
// avatar path is render.avatarNode (which sets img.src for a `data:` URI and nothing else),
// so the CSP `img-src 'self' data:` is never challenged. There is NO innerHTML here. The
// pure decisions (tokenizing, matching, the popup state machine, the copy) all live in
// session-mention.js; this module is the imperative shell it feeds. `document` is only ever
// touched INSIDE a factory, never at module load, so a node require needs no DOM.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionMentionUI = api; // sandboxed renderer global
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
  const pure = need("./session-mention.js", "DoplSessionMention");
  const render = need("./session-render.js", "DoplSessionRender");
  const chrome = need("./session-chrome.js", "DoplSessionChrome");

  function el(tag, className, text) {
    return render.el(tag, className, text);
  }
  function attr(node, key, value) {
    if (node && typeof node.setAttribute === "function") node.setAttribute(key, value);
  }
  // FIX F12: an EMPTY aria-activedescendant is still a present attribute pointing at no
  // element, which some screen readers announce as a broken reference. A closed listbox has
  // no active descendant, so the attribute is removed rather than blanked.
  function dropAttr(node, key) {
    if (node && typeof node.removeAttribute === "function") node.removeAttribute(key);
  }
  // A synthetic event from a test harness may carry no preventDefault (§ the boot-dom stub
  // idiom): guard it rather than throwing inside a keystroke.
  function prevent(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  }

  // ── the tag popup ───────────────────────────────────────────────────────────
  // Owns its own input / blur / mousedown / mouseenter listeners; it deliberately does NOT
  // register keydown — session.js delegates to handleKey() FIRST inside the composer's one
  // existing keydown handler, so Enter-to-accept and Enter-to-send can never both fire.
  function attach(spec) {
    const o = spec || {};
    const input = o.input;
    const host = o.host;
    const getOptions = typeof o.getOptions === "function" ? o.getOptions : () => [];
    const onAccept = typeof o.onAccept === "function" ? o.onAccept : noop;
    let pop = pure.initialPopup();

    // The boot harnesses' textarea stub has no selectionStart; the end of the value is where
    // a keystroke leaves the caret anyway.
    const caretOf = () =>
      typeof input.selectionStart === "number" ? input.selectionStart : String(input.value || "").length;

    function row(opt, i) {
      const sel = i === pop.index;
      const node = el("div", "mention-opt" + (sel ? " is-sel" : ""));
      attr(node, "id", "mentionOpt" + i);
      attr(node, "role", "option");
      attr(node, "aria-selected", sel ? "true" : "false");
      node.appendChild(el("span", "mention-opt__slug", "@" + opt.slug));
      node.appendChild(el("span", "mention-opt__hint", opt.label));
      // mousedown (not click) so the pick lands BEFORE the field's blur; preventDefault
      // first, so the composer never loses focus at all.
      node.addEventListener("mousedown", (e) => {
        prevent(e);
        accept(i);
      });
      node.addEventListener("mouseenter", () => {
        pop = pure.reducePopup(pop, { type: "move", delta: i - pop.index });
        paint();
      });
      return node;
    }

    function paint() {
      if (!host) return;
      if (!pop.open) {
        host.classList.add("hidden");
        host.replaceChildren();
        attr(input, "aria-expanded", "false");
        dropAttr(input, "aria-activedescendant");
        return;
      }
      const rows = pop.matches.map(row);
      // FIX F12: the label is a non-option child of a role="listbox", which is an invalid
      // child in the ARIA pattern (a listbox owns options). role="presentation" drops it out
      // of the accessibility tree so the row count a screen reader reports is the real one.
      const label = el("div", "mention-pop__label", pure.POPUP_LABEL);
      attr(label, "role", "presentation");
      host.replaceChildren(label, ...rows);
      host.classList.remove("hidden");
      attr(input, "aria-expanded", "true");
      attr(input, "aria-activedescendant", "mentionOpt" + pop.index);
    }

    // Accepting INSERTS the tag and nothing else: it never sends. The caret is only moved
    // when the field really has setSelectionRange (the stub does not).
    function accept(index) {
      const opt = pop.matches[index == null ? pop.index : index];
      if (!opt) return;
      const applied = pure.applyMention(input.value, { start: pop.start, end: pop.end }, opt);
      input.value = applied.value;
      if (typeof input.setSelectionRange === "function") input.setSelectionRange(applied.caret, applied.caret);
      pop = pure.reducePopup(pop, { type: "close" });
      paint();
      onAccept();
    }

    function sync() {
      pop = pure.reducePopup(pop, { type: "sync", value: input.value, caret: caretOf(), options: getOptions() });
      paint();
    }

    function close() {
      pop = pure.reducePopup(pop, { type: "close" });
      paint();
    }

    // TRUE means "consumed": session.js returns immediately and its Enter-sends branch is
    // never reached. Shift+Enter is NEVER consumed (it stays a newline).
    function handleKey(e) {
      const key = e && e.key;
      if (key === "Escape" && pop.open) {
        close();
        prevent(e);
        return true;
      }
      if (!pop.open) return false;
      if (key === "ArrowDown" || key === "ArrowUp") {
        pop = pure.reducePopup(pop, { type: "move", delta: key === "ArrowDown" ? 1 : -1 });
        paint();
        prevent(e);
        return true;
      }
      if (key === "Tab" || (key === "Enter" && e.shiftKey !== true)) {
        prevent(e);
        accept();
        return true;
      }
      return false;
    }

    if (input && typeof input.addEventListener === "function") {
      input.addEventListener("input", sync);
      input.addEventListener("blur", close);
    }
    if (host) host.classList.add("hidden");
    return { handleKey, isOpen: () => pop.open === true };
  }

  // ── the peer_message bubble ─────────────────────────────────────────────────
  // MY OWN words, addressed to the peer's agent: right-laned like the rest of this
  // machine's output (chrome.laneClass keys on the kind, never on the text), with a status
  // line instead of controls — there is no decision to make, only an outcome to report.
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
  // ONE object over the popup + the pure address parse. The options are re-derived on every
  // read so a late `init` (the peer name arrives with it) needs no re-wiring.
  function createComposer(spec) {
    const o = spec || {};
    const peerName = typeof o.getPeerName === "function" ? o.getPeerName : () => "";
    const getOptions = () => pure.tagOptions({ peerName: peerName() });
    const popup = attach({ input: o.input, host: o.host, getOptions, onAccept: o.onAccept });
    return {
      handleKey: popup.handleKey,
      isOpen: popup.isOpen,
      address: (raw) => pure.parseAddress(raw, getOptions()),
      peerTagged: () => pure.hasPeerTag(o.input ? o.input.value : "", getOptions()),
    };
  }

  return { attach, makePeerMessage, createComposer };
});

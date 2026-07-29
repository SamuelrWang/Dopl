// Dopl session window — DOM item factories (extracted from session.js so both
// the controller and this file stay under the HARD 500-line cap).
//
// SECURITY: every agent / counterparty / tool / consent string reaches the DOM
// via textContent (or as a value on a form control) ONLY. There is NO innerHTML,
// no template interpolation, no HTML parsing of untrusted text anywhere in this
// file. The pure decision logic lives in session-viewmodel.js; this module is
// the imperative DOM layer it feeds.
//
// UMD-wrapped like session-viewmodel.js: as a sandboxed-renderer <script> it
// attaches `globalThis.DoplSessionRender`; under node --test it is require()d.
// `document` is only ever touched INSIDE a factory (never at module load), so a
// node require never needs a DOM — the tests assert this file structurally.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionRender = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const noop = function () {};

  // ── shared DOM/format helpers ──────────────────────────────────────────────
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function cap(s) {
    return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "";
  }

  function pretty(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch (_err) {
      return String(v);
    }
  }

  // First letter of a name, for the counterparty avatar fallback.
  function initial(name) {
    const s = name == null ? "" : String(name).trim();
    return s ? s.charAt(0).toUpperCase() : "?";
  }

  // The live per-author avatar for a role key ('self' | 'peer'), read from the
  // controller-supplied ctx. Returns a bounded `data:` URI or null. ctx-optional
  // so a factory called without a ctx (e.g. a mock/test) degrades to initials.
  function avatarForKey(ctx, key) {
    return ctx && typeof ctx.avatarFor === "function" ? ctx.avatarFor(key) : null;
  }

  // The avatar node for a bubble (item 1/5/6). SECURITY: `img.src` is set to the
  // passed value ONLY when it is a `data:` URI — a remote/http string can NEVER
  // reach `img.src` (it falls through to the initials span), so the CSP
  // `img-src 'self' data:` is never challenged and no URL from untrusted content
  // is ever loaded. NEVER innerHTML. Falls back to the `.cp-avatar` initials
  // recipe when no data URI is available yet (cold cache) or none exists.
  function avatarNode(dataUri, initialsText) {
    if (typeof dataUri === "string" && dataUri.slice(0, 5) === "data:") {
      const wrap = el("span", "av");
      const img = el("img", "av-img");
      img.setAttribute("alt", "");
      img.setAttribute("src", dataUri); // data: URI ONLY (never a remote URL)
      wrap.appendChild(img);
      return wrap;
    }
    return el("span", "cp-avatar", initialsText == null ? "" : String(initialsText));
  }

  const ROLE = {
    assistant: { who: "Agent", cls: "role-agent" },
    agent: { who: "Agent", cls: "role-agent" },
    operator: { who: "You", cls: "role-operator" },
  };

  // ── stream item factories: each returns { el, update(item) } ───────────────
  // Every avatar-bearing factory holds a reference to its avatar node so update()
  // can RE-APPLY it in place — a late `avatars` event repaints already-rendered
  // bubbles (initials → the real photo) without rebuilding the whole item.
  function makeTurn(item, ctx) {
    const role = ROLE[item.role] || { who: cap(item.role), cls: "role-agent" };
    const root = el("div", "bubble " + role.cls);
    const head = el("div", "cp-head");
    // agent/operator turns are both ME → the SELF photo (item 1/5/6).
    let av = avatarNode(avatarForKey(ctx, item.avatarKey), initial(role.who));
    head.appendChild(av);
    head.appendChild(el("span", "who", role.who));
    root.appendChild(head);
    const body = el("span", "body", item.text || "");
    root.appendChild(body);
    const update = (it) => {
      body.textContent = it.text || "";
      root.classList.toggle("is-streaming", it.streaming === true);
      const next = avatarNode(avatarForKey(ctx, it.avatarKey), initial(role.who));
      head.replaceChild(next, av);
      av = next;
    };
    update(item);
    return { el: root, update };
  }

  // The peer's inbound reply — a distinct left lane. The avatar is the PEER photo
  // (item 1/5/6), falling back to the initials-on-token recipe (item 1).
  function makeCounterparty(item, ctx) {
    const root = el("div", "bubble role-counterparty");
    const head = el("div", "cp-head");
    let av = avatarNode(avatarForKey(ctx, "peer"), initial(item.from));
    head.appendChild(av);
    head.appendChild(el("span", "who", item.from || "Counterparty"));
    root.appendChild(head);
    root.appendChild(el("span", "body", item.text || ""));
    const update = () => {
      const next = avatarNode(avatarForKey(ctx, "peer"), initial(item.from));
      head.replaceChild(next, av);
      av = next;
    };
    return { el: root, update };
  }

  // What MY agent SENT to the peer (op=post) — a distinct styled COMPONENT (item
  // 4): a banner band (self avatar + an uppercase "SENT TO {peer}" label) over the
  // posted body, clearly differentiated from narration. `to` absent → the
  // "Posted to channel" label (resolved O-6). textContent-only; the avatar is a
  // `data:` <img>.
  function makeOutbound(item, ctx) {
    const root = el("div", "outbound role-outbound");
    const banner = el("div", "outbound__banner");
    let av = avatarNode(avatarForKey(ctx, "self"), "Y");
    banner.appendChild(av);
    const label = item.to ? "Sent to " + item.to : "Posted to channel";
    banner.appendChild(el("span", "outbound__label text-label", label));
    root.appendChild(banner);
    root.appendChild(el("div", "outbound__body", item.text || ""));
    const update = () => {
      const next = avatarNode(avatarForKey(ctx, "self"), "Y");
      banner.replaceChild(next, av);
      av = next;
    };
    return { el: root, update };
  }

  function makeNotice(item) {
    return { el: el("div", "notice level-" + (item.level || "error"), item.text || ""), update: noop };
  }

  // Item 8: the head (name + op summary + status) is ALWAYS visible; the input
  // and result live inside ONE native <details>, default CLOSED — so long/scary
  // tool output never blasts into the window until the user expands. Expanded
  // output SCROLLS (session.css caps the pre/.tool-result at 240px;overflow:auto).
  function makeTool(item, ctx) {
    const shortName = (ctx && ctx.vm && ctx.vm.shortToolName) || ((n) => n);
    const root = el("div", "tool-card");
    const head = el("div", "tool-card__head");
    head.appendChild(el("span", "tool-card__name", shortName(item.name)));
    head.appendChild(el("span", "tool-card__summary", item.inputSummary || ""));
    const status = el("span", "tool-status is-pending", "Running");
    head.appendChild(status);
    root.appendChild(head);

    // The body is the <details> itself (default closed — no `open` attribute).
    const details = el("details", "tool-card__body");
    details.appendChild(el("summary", null, "Show details"));
    details.appendChild(el("div", "tool-io-label", "Input"));
    details.appendChild(el("pre", null, pretty(item.inputFull)));
    const result = el("div", "tool-result hidden");
    details.appendChild(result);
    root.appendChild(details);

    const update = (it) => {
      const st = it.status || "pending";
      status.className = "tool-status is-" + st;
      status.textContent = st === "ok" ? "Done" : st === "error" ? "Failed" : "Running";
      if (it.resultSummary != null && it.resultSummary !== "") {
        result.textContent = it.resultSummary;
        result.classList.remove("hidden");
      }
    };
    update(item);
    return { el: root, update };
  }

  function makeInboundPending(item, ctx) {
    const onRelease = (ctx && ctx.onRelease) || noop;
    const root = el("div", "inbound-pending");
    root.appendChild(el("span", "who", (item.from || "Counterparty") + " — awaiting release"));
    root.appendChild(el("span", "body", item.text || ""));
    const row = el("div", "row");
    const btn = el("button", "ctl btn-light ctl-sm", "Release into session");
    btn.type = "button";
    btn.addEventListener("click", () => onRelease(item.pendingId));
    row.appendChild(btn);
    root.appendChild(row);
    const update = (it) => {
      root.classList.toggle("is-released", it.released === true);
      btn.disabled = it.released === true;
      if (it.released) btn.textContent = "Released";
    };
    update(item);
    return { el: root, update };
  }

  // The pre-consent request card (item 8). Renders ONLY the request text +
  // Accept/Deny — no agent content until Accept adopts the window. update()
  // shows a terminal note (denied/expired) or the local "Starting…" state.
  function makeConsent(consent, ctx) {
    const onDecide = (ctx && ctx.onConsentDecide) || noop;
    const root = el("div", "consent-card bento");

    const head = el("div", "consent-card__head");
    head.appendChild(el("span", "lbl", "Incoming request"));
    head.appendChild(el("span", "from", consent.from || "A collaborator"));
    root.appendChild(head);

    const body = el("div", "consent-card__body");
    if (consent.taskTitle) body.appendChild(el("div", "consent-task text-title", consent.taskTitle));
    if (consent.summary) body.appendChild(el("div", "consent-summary", consent.summary));
    if (consent.bodyText) {
      const well = el("div", "consent-body concave-field");
      well.appendChild(el("div", "consent-body__text", consent.bodyText));
      body.appendChild(well);
    }

    const meta = el("div", "consent-meta");
    meta.appendChild(metaItem("Channel", consent.channelName));
    meta.appendChild(metaItem("Profile", consent.toolProfileLabel));
    meta.appendChild(metaItem("Folder", consent.cwdLabel));
    body.appendChild(meta);

    const note = el("div", "consent-note hidden");
    body.appendChild(note);

    const actions = el("div", "consent-actions");
    const accept = el("button", "ctl auth-btn-3d ctl-primary", "Accept");
    accept.type = "button";
    const deny = el("button", "ctl btn-light ctl-danger", "Deny");
    deny.type = "button";
    const lock = (msg) => {
      accept.disabled = true;
      deny.disabled = true;
      if (msg != null) {
        note.textContent = msg;
        note.classList.remove("hidden");
      }
    };
    accept.addEventListener("click", () => {
      lock("Starting the session…");
      onDecide("accept");
    });
    deny.addEventListener("click", () => {
      lock("Declining the request…");
      onDecide("deny");
    });
    actions.appendChild(accept);
    actions.appendChild(deny);
    body.appendChild(actions);
    root.appendChild(body);

    // Terminal note when a decision lands (here or elsewhere). accepted → the
    // init/status events take over (this card is hidden by the controller).
    const update = (decision) => {
      if (!decision) return;
      const text =
        decision === "denied"
          ? "Request declined."
          : decision === "expired"
            ? "This request expired."
            : "Starting the session…";
      lock(text);
    };
    return { el: root, update };
  }

  function metaItem(k, v) {
    const item = el("span", "consent-meta__item");
    item.appendChild(el("span", "k", k));
    item.appendChild(el("span", "v", v || "—"));
    return item;
  }

  // The stream-item factory map, bound with the controller-supplied context
  // (vm helpers + the release callback). Consent is NOT a stream item — it is a
  // full render state — so it is not in this map.
  function makeFactories(ctx) {
    const bind = (fn) => (item) => fn(item, ctx);
    return {
      turn: bind(makeTurn),
      tool: bind(makeTool),
      counterparty: bind(makeCounterparty),
      outbound: bind(makeOutbound),
      inbound_pending: bind(makeInboundPending),
      notice: makeNotice,
    };
  }

  return {
    el,
    cap,
    pretty,
    initial,
    avatarNode,
    makeTurn,
    makeTool,
    makeCounterparty,
    makeOutbound,
    makeInboundPending,
    makeConsent,
    makeNotice,
    makeFactories,
  };
});

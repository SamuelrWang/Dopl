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

  const ROLE = {
    assistant: { who: "Agent", cls: "role-agent" },
    agent: { who: "Agent", cls: "role-agent" },
    operator: { who: "You", cls: "role-operator" },
  };

  // ── stream item factories: each returns { el, update(item) } ───────────────
  function makeTurn(item) {
    const role = ROLE[item.role] || { who: cap(item.role), cls: "role-agent" };
    const root = el("div", "bubble " + role.cls);
    root.appendChild(el("span", "who", role.who));
    const body = el("span", "body", item.text || "");
    root.appendChild(body);
    const update = (it) => {
      body.textContent = it.text || "";
      root.classList.toggle("is-streaming", it.streaming === true);
    };
    update(item);
    return { el: root, update };
  }

  // The peer's inbound reply — a distinct left lane with an initials avatar
  // styled like the web Avatar fallback (item 1).
  function makeCounterparty(item) {
    const root = el("div", "bubble role-counterparty");
    const head = el("div", "cp-head");
    head.appendChild(el("span", "cp-avatar", initial(item.from)));
    head.appendChild(el("span", "who", item.from || "Counterparty"));
    root.appendChild(head);
    root.appendChild(el("span", "body", item.text || ""));
    return { el: root, update: noop };
  }

  // What MY agent sent to the peer (op=post) — reads as an outgoing message,
  // clearly NOT narration and NOT a tool card (item 2). `to` absent → the
  // "Posted to channel" label (resolved O-6).
  function makeOutbound(item) {
    const root = el("div", "outbound role-outbound");
    const head = item.to ? "Sent to " + item.to : "Posted to channel";
    root.appendChild(el("span", "sent-to text-label", head));
    root.appendChild(el("span", "body", item.text || ""));
    return { el: root, update: noop };
  }

  function makeNotice(item) {
    return { el: el("div", "notice level-" + (item.level || "error"), item.text || ""), update: noop };
  }

  function makeTool(item, ctx) {
    const shortName = (ctx && ctx.vm && ctx.vm.shortToolName) || ((n) => n);
    const root = el("div", "tool-card");
    const head = el("div", "tool-card__head");
    head.appendChild(el("span", "tool-card__name", shortName(item.name)));
    head.appendChild(el("span", "tool-card__summary", item.inputSummary || ""));
    const status = el("span", "tool-status is-pending", "Running");
    head.appendChild(status);
    root.appendChild(head);

    const bodyWrap = el("div", "tool-card__body");
    const details = el("details");
    details.appendChild(el("summary", null, "Show input"));
    details.appendChild(el("pre", null, pretty(item.inputFull)));
    bodyWrap.appendChild(details);
    const result = el("div", "tool-result hidden");
    bodyWrap.appendChild(result);
    root.appendChild(bodyWrap);

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
      turn: makeTurn,
      tool: bind(makeTool),
      counterparty: makeCounterparty,
      outbound: makeOutbound,
      inbound_pending: bind(makeInboundPending),
      notice: makeNotice,
    };
  }

  return {
    el,
    cap,
    pretty,
    initial,
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

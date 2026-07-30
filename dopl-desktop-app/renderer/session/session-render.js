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

  // The pure chrome layer owns the item-kind → chat-lane mapping. It is reached the
  // same way session-chrome.js reaches the view-model: a require() under node, the
  // renderer global in the sandbox (session.html loads session-chrome.js first).
  const chrome =
    typeof module === "object" && typeof require === "function"
      ? require("./session-chrome.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionChrome) || null;

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

  // The chat lane for a stream item: `base` plus the lane class from the pure
  // kind→lane mapping (chrome.laneClass), or `base` alone when the item is not
  // conversational. Each factory passes the KIND it renders (the reducer stamps
  // the same one on every real item) so alignment can never key off item text.
  // A missing chrome module degrades to the un-laned, full-width class list.
  function lane(base, kindItem) {
    const cls = chrome && typeof chrome.laneClass === "function" ? chrome.laneClass(kindItem) : "";
    return cls ? base + " " + cls : base;
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
    // v2.7 L1: BOTH turn roles take the RIGHT lane — the operator's typed steer and the agent's
    // own text are this machine's output; only the peer's reply sits on the left. The lane class
    // comes from chrome.laneClass; the surface recipes (F2) are what tell the two roles apart.
    const root = el("div", lane("bubble " + role.cls, { kind: "turn", role: item.role }));
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
    const root = el("div", lane("bubble role-counterparty", { kind: "counterparty" }));
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
  // FIX F3: the bubble is painted while the tool_use streams, which is BEFORE the operator
  // answers the permission dock, so its label is not final. A denied or failed post flips
  // to "Not sent" (plus the muted `is-not-sent` surface) instead of standing there
  // claiming the peer received something that never left this machine.
  function outboundLabel(item) {
    if (item && item.status === "not_sent") return "Not sent";
    // v2.7 L3: a post still waiting on the operator has NOT been delivered, so it says so.
    if (item && item.status === "pending") return item.to ? "Sending to " + item.to : "Sending to the channel";
    return item && item.to ? "Sent to " + item.to : "Posted to channel";
  }

  // v2.7 L3 — the destination of the drafted post ("To: this channel" / "To: another
  // channel"), from the SAME pure v2.5 helpers the dock uses. Reached through ctx.vm like
  // shortToolName; a factory called without a ctx degrades to no destination line at all
  // (and therefore to no cross-channel marking, since there is nothing being claimed).
  function destOf(ctx, item) {
    const fn = ctx && ctx.vm && ctx.vm.postDestinationText;
    return typeof fn === "function" ? fn(item) : "";
  }
  // FAIL SUSPICIOUS, and note WHICH WAY this one fails: with no ctx.vm the destination line is
  // not rendered at all (destOf returns ""), so returning false here marks nothing rather than
  // marking a line that is not on screen. The suspicious default lives in the pure helper
  // (vm.isCrossChannelPost treats anything but an explicit ownChannel===true as another
  // channel), so a card that DOES show a destination can never under-claim the exfil shape.
  function crossOf(ctx, item) {
    const fn = ctx && ctx.vm && ctx.vm.isCrossChannelPost;
    return typeof fn === "function" && fn(item) === true;
  }

  // v2.7 L3 — the OUTBOUND DECISION CARD *is* the delivered record: ONE node, ONE stream
  // item per post attempt. While the post waits on canUseTool the root also carries
  // `outbound-pending` (its own accent band, the v2.5 destination line, and Send / Send for
  // this session / Deny); the decision RESOLVES IT IN PLACE — update() drops that class and
  // hides the row, so the node becomes exactly the delivered "Sent to X" bubble (or the
  // muted "Not sent" one). Nothing is rebuilt and nothing is removed, which is what makes
  // this safe under session.js's index-keyed renderStream (it only ever calls update()).
  // The three decisions map to the EXISTING dock verbs, so main's fail-closed
  // permission_decision mapping and the v2.5 scoped POST_GRANT are untouched.
  // v3.0 VOCABULARY: the middle verb reads "for this SESSION", which is what the grant has
  // always been — it lives on this session object and a park clears it (v2.9 FIX F1), while
  // the thread outlives every session that works it. `allow-task` is the IPC wire value and
  // is deliberately unchanged (wire name `task` == domain name `thread`).
  const OUT_BUTTONS = [
    { label: "Send", decision: "allow-once", cls: "ctl auth-btn-3d ctl-primary ctl-sm" },
    { label: "Send for this session", decision: "allow-task", cls: "ctl btn-light ctl-sm" },
    { label: "Deny", decision: "deny", cls: "ctl btn-light ctl-sm ctl-danger" },
  ];

  function makeOutbound(item, ctx) {
    const onDecide = (ctx && ctx.onOutboundDecide) || noop;
    let cur = item; // the LIVE item, so a click always decides the current requestId
    // FIX F7: a click DISABLES all three buttons immediately, before the invoke resolves, so a
    // fast double-click cannot send a second decision for the same requestId (main already
    // refuses one — it only dispatches a requestId it is still tracking — this closes the
    // window where nothing greys out). The next update() clears the flag, so the controller's
    // renderAll() on an {ok:false} refusal hands the buttons back on a card still answerable.
    let clicked = false;
    const root = el("div", "outbound role-outbound");
    const banner = el("div", "outbound__banner");
    let av = avatarNode(avatarForKey(ctx, "self"), "Y");
    banner.appendChild(av);
    const label = el("span", "outbound__label text-label", outboundLabel(item));
    banner.appendChild(label);
    root.appendChild(banner);
    // FIX #9 (v2.5) carried onto the card: WHERE this is going, read BEFORE the body.
    const dest = el("div", "outbound-pending__to text-caption hidden");
    root.appendChild(dest);
    root.appendChild(el("div", "outbound__body", item.text || ""));
    const row = el("div", "row");
    const buttons = OUT_BUTTONS.map((spec) => {
      const btn = el("button", spec.cls, spec.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (clicked) return;
        clicked = true;
        for (const b of buttons) b.disabled = true;
        onDecide(cur.requestId, spec.decision);
      });
      row.appendChild(btn);
      return btn;
    });
    root.appendChild(row);
    const update = (it) => {
      const next = avatarNode(avatarForKey(ctx, "self"), "Y");
      banner.replaceChild(next, av);
      av = next;
      cur = it || item;
      clicked = false;
      const pending = cur.status === "pending";
      // FAIL CLOSED: a card main is not awaiting (no requestId) cannot be answered.
      // FIX F3: and it does not show three DEAD buttons either. A post whose gate prediction
      // said "will stop" but which canUseTool then auto-allowed has no requestId while it waits
      // for main to resolve it (C6 now emits that resolution immediately; the tool_result is the
      // backstop), so the row is HIDDEN meanwhile instead of rendering a broken control set.
      const answerable = pending && !!cur.requestId;
      label.textContent = outboundLabel(cur);
      root.classList.toggle("outbound-pending", pending);
      root.classList.toggle("is-not-sent", cur.status === "not_sent");
      dest.textContent = pending ? destOf(ctx, cur) : "";
      dest.classList.toggle("hidden", !pending);
      dest.classList.toggle("is-cross", pending && crossOf(ctx, cur));
      row.classList.toggle("hidden", !answerable);
      for (const btn of buttons) btn.disabled = !answerable;
    };
    update(item); // a record created ALREADY pending / not-sent paints that way at once
    return { el: root, update };
  }

  function makeNotice(item) {
    return { el: el("div", "notice level-" + (item.level || "error"), item.text || ""), update: noop };
  }

  // Item 8 (v2.x reshape): the tool card ITSELF is the native <details>, default CLOSED, and
  // its <summary> IS the head line (name + op summary + status) — always visible AND the whole
  // disclosure control, with a LEFT ::before arrow (session.css) instead of a separate "Show
  // details" row + right chevron. The input + result live in the body wrapper after the summary,
  // so long/scary output never blasts into the window until the user expands (and then SCROLLS:
  // session.css caps the pre/.tool-result at 240px;overflow:auto). v2.7 L1: a tool card is MY
  // agent's own activity, so it takes the RIGHT lane like the rest of this machine's output.
  function makeTool(item, ctx) {
    const shortName = (ctx && ctx.vm && ctx.vm.shortToolName) || ((n) => n);
    const root = el("details", lane("tool-card", { kind: "tool" })); // <details>, default closed
    const head = el("summary", "tool-card__head"); // the summary IS the head line
    head.appendChild(el("span", "tool-card__name", shortName(item.name)));
    head.appendChild(el("span", "tool-card__summary", item.inputSummary || ""));
    const status = el("span", "tool-status is-pending", "Running");
    head.appendChild(status);
    root.appendChild(head);

    // The disclosed body: input + result, revealed only when the operator expands the summary.
    const body = el("div", "tool-card__body");
    body.appendChild(el("div", "tool-io-label", "Input"));
    body.appendChild(el("pre", null, pretty(item.inputFull)));
    const result = el("div", "tool-result hidden");
    body.appendChild(result);
    root.appendChild(body);

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

  // FIX (v2.x): the INITIATING request, pinned at the TOP of the transcript so the operator
  // sees the ask this session is answering — not just the reply + tool activity. DISPLAY ONLY:
  // main emits it once at session start and never feeds this item to the agent. A responder
  // shows the PEER's ask on the LEFT (counterparty recipe, peer avatar + name); a requester its
  // OWN opening goal on the RIGHT ("You"). It reuses the live bubble factories, so avatars, lanes
  // and the late-`avatars` repaint all behave identically; `is-request` marks it as the opener
  // (FIX F3: that class now HAS a rule in session.css — an unfilled surface + a hairline — so
  // the opener is visually distinguishable from a turn instead of being a dead marker).
  function makeRequest(item, ctx) {
    const rec =
      item.lane === "them"
        ? makeCounterparty({ from: item.from, text: item.text }, ctx)
        : makeTurn({ role: "operator", text: item.text, avatarKey: "self" }, ctx);
    rec.el.classList.add("is-request");
    return rec;
  }

  // v2.5 D1: the INBOUND GATE card. A counterparty message that has NOT reached the
  // agent, shown with the three decisions the operator has: Accept (feed it once),
  // Accept for this session (feed it and every later reply until this session parks or
  // ends), Decline (drop it locally — nothing is posted back to the peer). The card locks
  // and states the outcome once a decision lands, here or from an auto-accept echo. Same
  // visual language as the old release card + the permission dock. textContent only.
  // v3.0: the verb says SESSION because a park clears the grant (v2.9 FIX F1) while the
  // thread carries on; `accept-task` / `accepted-task` stay as the IPC wire values.
  const GATE_DONE = { accepted: "Accepted", "accepted-task": "Accepted for this session", declined: "Declined" };

  function makeInboundPending(item, ctx) {
    const onDecide = (ctx && ctx.onInboundDecide) || noop; // FIX F10: no dead alias path
    const root = el("div", "inbound-pending");
    root.appendChild(el("span", "who", (item.from || "Counterparty") + " sent a message"));
    root.appendChild(el("span", "body", item.text || ""));
    const note = el("div", "inbound-pending__note hidden");
    const row = el("div", "row");
    const buttons = [
      { label: "Accept", decision: "accept", cls: "ctl auth-btn-3d ctl-primary ctl-sm" },
      { label: "Accept for this session", decision: "accept-task", cls: "ctl btn-light ctl-sm" },
      { label: "Decline", decision: "decline", cls: "ctl btn-light ctl-sm ctl-danger" },
    ].map((spec) => {
      const btn = el("button", spec.cls, spec.label);
      btn.type = "button";
      btn.addEventListener("click", () => onDecide(item.pendingId, spec.decision));
      row.appendChild(btn);
      return btn;
    });
    root.appendChild(row);
    root.appendChild(note);
    const update = (it) => {
      const done = it.decision ? GATE_DONE[it.decision] || GATE_DONE.declined : null;
      root.classList.toggle("is-released", it.released === true);
      root.classList.toggle("is-declined", it.decision === "declined");
      for (const btn of buttons) btn.disabled = !!done;
      if (done) {
        note.textContent = done;
        note.classList.remove("hidden");
      }
    };
    update(item);
    return { el: root, update };
  }

  // v2.5 D3: a READ-ONLY history entry replayed from the channel thread. Deliberately
  // the muted twin of a live bubble (the lane class still aligns it) so it reads as
  // "earlier" at a glance and carries no controls at all.
  function makeHistory(item) {
    const root = el("div", lane("bubble history-entry", { kind: "history", lane: item.lane }));
    root.appendChild(el("span", "who", item.from || (item.lane === "them" ? "Counterparty" : "You")));
    root.appendChild(el("span", "body", item.text || ""));
    return { el: root, update: noop };
  }

  // The single divider that introduces the replayed history (copy from the view-model).
  function makeHistoryDivider(item) {
    return { el: el("div", "history-divider", item.text || ""), update: noop };
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
      request: bind(makeRequest), // FIX (v2.x): the initiating ask, pinned at the top
      counterparty: bind(makeCounterparty),
      outbound: bind(makeOutbound),
      inbound_pending: bind(makeInboundPending),
      history: makeHistory, // v2.5 D3 (read-only; needs no ctx)
      history_divider: makeHistoryDivider,
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
    makeRequest, // FIX (v2.x): the initiating request item
    makeCounterparty,
    makeOutbound,
    outboundLabel, // FIX F3
    makeInboundPending,
    makeHistory,
    makeHistoryDivider,
    makeConsent,
    makeNotice,
    makeFactories,
  };
});

// Dopl session window — renderer shell (imperative DOM over the pure view-model).
//
// SECURITY: every agent / counterparty / tool string reaches the DOM via
// textContent (or as a value on a form control). There is NO innerHTML, no
// template interpolation, no HTML parsing of untrusted text anywhere in this
// file. All decision logic lives in session-viewmodel.js (pure, tested).

(function () {
  "use strict";

  const vm = globalThis.DoplSessionVM;

  // Bridge (contextIsolation preload). A no-op stub lets session.html open
  // standalone for manual/mock testing; window.__sessionFeed drives a mock stream.
  const noop = function () {};
  const bridge = window.doplSession || {
    sessionId: "",
    onEvent: noop,
    send: noop,
    permission: noop,
    releaseInbound: noop,
    interrupt: noop,
    end: noop,
    closeTask: noop,
  };

  // ── DOM refs ────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const els = {
    channelName: $("channelName"),
    taskTitle: $("taskTitle"),
    badgeRow: $("badgeRow"),
    statusDot: $("statusDot"),
    statusLabel: $("statusLabel"),
    statusMeta: $("statusMeta"),
    turnCost: $("turnCost"),
    totalCost: $("totalCost"),
    turnCount: $("turnCount"),
    stream: $("stream"),
    dock: $("permissionDock"),
    permTool: $("permTool"),
    permSummary: $("permSummary"),
    permInput: $("permInput"),
    permDetails: $("permDetails"),
    permQueueNote: $("permQueueNote"),
    endedBanner: $("endedBanner"),
    steerInput: $("steerInput"),
    interject: $("interjectToggle"),
    closePanel: $("closePanel"),
    closeSummary: $("closeSummary"),
    outcomeSeg: $("outcomeSeg"),
  };

  let state = vm.initialState();
  let closeOutcome = "completed";

  // ── formatting helpers ───────────────────────────────────────────────────
  const usd = (n) => "$" + (Number(n) || 0).toFixed(4);
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
  const PHASE_LABEL = {
    launching: "Launching",
    running: "Running",
    awaiting_permission: "Awaiting permission",
    awaiting_inbound: "Awaiting reply",
    interrupted: "Interrupted",
    ended: "Ended",
  };
  const ROLE = {
    assistant: { who: "Agent", cls: "role-agent" },
    agent: { who: "Agent", cls: "role-agent" },
    operator: { who: "You", cls: "role-operator" },
    counterparty: { who: "Counterparty", cls: "role-counterparty" },
  };

  function pretty(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch (_err) {
      return String(v);
    }
  }

  // Small DOM helper — creates an element with a class and optional text.
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── stream item factories: each returns { el, update(item) } ─────────────
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

  function makeInbound(item) {
    const root = el("div", "bubble role-counterparty");
    root.appendChild(el("span", "who", item.from || "Counterparty"));
    root.appendChild(el("span", "body", item.text || ""));
    return { el: root, update: noop };
  }

  function makeNotice(item) {
    return { el: el("div", "notice level-" + (item.level || "error"), item.text || ""), update: noop };
  }

  function makeTool(item) {
    const root = el("div", "tool-card");
    const head = el("div", "tool-card__head");
    head.appendChild(el("span", "tool-card__name", vm.shortToolName(item.name)));
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

  function makeInboundPending(item) {
    const root = el("div", "inbound-pending");
    root.appendChild(el("span", "who", (item.from || "Counterparty") + " — awaiting release"));
    root.appendChild(el("span", "body", item.text || ""));
    const row = el("div", "row");
    const btn = el("button", "ctl btn-light ctl-sm", "Release into session");
    btn.type = "button";
    btn.addEventListener("click", () => {
      bridge.releaseInbound(item.pendingId);
      state = vm.markInboundReleased(state, item.pendingId);
      renderAll();
    });
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

  const FACTORY = {
    turn: makeTurn,
    tool: makeTool,
    inbound: makeInbound,
    inbound_pending: makeInboundPending,
    notice: makeNotice,
  };

  // Reconcile the stream by index: create missing nodes, update existing ones.
  const rendered = [];
  function renderStream() {
    const pinned =
      els.stream.scrollHeight - els.stream.scrollTop - els.stream.clientHeight < 48;
    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      if (!rendered[i]) {
        const make = FACTORY[item.kind] || makeNotice;
        const rec = make(item);
        rendered[i] = rec;
        els.stream.appendChild(rec.el);
      } else {
        rendered[i].update(item);
      }
    }
    if (pinned) els.stream.scrollTop = els.stream.scrollHeight;
  }

  // ── header / status / cost ───────────────────────────────────────────────
  function renderInit() {
    const info = state.init;
    if (!info) return;
    els.channelName.textContent = info.channelName || "Session";
    els.taskTitle.textContent = info.taskTitle || "";
    document.title = "Dopl — " + (info.channelName || "Session");

    const badges = [info.side, info.profile, info.mode].filter(Boolean);
    if (els.badgeRow.childElementCount !== badges.length) {
      els.badgeRow.replaceChildren();
      for (const b of badges) els.badgeRow.appendChild(el("span", "badge", b));
    }
  }

  function renderStatus() {
    const phase = state.phase || "launching";
    els.statusDot.className = "status-dot is-" + phase;
    els.statusLabel.textContent = PHASE_LABEL[phase] || cap(phase);
    const info = state.init || {};
    const model = (state.usage && state.usage.model) || info.model || "";
    const meta = [model, info.cwdLabel].filter(Boolean).join("  ·  ");
    els.statusMeta.textContent = meta;
  }

  function renderCost() {
    const u = state.usage;
    els.turnCost.textContent = usd(u && u.turnCostUsd);
    els.totalCost.textContent = usd(u && u.totalCostUsd);
    els.turnCount.textContent = String((u && u.turns) || 0);
  }

  // ── permission dock ──────────────────────────────────────────────────────
  function renderPermission() {
    const p = vm.nextPermission(state);
    if (!p || state.ended) {
      els.dock.classList.remove("is-active");
      return;
    }
    els.dock.classList.add("is-active");
    els.permTool.textContent = p.name || "";
    els.permSummary.textContent = p.inputSummary || "";
    els.permInput.textContent = pretty(p.inputFull);
    const extra = state.permissions.length - 1;
    if (extra > 0) {
      els.permQueueNote.textContent = "+" + extra + " more waiting";
      els.permQueueNote.classList.remove("hidden");
    } else {
      els.permQueueNote.classList.add("hidden");
    }
  }

  function decide(decision) {
    const p = vm.nextPermission(state);
    if (!p) return;
    bridge.permission(p.requestId, decision);
    state = vm.reduceEvent(state, { type: "permission_resolved", requestId: p.requestId, decision });
    renderAll();
  }

  // ── ended ────────────────────────────────────────────────────────────────
  function renderEnded() {
    if (!state.ended) {
      app.classList.remove("is-ended");
      return;
    }
    app.classList.add("is-ended");
    const e = state.ended;
    const parts = ["Session ended"];
    if (e.reason) parts.push("(" + e.reason + ")");
    if (e.outcome) parts.push("· " + e.outcome);
    if (e.summary) parts.push("— " + e.summary);
    parts.push("· total " + usd(e.totalCostUsd));
    els.endedBanner.textContent = parts.join(" ");
  }

  function renderAll() {
    renderInit();
    renderStatus();
    renderCost();
    renderStream();
    renderPermission();
    renderEnded();
  }

  // ── composer / controls wiring ───────────────────────────────────────────
  function sendSteer() {
    const text = els.steerInput.value.trim();
    if (!text || state.ended) return;
    const priority = els.interject.checked ? "now" : "normal";
    bridge.send(text, priority);
    state = vm.reduceEvent(state, { type: "turn", role: "operator", text, streaming: false });
    els.steerInput.value = "";
    els.interject.checked = false;
    renderAll();
  }

  function wire() {
    $("btnSend").addEventListener("click", sendSteer);
    els.steerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendSteer();
      }
    });

    $("btnStop").addEventListener("click", () => bridge.interrupt());
    $("btnEnd").addEventListener("click", () => bridge.end());

    $("btnAllowOnce").addEventListener("click", () => decide("allow-once"));
    $("btnAllowTask").addEventListener("click", () => decide("allow-task"));
    $("btnDeny").addEventListener("click", () => decide("deny"));

    // Close-task panel.
    $("btnClose").addEventListener("click", () => els.closePanel.classList.toggle("is-open"));
    $("btnCloseCancel").addEventListener("click", () => els.closePanel.classList.remove("is-open"));
    $("btnCloseConfirm").addEventListener("click", () => {
      bridge.closeTask(closeOutcome, els.closeSummary.value.trim());
      els.closePanel.classList.remove("is-open");
    });
    els.outcomeSeg.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      closeOutcome = btn.getAttribute("data-outcome") || "completed";
      for (const b of els.outcomeSeg.querySelectorAll(".seg-btn")) {
        const on = b === btn;
        b.classList.toggle("is-sel", on);
        b.classList.toggle("raised-tab", on);
      }
    });
  }

  // Manual/mock hook: window.__sessionFeed({type:'turn', ...}) drives the UI
  // without the engine — used by the standalone-open verification.
  window.__sessionFeed = function (evt) {
    state = vm.reduceEvent(state, evt);
    renderAll();
  };

  bridge.onEvent((evt) => {
    state = vm.reduceEvent(state, evt);
    renderAll();
  });

  wire();
  renderAll();
})();

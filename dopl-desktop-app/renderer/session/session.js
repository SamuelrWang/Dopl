// Dopl session window — renderer controller (imperative DOM over the pure
// view-model + the DOM factories in session-render.js).
//
// SECURITY: every agent / counterparty / tool / consent string reaches the DOM
// via textContent (or as a value on a form control). There is NO innerHTML, no
// template interpolation, no HTML parsing of untrusted text anywhere in this
// file or session-render.js. All decision logic lives in session-viewmodel.js
// (pure, tested); the DOM factories live in session-render.js.

(function () {
  "use strict";

  const vm = globalThis.DoplSessionVM;
  const render = globalThis.DoplSessionRender;
  const { el, pretty } = render;

  // Bridge (contextIsolation preload). A no-op stub lets session.html open
  // standalone for manual/mock testing; window.__sessionFeed drives a mock stream.
  const noop = function () {};
  const resolved = () => Promise.resolve({ label: null });
  const bridge = window.doplSession || {
    sessionId: "",
    onEvent: noop,
    send: noop,
    permission: noop,
    releaseInbound: noop,
    interrupt: noop,
    end: noop,
    closeTask: noop,
    consentDecision: noop,
    folder: { get: resolved, choose: resolved, clear: resolved },
  };
  const folderBridge = bridge.folder || { get: resolved, choose: resolved, clear: resolved };

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
    folderLabel: $("folderLabel"),
    folderNote: $("folderNote"),
    stream: $("stream"),
    dock: $("permissionDock"),
    permTool: $("permTool"),
    permSummary: $("permSummary"),
    permInput: $("permInput"),
    permQueueNote: $("permQueueNote"),
    consentView: $("consentView"),
    endedBanner: $("endedBanner"),
    steerInput: $("steerInput"),
    interject: $("interjectToggle"),
    closePanel: $("closePanel"),
    closeSummary: $("closeSummary"),
    outcomeSeg: $("outcomeSeg"),
  };

  let state = vm.initialState();
  let closeOutcome = "completed";

  // Context handed to the DOM factories: pure vm helpers + the two callbacks a
  // factory needs to reach the bridge (release + consent decision).
  const ctx = {
    vm,
    onRelease(pendingId) {
      bridge.releaseInbound(pendingId);
      state = vm.markInboundReleased(state, pendingId);
      renderAll();
    },
    onConsentDecide(decision) {
      bridge.consentDecision(decision);
    },
  };
  const FACTORY = render.makeFactories(ctx);

  // ── header / status / folder ──────────────────────────────────────────────
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
    els.statusDot.className = "status-dot " + vm.statusDotKey(state.phase, state.activity);
    els.statusLabel.textContent = vm.statusText(state.phase, state.activity);
    const info = state.init || {};
    els.statusMeta.textContent = info.model || "";
  }

  function renderFolder() {
    els.folderLabel.textContent = vm.folderLabel(state.folder);
  }

  // ── stream ─────────────────────────────────────────────────────────────────
  // Reconcile the stream by index: create missing nodes, update existing ones.
  const rendered = [];
  function renderStream() {
    const pinned =
      els.stream.scrollHeight - els.stream.scrollTop - els.stream.clientHeight < 48;
    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      if (!rendered[i]) {
        const make = FACTORY[item.kind] || render.makeNotice;
        const rec = make(item);
        rendered[i] = rec;
        els.stream.appendChild(rec.el);
      } else {
        rendered[i].update(item);
      }
    }
    if (pinned) els.stream.scrollTop = els.stream.scrollHeight;
  }

  // ── consent (pre-SDK request card) ─────────────────────────────────────────
  let consentRec = null;
  function renderConsent() {
    const active = state.phase === "consent" && !!state.consent;
    app.classList.toggle("is-consent", active);
    if (!active) return;
    if (!consentRec) {
      consentRec = render.makeConsent(state.consent, ctx);
      els.consentView.replaceChildren(consentRec.el);
    }
    if (state.consentResolved) consentRec.update(state.consentResolved.decision);
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
    els.endedBanner.textContent = parts.join(" ");
  }

  function renderAll() {
    renderInit();
    renderStatus();
    renderFolder();
    renderStream();
    renderConsent();
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

  // Apply a folder LABEL returned from the native picker / clear, and surface
  // the "applies to the next run" note (item 7 / O-7).
  function applyFolder(res) {
    if (!res || typeof res !== "object") return;
    state = vm.reduceEvent(state, { type: "folder", label: res.label });
    els.folderNote.classList.remove("hidden");
    renderAll();
  }

  function wireFolder() {
    $("btnFolderChange").addEventListener("click", () => {
      Promise.resolve(folderBridge.choose()).then(applyFolder).catch(noop);
    });
    $("btnFolderDefault").addEventListener("click", () => {
      Promise.resolve(folderBridge.clear()).then(applyFolder).catch(noop);
    });
    // Seed the chip from the stored dir (the engine also emits `folder` on init).
    Promise.resolve(folderBridge.get())
      .then((res) => {
        if (res && typeof res === "object") {
          state = vm.reduceEvent(state, { type: "folder", label: res.label });
          renderAll();
        }
      })
      .catch(noop);
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

    wireFolder();
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

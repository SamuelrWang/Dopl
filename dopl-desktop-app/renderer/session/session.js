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
  const chromeVm = globalThis.DoplSessionChrome;
  const render = globalThis.DoplSessionRender;
  const { pretty, initial, avatarNode } = render;

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
    setAutoApprove: noop,
    folder: { get: resolved, choose: resolved, clear: resolved },
  };
  const folderBridge = bridge.folder || { get: resolved, choose: resolved, clear: resolved };

  // ── DOM refs ────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const els = {
    peerAvatar: $("peerAvatar"),
    channelName: $("channelName"),
    taskTitle: $("taskTitle"),
    statusDot: $("statusDot"),
    statusLabel: $("statusLabel"),
    statusMeta: $("statusMeta"),
    permPosture: $("permPosture"),
    autoApprove: $("autoApprove"),
    folderLabel: $("folderLabel"),
    stream: $("stream"),
    dock: $("permissionDock"),
    permTool: $("permTool"),
    permSummary: $("permSummary"),
    permInput: $("permInput"),
    permQueueNote: $("permQueueNote"),
    consentView: $("consentView"),
    endedBanner: $("endedBanner"),
    steerInput: $("steerInput"),
    send: $("btnSend"),
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
    // The live per-author avatar for a bubble (item 1/5/6). Reads the CURRENT
    // `state` (reassigned per event) so a factory's update() always sees the
    // latest avatar — a late `avatars` event repaints existing bubbles.
    avatarFor(key) {
      if (key === "self") return state.selfAvatar || null;
      if (key === "peer") return state.peerAvatar || null;
      return null;
    },
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
  // D1: ONE identity priority (chromeVm.headerIdentity) drives the header title,
  // the subtitle, the avatar initials, and the native window title:
  //     taskTitle -> peer name (init.from) -> channelName -> "Session".
  // The avatar node is ALWAYS painted: the peer photo when one has arrived, else
  // initials on a token (the peer's, or the title's when there is no peer at all).
  // There is no black brand-mark fallback any more. Every string reaches the DOM
  // via textContent; the identity fields are one-lined + capped by the chrome
  // helper, so a counterparty-controlled name is bounded display data.
  function renderInit() {
    const info = state.init;
    if (!info) return;
    const id = chromeVm.headerIdentity(info);
    els.channelName.textContent = id.title;
    els.taskTitle.textContent = id.subtitle;
    // `has-img` lets the token span drop its padding/border so the photo fills
    // the round frame (item 1/5/6); initials otherwise.
    if (state.peerAvatar) {
      els.peerAvatar.replaceChildren(avatarNode(state.peerAvatar, initial(id.avatarName)));
      els.peerAvatar.classList.add("has-img");
    } else {
      els.peerAvatar.classList.remove("has-img");
      els.peerAvatar.textContent = initial(id.avatarName);
    }
    // The native title bar carries the same name (prefixed with the product).
    document.title = chromeVm.windowTitle(info);
  }

  function renderStatus() {
    els.statusDot.className = "status-dot " + vm.statusDotKey(state.phase, state.activity);
    els.statusLabel.textContent = vm.statusText(state.phase, state.activity);
    const info = state.init || {};
    els.statusMeta.textContent = info.model || "";
    // Permission posture (items 9 + 10): "Asking each time" / "Auto-approving",
    // with the profile label as context; the toggle reflects the echoed state.
    els.permPosture.textContent = vm.permissionModeText(state.autoApprove, info.profileLabel || info.profile);
    els.autoApprove.checked = state.autoApprove === true;
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

  // ── D5: the send button morphs into a pause control mid-turn ──────────────
  // One button, two states (chromeVm.sendButtonMode): idle shows the up-arrow glyph
  // and sends the steer; a running turn shows the pause glyph and interrupts the
  // agent. The glyphs are static inline SVG in session.html — CSS swaps which one
  // is visible, so nothing is ever built from a string here.
  function renderSend() {
    const mode = chromeVm.sendButtonMode(state);
    els.send.classList.toggle("is-running", mode === "pause");
    els.send.setAttribute("aria-label", chromeVm.sendButtonLabel(mode));
  }

  function renderAll() {
    renderInit();
    renderStatus();
    renderFolder();
    renderStream();
    renderConsent();
    renderPermission();
    renderSend();
    renderEnded();
  }

  // ── composer / controls wiring ───────────────────────────────────────────
  // The Interrupt checkbox is gone: a steer is ALWAYS 'normal' priority now (it
  // queues as the next turn), and interrupting is the pause button's job.
  function sendSteer() {
    const text = els.steerInput.value.trim();
    if (!text || state.ended) return;
    bridge.send(text);
    state = vm.reduceEvent(state, { type: "turn", role: "operator", text, streaming: false });
    els.steerInput.value = "";
    autoGrow(); // D7: back to a single line after send
    renderAll();
  }

  // Click = pause while the agent is mid-turn, send otherwise.
  function onSendClick() {
    if (chromeVm.sendButtonMode(state) === "pause") {
      bridge.interrupt();
      return;
    }
    sendSteer();
  }

  // ── D7: composer auto-grow (up to 3 line-heights, then scroll) ────────────
  // The cap math is pure (chromeVm.growHeight); this only measures the real
  // computed line-height + vertical padding and applies the returned px height.
  const MAX_COMPOSER_LINES = 3;
  function composerMetrics() {
    const cs = window.getComputedStyle(els.steerInput);
    const lh = parseFloat(cs.lineHeight);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return { lineHeight: Number.isFinite(lh) ? lh : 0, padding: pad };
  }

  function autoGrow() {
    const node = els.steerInput;
    const m = composerMetrics();
    node.style.height = "auto"; // let scrollHeight shrink back when text is deleted
    node.style.height = chromeVm.growHeight(node.scrollHeight, m.lineHeight, MAX_COMPOSER_LINES, m.padding) + "px";
  }

  // Apply a folder LABEL returned from the native picker (item 5). A change
  // persists per-channel and takes effect on the NEXT session (O-5).
  function applyFolder(res) {
    if (!res || typeof res !== "object") return;
    state = vm.reduceEvent(state, { type: "folder", label: res.label });
    renderAll();
  }

  function wireFolder() {
    // ONE click-to-change pill (item 5): clicking opens the native picker.
    $("folderPill").addEventListener("click", () => {
      Promise.resolve(folderBridge.choose()).then(applyFolder).catch(noop);
    });
    // Seed the pill from the stored dir (the engine also emits `folder` on init).
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
    els.send.addEventListener("click", onSendClick);
    // Enter still SENDS (the steer queues while a turn runs — unchanged main
    // behavior); Shift+Enter is a newline and grows the field.
    els.steerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendSteer();
      }
    });
    els.steerInput.addEventListener("input", autoGrow);
    autoGrow();

    $("btnStop").addEventListener("click", () => bridge.interrupt());
    $("btnEnd").addEventListener("click", () => bridge.end());

    $("btnAllowOnce").addEventListener("click", () => decide("allow-once"));
    $("btnAllowTask").addEventListener("click", () => decide("allow-task"));
    $("btnDeny").addEventListener("click", () => decide("deny"));

    // Per-session auto-approve toggle (item 10). The main side echoes an
    // `auto_approve` event → reduceEvent → renderStatus updates the posture
    // label + reflects the checkbox. The bridge coerces the boolean.
    els.autoApprove.addEventListener("change", () => {
      bridge.setAutoApprove(els.autoApprove.checked === true);
    });

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

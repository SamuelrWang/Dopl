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
    inboundDecision: noop,
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
    permPostLabel: $("permPostLabel"),
    permPostTo: $("permPostTo"),
    permPost: $("permPost"),
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
  // factory needs to reach the bridge (the gate decision + the consent decision).
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
    // v2.5 D1: the inbound gate decision. Main is authoritative (it re-validates and
    // fails closed); the stamp here only locks the card so a second click cannot
    // double-answer it. `decline` is LOCAL: nothing is sent to the peer.
    //
    // FIX F10: the stamp waits for the invoke to RESOLVE. Stamping first locked the card
    // (and disabled all three buttons) even when the call never reached main — an older
    // preload with no `inboundDecision` fell through to a noop and left the operator with
    // a dead card for a message main was still holding. No bridge method, no lock; a
    // rejected invoke or an {ok:false} keeps the card live so the click can be retried.
    //
    // FOLLOW-UP F12 (verified, round 2): the optimistic stamp is now correct enough to keep.
    // It only lands after main RESOLVES the invoke, and main re-validates fail-closed
    // (gate.decideInbound checks the head id), so the card can no longer lock on a decision
    // main refused. Main's own `inbound_resolved` echo applies the same stamp a moment later
    // and markInboundDecided is idempotent, so the two never disagree. What is left is
    // cosmetic: the buttons stay live for one IPC round trip, so a very fast double-click
    // sends two decisions (the second is refused by the head check, but nothing greys out in
    // between). A pending/disabled state on the clicked button would close that window.
    onInboundDecide(pendingId, decision) {
      const send = bridge.inboundDecision;
      if (typeof send !== "function") return;
      const stamped = decision === "accept" ? "accepted" : decision === "accept-task" ? "accepted-task" : "declined";
      Promise.resolve(send(pendingId, decision))
        .then((res) => {
          if (res && res.ok === false) return; // main did not accept the decision
          state = vm.markInboundDecided(state, pendingId, stamped);
          renderAll();
        })
        .catch(noop);
    },
    // v2.7 L3: the OUTBOUND decision card. The surface moved off the dock, the POLICY path
    // did not: the same session:permission IPC, the same three verbs, so main's fail-closed
    // permission_decision mapping and the v2.5 scoped POST_GRANT are byte-identical. The
    // card decides by its OWN requestId (never the queue head), which is what leaves the
    // dock free for a Bash request queued behind the post. Like the inbound gate (FIX F10)
    // the optimistic stamp WAITS for main: no requestId, no bridge method, or an {ok:false}
    // leaves the card answerable. Main's own permission_resolved echo applies the same stamp a
    // moment later, and markOutboundDecided is idempotent.
    //
    // FIX F1: {ok:false} now means what it says. main/session-ipc reports whether a LIVE
    // canUseTool resolver actually took the decision, so a Send that raced a park (which
    // deny-closed the request already) can no longer stamp that post "sent" forever — the
    // park's own permission_resolved{deny} echo is what resolves the card, to "Not sent".
    // FIX F7: the card disabled its buttons at click time, so a refusal (and a rejected
    // invoke) re-renders to hand them back while the card is still answerable.
    onOutboundDecide(requestId, decision) {
      if (!requestId || typeof bridge.permission !== "function") return;
      Promise.resolve(bridge.permission(requestId, decision))
        .then((res) => {
          if (res && res.ok === false) {
            renderAll(); // main did not take the decision — the card stays live
            return;
          }
          state = vm.markOutboundDecided(state, requestId, decision);
          renderAll();
        })
        .catch(() => renderAll());
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

  // ─── BEGIN SESSION-SCROLL-PURE (pure; unit-tested via source extraction) ────
  // SCROLL FIX (stuck/sticky stream). Two decisions, number-in / number-out, so the truth
  // tables live in test/session-scroll.test.mjs.
  //   1. THE PIN. renderStream re-pinned from within 48px of the bottom on EVERY renderAll —
  //      which also fires for folder labels, avatar fills, status pills and dock repaints —
  //      so a reader parked just above the bottom was yanked down by events that changed
  //      nothing they were looking at. Now: an 8px band (the ACTUAL bottom) AND real growth.
  //   2. THE WHEEL. A capped block inside the transcript (the tool card's input pre, a
  //      pending outbound draft) takes the wheel under the pointer and Chromium LATCHES the
  //      gesture to it — the stream freezes. forwardedWheelDelta hands it back to the stream
  //      once that box cannot travel further that way (or cannot scroll at all).
  const PIN_BAND_PX = 8; // was 48 — a band wide enough to read in is a band that fights you
  const EDGE_SLACK_PX = 1; // fractional device pixels never quite reach the exact edge
  const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) → px; deltaMode 2 (pages) is left alone

  // The whole pin decision. A non-finite gap (an unmeasured stream) reads as "at the bottom".
  function shouldPinStream(bottomGap, tailChanged) {
    return tailChanged === true && !(bottomGap >= PIN_BAND_PX);
  }

  // A cheap fingerprint of what the stream ENDS with: count, the last item's kind +
  // identity, its text length (a streaming turn taking more text IS growth). Everything a
  // non-stream renderAll touches leaves this identical.
  function streamTail(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return "0";
    const last = list[list.length - 1] || {};
    const id = last.toolUseId || last.pendingId || last.requestId || "";
    const len = typeof last.text === "string" ? last.text.length : 0;
    return list.length + "|" + (last.kind || "") + "|" + id + "|" + len;
  }

  function forwardedWheelDelta(scrollTop, scrollHeight, clientHeight, deltaY, deltaMode) {
    const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode ? 0 : deltaY;
    if (!Number.isFinite(px) || px === 0) return 0; // no vertical intent (or a page-mode wheel)
    const travel = scrollHeight - clientHeight;
    if (Number.isFinite(travel) && travel > 0) {
      if (px < 0 && scrollTop > EDGE_SLACK_PX) return 0; // the inner box can still go up
      if (px > 0 && scrollTop < travel - EDGE_SLACK_PX) return 0; // ...or down
    }
    return px; // the inner box is done (or never scrolled): the stream takes the gesture
  }
  // ─── END SESSION-SCROLL-PURE ────────────────────────────────────────────────

  // ── stream ─────────────────────────────────────────────────────────────────
  // Reconcile the stream by index: create missing nodes, update existing ones.
  const rendered = [];
  // The gap is measured on the USER's own scroll, never re-measured after a paint: a card
  // that grows (a result revealed in an open card) must not silently un-pin a reader sitting
  // at the bottom — only a scroll says "I moved away". 0 ⇒ initial open lands at the bottom.
  let bottomGap = 0;
  let lastTail = streamTail([]);
  function renderStream() {
    const tail = streamTail(state.items);
    const tailChanged = tail !== lastTail;
    lastTail = tail;
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
    if (shouldPinStream(bottomGap, tailChanged)) els.stream.scrollTop = els.stream.scrollHeight;
  }

  // The nested scrollers that live INSIDE the transcript. The dock / consent / composer
  // caps are chrome outside .stream, so this listener never sees them.
  const INNER_SCROLLERS = ".tool-card__body pre, .outbound-pending .outbound__body";
  function wireStreamScroll() {
    const s = els.stream;
    s.addEventListener("scroll", () => { bottomGap = s.scrollHeight - s.scrollTop - s.clientHeight; });
    s.addEventListener("wheel", (e) => {
      const box = e.target && typeof e.target.closest === "function" ? e.target.closest(INNER_SCROLLERS) : null;
      if (!box) return;
      const px = forwardedWheelDelta(box.scrollTop, box.scrollHeight, box.clientHeight, e.deltaY, e.deltaMode);
      if (!px) return;
      s.scrollTop += px;
      e.preventDefault(); // the inner box must not also consume (and latch) this gesture
    }, { passive: false });
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
    // v2.5 D2: an outbound post is gated now, so the dock shows the MESSAGE the agent
    // is about to send, in full, before the operator allows it. Any other tool hides
    // the block and keeps the existing summary + collapsible input only.
    const postBody = vm.permissionPostBody(p);
    els.permPost.textContent = postBody;
    els.permPost.classList.toggle("hidden", !postBody);
    els.permPostLabel.classList.toggle("hidden", !postBody);
    // FIX #9: the body alone made a CROSS-CHANNEL post (the exfil shape the outbound gate
    // exists to catch) read exactly like a normal reply to the peer, and the 140-char
    // inputSummary usually truncated the channel field away. State the destination.
    els.permPostTo.textContent = postBody ? vm.postDestinationText(p) : "";
    els.permPostTo.classList.toggle("hidden", !postBody);
    els.permPostTo.classList.toggle("is-cross", !!postBody && vm.isCrossChannelPost(p));
    const extra = state.permissions.length - 1;
    if (extra > 0) {
      els.permQueueNote.textContent = "+" + extra + " more waiting";
      els.permQueueNote.classList.remove("hidden");
    } else {
      els.permQueueNote.classList.add("hidden");
    }
  }

  // The DOCK decision (Bash / Write / a CROSS-channel post). FIX F9: the old
  // markOutboundNotSent call is GONE — an own-channel post decides on its own inline card
  // (onOutboundDecide) and never enters this queue, and a cross-channel post is not rendered
  // as an outbound item at all, so there was never a bubble here to correct.
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
    wireStreamScroll();
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

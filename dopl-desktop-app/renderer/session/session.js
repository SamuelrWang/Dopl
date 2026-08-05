// Dopl session window — renderer controller (imperative DOM over the pure view-model + the
// DOM factories in session-render.js).
//
// SECURITY: every agent / counterparty / tool / consent string reaches the DOM via textContent
// (or as a value on a form control). There is NO innerHTML, no template interpolation, no HTML
// parsing of untrusted text anywhere in this file or session-render.js. All decision logic
// lives in session-viewmodel.js (pure, tested); the DOM factories live in session-render.js.

(function () {
  "use strict";

  const vm = globalThis.DoplSessionVM;
  const chromeVm = globalThis.DoplSessionChrome;
  const render = globalThis.DoplSessionRender;
  const { pretty, initial, avatarNode } = render;

  const attendedUi = globalThis.DoplSessionAttendedUI || null; // F-118 consent-card button
  const modesUi = globalThis.DoplSessionModesUI || null; // FIX 2: the posture selects + their revert
  const closeUi = globalThis.DoplSessionCloseUI || null; // P1-6: the human close affordance
  const folderUi = globalThis.DoplSessionFolderUI || null; // §2 cap: the working-folder pill
  // §3.2 the composer addressee pill. BOTH modules are OPTIONAL at boot: session.html always
  // loads them, but a harness that stubs only VM / chrome / render degrades to a steer-only
  // composer, which is what this window did between rollback §1 and this phase.
  const address = globalThis.DoplSessionAddress || null;
  const addressUi = globalThis.DoplSessionAddressUI || null;
  let closeThread = null;
  // The COMPOSED stream reducer: the two peer_message cases (operator_post / _result) live in
  // session-address.js (the view-model is at its 500-line cap) and run over its output.
  const reduce = address ? (st, evt) => address.reducePeerMessage(vm.reduceEvent(st, evt), evt) : vm.reduceEvent;

  // Bridge (contextIsolation preload). A no-op stub lets session.html open
  // standalone for manual/mock testing; window.__sessionFeed drives a mock stream.
  const noop = function () {};
  const resolved = () => Promise.resolve({ label: null });
  const bridge = window.doplSession || {
    sessionId: "", onEvent: noop, send: noop, permission: noop,
    inboundDecision: noop, interrupt: noop, end: noop, closeTask: noop,
    consentDecision: noop, setToolMode: noop, setMessageMode: noop, setModel: noop,
    folder: { get: resolved, choose: resolved, clear: resolved },
  };
  const folderBridge = bridge.folder || { get: resolved, choose: resolved, clear: resolved };

  // ── DOM refs ────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const els = {
    peerAvatar: $("peerAvatar"), channelName: $("channelName"), taskTitle: $("taskTitle"),
    statusDot: $("statusDot"), statusLabel: $("statusLabel"), statusMeta: $("statusMeta"),
    permPosture: $("permPosture"), permWarn: $("permWarn"), folderLabel: $("folderLabel"),
    toolMode: $("toolMode"), messageMode: $("messageMode"), modelMode: $("modelMode"), ctxMeter: $("ctxMeter"),
    stream: $("stream"), dock: $("permissionDock"), permTool: $("permTool"), permWhy: $("permWhy"),
    permSummary: $("permSummary"), permPostLabel: $("permPostLabel"), permPostTo: $("permPostTo"),
    permPost: $("permPost"), permInput: $("permInput"), permQueueNote: $("permQueueNote"),
    consentView: $("consentView"), endedBanner: $("endedBanner"), thinking: $("thinkingChip"),
    steerInput: $("steerInput"), send: $("btnSend"),
    targetPill: $("btnTarget"), targetLabel: $("targetLabel"), targetPop: $("targetPop"),
    // P1-6: the close affordance (session-close-ui.js owns everything it does).
    closeBtn: $("btnCloseThread"), closePanel: $("closePanel"), closeNote: $("closeNote"),
    closeSummary: $("closeSummary"), closeCancel: $("btnCloseCancel"),
    closeDone: $("btnCloseDone"), closeFailed: $("btnCloseFailed"),
  };

  let state = vm.initialState();

  // Context handed to the DOM factories: pure vm helpers + the callbacks a factory needs to reach the bridge.
  const ctx = {
    vm,
    // The live per-author avatar for a bubble (item 1/5/6). Reads the CURRENT `state` (reassigned per
    // event) so a factory's update() always sees the latest avatar (a late `avatars` repaints bubbles).
    avatarFor(key) {
      if (key === "self") return state.selfAvatar || null;
      if (key === "peer") return state.peerAvatar || null;
      return null;
    },
    // v2.5 D1: the inbound gate decision. Main is authoritative (it re-validates and fails
    // closed); the stamp here only locks the card so a second click cannot double-answer it.
    // `decline` is LOCAL: nothing is sent to the peer. FIX F10 / FOLLOW-UP F12 (verified): the
    // stamp WAITS for the invoke to resolve, so a missing bridge method (an older preload), a
    // rejected invoke or an {ok:false} all leave the card ANSWERABLE instead of dead. Main's own
    // `inbound_resolved` echo applies the same stamp a moment later and markInboundDecided is
    // idempotent, so the two never disagree. Known gap: the buttons stay live for one IPC round
    // trip, so a fast double-click sends two (the second is refused by main's head check).
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
    // v2.7 L3: the OUTBOUND decision card. The surface moved off the dock, the POLICY path did not:
    // the same session:permission IPC, the same three verbs, so main's fail-closed
    // permission_decision mapping and the v2.5 scoped POST_GRANT are byte-identical. The card
    // decides by its OWN requestId (never the queue head), leaving the dock free for a Bash request
    // queued behind the post. Like the inbound gate the stamp WAITS for main, and FIX F1 made
    // {ok:false} mean what it says: main reports whether a LIVE canUseTool resolver took the
    // decision, so a Send that raced a park cannot stamp that post "sent" forever. FIX F7: a
    // refusal, or a rejected invoke, re-renders to hand the buttons back on a live card.
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
    // F-118: makeConsent calls this where the button belongs, beside Accept. The module owns
    // the control, its copy and the handled-attended state; it decides nothing on the request.
    attended: attendedUi ? (row, accept, note) => attendedUi.mount(row, accept, note, bridge) : null,
  };
  const FACTORY = render.makeFactories(ctx);
  // GRAFTED on, not added to render.makeFactories (that file is at its cap too).
  if (addressUi) FACTORY.peer_message = (item) => addressUi.makePeerMessage(item, ctx);

  // ── header / status / folder ──────────────────────────────────────────────
  // D1: ONE identity priority (chromeVm.headerIdentity) drives the header title, the subtitle, the
  // avatar initials and the native window title: taskTitle -> peer name (init.from) -> channelName
  // -> "Session". The avatar node is ALWAYS painted: the peer photo when one has arrived, else
  // initials on a token. Every string reaches the DOM via textContent, and the identity fields are
  // one-lined + capped by the chrome helper, so a peer-controlled name is bounded display data.
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
    // The model REALLY running (init states it once, every turn end restates it), so a
    // mid-session switch shows here. The picker shows the REQUESTED value: different facts.
    els.statusMeta.textContent = state.liveModel || info.model || "";
    // v2.9 THE TWO AXES. The posture line always states BOTH (contract D) and the selects
    // reflect MAIN's echoed state, never the click: a park resets both axes, and the `modes`
    // echo is what drags the controls back to Manual / Ask so they cannot lie about what the
    // gate will do. `bypass` additionally lights the danger chip that says it is per session.
    els.permPosture.textContent = vm.permissionPostureText(state.toolMode, state.messageMode,
      info.profileLabel || info.profile);
    const warn = vm.bypassNoticeText(state.toolMode);
    els.permWarn.textContent = warn;
    els.permWarn.classList.toggle("hidden", !warn);
    // FIX 2: dead during the accept -> init adoption gap. It also owns the unconditional repaint
    // of all three selects, the bypass tint and the context meter (its own strip, and §2 cap).
    if (modesUi) modesUi.sync(els, state);
    if (closeThread) closeThread.paint(state);
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
  // The gap is measured on the USER's own scroll, never re-measured after a paint: a card that
  // grows (a result revealed in an open card) must not silently un-pin a reader sitting at the
  // bottom — only a scroll says "I moved away". 0 ⇒ initial open lands at the bottom.
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
    // 2026-08-02: WHY the dock is asking (the inline post card has said so since the reason
    // codes landed). Closed code table: an unknown or absent code renders no line, not a guess.
    els.permWhy.textContent = render.gateReasonText(p.gateReason);
    els.permWhy.classList.toggle("hidden", !els.permWhy.textContent);
    // v2.5 D2: an outbound post is gated now, so the dock shows the MESSAGE the agent is about
    // to send, in full, before the operator allows it. Any other tool hides the block and keeps
    // the existing summary + collapsible input only.
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

  // The DOCK decision (Bash / Write / a CROSS-channel post). FIX F9 (v2.7): markOutboundNotSent
  // is GONE — an own-channel post decides on its own inline card (onOutboundDecide) and never
  // enters this queue, and a cross-channel post is not an outbound item, so there is no bubble.
  function decide(decision) {
    const p = vm.nextPermission(state);
    if (!p) return;
    bridge.permission(p.requestId, decision);
    state = reduce(state, { type: "permission_resolved", requestId: p.requestId, decision });
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
  // One button, two states (chromeVm.sendButtonMode): idle shows the up-arrow glyph and sends
  // the steer; a running turn shows the pause glyph and interrupts the agent. The glyphs are
  // static inline SVG in session.html — CSS swaps which one is visible, so nothing is ever
  // built from a string here. §3.2: a PEER-addressed draft always shows the send glyph —
  // it is not a steer, so there is no turn of its own to interrupt.
  function renderSend() {
    const mode = composer.target() === "peer" ? "send" : chromeVm.sendButtonMode(state);
    els.send.classList.toggle("is-running", mode === "pause");
    els.send.setAttribute("aria-label", chromeVm.sendButtonLabel(mode));
    composer.sync(); // the pill's face follows the names, which arrive after mount
  }

  // The live "Thinking" affordance: shown while a turn is in flight and nothing has been
  // rendered for it yet (chromeVm.thinkingVisible — pure, so the truth table is testable). It
  // lives outside .stream, so it never enters the stream tail and never moves the scroll pin.
  function renderThinking() {
    els.thinking.classList.toggle("is-active", chromeVm.thinkingVisible(state));
  }

  function renderAll() {
    renderInit();
    renderStatus();
    renderFolder();
    renderStream();
    renderConsent();
    renderPermission();
    renderSend();
    renderThinking();
    renderEnded();
  }

  // ── composer / controls wiring ───────────────────────────────────────────
  // The pill, its menu, the picked target, the session's own handle and the peer send all live
  // in session-address-ui.js / session-address.js (this file is at the hard §2 cap). Either
  // module absent -> the stub: everything is a steer, which is exactly what this composer was
  // between rollback §1 and §3.2.
  const composer = address && addressUi
    ? addressUi.createComposer({ els, bridge,
        getPeerName: () => (state.init && state.init.from) || "",
        onChange: () => renderSend(), // picking NEVER sends; it only re-faces the button
        notice: (text) => { state = reduce(state, { type: "notice", level: "error", text }); renderAll(); } })
    : { handleKey: () => false, isOpen: () => false, sync: () => {}, target: () => "self", send: () => false };

  // The Interrupt checkbox is gone: a steer is ALWAYS 'normal' priority (it queues as the next
  // turn), and interrupting is the pause button's job. §3.2: ONE composer, TWO addressees. The
  // resting pick steers this window; the other posts the operator's OWN words into the channel
  // addressed to the peer — never a steer (no session:send, no turn, no permission). The text is
  // delivered VERBATIM either way: the target is a control, not a prefix in the draft.
  function sendSteer() {
    const text = els.steerInput.value.trim();
    if (!text || state.ended) return;
    if (composer.target() === "peer") {
      if (!composer.send(text)) return; // refused: the draft stays in the field, and it says why
    } else {
      bridge.send(text);
      state = reduce(state, { type: "turn", role: "operator", text, streaming: false });
    }
    els.steerInput.value = "";
    autoGrow(); // D7: back to a single line after send
    renderAll();
  }

  // Click = pause mid-turn, send otherwise; a peer-addressed draft always SENDS.
  function onSendClick() {
    if (chromeVm.sendButtonMode(state) === "pause" && composer.target() !== "peer") {
      bridge.interrupt();
      return;
    }
    sendSteer();
  }

  // ── D7: composer auto-grow (up to 3 line-heights, then scroll) ────────────
  // The cap math is pure (chromeVm.growHeight); this only measures the real
  // computed line-height + vertical padding and applies the returned px height.
  const MAX_COMPOSER_LINES = 3;
  function autoGrow() {
    const node = els.steerInput;
    const cs = window.getComputedStyle(node);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    node.style.height = "auto"; // let scrollHeight shrink back when text is deleted
    node.style.height = chromeVm.growHeight(node.scrollHeight, parseFloat(cs.lineHeight), MAX_COMPOSER_LINES, pad) + "px";
  }

  function wire() {
    els.send.addEventListener("click", onSendClick);
    // Enter still SENDS (the steer queues while a turn runs); Shift+Enter is a newline.
    els.steerInput.addEventListener("keydown", (e) => {
      // R1: an IME COMMIT fires keydown with key "Enter" and isComposing true (keyCode 229 on
      // older Chromium): sending there ships a half-composed draft, and a peer-tagged one leaves
      // this machine and cannot be recalled. FIRST line, ahead of the menu delegation, so
      // neither the send nor a dismiss can run mid-composition.
      if (e.isComposing || e.keyCode === 229) return;
      if (composer.handleKey(e)) return; // Escape closes the open menu, and only that
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendSteer();
      }
    });
    els.steerInput.addEventListener("input", autoGrow);
    autoGrow();

    // The header's Stop button is gone (v3.1): the send button's pause morph is the ONE
    // interrupt control, and sendButtonMode now covers every in-flight state it used to cover.
    $("btnEnd").addEventListener("click", () => bridge.end());

    $("btnAllowOnce").addEventListener("click", () => decide("allow-once"));
    $("btnAllowTask").addEventListener("click", () => decide("allow-task"));
    $("btnDeny").addEventListener("click", () => decide("deny"));

    // v2.9 THE TWO AXES, v3.2 FIX 2: the selects live in session-modes-ui.js (this file is at
    // the §2 cap) because the control now has to REVERT itself when main refuses the change.
    if (modesUi) modesUi.mount({ els, bridge,
      confirmed: () => ({ tool: state.toolMode, message: state.messageMode, model: state.modelChoice }),
      notice: (text) => { state = reduce(state, { type: "notice", level: "error", text }); renderAll(); } });

    // P1-6 (2026-08-04): THE CLOSE AFFORDANCE IS BACK, through the seam v3.1 left intact.
    // v3.1 removed the panel because closing settles the SHARED thread for both members and so
    // belongs to the thread — true, and not enough: nothing else closed either, and decision 2
    // now makes the human the ONLY closer. session-close-ui.js owns the control; this file
    // keeps one mount and one paint, the same arrangement session-modes-ui.js has.
    if (closeUi) {
      closeThread = closeUi.mount({ els, bridge,
        notice: (text) => { state = reduce(state, { type: "notice", level: "error", text }); renderAll(); } });
    }

    // The working-folder pill moved to session-folder-ui.js at the §2 cap (2026-08-04).
    // A folder change persists per-channel and takes effect on the NEXT session (O-5).
    if (folderUi) folderUi.mount({ pill: $("folderPill"), bridge: folderBridge,
      onLabel: (label) => { state = reduce(state, { type: "folder", label }); renderAll(); } });
    wireStreamScroll();
  }

  // Manual/mock hook: window.__sessionFeed({type:'turn', ...}) drives the UI
  // without the engine — used by the standalone-open verification.
  window.__sessionFeed = function (evt) {
    state = reduce(state, evt);
    renderAll();
  };

  bridge.onEvent((evt) => {
    state = reduce(state, evt);
    renderAll();
  });

  wire();
  renderAll();
})();

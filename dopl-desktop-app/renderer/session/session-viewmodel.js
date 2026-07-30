// Pure view-model for the Dopl session window.
//
// This module is INTENTIONALLY free of DOM / electron / fs references so it can
// run both (a) as a plain browser <script> in the sandboxed renderer — where it
// attaches `globalThis.DoplSessionVM` — and (b) be `require()`d directly by the
// node --test source in test/session-render.test.mjs (UMD guard below). It is
// the same discipline as main/load-guard.js: keep the pure core importable.
//
// Everything here is a PURE function over plain data:
//   - initialState()                      -> the empty view-model
//   - reduceEvent(state, event)           -> next view-model (immutable; never mutates `state`)
//   - nextPermission(state)               -> the head of the permission queue or null
//   - markInboundDecided(state, id, d)    -> stamps a gate card accepted / declined (v2.5 D1)
//   - markInboundReleased(state, id)      -> the accept-once alias of the above
//   - markOutboundGated(state, gateEvent) -> hands a post card its requestId + the authorized
//                                            bytes, creating the card if none landed (F4/F5)
//   - markOutboundDecided(state, rid, d)  -> Send / Deny resolves that card in place (v2.7 L3)
// The status / posture / folder label strings — plus the gated-post body + destination
// helpers (permissionPostBody / postDestinationText / isCrossChannelPost) — live in
// session-labels.js, and the string formatters (oneLine / shortToolName /
// summarizeToolInput) in session-format.js; both are re-exported from here unchanged (the
// §2 500-line split).
//
// The renderer (session.js) owns ALL DOM and renders every string via
// textContent — this module never produces markup.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionVM = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ── helpers ──────────────────────────────────────────────────────────────
  // The pure string formatters live in session-format.js (the §2 500-line split) and are
  // reached the same way this module reaches session-labels.js: a require() under node,
  // the renderer global in the sandbox (session.html loads session-format.js first). They
  // are RE-EXPORTED below, so vm.summarizeToolInput / vm.shortToolName / vm.oneLine are
  // unchanged for every caller (session-chrome.js reads vm.oneLine, session-render.js
  // reads ctx.vm.shortToolName).
  //
  // NIT (v2.7): a MISSING formatter THROWS here, at load, instead of degrading to a local
  // fallback. The old `fmt.oneLine || (…)` shims silently replaced the capped one-liner with
  // an UNCAPPED String(v) if the script ever failed to load — an unbounded, untrusted name
  // reaching the header is worse than a window that fails loudly on boot.
  const fmt =
    typeof module === "object" && typeof require === "function"
      ? require("./session-format.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionFormat) || {};
  for (const fn of ["oneLine", "shortToolName", "summarizeToolInput"]) {
    if (typeof fmt[fn] !== "function") throw new Error("session-format.js did not load: " + fn);
  }
  const oneLine = fmt.oneLine;
  const shortToolName = fmt.shortToolName;
  const summarizeToolInput = fmt.summarizeToolInput;

  // ── state ──────────────────────────────────────────────────────────────────

  function initialState() {
    return {
      init: null, // {sessionId, side, profile, profileLabel, mode, model, channelName, taskTitle, cwdLabel, from}
      items: [], // ordered stream: turn | tool | counterparty | outbound | inbound_pending | notice
      // Per-author avatars (item 1/5/6): bounded `data:` URIs (never a remote URL)
      // supplied by main via the init payload + a later `avatars` event.
      //   selfAvatar = MY photo (agent/operator turns + outbound bubbles);
      //   peerAvatar = the PEER's photo (counterparty bubbles + header identity).
      selfAvatar: null,
      peerAvatar: null,
      permissions: [], // FIFO queue of pending permission_request payloads
      phase: "launching", // launching | consent | running | interrupted | ended
      activity: null, // working | idle | awaiting_peer | awaiting_permission | awaiting_inbound  (item 3)
      autoApprove: false, // per-session auto-approve toggle (item 10) — always starts OFF
      folder: null, // {label}  (item 7 — LABEL only; the abs path never crosses the bridge)
      consent: null, // {requestId, from, summary, bodyText, taskTitle, channelName, toolProfileLabel, cwdLabel}  (item 8)
      consentResolved: null, // {decision:'accepted'|'denied'|'expired'}  (item 8)
      ended: null, // {outcome, summary, reason}  (cost REMOVED from display — item 6)
      lastError: null,
    };
  }

  // Immutable helpers: always return NEW arrays/objects; never touch `state`.
  function replaceLast(items, nextLast) {
    const copy = items.slice();
    copy[copy.length - 1] = nextLast;
    return copy;
  }

  function isOpenStream(item, role) {
    return !!item && item.kind === "turn" && item.streaming === true && item.role === role;
  }

  function reduceTurn(state, ev) {
    const role = ev.role || "assistant";
    const text = ev.text == null ? "" : String(ev.text);
    const last = state.items[state.items.length - 1];

    // avatarKey:'self' — an agent/assistant OR operator turn is ALWAYS ME, so
    // both render MY photo (item 1/5/6).
    if (ev.streaming === true) {
      if (isOpenStream(last, role)) {
        const merged = { ...last, text: last.text + text };
        return { ...state, items: replaceLast(state.items, merged) };
      }
      const started = { kind: "turn", role, text, streaming: true, avatarKey: "self" };
      return { ...state, items: state.items.concat([started]) };
    }

    // Terminating / complete turn.
    if (isOpenStream(last, role)) {
      const finalText = last.text ? last.text : text;
      const closed = { ...last, text: finalText, streaming: false };
      return { ...state, items: replaceLast(state.items, closed) };
    }
    const complete = { kind: "turn", role, text, streaming: false, avatarKey: "self" };
    return { ...state, items: state.items.concat([complete]) };
  }

  // The item kinds a tool_result may patch: the generic tool card, and (FIX F3) the OUTBOUND
  // bubble — a post's artifact is painted while the tool_use streams, BEFORE any decision
  // lands, so it used to keep reading "Sent to {peer}" even after a Deny. v2.7: this is also
  // the SELF-HEAL for a card that never got a requestId (the gate auto-allowed instead).
  const PATCHABLE_BY_RESULT = { tool: 1, outbound: 1 };
  function reduceToolResult(state, ev) {
    const id = ev.toolUseId;
    let touched = false;
    const items = state.items.map((it) => {
      if (touched || it.toolUseId !== id || !PATCHABLE_BY_RESULT[it.kind]) return it;
      touched = true;
      if (it.kind === "outbound") return { ...it, status: ev.ok ? "sent" : "not_sent" };
      return {
        ...it,
        status: ev.ok ? "ok" : "error",
        resultSummary: ev.resultSummary == null ? "" : String(ev.resultSummary),
      };
    });
    return touched ? { ...state, items } : state;
  }

  // FIX F9 (v2.7): markOutboundNotSent is DELETED. It existed for the dock's Deny path, and
  // an own-channel post no longer reaches the dock at all (main sends `outbound_gate`, so the
  // card answers for itself and markOutboundDecided resolves it by requestId). A CROSS-channel
  // post does still use the dock, but it is not classified as an outbound_post, so it has no
  // outbound item to mark — the helper could only ever no-op from there.

  // ── reduceEvent ────────────────────────────────────────────────────────────
  function reduceEvent(state, event) {
    if (!event || typeof event !== "object") return state;
    switch (event.type) {
      case "init":
        return {
          ...state,
          init: {
            sessionId: event.sessionId,
            side: event.side,
            profile: event.profile,
            profileLabel: event.profileLabel, // human tool-profile label (item 9)
            mode: event.mode,
            model: event.model,
            channelName: event.channelName,
            taskTitle: event.taskTitle,
            cwdLabel: event.cwdLabel,
            from: event.from, // counterparty name (item 2)
          },
          // Warm-cache avatar data URIs ride the init payload (item 1/5/6). null
          // ⇒ keep what we have; a later `avatars` event fills the cold-cache case.
          selfAvatar: event.selfAvatar == null ? state.selfAvatar : event.selfAvatar,
          peerAvatar: event.fromAvatar == null ? state.peerAvatar : event.fromAvatar,
          // launching OR the pre-consent state (item 8, on adoption) flips to running.
          phase: state.phase === "launching" || state.phase === "consent" ? "running" : state.phase,
        };

      // Cold-cache avatar fill (item 1/5/6): main finished the bounded fetch+encode.
      // OR-merge — a null field means "keep what init/prior set" (§B.1).
      case "avatars":
        return {
          ...state,
          selfAvatar: event.self == null ? state.selfAvatar : event.self,
          peerAvatar: event.from == null ? state.peerAvatar : event.from,
        };

      case "turn":
        return reduceTurn(state, event);

      case "tool_use":
        return {
          ...state,
          items: state.items.concat([
            {
              kind: "tool",
              toolUseId: event.toolUseId,
              name: event.name,
              inputSummary: event.inputSummary || summarizeToolInput(event.name, event.inputFull),
              inputFull: event.inputFull,
              status: "pending",
              resultSummary: null,
            },
          ]),
        };

      case "tool_result":
        return reduceToolResult(state, event);

      // What MY agent SENT to the peer (op=post) — a distinct outbound lane, NOT
      // narration and NOT a generic tool card (item 2).
      //
      // v2.7 L3: main marks the post `pending` when it is going to stop on an operator
      // Send / Deny. That is the SAME single item — it renders as the inline decision card
      // while it waits and resolves IN PLACE — so a post never leaves two artifacts in the
      // stream. A post that does NOT gate (auto-approve, or the scoped task grant) carries
      // no status at all, byte-identical to v2.6's delivered bubble.
      case "outbound_post": {
        // avatarKey:'self' — an outbound post is MY agent sending (item 1/5/6).
        const post = { kind: "outbound", toolUseId: event.toolUseId, to: event.to, text: event.text, avatarKey: "self" };
        if (event.pending === true) {
          post.status = "pending";
          post.requestId = null; // main hands it over in `outbound_gate` (below)
          post.ownChannel = event.ownChannel === true; // fail-suspicious destination line
        }
        return { ...state, items: state.items.concat([post]) };
      }

      // v2.7 L3: main minted the permission requestId for a pending post. Hand it to the
      // card so its own buttons can decide it — the dock never sees a post at all, which
      // is what keeps a Bash request queued behind one visible in the dock.
      case "outbound_gate":
        return markOutboundGated(state, event);

      case "permission_request": {
        if (state.permissions.some((p) => p.requestId === event.requestId)) return state;
        const perm = {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          name: event.name,
          inputSummary: event.inputSummary || summarizeToolInput(event.name, event.inputFull),
          inputFull: event.inputFull,
          title: event.title,
          // FIX #9: main's own-channel verdict for an op=post (never the target id).
          // Absent (an older main) reads as cross-channel — fail suspicious.
          ownChannel: event.ownChannel === true,
        };
        return { ...state, permissions: state.permissions.concat([perm]) };
      }

      // A decision landed for `requestId` — from this window, from the auto-approve drain,
      // or from a PARK (which deny-closes every awaited request fail-closed). Drop it from
      // the dock queue AND, when it belongs to a pending outbound post, resolve that card:
      // v2.7 L3 is what stops a parked post's record from reading "Sent to peer" forever.
      case "permission_resolved":
        return markOutboundDecided(
          { ...state, permissions: state.permissions.filter((p) => p.requestId !== event.requestId) },
          event.requestId,
          event.decision
        );

      // The peer's inbound reply — a first-class left lane (item 1). `inbound` is
      // kept as a legacy alias for a mid-wave engine that has not yet renamed.
      case "counterparty":
      case "inbound":
        return {
          ...state,
          // avatarKey:'peer' — the counterparty's reply renders the PEER photo.
          items: state.items.concat([{ kind: "counterparty", from: event.from, text: event.text, avatarKey: "peer" }]),
        };

      // v2.5 D1: the INBOUND GATE card. `decision` is null while it awaits the
      // operator (Accept / Accept for this task / Decline); `released` is kept as the
      // legacy accepted flag the older release-only card used.
      case "inbound_pending":
        return {
          ...state,
          items: state.items.concat([
            { kind: "inbound_pending", pendingId: event.pendingId, from: event.from, text: event.text, released: false, decision: null },
          ]),
        };

      // Main echoes the decision (from this window or an auto-accept) — mark the card.
      case "inbound_resolved":
        return markInboundDecided(state, event.pendingId, event.decision);

      // v2.5 D3: read-only channel history for a reopened shell. One divider note
      // (copy owned here) followed by the entries in stream order. Display only —
      // these items carry no pendingId and no controls.
      case "history": {
        const entries = Array.isArray(event.entries) ? event.entries : [];
        if (!entries.length) return state;
        const items = [{ kind: "history_divider", text: HISTORY_NOTE }].concat(
          entries.map((e) => ({
            kind: "history",
            from: e && e.from ? String(e.from) : "",
            text: e && e.text == null ? "" : String(e.text),
            lane: e && e.lane === "them" ? "them" : "me",
          }))
        );
        return { ...state, items: state.items.concat(items) };
      }

      // No `usage` case — the cost/usage meter was removed (item 6). The safety
      // caps still run in the main reducer; the window simply never shows cost.

      case "status":
        return {
          ...state,
          phase: event.phase || state.phase,
          activity: event.activity || state.activity, // item 3
        };

      // P1: idle-park inline note. Fixed copy owned here (renderer copy). No em dash.
      // FIX #17: main sets `gated` when the park happened with a message still held.
      case "paused":
        return {
          ...state,
          items: state.items.concat([
            { kind: "notice", level: "info", text: event.gated === true ? PAUSED_GATED_NOTE : PAUSED_NOTE },
          ]),
        };

      // P2: a reopened parked shell (or any main-emitted system note) — a calm,
      // caller-supplied notice line. Rendered via textContent by makeNotice.
      case "notice":
        return {
          ...state,
          items: state.items.concat([
            { kind: "notice", level: event.level || "info", text: event.text == null ? "" : String(event.text) },
          ]),
        };

      // Folder LABEL only — never an absolute path (item 7 / §H-9).
      case "folder":
        return { ...state, folder: { label: event.label == null ? null : String(event.label) } };

      // Echo of the per-session auto-approve toggle (item 10). Display-only here:
      // the actual gate→allow flip is enforced in main/session-io.makeCanUseTool.
      case "auto_approve":
        return { ...state, autoApprove: event.enabled === true };

      // Pre-consent state (item 8): the window opened BEFORE any SDK/agent work.
      case "consent_request":
        return {
          ...state,
          phase: "consent",
          consent: {
            requestId: event.requestId,
            from: event.from,
            summary: event.summary,
            bodyText: event.bodyText,
            taskTitle: event.taskTitle,
            channelName: event.channelName,
            toolProfileLabel: event.toolProfileLabel,
            cwdLabel: event.cwdLabel,
          },
          consentResolved: null,
        };

      // Decided elsewhere (web / notification) while the window is open (item 8).
      case "consent_resolved":
        return { ...state, consentResolved: { decision: event.decision } };

      case "ended":
        return {
          ...state,
          phase: "ended",
          ended: {
            outcome: event.outcome,
            summary: event.summary,
            reason: event.reason,
          },
        };

      case "error":
        return {
          ...state,
          lastError: event.message == null ? "" : String(event.message),
          items: state.items.concat([{ kind: "notice", level: "error", text: event.message }]),
        };

      default:
        return state;
    }
  }

  // Head of the permission queue (the one the dock surfaces), or null.
  function nextPermission(state) {
    return state && state.permissions && state.permissions.length ? state.permissions[0] : null;
  }

  // v2.5 D1: stamp the operator's decision on a gate card (optimistically, before main
  // echoes it back). 'accepted' | 'accepted-task' | 'declined'; anything else is
  // treated as a decline, so a card can never look accepted on a junk value. Immutable.
  function markInboundDecided(state, pendingId, decision) {
    const d = decision === "accepted" || decision === "accepted-task" ? decision : "declined";
    let touched = false;
    const items = state.items.map((it) => {
      if (!touched && it.kind === "inbound_pending" && it.pendingId === pendingId) {
        touched = true;
        return { ...it, decision: d, released: d !== "declined" };
      }
      return it;
    });
    return touched ? { ...state, items } : state;
  }

  // The accept-once alias (the pre-gate name), kept so a mid-wave caller keeps working.
  function markInboundReleased(state, pendingId) {
    return markInboundDecided(state, pendingId, "accepted");
  }

  // v2.7 L3 — hand a post's artifact the requestId main minted for it in canUseTool, matched on
  // the tool_use id both carry. It stamps an UNDECIDED artifact: a card already painted pending,
  // and also one painted as a DELIVERY because auto-approve was on when the tool_use streamed and
  // the operator turned it off before canUseTool ran. Main is genuinely awaiting a decision in
  // that race, so the record must ask for one rather than claim the peer already has it. A
  // RESOLVED artifact (sent / not_sent) is never reopened.
  //
  // FIX F4: the gate carries the AUTHORIZED BYTES (`ev.text`, the body canUseTool is holding),
  // and they WIN over the separately streamed copy the tool_use painted — the operator approves
  // the surface the decision actually covers. FIX F5: when NO artifact for this tool_use exists
  // at all (a replay that dropped it), those same bytes CREATE the card, so a post can never
  // gate invisibly with three buttons nowhere to be found.
  function markOutboundGated(state, ev) {
    const toolUseId = ev && ev.toolUseId;
    const requestId = ev && ev.requestId;
    if (!toolUseId || !requestId) return state;
    const mine = (it) => it.kind === "outbound" && it.toolUseId === toolUseId;
    const open = (it) => mine(it) && (it.status === "pending" || it.status == null);
    const ownChannel = ev.ownChannel === true; // fail-suspicious: only an explicit true
    if (!state.items.some(mine)) {
      if (ev.text == null) return state; // nothing to show; a bodiless gate creates nothing
      const to = ev.to == null ? null : String(ev.to);
      const created = { kind: "outbound", toolUseId, to, text: String(ev.text), avatarKey: "self", status: "pending", requestId, ownChannel };
      return { ...state, items: state.items.concat([created]) };
    }
    if (!state.items.some(open)) return state;
    const gate = (it) => {
      const next = { ...it, status: "pending", requestId, ownChannel: it.ownChannel === true || ownChannel };
      if (ev.text != null) next.text = String(ev.text); // the bytes under decision, not the stream copy
      if (ev.to != null && !next.to) next.to = String(ev.to);
      return next;
    };
    return { ...state, items: state.items.map((it) => (open(it) ? gate(it) : it)) };
  }

  // v2.7 L3 — the decision for a pending post: the two explicit allows DELIVER it, and
  // EVERYTHING else (deny, a park's fail-closed deny echo, an unrecognized/forged string)
  // marks it not sent. Matched by requestId, so a card only ever answers for itself.
  const OUTBOUND_SENT = { "allow-once": true, "allow-task": true };
  function markOutboundDecided(state, requestId, decision) {
    const hit = (it) => it.kind === "outbound" && it.status === "pending" && it.requestId === requestId;
    if (!requestId || !state.items.some(hit)) return state;
    const status = OUTBOUND_SENT[decision] === true ? "sent" : "not_sent";
    return { ...state, items: state.items.map((it) => (hit(it) ? { ...it, status } : it)) };
  }

  // v2.5 D2 / FIX #9: permissionPostBody + postDestinationText now live in
  // session-labels.js (the §2 500-line split) and are re-exported below with the rest of
  // the label strings, so vm.permissionPostBody(...) keeps working unchanged.

  // P1: the inline note dropped when an idle session parks. Plain voice, NO em dash.
  const PAUSED_NOTE = "Paused after inactivity. Send a message or wait for a reply to continue.";
  // FIX #17: the same park while a message is HELD at the gate. "Wait for a reply" is
  // wrong there — the reply already arrived and is waiting on the operator.
  const PAUSED_GATED_NOTE = "Paused after inactivity. Accept the waiting message or send one to continue.";
  // D3: the one divider that introduces the read-only channel history of a reopened
  // window. Renderer-owned copy (main sends data only). No em dash.
  const HISTORY_NOTE = "History from the channel";

  // The status / posture / folder label strings live in session-labels.js (the §2
  // 500-line split) and are RE-EXPORTED here verbatim, so every existing caller and
  // test keeps reaching them as vm.statusText / vm.statusDotKey / vm.folderLabel /
  // vm.permissionModeText. Reached the same way session-chrome.js reaches this module:
  // a require() under node, the renderer global in the sandbox (session.html loads
  // session-labels.js first).
  const labels =
    typeof module === "object" && typeof require === "function"
      ? require("./session-labels.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionLabels) || {};

  return {
    ...labels,
    initialState,
    reduceEvent,
    summarizeToolInput,
    shortToolName,
    nextPermission,
    markInboundReleased,
    markInboundDecided, // v2.5 D1
    markOutboundGated, // v2.7 L3 (+ FIX F4/F5: the authorized bytes, and the create path)
    markOutboundDecided, // v2.7 L3
    oneLine,
  };
});

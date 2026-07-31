// Pure view-model for the Dopl session window.
//
// This module is INTENTIONALLY free of DOM / electron / fs references so it can run both (a) as a
// plain browser <script> in the sandboxed renderer — where it attaches `globalThis.DoplSessionVM`
// — and (b) be `require()`d directly by node --test (UMD guard below). Same discipline as
// main/load-guard.js: keep the pure core importable.
//
// Everything here is a PURE function over plain data:
//   - initialState()                      -> the empty view-model
//   - reduceEvent(state, event)           -> next view-model (immutable; never mutates `state`)
//   - nextPermission(state)               -> the head of the permission queue or null
//   - markInboundDecided(state, id, d)    -> stamps a gate card accepted / declined (v2.5 D1)
//   - markOutboundGated(state, gateEvent) -> gives a post card its requestId + authorized bytes
//   - markOutboundDecided(state, rid, d)  -> Send / Deny resolves that card in place (v2.7 L3)
// The status / posture / folder label strings — plus the gated-post body + destination helpers
// (permissionPostBody / postDestinationText / isCrossChannelPost) — live in session-labels.js, and
// the string formatters (oneLine / shortToolName / summarizeToolInput) in session-format.js; both
// are re-exported from here unchanged (the §2 500-line split). The renderer (session.js) owns ALL
// DOM and renders every string via textContent — this module never produces markup.

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
  // The pure string formatters live in session-format.js (the §2 split); this module reaches them
  // like session-labels.js and RE-EXPORTS them, so vm.summarizeToolInput / vm.shortToolName /
  // vm.oneLine are unchanged. NIT (v2.7): a MISSING formatter THROWS here at load rather than
  // degrading to a silent fallback that could let an UNCAPPED, untrusted name reach the header.
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

  // v3.0 FIX Q2: the read-only history reducer (and the divider copy it owns) live in
  // session-history-vm.js — the §2 500-line split — reached exactly the way session-format.js is.
  // Same NIT posture: a MISSING module THROWS at load rather than dropping a shell's history.
  const history =
    typeof module === "object" && typeof require === "function"
      ? require("./session-history-vm.js")
      : (typeof globalThis !== "undefined" && globalThis.DoplSessionHistoryVM) || {};
  if (typeof history.historyItems !== "function") throw new Error("session-history-vm.js did not load: historyItems");

  // C8/MEDIUM-6: the bound every COUNTERPARTY-CONTROLLED display name gets before it reaches a
  // decision surface (the peer bubble already had it). v2.9 THE TWO AXES: the renderer's own copy of
  // the canonical tables (a sandboxed page cannot require main), used ONLY to fail-closed a `modes`
  // echo, never to decide anything.
  const NAME_CAP = 60;
  const TOOL_MODES = ["manual", "accept_edits", "auto", "bypass"];
  const MESSAGE_MODES = ["ask", "auto_inbound", "auto_outbound", "auto_both"];

  // ── state ──────────────────────────────────────────────────────────────────

  function initialState() {
    return {
      init: null, // {sessionId, side, profile, profileLabel, mode, model, channelName, taskTitle, cwdLabel, from}
      items: [], // ordered stream: turn | tool | counterparty | outbound | inbound_pending | notice
      // Per-author avatars (item 1/5/6): bounded `data:` URIs (never a remote URL) supplied by
      // main via the init payload + a later `avatars` event. selfAvatar = MY photo (agent/operator
      // turns + outbound bubbles); peerAvatar = the PEER's (counterparty bubbles + header).
      selfAvatar: null,
      peerAvatar: null,
      permissions: [], // FIFO queue of pending permission_request payloads
      phase: "launching", // launching | consent | running | interrupted | ended
      activity: null, // working | idle | awaiting_peer | awaiting_permission | awaiting_inbound  (item 3)
      // v2.9 THE TWO AXES, display only (main enforces both). Always start at the MOST
      // RESTRICTIVE value, and a park resets them, which main echoes back as `modes`.
      toolMode: "manual", // AXIS A: manual | accept_edits | auto | bypass
      messageMode: "ask", // AXIS B: ask | auto_inbound | auto_outbound | auto_both
      folder: null, // {label}  (item 7 — LABEL only; the abs path never crosses the bridge)
      consent: null, // {requestId, from, summary, bodyText, taskTitle, channelName, toolProfileLabel, cwdLabel}  (item 8)
      consentResolved: null, // {decision:'accepted'|'denied'|'expired'}  (item 8)
      ended: null, // {outcome, summary, reason}  (cost REMOVED from display — item 6)
      lastError: null,
    };
  }

  // Immutable helpers: always NEW arrays/objects; never touch `state`.
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

    // avatarKey:'self' — an agent/assistant OR operator turn is ALWAYS ME, so both render MY
    // photo (item 1/5/6).
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

  // The item kinds a tool_result may patch: the generic tool card, and (FIX F3) the OUTBOUND bubble
  // — a post's artifact is painted while the tool_use streams, BEFORE any decision lands, so it
  // used to read "Sent to {peer}" even after a Deny. v2.7: also the SELF-HEAL for a card that never
  // got a requestId (the gate auto-allowed instead).
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

  // FIX F9 (v2.7): markOutboundNotSent is DELETED — an own-channel post decides on its own inline
  // card (main's `outbound_gate` + markOutboundDecided by requestId), never in the dock.

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
          // Warm-cache avatar data URIs ride the init payload (item 1/5/6). null ⇒ keep what we
          // have; a later `avatars` event fills the cold-cache case.
          selfAvatar: event.selfAvatar == null ? state.selfAvatar : event.selfAvatar,
          peerAvatar: event.fromAvatar == null ? state.peerAvatar : event.fromAvatar,
          // launching OR the pre-consent state (item 8, on adoption) flips to running.
          phase: state.phase === "launching" || state.phase === "consent" ? "running" : state.phase,
        };

      // Cold-cache avatar fill (item 1/5/6): main finished the bounded fetch+encode. OR-merge — a
      // null field means "keep what init/prior set" (§B.1).
      case "avatars":
        return {
          ...state,
          selfAvatar: event.self == null ? state.selfAvatar : event.self,
          peerAvatar: event.from == null ? state.peerAvatar : event.from,
        };

      case "turn":
        return reduceTurn(state, event);

      // FIX (v2.x): the INITIATING request, pinned at the TOP (display only; main emits it once at
      // session start, never feeds it to the agent). A responder shows the peer's ask on the LEFT,
      // a requester its own goal on the RIGHT.
      case "request":
        return {
          ...state,
          items: state.items.concat([{
            kind: "request",
            lane: event.side === "responder" ? "them" : "me",
            from: event.from,
            text: event.text == null ? "" : String(event.text),
          }]),
        };

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

      // What MY agent SENT to the peer (op=post) — a distinct outbound lane, NOT narration and NOT
      // a generic tool card (item 2). v2.7 L3: main marks the post `pending` when it is going to
      // stop on an operator Send / Deny. That is the SAME single item — it renders as the inline
      // decision card while it waits and resolves IN PLACE — so a post never leaves two artifacts
      // in the stream. A post that does NOT gate (AXIS B, or the scoped task grant) carries no
      // status at all, byte-identical to v2.6's delivered bubble.
      case "outbound_post": {
        // avatarKey:'self' — an outbound post is MY agent sending (item 1/5/6).
        const post = { kind: "outbound", toolUseId: event.toolUseId, to: event.to, text: event.text, avatarKey: "self" };
        // MEDIUM-2: main sets these ONLY when the call really carried them, so a plain reply's
        // item is byte-identical to v2.8's. `addressed` => `to` is the call's own recipient, not
        // this session's counterparty; `postKind` => it claims to be a lifecycle event.
        if (event.addressed === true) post.addressed = true;
        if (event.postKind) post.postKind = String(event.postKind);
        if (event.pending === true) {
          post.status = "pending";
          post.requestId = null; // main hands it over in `outbound_gate` (below)
          post.ownChannel = event.ownChannel === true; // fail-suspicious destination line
        }
        return { ...state, items: state.items.concat([post]) };
      }

      // v2.7 L3: main minted the permission requestId for a pending post. Hand it to the card so
      // its own buttons can decide it — the dock never sees a post at all, which is what keeps a
      // Bash request queued behind one visible in the dock.
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
          // FIX #9: main's own-channel verdict for an op=post (never the target id). Absent (an
          // older main) reads as cross-channel — fail suspicious.
          ownChannel: event.ownChannel === true,
        };
        return { ...state, permissions: state.permissions.concat([perm]) };
      }

      // A decision landed for `requestId` — from this window, or from a PARK (which deny-closes
      // every awaited request fail-closed). Drop it from the dock queue AND, when it belongs to a
      // pending outbound post, resolve that card: v2.7 L3 is what stops a parked post's record
      // from reading "Sent to peer" forever.
      case "permission_resolved":
        return markOutboundDecided(
          { ...state, permissions: state.permissions.filter((p) => p.requestId !== event.requestId) },
          event.requestId,
          event.decision
        );

      // The peer's inbound reply — a first-class left lane (item 1). `inbound` is kept as a
      // legacy alias for a mid-wave engine that has not yet renamed.
      case "counterparty":
      case "inbound":
        return {
          ...state,
          // avatarKey:'peer' — the peer's reply renders the PEER photo. C8/MEDIUM-6: `from` is
          // COUNTERPARTY-CONTROLLED and reaches a decision surface, so it takes the same one-line
          // 60-char bound the header name has. Capped HERE, so every renderer of the item gets it.
          items: state.items.concat([{ kind: "counterparty", from: oneLine(event.from, NAME_CAP), text: event.text, avatarKey: "peer" }]),
        };

      // v2.5 D1: the INBOUND GATE card. `decision` is null while it awaits the operator.
      case "inbound_pending":
        return {
          ...state,
          items: state.items.concat([
            // C8/MEDIUM-6: the same bound on the gate card, the OTHER decision surface.
            { kind: "inbound_pending", pendingId: event.pendingId, from: oneLine(event.from, NAME_CAP), text: event.text, released: false, decision: null },
          ]),
        };

      // Main echoes the decision (from this window or an auto-accept) — mark the card.
      case "inbound_resolved":
        return markInboundDecided(state, event.pendingId, event.decision);

      // v2.5 D3: read-only channel history for a reopened shell — one divider note then the
      // entries in stream order, each stamped with the role + avatarKey a LIVE bubble carries
      // (v3.0 FIX Q2). Display only, no controls; the whole slice is built in session-history-vm.js.
      case "history": {
        const items = history.historyItems(event.entries);
        return items.length ? { ...state, items: state.items.concat(items) } : state;
      }

      case "status": // no `usage` case: the meter was removed (item 6); the caps live in main
        return {
          ...state,
          phase: event.phase || state.phase,
          activity: event.activity || state.activity, // item 3
        };

      // P1: idle-park note. Copy owned here, no em dash. FIX #17: `gated` when a message was held.
      case "paused":
        return {
          ...state,
          items: state.items.concat([
            { kind: "notice", level: "info", text: event.gated === true ? PAUSED_GATED_NOTE : PAUSED_NOTE },
          ]),
        };

      // P2: a reopened parked shell (or any main-emitted system note). textContent via makeNotice.
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

      // v2.9 — main's echo of BOTH axes (an axis change, or the park that resets them). Display
      // only: the decisions are made in main/session-profiles.grantDecision and the inbound gate.
      // Fail-closed on junk, so the header can never claim a posture main is not enforcing.
      case "modes":
        return {
          ...state,
          toolMode: TOOL_MODES.indexOf(event.tool) === -1 ? "manual" : event.tool,
          messageMode: MESSAGE_MODES.indexOf(event.message) === -1 ? "ask" : event.message,
        };

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

  // v2.5 D1: stamp the operator's decision on a gate card (optimistically, before main echoes it
  // back). Anything but 'accepted' / 'accepted-task' is a decline. Immutable.
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

  // The accept-once alias (the pre-gate name), kept for a mid-wave caller.
  function markInboundReleased(state, pendingId) {
    return markInboundDecided(state, pendingId, "accepted");
  }

  // v2.7 L3 — hand a post's artifact the requestId main minted in canUseTool, matched on the
  // tool_use id both carry. It stamps an UNDECIDED artifact: one already pending, and also one
  // painted as a DELIVERY because AXIS B was permissive when the tool_use streamed and the operator
  // tightened it before canUseTool ran (main really is awaiting a decision in that race, so the
  // record must ask for one, not claim the peer has it). A RESOLVED artifact is never reopened.
  // FIX F4: the gate carries the AUTHORIZED BYTES (`ev.text`, the body canUseTool holds) and they
  // WIN over the streamed copy — the operator approves the surface the decision covers. FIX F5:
  // with NO artifact for this tool_use (a replay that dropped it) those bytes CREATE the card, so
  // a post can never gate invisibly with three buttons nowhere to be found.
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
      // MEDIUM-2 again, and conditionally: a plain reply's created card is unchanged.
      if (ev.addressed === true) created.addressed = true;
      if (ev.postKind) created.postKind = String(ev.postKind);
      return { ...state, items: state.items.concat([created]) };
    }
    if (!state.items.some(open)) return state;
    const gate = (it) => {
      const next = { ...it, status: "pending", requestId, ownChannel: it.ownChannel === true || ownChannel };
      if (ev.text != null) next.text = String(ev.text); // the bytes under decision, not the stream copy
      // MEDIUM-2: the ADDRESSEE under decision wins over the streamed guess for the same reason
      // the bytes do — the card must describe the call canUseTool is holding.
      if (ev.addressed === true) { next.to = ev.to == null ? next.to : String(ev.to); next.addressed = true; }
      else if (ev.to != null && !next.to) next.to = String(ev.to);
      if (ev.postKind) next.postKind = String(ev.postKind);
      return next;
    };
    return { ...state, items: state.items.map((it) => (open(it) ? gate(it) : it)) };
  }

  // v2.7 L3 — the decision for a pending post: the two explicit allows DELIVER it, EVERYTHING else
  // (deny, a park's deny echo, a forged string) marks it not sent. Matched by requestId only.
  const OUTBOUND_SENT = { "allow-once": true, "allow-task": true };
  function markOutboundDecided(state, requestId, decision) {
    const hit = (it) => it.kind === "outbound" && it.status === "pending" && it.requestId === requestId;
    if (!requestId || !state.items.some(hit)) return state;
    const status = OUTBOUND_SENT[decision] === true ? "sent" : "not_sent";
    return { ...state, items: state.items.map((it) => (hit(it) ? { ...it, status } : it)) };
  }

  // v2.5 D2 / FIX #9: permissionPostBody + postDestinationText live in session-labels.js and are
  // re-exported below, so vm.permissionPostBody(...) keeps working unchanged.

  // P1: the inline note dropped when an idle session parks. Plain voice, NO em dash.
  const PAUSED_NOTE = "Paused after inactivity. Send a message or wait for a reply to continue.";
  // FIX #17: the same park with a message HELD. "Wait for a reply" is wrong: it already arrived.
  const PAUSED_GATED_NOTE = "Paused after inactivity. Accept the waiting message or send one to continue.";

  // The label strings live in session-labels.js (the §2 split) and are RE-EXPORTED verbatim, so
  // callers keep reaching vm.statusText / vm.folderLabel / vm.permissionPostureText. Reached the
  // way session-chrome.js reaches this module: require() under node, the global in the sandbox.
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

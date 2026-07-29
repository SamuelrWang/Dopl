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
//   - summarizeToolInput(name, input)     -> a single-line tool-call summary
//   - nextPermission(state)               -> the head of the permission queue or null
//   - markInboundReleased(state, id)      -> flips a pending-inbound item to released
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

  // Collapse to a single trimmed line and cap length. Non-strings coerce.
  function oneLine(value, max) {
    const cap = typeof max === "number" && max > 0 ? max : 140;
    let s = value == null ? "" : String(value);
    s = s.replace(/\s+/g, " ").trim();
    if (s.length > cap) s = s.slice(0, cap - 1).trimEnd() + "…";
    return s;
  }

  // The short display name for a tool: the last mcp segment, else the raw name.
  function shortToolName(name) {
    const n = name == null ? "" : String(name);
    if (n.startsWith("mcp__")) {
      const parts = n.split("__").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : n;
    }
    return n;
  }

  // First present string field among `keys` on `input`.
  function pick(input, keys) {
    if (!input || typeof input !== "object") return "";
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v) return v;
      if (typeof v === "number") return String(v);
    }
    return "";
  }

  // ── summarizeToolInput ─────────────────────────────────────────────────────
  // One-line, human-scannable summary of a tool call. Robust to null/odd input.
  // NEVER returns a multi-line string (the card summary must stay one line).
  function summarizeToolInput(name, input) {
    const raw = name == null ? "" : String(name);

    switch (raw) {
      case "Bash": {
        const cmd = pick(input, ["command"]);
        return cmd ? oneLine("$ " + cmd, 160) : "Run a shell command";
      }
      case "Read": {
        const p = pick(input, ["file_path", "path"]);
        return p ? oneLine("Read " + p) : "Read a file";
      }
      case "Write": {
        const p = pick(input, ["file_path", "path"]);
        return p ? oneLine("Write " + p) : "Write a file";
      }
      case "Edit":
      case "MultiEdit": {
        const p = pick(input, ["file_path", "path"]);
        return p ? oneLine("Edit " + p) : "Edit a file";
      }
      case "NotebookEdit": {
        const p = pick(input, ["notebook_path", "file_path", "path"]);
        return p ? oneLine("Edit notebook " + p) : "Edit a notebook";
      }
      case "Glob": {
        const g = pick(input, ["pattern", "glob"]);
        return g ? oneLine("Glob " + g) : "Match files by glob";
      }
      case "Grep": {
        const pat = pick(input, ["pattern"]);
        const where = pick(input, ["path", "glob"]);
        if (pat) return oneLine("Grep /" + pat + "/" + (where ? " in " + where : ""));
        return "Search file contents";
      }
      case "WebFetch": {
        const u = pick(input, ["url"]);
        return u ? oneLine("Fetch " + u) : "Fetch a web page";
      }
      case "WebSearch": {
        const q = pick(input, ["query"]);
        return q ? oneLine('Search "' + q + '"') : "Search the web";
      }
      default:
        break;
    }

    // MCP tools and anything else: prefer intent-y fields, else compact JSON.
    const label = shortToolName(raw);
    const hint = pick(input, ["op", "action", "kind", "operation", "query", "title", "message", "text", "name"]);
    if (hint) return oneLine(label + " · " + hint);
    if (input && typeof input === "object") {
      let json = "";
      try {
        json = JSON.stringify(input);
      } catch (_err) {
        json = "";
      }
      if (json && json !== "{}") return oneLine(label + " " + json);
    }
    return label || "Tool call";
  }

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

  function reduceToolResult(state, ev) {
    const id = ev.toolUseId;
    let touched = false;
    const items = state.items.map((it) => {
      if (!touched && it.kind === "tool" && it.toolUseId === id) {
        touched = true;
        return {
          ...it,
          status: ev.ok ? "ok" : "error",
          resultSummary: ev.resultSummary == null ? "" : String(ev.resultSummary),
        };
      }
      return it;
    });
    return touched ? { ...state, items } : state;
  }

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
      case "outbound_post":
        return {
          ...state,
          items: state.items.concat([
            // avatarKey:'self' — an outbound post is MY agent sending (item 1/5/6).
            { kind: "outbound", toolUseId: event.toolUseId, to: event.to, text: event.text, avatarKey: "self" },
          ]),
        };

      case "permission_request": {
        if (state.permissions.some((p) => p.requestId === event.requestId)) return state;
        const perm = {
          requestId: event.requestId,
          toolUseId: event.toolUseId,
          name: event.name,
          inputSummary: event.inputSummary || summarizeToolInput(event.name, event.inputFull),
          inputFull: event.inputFull,
          title: event.title,
        };
        return { ...state, permissions: state.permissions.concat([perm]) };
      }

      case "permission_resolved":
        return {
          ...state,
          permissions: state.permissions.filter((p) => p.requestId !== event.requestId),
        };

      // The peer's inbound reply — a first-class left lane (item 1). `inbound` is
      // kept as a legacy alias for a mid-wave engine that has not yet renamed.
      case "counterparty":
      case "inbound":
        return {
          ...state,
          // avatarKey:'peer' — the counterparty's reply renders the PEER photo.
          items: state.items.concat([{ kind: "counterparty", from: event.from, text: event.text, avatarKey: "peer" }]),
        };

      case "inbound_pending":
        return {
          ...state,
          items: state.items.concat([
            { kind: "inbound_pending", pendingId: event.pendingId, from: event.from, text: event.text, released: false },
          ]),
        };

      // No `usage` case — the cost/usage meter was removed (item 6). The safety
      // caps still run in the main reducer; the window simply never shows cost.

      case "status":
        return {
          ...state,
          phase: event.phase || state.phase,
          activity: event.activity || state.activity, // item 3
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

  // Optimistically flag a pending-inbound item as released (before the engine
  // feeds it back as a turn). Immutable.
  function markInboundReleased(state, pendingId) {
    let touched = false;
    const items = state.items.map((it) => {
      if (!touched && it.kind === "inbound_pending" && it.pendingId === pendingId) {
        touched = true;
        return { ...it, released: true };
      }
      return it;
    });
    return touched ? { ...state, items } : state;
  }

  // ── status / folder labels (pure; item 3 + item 7) ──────────────────────────
  const PHASE_LABEL = {
    launching: "Launching",
    consent: "Consent",
    running: "Running",
    awaiting_permission: "Awaiting permission",
    awaiting_inbound: "Awaiting reply",
    interrupted: "Interrupted",
    ended: "Ended",
  };
  const ACTIVITY_LABEL = {
    working: "Working",
    idle: "Idle",
    awaiting_peer: "Waiting for reply",
    awaiting_permission: "Awaiting permission",
    awaiting_inbound: "Reply ready",
  };

  // The status-pill text. When a turn is RUNNING the finer `activity` wins;
  // otherwise the coarse phase label is shown.
  function statusText(phase, activity) {
    const ph = phase || "launching";
    if (ph === "running" && activity) return ACTIVITY_LABEL[activity] || PHASE_LABEL[ph] || ph;
    return PHASE_LABEL[ph] || (ph.charAt(0).toUpperCase() + ph.slice(1));
  }

  // The status-dot class key (colour) — `act-<activity>` while running, else `is-<phase>`.
  function statusDotKey(phase, activity) {
    const ph = phase || "launching";
    if (ph === "running" && activity) return "act-" + activity;
    return "is-" + ph;
  }

  // The folder-pill label (item 5): the abbreviated dir short-form. The engine
  // now always emits a REAL resolved dir (item 6 default = ~/Downloads), so the
  // null case is only the pre-event render — fall back to the same default.
  function folderLabel(folder) {
    const label = folder && folder.label;
    return label ? String(label) : "~/Downloads";
  }

  // The permission-posture label (items 9 + 10). Off = "Asking each time",
  // on = "Auto-approving"; the tool-profile label rides along as context. Plain
  // sentence case, no em dash (§H-13). The middle dot separates mode · profile.
  function permissionModeText(autoApprove, profileLabel) {
    const mode = autoApprove ? "Auto-approving" : "Asking each time";
    const label = profileLabel == null ? "" : String(profileLabel).trim();
    return "Permissions: " + mode + (label ? " · " + label : "");
  }

  return {
    initialState,
    reduceEvent,
    summarizeToolInput,
    shortToolName,
    nextPermission,
    markInboundReleased,
    oneLine,
    statusText,
    statusDotKey,
    folderLabel,
    permissionModeText,
  };
});

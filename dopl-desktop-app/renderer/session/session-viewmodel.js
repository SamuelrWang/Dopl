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
      init: null, // {sessionId, side, profile, mode, model, channelName, taskTitle, cwdLabel}
      items: [], // ordered stream: turn | tool | inbound | inbound_pending | notice
      permissions: [], // FIFO queue of pending permission_request payloads
      usage: null, // {turnCostUsd, totalCostUsd, turns, model}
      phase: "launching",
      ended: null, // {outcome, summary, totalCostUsd, reason}
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

    if (ev.streaming === true) {
      if (isOpenStream(last, role)) {
        const merged = { ...last, text: last.text + text };
        return { ...state, items: replaceLast(state.items, merged) };
      }
      const started = { kind: "turn", role, text, streaming: true };
      return { ...state, items: state.items.concat([started]) };
    }

    // Terminating / complete turn.
    if (isOpenStream(last, role)) {
      const finalText = last.text ? last.text : text;
      const closed = { ...last, text: finalText, streaming: false };
      return { ...state, items: replaceLast(state.items, closed) };
    }
    const complete = { kind: "turn", role, text, streaming: false };
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
            mode: event.mode,
            model: event.model,
            channelName: event.channelName,
            taskTitle: event.taskTitle,
            cwdLabel: event.cwdLabel,
          },
          phase: state.phase === "launching" ? "running" : state.phase,
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

      case "inbound":
        return {
          ...state,
          items: state.items.concat([{ kind: "inbound", from: event.from, text: event.text }]),
        };

      case "inbound_pending":
        return {
          ...state,
          items: state.items.concat([
            { kind: "inbound_pending", pendingId: event.pendingId, from: event.from, text: event.text, released: false },
          ]),
        };

      case "usage":
        return {
          ...state,
          usage: {
            turnCostUsd: event.turnCostUsd,
            totalCostUsd: event.totalCostUsd,
            turns: event.turns,
            model: event.model,
          },
        };

      case "status":
        return { ...state, phase: event.phase || state.phase };

      case "ended":
        return {
          ...state,
          phase: "ended",
          ended: {
            outcome: event.outcome,
            summary: event.summary,
            totalCostUsd: event.totalCostUsd,
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

  return {
    initialState,
    reduceEvent,
    summarizeToolInput,
    shortToolName,
    nextPermission,
    markInboundReleased,
    oneLine,
  };
});

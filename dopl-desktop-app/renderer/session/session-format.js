// Pure STRING FORMATTERS for the Dopl session window.
//
//   - oneLine(value, max)                 -> a single trimmed line, capped with an ellipsis
//   - shortToolName(name)                 -> the last mcp segment, else the raw tool name
//   - summarizeToolInput(name, input)     -> a one-line, human-scannable tool-call summary
//
// Split out of session-viewmodel.js purely to respect the HARD 500-line-per-file cap (§2)
// while v2.7 added the outbound decision card — the same discipline as the earlier
// session-chrome.js / session-labels.js splits. This module has NO dependencies at all, is
// DOM / electron / fs free, and is UMD-wrapped: a plain <script> in the sandboxed renderer
// (attaching `globalThis.DoplSessionFormat`), a require() under node --test.
// session-viewmodel.js re-exports every function here, so `vm.summarizeToolInput(...)`,
// `vm.shortToolName(...)` and `vm.oneLine(...)` keep working unchanged.
//
// It produces STRINGS only, never markup; session.js prints them via textContent.

(function (global, factory) {
  const api = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = api; // node / CommonJS (tests)
  } else {
    global.DoplSessionFormat = api; // sandboxed renderer global
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  return { oneLine, shortToolName, summarizeToolInput };
});

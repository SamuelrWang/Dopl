// Tests for the PURE session-window view-model (renderer/session/session-viewmodel.js).
//
// The module is DOM/electron-free and UMD-wrapped, so — like main/load-guard.js's
// pure core — it is loaded directly (via createRequire, since the module is CJS in
// Node). session.js (the imperative DOM shell) is NOT unit-tested here; its logic
// is entirely delegated to these pure functions.
//
// What matters:
//   - summarizeToolInput: single-line, robust to junk, tool-aware one-liners.
//   - reduceEvent: correct stream/permission/usage/phase transitions AND
//     immutability (never mutates the input state — the renderer relies on this).
//   - streaming deltas accumulate into one open turn, then finalize.
//   - permission queue is FIFO + dedup; resolved requests leave it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vm = require(
  fileURLToPath(new URL("../renderer/session/session-viewmodel.js", import.meta.url))
);
const {
  initialState, reduceEvent, summarizeToolInput, shortToolName, nextPermission,
  markInboundReleased, oneLine, statusText, statusDotKey, folderLabel, permissionModeText,
} = vm;

// session-render.js is DOM-free to require (factories touch `document` only when
// CALLED), so the pure helper `initial()` is testable here without a DOM. The
// factory-exec tests (item 8 collapse, item 2 avatar) that DO need a DOM live in
// the sibling session-render-dom.test.mjs (kept separate to respect the 500-line
// cap on this file).
const render = require(
  fileURLToPath(new URL("../renderer/session/session-render.js", import.meta.url))
);

const last = (s) => s.items[s.items.length - 1];

// ── summarizeToolInput ───────────────────────────────────────────────────────

test("summarizeToolInput: Bash shows the command with a $ prefix", () => {
  assert.equal(summarizeToolInput("Bash", { command: "ls -la /tmp" }), "$ ls -la /tmp");
});

test("summarizeToolInput: file tools show their path", () => {
  assert.equal(summarizeToolInput("Read", { file_path: "/a/b.js" }), "Read /a/b.js");
  assert.equal(summarizeToolInput("Write", { file_path: "/a/b.js" }), "Write /a/b.js");
  assert.equal(summarizeToolInput("Edit", { file_path: "/a/b.js" }), "Edit /a/b.js");
  assert.equal(summarizeToolInput("NotebookEdit", { notebook_path: "/n.ipynb" }), "Edit notebook /n.ipynb");
});

test("summarizeToolInput: web + search tools", () => {
  assert.equal(summarizeToolInput("WebFetch", { url: "https://x.dev" }), "Fetch https://x.dev");
  assert.equal(summarizeToolInput("WebSearch", { query: "electron csp" }), 'Search "electron csp"');
  assert.equal(summarizeToolInput("Grep", { pattern: "TODO", path: "src" }), "Grep /TODO/ in src");
});

test("summarizeToolInput: mcp tools use the last segment + an intent field", () => {
  const s = summarizeToolInput("mcp__dopl__dopl_channel", { op: "post_message", message: "hello" });
  assert.ok(s.startsWith("dopl_channel · post_message"), s);
});

test("summarizeToolInput: unknown tool falls back to compact single-line JSON", () => {
  const s = summarizeToolInput("SomethingElse", { a: 1, b: "two" });
  assert.ok(s.startsWith("SomethingElse"));
  assert.ok(!s.includes("\n"), "must be single line");
});

test("summarizeToolInput: robust to null / non-object input", () => {
  assert.equal(typeof summarizeToolInput("Bash", null), "string");
  assert.equal(summarizeToolInput("Bash", null), "Run a shell command");
  assert.equal(summarizeToolInput("Read", undefined), "Read a file");
  assert.equal(typeof summarizeToolInput(null, null), "string");
});

test("summarizeToolInput: collapses newlines so a multi-line command stays one line", () => {
  const s = summarizeToolInput("Bash", { command: "echo a\nrm -rf /\necho b" });
  assert.ok(!s.includes("\n"), "no newline may survive into the one-liner");
});

test("oneLine caps length with an ellipsis and trims whitespace", () => {
  const s = oneLine("x".repeat(500), 20);
  assert.equal(s.length, 20);
  assert.ok(s.endsWith("…"));
  assert.equal(oneLine("  a   b \n c ", 100), "a b c");
});

test("shortToolName strips the mcp prefix to the last segment", () => {
  assert.equal(shortToolName("mcp__dopl__dopl_channel"), "dopl_channel");
  assert.equal(shortToolName("Bash"), "Bash");
});

// ── reduceEvent: init / status / usage ───────────────────────────────────────

test("init populates the header info and moves launching -> running", () => {
  const s = reduceEvent(initialState(), {
    type: "init", sessionId: "s1", side: "responder", profile: "full",
    mode: "interactive", model: "claude", channelName: "Ops", taskTitle: "Ship it", cwdLabel: "~/repo",
  });
  assert.equal(s.init.channelName, "Ops");
  assert.equal(s.init.side, "responder");
  assert.equal(s.phase, "running");
});

test("status event drives the phase", () => {
  const s = reduceEvent(initialState(), { type: "status", phase: "awaiting_permission" });
  assert.equal(s.phase, "awaiting_permission");
});

test("usage event is IGNORED — the cost meter was removed (item 6)", () => {
  const s0 = initialState();
  assert.ok(!("usage" in s0), "initial state has no usage field");
  const s = reduceEvent(s0, {
    type: "usage", turnCostUsd: 0.012, totalCostUsd: 0.05, turns: 3, model: "claude",
  });
  assert.equal(s, s0, "an unknown `usage` event is a no-op (same reference)");
  assert.ok(!("usage" in s), "no usage state is ever created");
});

// ── reduceEvent: streaming turns ──────────────────────────────────────────────

test("streaming deltas accumulate into a single open turn, then finalize", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "turn", role: "assistant", text: "Hel", streaming: true });
  s = reduceEvent(s, { type: "turn", role: "assistant", text: "lo", streaming: true });
  assert.equal(s.items.length, 1);
  assert.equal(last(s).text, "Hello");
  assert.equal(last(s).streaming, true);
  s = reduceEvent(s, { type: "turn", role: "assistant", text: "", streaming: false });
  assert.equal(s.items.length, 1, "finalize must not create a second turn");
  assert.equal(last(s).streaming, false);
  assert.equal(last(s).text, "Hello");
});

test("a non-streaming turn with no open stream is a standalone complete turn", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "turn", role: "assistant", text: "Done." });
  assert.equal(s.items.length, 1);
  assert.equal(last(s).streaming, false);
  assert.equal(last(s).text, "Done.");
});

test("an operator turn after an agent turn starts a new bubble", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "turn", role: "assistant", text: "hi", streaming: true });
  s = reduceEvent(s, { type: "turn", role: "operator", text: "go", streaming: false });
  assert.equal(s.items.length, 2);
  assert.equal(s.items[1].role, "operator");
});

// ── reduceEvent: tool cards ───────────────────────────────────────────────────

test("tool_use creates a pending card with a derived summary; tool_result fills it", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: { command: "ls" } });
  assert.equal(last(s).kind, "tool");
  assert.equal(last(s).status, "pending");
  assert.equal(last(s).inputSummary, "$ ls");
  s = reduceEvent(s, { type: "tool_result", toolUseId: "t1", ok: true, resultSummary: "2 files" });
  assert.equal(last(s).status, "ok");
  assert.equal(last(s).resultSummary, "2 files");
});

test("tool_use prefers an engine-supplied inputSummary over the derived one", () => {
  const s = reduceEvent(initialState(), {
    type: "tool_use", toolUseId: "t2", name: "Bash", inputSummary: "run build", inputFull: { command: "npm run build" },
  });
  assert.equal(last(s).inputSummary, "run build");
});

test("tool_result for an unknown id is a no-op (same state)", () => {
  const s0 = reduceEvent(initialState(), { type: "tool_use", toolUseId: "t1", name: "Read", inputFull: {} });
  const s1 = reduceEvent(s0, { type: "tool_result", toolUseId: "nope", ok: false });
  assert.equal(s1, s0, "no matching card -> unchanged reference");
});

test("tool_result ok:false marks the card as error", () => {
  let s = reduceEvent(initialState(), { type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: { command: "x" } });
  s = reduceEvent(s, { type: "tool_result", toolUseId: "t1", ok: false, resultSummary: "boom" });
  assert.equal(last(s).status, "error");
});

// ── reduceEvent: permission queue ─────────────────────────────────────────────

test("permission_request enqueues FIFO and dedups by requestId", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "permission_request", requestId: "r1", name: "Bash", inputFull: { command: "rm x" } });
  s = reduceEvent(s, { type: "permission_request", requestId: "r2", name: "Write", inputFull: { file_path: "/a" } });
  s = reduceEvent(s, { type: "permission_request", requestId: "r1", name: "Bash", inputFull: { command: "rm x" } }); // dup
  assert.equal(s.permissions.length, 2);
  assert.equal(nextPermission(s).requestId, "r1");
  assert.equal(nextPermission(s).inputSummary, "$ rm x");
});

test("permission_resolved removes the matching request from the queue", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "permission_request", requestId: "r1", name: "Bash", inputFull: {} });
  s = reduceEvent(s, { type: "permission_request", requestId: "r2", name: "Write", inputFull: {} });
  s = reduceEvent(s, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.equal(s.permissions.length, 1);
  assert.equal(nextPermission(s).requestId, "r2");
});

test("nextPermission returns null on an empty queue", () => {
  assert.equal(nextPermission(initialState()), null);
});

// ── reduceEvent: inbound (interactive) ────────────────────────────────────────

test("counterparty (autonomous reply) appends a counterparty item (item 1)", () => {
  const s = reduceEvent(initialState(), { type: "counterparty", from: "Alice", text: "reply" });
  assert.equal(last(s).kind, "counterparty");
  assert.equal(last(s).from, "Alice");
  assert.equal(last(s).text, "reply");
});

test("legacy `inbound` still maps to a counterparty item (mid-wave alias)", () => {
  const s = reduceEvent(initialState(), { type: "inbound", from: "Bob", text: "hi" });
  assert.equal(last(s).kind, "counterparty");
  assert.equal(last(s).from, "Bob");
});

test("inbound_pending + markInboundReleased flips released without mutating", () => {
  let s = reduceEvent(initialState(), { type: "inbound_pending", pendingId: "p1", from: "Alice", text: "hold" });
  assert.equal(last(s).released, false);
  const before = s;
  s = markInboundReleased(s, "p1");
  assert.equal(last(s).released, true);
  assert.equal(last(before).released, false, "original state item must not be mutated");
});

test("markInboundReleased on an unknown id is a no-op (same reference)", () => {
  const s0 = reduceEvent(initialState(), { type: "inbound_pending", pendingId: "p1", from: "A", text: "x" });
  assert.equal(markInboundReleased(s0, "nope"), s0);
});

// ── reduceEvent: ended / error ────────────────────────────────────────────────

test("ended sets the terminal phase + settlement fields", () => {
  const s = reduceEvent(initialState(), {
    type: "ended", outcome: "completed", summary: "done", totalCostUsd: 0.2, reason: "close_task",
  });
  assert.equal(s.phase, "ended");
  assert.equal(s.ended.outcome, "completed");
  assert.equal(s.ended.reason, "close_task");
});

test("error records lastError and a visible notice item", () => {
  const s = reduceEvent(initialState(), { type: "error", message: "query threw" });
  assert.equal(s.lastError, "query threw");
  assert.equal(last(s).kind, "notice");
  assert.equal(last(s).level, "error");
});

test("an unknown event type is ignored (same reference)", () => {
  const s0 = initialState();
  assert.equal(reduceEvent(s0, { type: "nope" }), s0);
  assert.equal(reduceEvent(s0, null), s0);
});

// ── immutability guarantee ────────────────────────────────────────────────────

test("reduceEvent never mutates the input state", () => {
  const s0 = initialState();
  const frozenItems = s0.items;
  const s1 = reduceEvent(s0, { type: "turn", role: "assistant", text: "hi" });
  assert.equal(s0.items, frozenItems, "items array reference on the old state is unchanged");
  assert.equal(s0.items.length, 0, "old state still empty");
  assert.notEqual(s1, s0);
  assert.equal(s1.items.length, 1);
});

test("hostile agent text is carried verbatim as a data string (no parsing here)", () => {
  const evil = '<img src=x onerror=alert(1)> </script>';
  const s = reduceEvent(initialState(), { type: "turn", role: "assistant", text: evil });
  // The reducer keeps it as an exact string; session.js renders it via textContent.
  assert.equal(last(s).text, evil);
  const sum = summarizeToolInput("Bash", { command: evil });
  assert.equal(typeof sum, "string");
  assert.ok(!sum.includes("\n"));
});

// ── reduceEvent: outbound_post (item 2) ───────────────────────────────────────

test("outbound_post appends a distinct outbound item with the peer + body", () => {
  const s = reduceEvent(initialState(), {
    type: "outbound_post", toolUseId: "t1", to: "Alice", text: "on it",
  });
  assert.equal(last(s).kind, "outbound");
  assert.equal(last(s).to, "Alice");
  assert.equal(last(s).text, "on it");
  assert.equal(last(s).toolUseId, "t1");
});

test("outbound_post is a separate lane from a narration turn", () => {
  let s = initialState();
  s = reduceEvent(s, { type: "turn", role: "assistant", text: "thinking" });
  s = reduceEvent(s, { type: "outbound_post", to: "Alice", text: "sent" });
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].kind, "turn");
  assert.equal(s.items[1].kind, "outbound");
});

// ── reduceEvent: status + activity (item 3) ───────────────────────────────────

test("status carries phase AND activity; activity is sticky across a bare status", () => {
  let s = reduceEvent(initialState(), { type: "status", phase: "running", activity: "working" });
  assert.equal(s.phase, "running");
  assert.equal(s.activity, "working");
  s = reduceEvent(s, { type: "status", phase: "running" }); // no activity -> keep last
  assert.equal(s.activity, "working");
});

test("statusText keys on activity while running, else on the phase", () => {
  assert.equal(statusText("running", "working"), "Working");
  assert.equal(statusText("running", "idle"), "Idle");
  assert.equal(statusText("running", "awaiting_peer"), "Waiting for reply");
  assert.equal(statusText("running", "awaiting_permission"), "Awaiting permission");
  assert.equal(statusText("running", "awaiting_inbound"), "Reply ready");
  assert.equal(statusText("consent", null), "Consent");
  assert.equal(statusText("launching", null), "Launching");
  assert.equal(statusText("ended", "working"), "Ended"); // phase wins when not running
});

test("statusDotKey → act-<activity> while running, else is-<phase>", () => {
  assert.equal(statusDotKey("running", "working"), "act-working");
  assert.equal(statusDotKey("running", "awaiting_peer"), "act-awaiting_peer");
  assert.equal(statusDotKey("consent", null), "is-consent");
  assert.equal(statusDotKey("ended", "idle"), "is-ended");
});

// ── reduceEvent: folder (item 7) ──────────────────────────────────────────────

test("folder stores the LABEL; folderLabel falls back to the ~/Downloads default (item 5/6)", () => {
  const s = reduceEvent(initialState(), { type: "folder", label: "~/Downloads/repo" });
  assert.equal(s.folder.label, "~/Downloads/repo");
  assert.equal(folderLabel(s.folder), "~/Downloads/repo");
  const cleared = reduceEvent(s, { type: "folder", label: null });
  assert.equal(cleared.folder.label, null);
  // The engine now always emits a real dir; the null case is only the pre-event
  // render, which falls back to the same ~/Downloads default (never "sandbox").
  assert.equal(folderLabel(cleared.folder), "~/Downloads");
  assert.equal(folderLabel(null), "~/Downloads");
});

// ── reduceEvent: consent (item 8) ─────────────────────────────────────────────

test("consent_request moves to phase:consent and captures the request card fields", () => {
  const s = reduceEvent(initialState(), {
    type: "consent_request", requestId: "c1", from: "Alice", summary: "review the PR",
    bodyText: "please look", taskTitle: "PR #4", channelName: "Ops",
    toolProfileLabel: "Full access", cwdLabel: "~/repo",
  });
  assert.equal(s.phase, "consent");
  assert.equal(s.consent.from, "Alice");
  assert.equal(s.consent.taskTitle, "PR #4");
  assert.equal(s.consent.cwdLabel, "~/repo");
  assert.equal(s.consentResolved, null);
  assert.equal(s.items.length, 0, "NO agent content renders before accept (§H-1)");
});

test("consent_resolved records the terminal decision without clearing the card", () => {
  let s = reduceEvent(initialState(), { type: "consent_request", requestId: "c1", from: "A" });
  s = reduceEvent(s, { type: "consent_resolved", decision: "denied" });
  assert.equal(s.consentResolved.decision, "denied");
  assert.equal(s.phase, "consent");
  assert.ok(s.consent, "the card fields remain so the note can show on it");
});

test("init adopts a pre-consent window: phase consent → running", () => {
  let s = reduceEvent(initialState(), { type: "consent_request", requestId: "c1", from: "A" });
  assert.equal(s.phase, "consent");
  s = reduceEvent(s, { type: "init", channelName: "Ops", from: "Alice" });
  assert.equal(s.phase, "running");
  assert.equal(s.init.from, "Alice");
});

// ── security: the DOM factories never use innerHTML (structural) ──────────────

test("session-render.js sets textContent only — never innerHTML (injection guard)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(
    fileURLToPath(new URL("../renderer/session/session-render.js", import.meta.url)), "utf8"
  );
  assert.ok(!/\.innerHTML/.test(src), "no .innerHTML anywhere in the DOM factories");
  assert.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(src), "no HTML-string sink");
  assert.ok(/textContent/.test(src), "strings reach the DOM via textContent");
});

test("session.js (controller) also never uses innerHTML", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(
    fileURLToPath(new URL("../renderer/session/session.js", import.meta.url)), "utf8"
  );
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src));
});

test("session-preload.js (new setAutoApprove path) uses no HTML sink", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(
    fileURLToPath(new URL("../renderer/session/session-preload.js", import.meta.url)), "utf8"
  );
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML/.test(src));
  assert.ok(/setAutoApprove/.test(src), "the item-10 bridge method is exposed");
  assert.ok(/session:set-auto-approve/.test(src), "invokes the frozen IPC channel");
});

// ── init: profileLabel + peer identity (items 9 + 2) ──────────────────────────

test("init stores the profileLabel (item 9) and the peer name `from` (item 2)", () => {
  const s = reduceEvent(initialState(), {
    type: "init", channelName: "Direct message", from: "David", profile: "full",
    profileLabel: "Full access", model: "claude",
  });
  assert.equal(s.init.profileLabel, "Full access");
  assert.equal(s.init.from, "David");
  assert.equal(s.init.profile, "full");
});

// ── auto-approve state (item 10) ──────────────────────────────────────────────

test("a launched session starts with auto-approve OFF (item 10)", () => {
  assert.equal(initialState().autoApprove, false);
});

test("auto_approve event flips the per-session flag both ways (item 10)", () => {
  let s = reduceEvent(initialState(), { type: "auto_approve", enabled: true });
  assert.equal(s.autoApprove, true);
  s = reduceEvent(s, { type: "auto_approve", enabled: false });
  assert.equal(s.autoApprove, false);
  // Only an explicit boolean true enables it (fail-closed).
  assert.equal(reduceEvent(initialState(), { type: "auto_approve" }).autoApprove, false);
  assert.equal(reduceEvent(initialState(), { type: "auto_approve", enabled: "yes" }).autoApprove, false);
});

// ── permissionModeText (items 9 + 10) ─────────────────────────────────────────

test("permissionModeText maps the auto-approve flag to the posture label", () => {
  assert.equal(
    permissionModeText(false, "Full access"),
    "Permissions: Asking each time · Full access"
  );
  assert.equal(
    permissionModeText(true, "Full access"),
    "Permissions: Auto-approving · Full access"
  );
  // No profile → just the mode; no trailing separator.
  assert.equal(permissionModeText(false, null), "Permissions: Asking each time");
  assert.equal(permissionModeText(true, ""), "Permissions: Auto-approving");
  // No em dash in our own copy (§H-13).
  assert.ok(!permissionModeText(true, null).includes("—"));
});

// ── item 2: initials avatar ───────────────────────────────────────────────────

test("initial() returns the uppercase first letter, else '?' (item 2 avatar)", () => {
  assert.equal(render.initial("david"), "D");
  assert.equal(render.initial("  amy"), "A");
  assert.equal(render.initial("Örn"), "Ö");
  assert.equal(render.initial(""), "?");
  assert.equal(render.initial(null), "?");
});

// ── item 10: the permission dock renders all THREE actions ────────────────────

test("session.html: the permission dock renders all THREE actions with exact labels (item 10)", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(
    fileURLToPath(new URL("../renderer/session/session.html", import.meta.url)), "utf8"
  );
  assert.match(html, /id="btnAllowOnce"[^>]*>Allow once</);
  assert.match(html, /id="btnAllowTask"[^>]*>Allow for this task</);
  assert.match(html, /id="btnDeny"[^>]*>Deny</);
  // The auto-approve toggle + posture label exist (items 9/10).
  assert.match(html, /id="autoApprove"/);
  assert.match(html, /id="permPosture"/);
  // The folder pill replaced the old chip/change/use-default cluster (item 5).
  assert.match(html, /id="folderPill"[^>]*>Working Directory:/);
  assert.ok(!/btnFolderChange|btnFolderDefault|folder-chip/.test(html), "old folder chip cluster is removed");
});

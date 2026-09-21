// SESSION SUMMARIES — the report view and the change subscription (F-147).
//
// `session-summary.test.mjs` pins what the OPERATOR sees (mapping, naming, wire shape, ended
// retention, renderer frame). This file pins the seam read-session-state hangs off: the two facts
// a server row needs that a pill does not, and the event the writer rides. Both share
// `_session-summary-harness.mjs`.
//
// The property under all of it: a server write must cost a STATE CHANGE, never a turn and never a
// window rebuild. `agent_presence` heartbeats 120 times an hour per listener, and if this gate is
// wrong in the cheap direction the replacement is the thing it replaced.
//
// Run: `node --test dopl-desktop-app/test/session-summary-report.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, session, endedRecord } from "./_session-summary-harness.mjs";

const settle = (m) => new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));

// ── 1. THE REPORT SHAPE ──────────────────────────────────────────────────────────────

test("REPORT: an entry carries the session KEY and the WORKSPACE a row cannot do without", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  const [entry] = m.reportList();
  // The upsert key is the STABLE (channel, thread, AGENT) key, never `sessionId` — a park, a lazy
  // resume and a crash each mint a fresh sessionId. The AGENT segment joined 2026-08-21: without
  // it two of the operator's agents on one thread would upsert onto ONE row.
  assert.equal(entry.key, "chan-1:task-1:a1b2c3d4");
  assert.equal(entry.workspaceId, "ws-1");
  // …and everything the pill shows is still there, unchanged.
  assert.equal(entry.sessionId, "sess-1");
  assert.equal(entry.name, "a1b2c3d4");
  assert.equal(entry.agentId, "a1b2c3d4");
  assert.equal(entry.state, "working");
  assert.equal(entry.channelName, "general");
  assert.equal(entry.threadTitle, "Ship the thing");
  // 2026-08-22: `null` is the honest answer for a BLANK agent. Absent would be a different claim
  // on a wire whose reader cannot tell them apart once JSON.stringify has dropped it.
  assert.equal(entry.templateName, null);
});

test("REPORT: `list()` narrows the report-only `key` back off — `workspaceId` rides the wire", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  // The five measurement fields (Phase 5, 2026-08-18) and `detail` / `toolLabel` (2026-08-20) are
  // NOT report-only — they are LOCAL-only, which is a different claim and is asserted where it
  // bites, in `session-state-push.test.mjs`'s row shape. The claim here is narrower and unchanged:
  // whatever the wire carries, the two REPORT fields are not on it.
  assert.deepEqual(Object.keys(m.list()[0]).sort(), [
    // Most fields below are LOCAL-only: `session-state-push.js › reportRow` picks the server
    // columns BY NAME, so they never reach `channel_sessions`. The exceptions are noted inline.
    // `agentId` joined 2026-08-21 and IS on the wire: session ops address ONE agent among several,
    // and (channelId, taskId) can no longer say which.
    "agentId", "channelId", "channelName",
    // `color` (2026-09-13, Samuel's agent-colours ruling) DOES reach the server: peer-visible by
    // design, since a colour is drawn on every member's transcript.
    "color",
    "contextUsed", "contextWindow",
    // The health half (2026-09-01, T25 / T50 / T51 / T83) also reaches the server, onto
    // OPERATOR-ONLY columns.
    "deniedCalls",
    "description", "detail",
    // `diag` (2026-09-13, F-692) is the sentence an operator reads when a launch could not run at
    // all — the one state the three-value pill cannot express.
    "diag",
    "displayName",
    // ── 2026-09-21 (U10) — `endReason` / `runtimeId` / `usageBaseline`, ALL THREE LOCAL-ONLY ──
    // `endReason` is the STRUCTURED half of `diag` above: the code was frozen, the sentence is
    // rebuilt at read time from the runtime that produced it, so a Codex failure reads as a Codex
    // failure. `runtimeId` says WHO is answering where `model` says WHAT. `usageBaseline` is the
    // three-word answer to whether a resume would keep the cost cap honest. None is named by
    // `session-state-push.js › reportRow`, so none of them reaches `channel_sessions`.
    // ⚠ `endReason` SORTS BEFORE `endedAt` — capital `R`, and this list is asserted SORTED.
    "endReason", "endedAt",
    // `heldGates` (2026-09-17, Samuel's inline-approval ruling) is local-only, and that matters
    // more here than elsewhere: an entry carries a one-line summary of a TOOL INPUT, which is a
    // fact about this machine and nobody else's business.
    "heldGates",
    "lastActivityAt", "lastDeniedTool", "lastWakeAt", "lastWakeSeq", "listening", "messageMode",
    "model",
    "name", "runtimeId", "sessionId", "stale", "startedAt", "state", "taskId",
    // `templateName` (2026-08-22) is named in `reportRow` on purpose — Phase 4 added the column.
    "templateName", "threadTitle", "tokensDelta", "tokensSpent", "toolLabel", "toolMode",
    "turns",
    "usageBaseline",
    // `workspaceId` joined the WIRE on 2026-09-14 (the pop-out rail routes by it).
    "workspaceId",
  ]);
  // `key` is report-only; `workspaceId` rides the wire since 2026-09-14.
  assert.equal("key" in m.list()[0], false);
  assert.equal(m.list()[0].workspaceId, "ws-1");
});

test("REPORT: it is ONE pass — the wire rows are the report rows, minus two fields", () => {
  const m = load();
  m.bind({
    sessions: new Map([
      ["chan-1:task-1", session()],
      ["chan-2:task-9", session({ channelId: "chan-2", taskId: "task-9", sessionId: "s2", workspaceId: "ws-2" })],
    ]),
  });
  assert.deepEqual(m.list(), m.reportList().map(m.wireSummary));
});

test("REPORT: a thread-less responder reports a real key and a NULL thread", () => {
  const m = load();
  const s = session({ taskId: "", context: {} });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const [entry] = m.reportList();
  assert.equal(entry.key, "chan-1::a1b2c3d4");
  assert.equal(entry.taskId, "", "the wire keeps '' — the writer is what turns it into NULL");
  assert.equal(entry.workspaceId, "ws-1");
});

test("REPORT: an ENDED retained entry carries the workspace frozen at settle time", () => {
  // It comes from the durable history (2026-08-22, Samuel's ended-agent ruling): the projection
  // reads `agent-history.js › listEnded`, which is why an ended card survives a restart — and why
  // the workspace has to be frozen into the record, since the session object is long gone.
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord({ workspaceId: "ws-7" })] });
  const [entry] = m.reportList();
  assert.equal(entry.state, "ended");
  assert.equal(entry.key, "chan-1:task-1:a1b2c3d4");
  assert.equal(entry.workspaceId, "ws-7");
  assert.equal(entry.endedAt, 1700000600000, "the 7-day clock rides the row");
  assert.equal(entry.listening, false, "nothing terminal is listening");
});

test("REPORT: a session with no workspace reports '' rather than undefined", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session({ workspaceId: undefined })]]) });
  assert.equal(m.reportList()[0].workspaceId, "");
});

// ── 2. THE CHANGE SUBSCRIPTION — THE WRITER'S ONE TRIGGER ────────────────────────────

test("CHANGE: a subscriber gets the report entries when the projection first moves", async () => {
  const m = load();
  const seen = [];
  m.subscribe((entries) => seen.push(entries));
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].key, "chan-1:task-1:a1b2c3d4");
  assert.equal(seen[0][0].workspaceId, "ws-1");
});

test("CHANGE: a burst of dispatches with nothing moving costs ZERO further events", async () => {
  const m = load();
  const seen = [];
  const s = session();
  m.subscribe((entries) => seen.push(entries));
  m.bind({ sessions: new Map([[s.key, s]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  assert.equal(seen.length, 1);
  // One turn is dozens of engine dispatches — tool results, token counts, cost deltas.
  // NONE of them is a pill state change, and none of them may cost a server write.
  for (let i = 0; i < 50; i += 1) m.touch();
  await settle(m);
  assert.equal(seen.length, 1, "this gate is the difference between a push and a heartbeat");
  // A REAL transition does fire, exactly once.
  s.state = { phase: "running", activity: "awaiting_peer" };
  m.touch();
  await settle(m);
  assert.equal(seen.length, 2);
  assert.equal(seen[1][0].state, "idle");
});

test("CHANGE: a REBUILT renderer repaints but is NOT a change — the two gates are separate", async () => {
  const m = load();
  const seen = [];
  m.subscribe((entries) => seen.push(entries));
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  assert.equal(m.sent.length, 1);
  assert.equal(seen.length, 1);
  // The SPA window is closed and reopened: `start()` resets the window's digest so the fresh
  // renderer is painted. Nothing about the SESSIONS changed, so the server must not be written to.
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  assert.equal(m.sent.length, 2, "the renderer is repainted");
  assert.equal(seen.length, 1, "and the server is not");
});

test("CHANGE: an event that reached NO window still counts — delivery is not the trigger", async () => {
  const m = load();
  const seen = [];
  m.subscribe((entries) => seen.push(entries));
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [] }); // headless: the SPA window is not built
  await settle(m);
  assert.equal(m.sent.length, 0);
  assert.equal(seen.length, 1, "a session runs whether or not anyone is looking at it");
});

test("CHANGE: unsubscribing stops it, and the renderer feed is untouched", async () => {
  const m = load();
  const seen = [];
  const s = session();
  const off = m.subscribe((entries) => seen.push(entries));
  m.bind({ sessions: new Map([[s.key, s]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  assert.equal(seen.length, 1);
  off();
  s.state = { phase: "ended", activity: "idle" };
  m.touch();
  await settle(m);
  assert.equal(seen.length, 1);
  assert.equal(m.sent.length, 2, "the pills keep working with nobody subscribed");
});

test("CHANGE: a non-function subscriber is a no-op, not a crash", () => {
  const m = load();
  assert.equal(typeof m.subscribe(null), "function");
  assert.equal(typeof m.subscribe("nope"), "function");
});

test("CHANGE: a THROWING subscriber cannot break the engine's dispatch", async () => {
  const m = load();
  const after = [];
  m.subscribe(() => { throw new Error("writer exploded"); });
  m.subscribe((entries) => after.push(entries)); // registered after the thrower
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  // `touch()` is called from the engine's dispatch, so an exception here would unwind into the
  // SDK event loop. The frame still lands, the next subscriber still runs, and it is logged.
  assert.equal(m.sent.length, 1);
  assert.equal(after.length, 1);
  assert.ok(m.logged.some((l) => l.includes("change subscriber threw")));
});

test("CHANGE: ending a session is a change, and so is its pill leaving", async () => {
  const m = load();
  const seen = [];
  m.subscribe((entries) => seen.push(entries));
  const s = session();
  m.bind({ sessions: new Map([[s.key, s]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await settle(m);
  assert.equal(seen.length, 1);
  // The end: the pill (and the row) stay as `ended`, now read from the durable history.
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord()] });
  m.noteEnded(s, true);
  await settle(m);
  assert.equal(seen.length, 2);
  assert.equal(seen[1][0].state, "ended");
  // The third beat is deleted (2026-08-20, F-234): retention no longer consults a window — every
  // session is windowless — so nothing makes a retained pill leave except the `MAX_ENDED` bound.
  // The rule that survives: a retained pill is STABLE across projections, and the writer is not
  // told to delete a row that is still on the tab.
  m.touch();
  await settle(m);
  assert.equal(seen.length, 2, "a projection with nothing new is not a change");
  assert.equal(m.list().length, 1, "and the retained pill is still there");
});

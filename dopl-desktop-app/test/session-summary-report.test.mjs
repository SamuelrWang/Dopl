// SESSION SUMMARIES — THE REPORT VIEW AND THE CHANGE SUBSCRIPTION (F-147).
//
// WHAT THIS FILE IS ABOUT, and why it is separate from `session-summary.test.mjs`: that
// file pins what the OPERATOR sees (the mapping, the naming, the wire shape, the ended
// retention rule, the renderer frame). This one pins the seam rollback §3.5's
// read-session-state hangs off — the two facts a server row needs that a pill does not, and
// the event the writer rides. Both share `_session-summary-harness.mjs`.
//
// THE PROPERTY UNDER ALL OF IT: a server write must cost a STATE CHANGE and never a turn,
// and never a window rebuild. `agent_presence` heartbeats 120 times an hour per listener and
// is the quadratic always-on term plan §5 is shedding; if this gate is wrong in the cheap
// direction, the replacement is the thing it replaced.
//
// ⚠ NOTHING HERE WAS REMOVED BY THE SESSION-WINDOW WAVE (2026-08-20, F-228) AND NOTHING HERE IS
// ABOUT A WINDOW. Every case in this file failed at LOAD, not on an assertion: the shared
// harness's `EXPORTED` list still named `main/session-summary.js › keptWindow`, and that list
// feeds a `new Function` return, so one deleted symbol is a ReferenceError for all fourteen. The
// harness lost the name; the report shape and the change gate are untouched.
// ⚠ ONE CASE STILL DRIVES A WINDOW HANDLE — "ending a session is a change, and so is its pill
// leaving" flips `s.win.destroyed` to make a retained pill lapse. That is the RETENTION
// predicate, which is live source that the engine can no longer satisfy; the argument is written
// out over §4 of `session-summary.test.mjs` and is not restated here.
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
  // The upsert key is the STABLE (channel, thread, AGENT) key, never `sessionId` — a park, a
  // lazy resume and a crash recreate all mint a fresh sessionId for the same session.
  // ⚠ The AGENT segment joined 2026-08-21: without it two of the operator's agents on one
  // thread would upsert onto ONE row and each overwrite the other's state.
  assert.equal(entry.key, "chan-1:task-1:a1b2c3d4");
  assert.equal(entry.workspaceId, "ws-1");
  // …and everything the pill shows is still there, unchanged.
  assert.equal(entry.sessionId, "sess-1");
  assert.equal(entry.name, "a1b2c3d4");
  assert.equal(entry.agentId, "a1b2c3d4");
  assert.equal(entry.state, "working");
  assert.equal(entry.channelName, "general");
  assert.equal(entry.threadTitle, "Ship the thing");
  // ⚠ 2026-08-22: the fixture carries no template, and `null` is the honest answer for a
  // BLANK agent. Absent would be a different claim on a wire whose reader cannot tell them
  // apart once JSON.stringify has dropped it.
  assert.equal(entry.templateName, null);
});

test("REPORT: `list()` narrows the two report-only fields back off — the wire is unchanged", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  // ⚠ The five measurement fields joined the wire in Phase 5 (2026-08-18) and they are
  // NOT report-only: the Agents tab is their whole audience. What stays report-only is
  // still exactly two, and the point of this case is that the narrowing did not widen.
  // ⚠ `detail` and `toolLabel` joined on 2026-08-20 and are NOT report-only either — they
  // are LOCAL-only, which is a different claim and is asserted where it bites: the server
  // never sees them because `session-state-push.js › reportRow` picks columns by name, and
  // `session-state-push.test.mjs` pins that row shape. Here the claim is narrower and
  // unchanged: whatever the wire carries, the two REPORT fields are not on it.
  assert.deepEqual(Object.keys(m.list()[0]).sort(), [
    // ⚠ `toolMode` / `messageMode` joined 2026-08-20 (the agent view's live controls) and
    // are LOCAL-only for the same reason `detail` is — asserted where it bites, in
    // `session-state-push.test.mjs`'s row shape. Here the claim is the narrower one and is
    // unchanged: whatever the wire carries, the two REPORT fields are not on it.
    // ⚠ `agentId` joined 2026-08-21 and IS on the wire: the Agents tab addresses pause / end /
    // setMode / message / narration at ONE agent among several, and (channelId, taskId) can no
    // longer say which. It is LOCAL-only in the other direction — `reportRow` picks the server
    // columns by name and files the same string as `name`.
    // ⚠ `listening` joined 2026-08-22 and is LOCAL-only in the same sense `detail` is: it
    // refines the `idle` pill into Waiting (query alive, a message feeds it) vs Idle (torn down,
    // a message relaunches it), and `reportRow` picks the server columns by name so it never
    // reaches `channel_sessions`.
    // ⚠ `endedAt` joined 2026-08-22 and is LOCAL-only for the same reason: it is the 7-day
    // retention clock the OPERATOR's own cards render from, and `reportRow` picks the server
    // columns by name so it never reaches `channel_sessions`.
    "agentId", "channelId", "channelName", "contextUsed", "contextWindow", "detail", "endedAt",
    "lastActivityAt", "listening", "messageMode",
    // ⚠ `model` joined 2026-08-22 (Samuel's model-selection ruling) and is LOCAL-only on the same
    // terms as `detail` / `toolMode` / `messageMode`: `session-state-push.js › reportRow` picks
    // columns by name, so the wire is unchanged and the claim here stays the narrower one.
    "model",
    "name", "sessionId", "startedAt", "state", "taskId",
    // ⚠ `templateName` joined 2026-08-22 (agent templates) and is the ONE field on this list
    // that is NOT local-only: it is named in `reportRow` on purpose, because Phase 4 added the
    // column to receive it. It is still not REPORT-only, which is all this case claims.
    "templateName", "threadTitle", "tokensSpent", "toolLabel", "toolMode",
  ]);
  // The renderer has no use for either, and `DesktopSessionSummary` is a wire contract.
  assert.equal("key" in m.list()[0], false);
  assert.equal("workspaceId" in m.list()[0], false);
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
  // ⚠ IT COMES FROM THE DURABLE HISTORY NOW (2026-08-22, Samuel's ended-agent ruling), not
  // from an in-memory list `noteEnded` appended to. The projection READS `agent-history.js ›
  // listEnded`, which is why an ended card survives a restart — and why the workspace has to
  // be frozen into the record: the session object is long gone.
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
  // The SPA window is closed and reopened: `start()` resets the window's digest so the
  // fresh renderer is painted. Nothing about the SESSIONS changed, so the server must not
  // be written to — a window rebuild is not an event the server has any interest in.
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
  // `touch()` is called from the engine's dispatch, so an exception here would unwind into
  // the SDK event loop. The frame still lands, the next subscriber still runs, and the
  // failure is on the record.
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
  // ⚠ THE THIRD BEAT IS DELETED, AND ITS SUBJECT WITH IT (2026-08-20, F-234). It read: "the
  // operator closes that window: the pill leaves, and the writer is told the set is now empty
  // — which is what deletes the row", driven by `s.win.destroyed = true`. Retention no longer
  // consults a window (it could not: every session is windowless, which is why NOTHING was
  // being retained at all), so there is no event that makes a retained pill leave except the
  // `MAX_ENDED` bound. Rewritten to the rule that survives: a retained pill is STABLE across
  // projections, and the writer is not told to delete a row that is still on the tab.
  m.touch();
  await settle(m);
  assert.equal(seen.length, 2, "a projection with nothing new is not a change");
  assert.equal(m.list().length, 1, "and the retained pill is still there");
});

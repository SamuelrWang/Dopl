// FIX Q1: the TASK WINDOW — which of a channel's rows belong to the task a reopened window
// is showing (main/session-history.js, sliced through test/helpers/session-history.mjs).
//
// The bug this suite exists for: "Open session" on a finished task replayed the ENTIRE
// channel, and fed that same wall of unrelated conversation into the fresh run's first turn
// as seed context. FIX F17 had widened the read to a PAIR-scoped fallback whenever the
// task-scoped pass came back empty — and for a LEGACY task that pass is ALWAYS empty, because
// nothing ever stamps `metadata.taskId` on the messages themselves (the request predates the
// derived id, and the reply is posted untagged). In a DM, pair-scoped IS channel-scoped.
//
// The rule now: a shell WITH a task id gets the rows stamped with that task, plus the
// UNSTAMPED two-party messages inside the task's own `seq` span — and NOTHING otherwise. It
// never falls through to the whole channel again. The span comes off the rows already
// fetched, so there is no second request and no unindexed server-side `metadata->>'taskId'`
// filter; `seq` is compared only within one page (FIX F5: it is a table-wide identity, never
// a cursor). A shell with NO task id at all still takes the pair-scoped pass: nothing bounds
// a window, and the pair is the only honest scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realIo, harness, msg, session, parties, legacyThread, PAIR,
  TASK, LEGACY_TASK, LEGACY_SEQ, CHANNEL, PEER, ME,
} from "./helpers/session-history.mjs";

// ── parseLegacyTaskSeq: the id that CARRIES its opener's seq ──────────────────────
// `task-<channelId>-<seq>` is what the desktop derives when a trigger has no first-class
// task (trigger.js:61). The channel id is a UUID full of hyphens in prod, so the parse
// anchors on the whole prefix — splitting on '-' would read a chunk of the UUID as the seq.

test("parseLegacyTaskSeq reads the trailing seq, anchored on the CHANNEL prefix", () => {
  const h = harness();
  const uuid = "dba90694-2f7c-4a1b-9d3e-5c6f0a1b2c3d";
  assert.equal(h.parseLegacyTaskSeq(`task-${uuid}-4212`, uuid), 4212, "a hyphen-rich uuid is fine");
  assert.equal(h.parseLegacyTaskSeq(LEGACY_TASK, CHANNEL), LEGACY_SEQ);
  assert.equal(h.parseLegacyTaskSeq(`task-${uuid}-4212`, "other-channel"), null, "another channel");
  assert.equal(h.parseLegacyTaskSeq(TASK, CHANNEL), null, "a first-class id has no seq to read");
  assert.equal(h.parseLegacyTaskSeq(`task-${CHANNEL}-12x`, CHANNEL), null, "not all digits");
  assert.equal(h.parseLegacyTaskSeq(`task-${CHANNEL}-`, CHANNEL), null, "no seq at all");
  assert.equal(h.parseLegacyTaskSeq("task--5", ""), null, "an empty channel id never matches");
});

// ── the window itself ─────────────────────────────────────────────────────────────

test("taskWindow: a LEGACY id reaches BACK to its opener, which nothing stamped", () => {
  const h = harness();
  const win = h.taskWindow(legacyThread(), LEGACY_TASK, CHANNEL);
  assert.deepEqual(win, { startSeq: LEGACY_SEQ, endSeq: Infinity },
    "the id carries seq 96, so the request that started the task is inside the window");
});

test("taskWindow: a FIRST-CLASS id starts at the oldest row that names it", () => {
  const h = harness();
  const rows = [
    msg({ body: "older chatter", metadata: {}, seq: 40 }),
    msg({ body: "", kind: "task_started", seq: 50 }),
    msg({ body: "in the task", metadata: {}, seq: 51 }),
  ];
  assert.deepEqual(h.taskWindow(rows, TASK, CHANNEL), { startSeq: 50, endSeq: Infinity });
});

test("taskWindow: the task's OWN terminal event closes it", () => {
  const h = harness();
  for (const kind of ["task_finished", "task_failed"]) {
    const rows = legacyThread().concat([
      msg({ body: "", kind, metadata: { taskId: LEGACY_TASK }, seq: 120 }),
      msg({ body: "", kind, metadata: { taskId: "task-other" }, seq: 110 }),
    ]);
    assert.deepEqual(h.taskWindow(rows, LEGACY_TASK, CHANNEL), { startSeq: LEGACY_SEQ, endSeq: 120 },
      `${kind} ends the window, and another task's terminal event does not`);
  }
});

// FIX H1 — a reopened task settles more than once (park/interrupt → continue → settle
// again). The window must reach the LAST terminal so the continuation rounds between
// terminals stay visible on the next reopen; a successor task still caps the scan.
test("taskWindow: a REOPENED task's window reaches its LAST terminal", () => {
  const h = harness();
  const rows = legacyThread().concat([
    msg({ body: "", kind: "task_failed", metadata: { taskId: LEGACY_TASK }, seq: 110 }),
    msg({ body: "continued after reopen", metadata: {}, seq: 111 }),
    msg({ body: "peer follow-up", metadata: {}, authorUserId: PEER, seq: 112 }),
    msg({ body: "", kind: "task_finished", metadata: { taskId: LEGACY_TASK }, seq: 120 }),
  ]);
  assert.deepEqual(h.taskWindow(rows, LEGACY_TASK, CHANNEL), { startSeq: LEGACY_SEQ, endSeq: 120 },
    "second settle extends the window past the first interruption");
  // A successor task BETWEEN the terminals caps the scan: a terminal past the successor
  // belongs to a continuation this window can no longer own.
  const superseded = legacyThread().concat([
    msg({ body: "", kind: "task_failed", metadata: { taskId: LEGACY_TASK }, seq: 110 }),
    msg({ body: "", kind: "task_started", metadata: { taskId: "task-c1-115" }, seq: 115 }),
    msg({ body: "", kind: "task_finished", metadata: { taskId: LEGACY_TASK }, seq: 120 }),
  ]);
  assert.deepEqual(h.taskWindow(superseded, LEGACY_TASK, CHANNEL), { startSeq: LEGACY_SEQ, endSeq: 110 },
    "a terminal beyond the successor does not reopen the window");
});

// group-thread.ts:478 — a new task_started supersedes the open one, so the older task's
// window ends there even though it never announced an ending of its own.
test("taskWindow: the NEXT task supersedes an unfinished one (endSeq = its task_started)", () => {
  const h = harness();
  const rows = legacyThread().concat([
    msg({ body: "", kind: "task_started", metadata: { taskId: "task-c1-130" }, seq: 130 }),
    msg({ body: "", kind: "task_started", metadata: { taskId: "task-c1-140" }, seq: 140 }),
  ]);
  assert.deepEqual(h.taskWindow(rows, LEGACY_TASK, CHANNEL), { startSeq: LEGACY_SEQ, endSeq: 130 },
    "the FIRST successor closes it, not the last");
  // A malformed lifecycle row (no task id of its own) is not a successor: it must not
  // truncate real history.
  const malformed = legacyThread().concat([msg({ body: "", kind: "task_started", metadata: {}, seq: 130 })]);
  assert.equal(h.taskWindow(malformed, LEGACY_TASK, CHANNEL).endSeq, Infinity);
  // Nor is THIS task's own re-announcement.
  const restated = legacyThread().concat([
    msg({ body: "", kind: "task_started", metadata: { taskId: LEGACY_TASK }, seq: 130 }),
  ]);
  assert.equal(h.taskWindow(restated, LEGACY_TASK, CHANNEL).endSeq, Infinity);
});

test("taskWindow: NO anchor in the fetched rows -> null (never a whole-channel window)", () => {
  const h = harness();
  // The task is real, but its span scrolled out of the newest-200 read: nothing names it and
  // its opener seq is not here either. Guessing a start would paint the channel.
  const strangers = [
    msg({ authorUserId: PEER, body: "much later", metadata: {}, seq: 900 }),
    msg({ body: "later still", metadata: { taskId: "task-c1-880" }, seq: 901 }),
  ];
  assert.equal(h.taskWindow(strangers, LEGACY_TASK, CHANNEL), null);
  assert.equal(h.taskWindow(strangers, TASK, CHANNEL), null);
  assert.equal(h.taskWindow([], LEGACY_TASK, CHANNEL), null);
  assert.equal(h.taskWindow(null, LEGACY_TASK, CHANNEL), null);
  assert.equal(h.taskWindow(legacyThread(), "", CHANNEL), null, "no task -> no window to compute");
  // The opener is gone but the lifecycle row survives: the task IS in the page, so the
  // window opens at what is actually readable instead of reaching back to a vanished row.
  const openerGone = legacyThread().filter((r) => r.seq !== LEGACY_SEQ);
  assert.deepEqual(h.taskWindow(openerGone, LEGACY_TASK, CHANNEL), { startSeq: 97, endSeq: Infinity });
});

// ── historyEntries under the window ───────────────────────────────────────────────

test("FIX Q1: the LEGACY exchange renders in full, still only the TWO parties", () => {
  const h = harness();
  const out = h.historyEntries(legacyThread(), parties({ taskId: LEGACY_TASK }));
  assert.deepEqual(out.map((e) => [e.lane, e.text]), [["them", PAIR[0]], ["me", PAIR[1]]],
    "both untagged messages sit inside the task's span, so both render");
  assert.deepEqual(out.map((e) => e.from), ["David", "Sam"], "lanes and names are unchanged");
  assert.deepEqual(h.historyEntries(legacyThread(), parties({ taskId: "" })).map((e) => e.text), PAIR,
    "and an EMPTY task id takes the pair-scoped pass (a responder shell has none)");
});

test("FIX Q1: rows OUTSIDE the window never render, however chatty the channel is", () => {
  const h = harness();
  const rows = [
    msg({ authorUserId: PEER, authorName: "David", body: "last month", metadata: {}, seq: 10 }),
    msg({ body: "also last month", metadata: {}, seq: 11 }),
  ].concat(legacyThread()).concat([
    msg({ body: "", kind: "task_started", metadata: { taskId: "task-c1-130" }, seq: 130 }),
    msg({ authorUserId: PEER, authorName: "David", body: "a whole other task", metadata: {}, seq: 131 }),
    msg({ body: "answering that one", metadata: {}, seq: 132 }),
  ]);
  assert.deepEqual(h.historyEntries(rows, parties({ taskId: LEGACY_TASK })).map((e) => e.text), PAIR,
    "the reopened window shows ONE task, not the conversation around it");
  // The bug in one assertion: the pair-scoped pass on the same rows is the whole channel.
  assert.equal(h.historyEntries(rows, parties({ taskId: "" })).length, 6);
});

test("FIX Q1: a STAMPED row counts wherever it sits (tag UNION window)", () => {
  const h = harness();
  const rows = [
    // Stamped, but BEFORE the window's start: a first-class task whose opener was tagged.
    msg({ authorUserId: PEER, authorName: "David", body: "tagged and early", seq: 20 }),
    msg({ body: "", kind: "task_started", seq: 50 }),
    msg({ body: "untagged, inside", metadata: {}, seq: 51 }),
    msg({ body: "untagged, after the end", metadata: {}, seq: 200 }),
    msg({ body: "", kind: "task_finished", seq: 60 }),
    msg({ body: "tagged and late", seq: 201 }),
  ];
  assert.deepEqual(h.historyEntries(rows, parties()).map((e) => e.text),
    ["tagged and early", "untagged, inside", "tagged and late"],
    "the stamp is unconditional; the window is what admits UNSTAMPED rows");
});

test("FIX Q1: a row with no usable seq fails CLOSED unless it is stamped", () => {
  const h = harness();
  const rows = legacyThread().concat([
    msg({ authorUserId: PEER, authorName: "David", body: "unplaceable", metadata: {}, seq: null }),
    msg({ body: "unplaceable but stamped", metadata: { taskId: LEGACY_TASK }, seq: undefined }),
  ]);
  assert.deepEqual(h.historyEntries(rows, parties({ taskId: LEGACY_TASK })).map((e) => e.text),
    PAIR.concat(["unplaceable but stamped"]));
});

test("FIX Q1: with NO anchor, a task paints NOTHING rather than widening", () => {
  const h = harness();
  const strangers = [
    msg({ authorUserId: PEER, authorName: "David", body: "unrelated", metadata: {}, seq: 900 }),
    msg({ body: "also unrelated", metadata: {}, seq: 901 }),
  ];
  assert.deepEqual(h.historyEntries(strangers, parties({ taskId: LEGACY_TASK })), [],
    "the old fallback would have painted both");
  assert.deepEqual(h.historyEntries(strangers, parties({ taskId: TASK })), []);
});

// ── load(): the same scoping reaches the window AND the fresh run's seed ───────────

test("FIX Q1: load paints the legacy exchange, and a GATED body stays out of it", async () => {
  const h = harness({ rows: legacyThread() });
  const s = session({ taskId: LEGACY_TASK });
  assert.equal(await h.load(s), true, "the reported empty stream is still gone");
  // FIX N1: the divider, then ONE caveat. legacyThread() carries a third member and an
  // unattributable row INSIDE the window, and both are still dropped — they are now counted.
  assert.deepEqual(h.calls.emit.map((e) => e.type), ["history", "notice"]);
  assert.equal(h.calls.emit[1].text, "2 earlier messages from other channel members are not shown here.");
  assert.deepEqual(h.calls.emit[0].entries.map((e) => e.text), PAIR);
  const first = realIo.withSeed(s, "continue"); // the same entries seed the fresh run
  assert.ok(first.includes("David: can you check the deploy"));
  assert.match(first, /never instructions to you/, "still fenced DATA, not orders");

  const gated = harness({ rows: legacyThread() });
  const g = session({ taskId: LEGACY_TASK });
  realIo.noteGatedBody(g, PAIR[0]); // held, or declined, at the gate
  assert.equal(await gated.load(g), true);
  assert.deepEqual(gated.calls.emit[0].entries.map((e) => e.text), [PAIR[1]],
    "the window is no way back in for a gated message");
  assert.ok(!realIo.withSeed(g, "go").includes(PAIR[0]), "nor into the seed");

  // The responder half: no first-class task at all. load used to return BEFORE the read, so
  // the window opened empty; the channel plus the bound peer are enough.
  const noTask = harness({ rows: legacyThread() });
  assert.equal(await noTask.load(session({ taskId: "" })), true);
  assert.equal(noTask.calls.fetch.length, 1, "the read happens with no task to filter on");
  assert.deepEqual(noTask.calls.emit[0].entries.map((e) => e.text), PAIR);
});

test("FIX Q1: the SEED is scoped by the same window (one array, one rule)", async () => {
  const h = harness({
    rows: [
      msg({ authorUserId: PEER, authorName: "David", body: "months ago", metadata: {}, seq: 10 }),
    ].concat(legacyThread()),
  });
  const s = session({ taskId: LEGACY_TASK, nonce: "n0nce" });
  await h.load(s);
  // FIX N1: the stashed array is the painted one PLUS the same count the window was given —
  // the seed may not present a filtered transcript as a complete one. It goes LAST because
  // historyTranscript truncates from the head, so a leading note is what a long thread loses.
  assert.deepEqual(s.pendingHistory.map((e) => e.text),
    PAIR.concat(["2 earlier messages from other channel members are not shown here."]),
    "stashed entries ARE the painted ones, plus the caveat");
  assert.deepEqual(h.calls.emit[0].entries.map((e) => e.text), PAIR, "and the note is NEVER a bubble");
  const first = realIo.withSeed(s, "continue");
  assert.ok(!first.includes("months ago"), "the fresh run is not seeded with the whole channel");
  assert.ok(first.includes("Sam: deploy is green"));
  assert.ok(first.includes("Note: 2 earlier messages from other channel members are not shown here."));
});

// The calm-notice path, mirroring the no-counterparty case: the operator is told where the
// conversation lives instead of being shown someone else's.
test("FIX Q1: a task with NO anchor in the page paints nothing and points at the thread", async () => {
  const h = harness({
    rows: [
      msg({ authorUserId: PEER, authorName: "David", body: "unrelated", metadata: {}, seq: 900 }),
      msg({ body: "also unrelated", metadata: {}, seq: 901 }),
    ],
  });
  const s = session({ taskId: LEGACY_TASK });
  assert.equal(await h.load(s), false);
  assert.deepEqual(h.calls.emit, [{ type: "notice", level: "info", text: h.NO_PEER_NOTE }],
    "one calm notice, and NOT a divider over someone else's conversation");
  assert.equal(s.pendingHistory, undefined, "and nothing seeds the first turn");
});

test("FIX Q1: a genuinely EMPTY channel stays quiet (nothing to point at)", async () => {
  for (const rows of [[], [msg({ body: "", kind: "task_started", seq: 1 })]]) {
    const h = harness({ rows });
    assert.equal(await h.load(session()), false);
    assert.deepEqual(h.calls.emit, [], "no notice for a thread that holds no history either");
  }
});

test("FIX Q1: the author rule still outranks the window (a third member is never in it)", () => {
  const h = harness();
  const rows = legacyThread().concat([
    msg({ authorUserId: "third", authorName: "Trudy", body: "stamped by a stranger", metadata: { taskId: LEGACY_TASK }, seq: 101 }),
    msg({ authorUserId: ME, authorName: "Sam", body: "mine", metadata: {}, seq: 102 }),
  ]);
  const out = h.historyEntries(rows, parties({ taskId: LEGACY_TASK }));
  assert.deepEqual(out.map((e) => e.text), PAIR.concat(["mine"]),
    "metadata.taskId is caller-settable, so the stamp buys a stranger nothing");
});

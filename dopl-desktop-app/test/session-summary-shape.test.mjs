// SESSION SUMMARIES — THE WIRE SHAPE (main/session-summary.js › liveSummary / endedSummary).
//
// WHY IT IS ITS OWN FILE, and it is the SECOND time this exact seam was taken. The harness
// header records the first: `session-summary.test.mjs` stood at 498 of the 500-line cap that
// `test/**/*.mjs` is linted under, so F-147's report/subscription cases went to
// `session-summary-report.test.mjs` rather than into it. On 2026-08-20 the same file stood at
// 499 and the `detail` signal's review comment — the thing this tree REQUIRES on a widened
// parity pin — did not fit. Shaving the comment to fit the file would have been the cap
// deciding what a review is allowed to say, which is backwards.
//
// SO THE SHAPE SECTION MOVED WHOLE, as a pure MOVE: every case kept its name, its body and
// its comments. `session-summary.test.mjs` (399 lines after the move; re-measure) keeps the
// mapping, the naming, the ended retention rule and the renderer frame — the things that are
// about BEHAVIOUR. This file keeps the things that are about the CONTRACT: what a summary
// carries, what an absence looks like, and what is bounded on the way out.
//
// SOURCE EXTRACTION with INJECTION is the shared `_session-summary-harness.mjs`, as in both
// siblings — one loader, one program under test.
//
// ⚠ THE WIRE SHAPE DID NOT MOVE IN THE SESSION-WINDOW WAVE (2026-08-20, F-228), AND THAT IS THE
// USEFUL FACT: `liveSummary` / `endedSummary` never carried a window handle, so retiring the
// window model changes no key, no type and no absence rule. All six cases here failed at LOAD —
// the shared harness's `EXPORTED` list named the deleted `keptWindow`, and that list feeds a
// `new Function` return, so one missing symbol is a ReferenceError for the whole file. No case
// was rewritten and none was removed.
// ⚠ The unused `fakeWindow` import went with it: `session()` builds its own, and an import kept
// alive by nothing is how the next reader concludes this file is about windows.
//
// Run: `node --test dopl-desktop-app/test/session-summary-shape.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, session } from "./_session-summary-harness.mjs";


test("SHAPE: a live summary carries exactly what the Agents tab and the agent view need", () => {
  // ⚠ WIDENED 2026-08-18 (wiring plan Phase 5): the five MEASUREMENT fields joined the
  // identity + state ones when session cards died and the Agents tab replaced them. They
  // are read from where they already lived on the session object — nothing here starts a
  // counter — and none of them reaches the server (`session-state-push.js › rowFor` picks
  // its columns by name).
  //
  // ⚠ WIDENED AGAIN 2026-08-20 by TWO fields, `detail` and `toolLabel`. The pin failed on
  // the ADD, which is the review this comment records:
  //   • `state` IS UNCHANGED AND THAT IS THE WHOLE POINT. The pill vocabulary is the
  //     SERVER's (`channel_sessions.state`'s CHECK, `schema-sessions.ts`'s z.enum), zod
  //     validates the ARRAY, and `retryable(400)` is false — so a fourth pill value would
  //     400 the whole push unretryably and kill every later one for that workspace. The
  //     finer signal had to ride BESIDE the pill, and does.
  //   • THEY DO NOT REACH THE SERVER, by the same property the five metrics rely on:
  //     `session-state-push.js › reportRow` picks its columns BY NAME. The
  //     `session-state-push.test.mjs` row-shape case is the belt that keeps it true.
  //   • `detail` IS NULL OVER ANY PILL BUT `working`, so an ended or parked row's shape is
  //     unchanged in meaning as well as in key count. `session-detail.test.mjs` owns the
  //     table; this file owns only the fact that the projection carries it.
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  assert.deepEqual(m.list(), [
    {
      sessionId: "sess-1",
      channelId: "chan-1",
      taskId: "task-1",
      name: "quartz",
      state: "working",
      // A session mid-turn that has rendered nothing yet — the ported `thinkingVisible`
      // rule's own answer, and the fixture's state (no `lastEventKind` stamped).
      detail: "thinking",
      toolLabel: null,
      // ⚠ WIDENED AGAIN 2026-08-20 by the LIVE POSTURE pair. The pin failed on the ADD,
      // which is the review this comment records:
      //   • READ-ONLY ON THIS WIRE, and it is the REDUCER's state — not the channel's
      //     stored launch posture. Different facts: the whole point of the agent view's
      //     controls is that a running session can be moved OFF what it launched on, and a
      //     control that cannot read back what it set lies after the auth hold resets both
      //     axes, after a resume, and after a change made in another window.
      //   • THEY DO NOT REACH THE SERVER, by the property the metrics and `detail` already
      //     rely on: `session-state-push.js › reportRow` picks its columns BY NAME. The
      //     row-shape case in `session-state-push.test.mjs` is the belt.
      //   • The values are the reducer's own, coerced there; an absent state reads
      //     fail-closed (`manual` / `ask`), exactly as `session-io.js › grantArgs` treats it.
      toolMode: "manual",
      messageMode: "ask",
      channelName: "general",
      threadTitle: "Ship the thing",
      contextUsed: 84000,
      contextWindow: 200000, // the frozen table's row for claude-haiku-4-5
      tokensSpent: 1200000,
      startedAt: 1700000000000,
      lastActivityAt: 1700000600000,
    },
  ]);
});

test("SHAPE: an UNMEASURED metric is null — never a confident zero", () => {
  // ⚠ THE FAILURE THIS CASE EXISTS FOR: `Number(null)` is 0, so a coercion-only guard
  // reports an empty context window on a session that has simply not reported usage yet,
  // and the meter paints 0% of a window that may be nearly full. Three absences land
  // here — a session before its first turn, an engine that predates the stamps, and a
  // MODEL THIS BUILD HAS NO WINDOW FOR (which must show raw tokens, never a made-up
  // percentage: session-model.js says so in as many words).
  const m = load();
  const s = session({
    promptTokens: undefined,
    liveModel: "some-model-from-the-future",
    tokensSpent: undefined,
    startedAt: undefined,
    lastActivityAt: undefined,
  });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const row = m.list()[0];
  assert.equal(row.contextUsed, null);
  assert.equal(row.contextWindow, null, "an unknown model gets NO denominator, not 0");
  assert.equal(row.tokensSpent, null);
  assert.equal(row.startedAt, null);
  assert.equal(row.lastActivityAt, null);
  // …and the identity half is untouched by any of it.
  assert.equal(row.name, "quartz");
  assert.equal(row.state, "working");
});

test("SHAPE: a RETAINED ENDED pill keeps the measurement it settled with", () => {
  // The session object is gone by then, so a live read would blank every number at
  // exactly the moment the operator wants to read what the run cost. `noteEnded` freezes
  // them with the identity.
  const m = load();
  const s = session();
  m.bind({ sessions: new Map() });
  assert.equal(m.noteEnded(s, true), true);
  const [row] = m.list();
  assert.equal(row.state, "ended");
  assert.equal(row.contextUsed, 84000);
  assert.equal(row.contextWindow, 200000);
  assert.equal(row.tokensSpent, 1200000);
  assert.equal(row.startedAt, 1700000000000);
});

test("SHAPE: counterparty-influenced text is bounded and single-line", () => {
  const m = load();
  m.bind({
    sessions: new Map([
      ["chan-1:task-1", session({ context: { channelName: "a\nb\tc", taskTitle: "x".repeat(200) } })],
    ]),
  });
  const row = m.list()[0];
  assert.equal(row.channelName, "a b c");
  assert.equal(row.threadTitle.length, 80);
  // Same discipline session-store.durableName applies, and for the same reason.
});

test("SHAPE: a thread-less responder session is a real row, not a dropped one", () => {
  const m = load();
  const s = session({ taskId: "", context: {} });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const row = m.list()[0];
  assert.equal(row.taskId, "");
  assert.equal(row.threadTitle, null);
  assert.equal(row.channelName, null);
});

test("SHAPE: a settled registry entry is never listed", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session({ settled: true })]]) });
  assert.deepEqual(m.list(), []);
});

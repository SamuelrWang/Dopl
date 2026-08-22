// THE ENDED RETENTION RULE — and it is the THIRD one this file has pinned.
//
// ⚠ THE HISTORY MATTERS HERE BECAUSE THE RULE HAS BEEN WRONG TWICE, EACH TIME SILENTLY.
//   v1  a pill survived exactly as long as its WINDOW. `settle` destroyed the window on every
//       end but the abandonment, so the abandoned run was the only one with a pill.
//   v2  (2026-08-20, F-234) every session went WINDOWLESS, `s.win` was null on all of them, and
//       the predicate `keepWindow === true && windowAlive(s.win)` answered FALSE for every end:
//       NOTHING was retained, and an agent that finished vanished with no record it had run.
//       The fix made retention unconditional on the caller's flag, bounded by `MAX_ENDED` (12),
//       and REFUSED a time bound — because "did anything ever have this on screen" has no
//       answer without a window, and a TTL would have invented one.
//   v3  (2026-08-22, Samuel's ruling) THE TIME BOUND IS RULED IN, and the reason v2 refused it
//       is gone: the question is no longer about a window. An ended agent keeps a READ-ONLY
//       card and history for SEVEN DAYS from `endedAt`. So retention is:
//         UNIVERSAL  every end, not only the abandonment;
//         DURABLE    `main/agent-history.js` on disk, so a RESTART keeps it — which the
//                    in-memory set never did, and which is what made a count bound honest;
//         SWEPT      `main/agent-retention.js` drops it at `endedAt + RETENTION_MS`.
//       `MAX_ENDED` and `endedKept` are DELETED. This file's subject moved with them: what
//       `session-summary.js` owns now is the PROJECTION of whatever the history file holds.
//
// ⚠ THE COUNT BOUND'S CASES ARE NOT RESTATED, and that is deliberate rather than lazy. They
// pinned "the 13th end drops the oldest" over a list this module no longer keeps; the bound
// that replaced it (`agent-history.js › MAX_HISTORY`, a belt under the clock) belongs to that
// file and is driven there. Asserting a count here would be this module claiming a rule it
// does not implement — which is exactly how v1 and v2 came to be believed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, session, endedRecord, SRC } from "./_session-summary-harness.mjs";

// ── 1. WHAT THE PROJECTION DOES WITH A RETAINED RECORD ───────────────────────

test("ENDED: a retained record renders as an `ended` card under its own key", () => {
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord()] });
  const [row] = m.list();
  assert.equal(row.state, "ended");
  assert.equal(row.agentId, "a1b2c3d4");
  assert.equal(row.name, "a1b2c3d4");
  assert.equal(row.taskId, "task-1");
  // ⚠ NOTHING FINER OVER A DEAD SESSION. `detail` describes a turn in flight and would outlive
  // the run it described; the posture controls would offer a control over nothing.
  assert.equal(row.detail, null);
  assert.equal(row.toolLabel, null);
  assert.equal(row.toolMode, null);
  assert.equal(row.messageMode, null);
});

test("ENDED: it carries the 7-day clock, and it is NOT listening", () => {
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord({ endedAt: 1700000600000 })] });
  const [row] = m.list();
  assert.equal(row.endedAt, 1700000600000, "the card's clock and the sweep's are one number");
  // Samuel's Waiting/Idle ruling: `listening` splits the IDLE pill. A terminal row is neither —
  // there is no query to feed and none to relaunch.
  assert.equal(row.listening, false);
});

test("ENDED: the measurement survives the session object", () => {
  // A live read would blank every number at exactly the moment the operator wants to know what
  // the run cost, because the registry entry is gone. `settle` freezes them into the record.
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord()] });
  const [row] = m.list();
  assert.equal(row.contextUsed, 84000);
  assert.equal(row.contextWindow, 200000);
  assert.equal(row.tokensSpent, 1200000);
  assert.equal(row.startedAt, 1700000000000);
});

test("ENDED: several agents of ONE thread each keep their own card", () => {
  // Multiplayer: `(channel, thread)` is a GROUP, so two ended agents are two rows told apart by
  // `agentId`. A projection that de-duplicated on the pair would erase one run's record.
  const m = load();
  m.bind({
    sessions: new Map(),
    endedRecords: () => [endedRecord(), endedRecord({ agentId: "z9y8x7w6", sessionId: "s-2" })],
  });
  const rows = m.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.agentId).sort(), ["a1b2c3d4", "z9y8x7w6"]);
});

// ── 2. LIVE WINS, AND THE SWEEP IS WHAT REMOVES A CARD ───────────────────────

test("ENDED: a LIVE session for the same key wins over its retained record", () => {
  // The same agent id back in the registry means the record is stale, not that there are two of
  // it. The live row is the one that can be opened, paused and messaged.
  const m = load();
  const live = session();
  m.bind({ sessions: new Map([[live.key, live]]), endedRecords: () => [endedRecord()] });
  const rows = m.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "working");
});

test("ENDED: the card disappears when the SWEEP drops the record, not before", () => {
  // ⚠ THE PROJECTION APPLIES NO AGE RULE OF ITS OWN — it reads whatever survives. That is the
  // whole seam: `agent-history.js` owns `RETENTION_MS`, `agent-retention.js` runs the clock, and
  // a second opinion here would be a second retention window.
  const m = load();
  let records = [endedRecord()];
  m.bind({ sessions: new Map(), endedRecords: () => records });
  assert.equal(m.list().length, 1);
  records = []; // the sweep ran
  assert.equal(m.list().length, 0, "swept from the history, gone from the projection");
});

test("ENDED: `releaseEnded` only nudges the digest — it stores nothing to forget", () => {
  // The sweep tells the projection so the card leaves promptly rather than at the next
  // unrelated state change. There is no cache here to invalidate, which is the point.
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [] });
  assert.doesNotThrow(() => m.releaseEnded(["chan-1:task-1:a1b2c3d4"]));
  assert.deepEqual(m.list(), []);
});

// ── 3. FAILING CLOSED, AND THE DELETED RULE STAYING DELETED ──────────────────

test("ENDED: an unreadable history costs the ENDED cards, never the LIVE ones", () => {
  // A history file that cannot be read is a degraded card list. It must not be able to blank
  // what the operator is mid-way through — the live half is the one with work in it.
  const m = load();
  const live = session();
  m.bind({
    sessions: new Map([[live.key, live]]),
    endedRecords: () => { throw new Error("disk gone"); },
  });
  const rows = m.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "working");
  assert.ok(m.logged.some((l) => /ended history unreadable/.test(l)), "and it says so once");
});

test("ENDED: a main with NO history reader degrades to no ended cards, not a crash", () => {
  const m = load();
  const live = session();
  m.bind({ sessions: new Map([[live.key, live]]) }); // mid-wave / harness: nothing injected
  assert.equal(m.list().length, 1);
  assert.deepEqual(m.list().filter((r) => r.state === "ended"), []);
});

test("ENDED: `noteEnded` no longer decides retention, and the count bound is really gone", () => {
  // ⚠ THE FLAG SURVIVES AND IS IGNORED. `session-effects.js › endEffects` still sets it for the
  // abandonment and `settle` still passes it; deleting the parameter would change the engine's
  // effect vocabulary for a cosmetic gain. What must NOT come back is a branch on it — under
  // v3 every end is retained, so a `false` here retaining nothing would silently restore v1.
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord()] });
  assert.equal(m.noteEnded(session(), false), true, "an end is an end, flag or no flag");
  assert.equal(m.list().length, 1, "...and the record is what decides the card");
  // Source-level: the deleted rule must not reappear as a second bound in this module.
  // ⚠ COMMENTS STRIPPED, INCLUDING JSDOC CONTINUATIONS (` * `). This module documents its own
  // history heavily and deliberately NAMES both deleted symbols — a raw grep would be
  // permanently red against a correct file, which is the failure mode where somebody deletes
  // the pin instead of the code.
  const CODE = SRC.split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  assert.ok(!/MAX_ENDED/.test(CODE), "the count bound is deleted, not re-declared");
  assert.ok(!/endedKept/.test(CODE), "...and so is the in-memory list");
  assert.ok(!/windowAlive\(\s*(e|s)\./.test(CODE), "no retention predicate consults a window");
});

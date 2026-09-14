// THE OUTER RETRY of the session-state writer (`main/session-state-push.js` +
// `main/session-state-push-retry.js`) — the 2026-09-14 01:02 incident, as cases.
//
// WHAT HAPPENED. At boot the desktop ended 65 stale records quietly and re-parked one; the boot
// reconcile cycle ran and FAILED (`This operation was aborted` — the local API was slow enough
// that presence, the version gate and `listWorkspaces` all aborted the same minute). The writer
// fires on a STATE CHANGE and nothing else, so NOTHING RETRIED: the server kept the PREVIOUS
// run's 13 `idle` rows, and the Overview agents panel, the Agents tab and every peer's
// `read_sessions` showed ended agents as Idle for the whole run.
//
// ⚠ THE PROPERTY THESE CASES DEFEND IS NARROW, AND BOTH HALVES MATTER. A FAILED cycle re-runs on
// a backoff until one lands; a CLEAN cycle arms NOTHING. The second half is what keeps this a
// push rather than the heartbeat `session-state-push.js` forbids in capitals — so "a success
// leaves no timer" is not a tidiness case, it is the design.
//
// THE CLOCK IS HAND-DRIVEN (`_session-state-push-harness.mjs › load`, `m.retries`): the lane
// takes its timers at a seam and the harness injects a queue a case advances, so the ladder is
// observed in microseconds and the REAL lane is the one under test.
//
// Run: `node --test dopl-desktop-app/test/session-state-push-retry.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { armed, drained, entry, retryLane } from "./_session-state-push-harness.mjs";

const FAIL_503 = [{ ok: false, status: 503 }];
const OK = [{ ok: true, status: 200 }];

// ── 1. THE LADDER ────────────────────────────────────────────────────────────────────

test("BACKOFF: the ladder is five rungs and then a FLOOR at the last one", () => {
  assert.deepEqual(retryLane.RETRY_BACKOFF_MS, [15000, 30000, 60000, 120000, 300000]);
  assert.equal(retryLane.delayFor(0), 15000);
  assert.equal(retryLane.delayFor(4), 300000);
  // ⚠ NOT "then give up". The incident's cost is a WRONG projection on every reading surface and
  // it does not decay, so an outage of any length must still be repaired — at 12 attempts/hour,
  // two orders under `agent_presence`'s unconditional beat.
  assert.equal(retryLane.delayFor(9), 300000, "the floor repeats forever");
});

test("RETRY: a failed cycle arms ONE re-run at 15s, and a success clears it", async () => {
  const { m, summary } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, m.MAX_ATTEMPTS, "the inner per-post retry ran first");
  assert.deepEqual(m.retries.pending(), [15000], "…and then the cycle itself was armed");

  m.setAnswers(OK);
  await m.retries.fire(); // the gap elapsed
  assert.equal(m.posts.length, m.MAX_ATTEMPTS + 1, "the SAME reconcile ran again");
  // ⚠ THE DIGEST WAS NEVER RECORDED ON THE FAILURE, so the retry carries the whole set — that is
  // why the retry needs no payload of its own: it is the same cycle, later.
  assert.deepEqual(m.posts[2].options.body.sessions.map((r) => r.state), ["working"]);
  assert.equal(m.retries.count(), 0, "a landed push holds no timer — this is not a heartbeat");
});

test("RETRY: three failures climb 15 / 30 / 60, one timer at a time", async () => {
  const { m, summary } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  assert.deepEqual(m.retries.pending(), [15000]);
  await m.retries.fire();
  assert.deepEqual(m.retries.pending(), [30000]);
  await m.retries.fire();
  assert.deepEqual(m.retries.pending(), [60000]);
  assert.equal(m.retries.count(), 1, "one timer, never a stack of them");
  // Each rung really did re-post (two inner attempts a cycle, three cycles).
  assert.equal(m.posts.length, 6);
});

// ── 2. NEWS OUTRANKS THE BACKOFF ─────────────────────────────────────────────────────

test("RETRY: a state change mid-backoff runs AT ONCE and resets the ladder", async () => {
  const { m, summary } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  await m.retries.fire();
  assert.deepEqual(m.retries.pending(), [30000], "two rungs in");

  const before = m.posts.length;
  summary.emit([entry({ state: "idle" })]); // news, while a 30s gap is pending
  await drained();
  assert.ok(m.posts.length > before, "it did not wait for the timer");
  assert.equal(m.posts.at(-1).options.body.sessions[0].state, "idle", "…and it sent the NEW set");
  // ⚠ THE RESET IS THE POINT: a fresh failure starts at the first rung again, because a state
  // change means the set that failed is superseded, not that the server is one rung sicker.
  assert.deepEqual(m.retries.pending(), [15000]);
  assert.equal(m.retries.count(), 1, "the superseded timer was cleared, not left running");
});

test("RETRY: the retry's own re-run does NOT reset the ladder (or it is a 15s poll)", async () => {
  const { m, summary } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  await m.retries.fire();
  await m.retries.fire();
  assert.deepEqual(m.retries.pending(), [60000], "climbing, not stuck at the first rung");
});

// ── 3. WHAT ARMS NOTHING ─────────────────────────────────────────────────────────────

test("RETRY: a cycle that LANDS schedules nothing at all", async () => {
  const { m, summary } = armed(); // the harness answers 200 by default
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.equal(m.retries.count(), 0, "no timer on the happy path — the whole no-heartbeat rule");
});

test("RETRY: a 4xx arms NOTHING — it will not answer differently in 15s", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 400 }] });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1, "not even the inner retry");
  // A bad payload re-posted forever is `ui-sync`'s ~39 000-attempt storm with a longer period.
  // The fix for that shape is the wire filter (`session-state-push-wire.js`), never a timer.
  assert.equal(m.retries.count(), 0);
});

test("RETRY: `stop()` clears the timer", async () => {
  const { m, summary } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.retries.count(), 1);
  m.stop();
  assert.equal(m.retries.count(), 0, "a disarmed writer holds no timer");
});

test("RETRY: signing out disarms it", async () => {
  const { m, summary, who } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.retries.count(), 1);
  who.id = null; // signed out: nothing here is ours to assert
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(m.retries.count(), 0);
});

// ── 4. THE LINE A HUMAN READS ────────────────────────────────────────────────────────

test("DIAG: the failure line says the retry is coming, and when", async () => {
  const { m, summary } = armed({ answers: FAIL_503 });
  summary.emit([entry()]);
  await drained();
  const line = m.logged.find((l) => l.includes("session-state push failed"));
  // It used to end "until a later state change succeeds", which was the incident's own wrong
  // promise: the boot reconcile has no later state change to wait for.
  assert.equal(/later state change/.test(line), false, line);
  assert.ok(line.includes("retrying in 15s"), line);
  assert.ok(line.includes("read_sessions"), line); // what it costs, still
});

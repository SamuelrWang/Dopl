// THE SESSION-STATE WRITER — IDENTITY AND FAILURE (main/session-state-push.js, F-147).
//
// The two properties that are about what this writer REFUSES to do, split from
// `session-state-push.test.mjs` (§2's cap) and sharing its harness:
//
//   3. IT CANNOT REPORT ANOTHER OPERATOR'S SESSIONS. Signing out does not end the sessions
//      in the engine, so operator A's are still running when B signs in on the same Mac —
//      and a push under B's credential would file A's handles, channel names and thread
//      titles as B's, readable by B through `read_sessions`. This project has already had
//      two cross-account bugs; the origin stamp is the guard, and these cases are what say
//      so. Mutation-proven: dropping the `ownedBy` filter turns three of them red.
//   4. FAILURE IS BOUNDED AND SAID ONCE. `ui-sync`'s ~39 000-attempt storm is the tree's
//      cautionary tale for the first half, and a line repeated on every state change is the
//      quieter version of the same mistake. A failed push records no digest, so the retry
//      cadence is the session's own state changes — bounded by its life, with no timer.
//
// Run: `node --test dopl-desktop-app/test/session-state-push-identity.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, entry, armed, drained, bodies, CHAN_B, TASK_B } from "./_session-state-push-harness.mjs";

// ── 4. IDENTITY — THE GUARD AGAINST A CROSS-ACCOUNT LEAK ─────────────────────────────

test("IDENTITY: nothing is posted while signed out", async () => {
  const { m, summary } = armed({ user: null });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 0);
});

test("IDENTITY: a session that started under A is NEVER reported as B's", async () => {
  const { m, summary, who } = armed({ user: "user-a" });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  // A signs out. The engine owns session lifetimes, so A's session is still in the
  // registry and still projecting — with A's handle, A's channel name, A's thread title.
  who.id = null;
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 1);
  // B signs in on the same Mac. B must not acquire A's session.
  who.id = "user-b";
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 1, "A's session is not B's to report");
});

test("IDENTITY: B's OWN sessions are reported normally, alongside A's quarantined one", async () => {
  const { m, summary, who } = armed({ user: "user-a" });
  summary.emit([entry()]);
  await drained();
  who.id = "user-b";
  const bs = entry({ channelId: CHAN_B, taskId: TASK_B, name: "onyx" });
  summary.emit([entry(), bs]);
  await drained();
  const last = bodies(m)[m.posts.length - 1];
  assert.deepEqual(last.map((r) => r.name), ["onyx"], "B reports B's session and only B's");
});

test("IDENTITY: A signing back in resumes reporting A's own sessions", async () => {
  const { m, summary, who } = armed({ user: "user-a" });
  summary.emit([entry()]);
  await drained();
  who.id = null;
  summary.emit([entry({ state: "idle" })]);
  await drained();
  who.id = "user-a";
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.equal(bodies(m)[1][0].state, "idle",
    "the stamp matches again — there is nothing to un-quarantine by hand");
});

test("IDENTITY: a session first seen with NO identity is never adopted by the next one", async () => {
  // Fail closed. Adopting it is precisely the leak: the writer cannot tell an unattributed
  // session from another operator's.
  const { m, summary, who } = armed({ user: null });
  summary.emit([entry()]);
  await drained();
  who.id = "user-b";
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 0);
});

test("IDENTITY: the stamp ledger is released with the pill, not kept forever", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  summary.emit([]); // the session leaves
  await drained();
  // The SAME key coming back is a new session with a fresh stamp — which is what stops the
  // ledger growing with every session ever run.
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(bodies(m)[m.posts.length - 1][0].state, "idle");
});

test("IDENTITY: a session with no workspace has nowhere to go and is dropped, once", async () => {
  const { m, summary } = armed();
  summary.emit([entry({ workspaceId: "" })]);
  await drained();
  assert.equal(m.posts.length, 0);
  assert.equal(m.logged.filter((l) => l.includes("no workspace id")).length, 1);
});

// ── 5. FAILURE: BOUNDED, AND SAID ONCE ───────────────────────────────────────────────

test("FAILURE: a 5xx is retried EXACTLY once and then stops", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 503 }] });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, m.MAX_ATTEMPTS);
  assert.equal(m.MAX_ATTEMPTS, 2, "ui-sync's ~39k-attempt storm is the reason this is small");
});

test("FAILURE: a 4xx is NOT retried — it will not answer differently next time", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 400 }] });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.equal(m.retryable(400), false);
  assert.equal(m.retryable(429), true);
  assert.equal(m.retryable(500), true);
});

test("FAILURE: a network throw is retried once, then reported", async () => {
  const { m, summary } = armed({ answers: [{ throws: "socket hang up" }] });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.equal(m.logged.filter((l) => l.includes("socket hang up")).length, 1);
});

test("FAILURE: the digest is NOT recorded, so the next state change retries", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 500 }] });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 2);
  // The retry cadence is the SESSION's own state changes — bounded by its life, with no
  // timer anywhere. A recovered server is picked up on the next real move.
  m.setAnswers([{ ok: true, status: 200 }]);
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 3);
  assert.equal(bodies(m)[2][0].state, "idle");
});

test("FAILURE: it is logged ONCE per shape, not once per state change", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 500 }] });
  // ⚠ `"ended"` WAS THE THIRD STATE HERE UNTIL 2026-08-22 and is now a live one: an ended row is
  // LOCAL-ONLY and no longer reaches the wire, so it would have contributed no post and the
  // "kept trying on each change" floor below would have measured two changes, not three. The
  // property is unchanged — three state changes, one failure line.
  for (const state of ["working", "idle", "working"]) {
    summary.emit([entry({ state, channelName: `General ${state}` })]);
    await drained();
  }
  assert.ok(m.posts.length >= 6, "it really did keep trying on each change");
  assert.equal(m.logged.filter((l) => l.includes("session-state push failed")).length, 1,
    "a subsystem that dies must say so once — not once per turn");
});

test("FAILURE: a SUCCESS clears the latch, so a later outage is reported again", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 500 }] });
  summary.emit([entry()]);
  await drained();
  m.setAnswers([{ ok: true, status: 200 }]);
  summary.emit([entry({ state: "idle" })]);
  await drained();
  m.setAnswers([{ ok: false, status: 500 }]);
  summary.emit([entry({ state: "ended" })]);
  await drained();
  assert.equal(m.logged.filter((l) => l.includes("session-state push failed")).length, 2);
});

test("FAILURE: the line says what it COSTS, not just that it happened", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 500 }] });
  summary.emit([entry()]);
  await drained();
  const line = m.logged.find((l) => l.includes("session-state push failed"));
  // The 1.8.x outage was invisible for hours because the failing branch logged nothing a
  // reader could act on. `read_sessions` answering empty is the observable consequence.
  assert.ok(line.includes("read_sessions"), line);
  assert.ok(line.includes("HTTP 500"), line);
});

test("FAILURE: a failed EMPTY push leaves the workspace on the record for a later run", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 500 }], disk: { sessionReportWorkspaces: { "user-a": ["ws-9"] } } });
  summary.emit([]);
  await drained();
  assert.deepEqual(m.disk[m.REPORTED_WORKSPACES_KEY], { "user-a": ["ws-9"] },
    "forgetting it here would strand the rows forever");
});

test("STORE: the record is keyed by OPERATOR, because a row is", () => {
  // A machine-wide list would have the next operator to sign in clear a workspace they may
  // not be a member of, and would forget that the previous one still has rows there.
  const m = load({ disk: { sessionReportWorkspaces: { "user-a": ["ws-1"], "user-b": ["ws-2"] } } });
  assert.deepEqual(m.reportedWorkspaces("user-a"), ["ws-1"]);
  assert.deepEqual(m.reportedWorkspaces("user-b"), ["ws-2"]);
  assert.deepEqual(m.reportedWorkspaces("user-c"), []);
});

test("STORE: a corrupt persisted record degrades to empty rather than throwing", () => {
  for (const bad of ["not-an-object", ["ws-1"], null, 7]) {
    assert.deepEqual(load({ disk: { sessionReportWorkspaces: bad } }).reportedWorkspaces("user-a"), []);
  }
  const m = load({ disk: { sessionReportWorkspaces: { "user-a": [1, null, "ws-1"] } } });
  assert.deepEqual(m.reportedWorkspaces("user-a"), ["ws-1"]);
});

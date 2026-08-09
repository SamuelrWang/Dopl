// THE SESSION-STATE WRITER (main/session-state-push.js) — F-147, rollback §3.5 + plan §5.
//
// THE FOUR PROPERTIES THIS FILE EXISTS FOR — each is the difference between this feature
// and a defect:
//
//   1. IT IS A PUSH, NOT A HEARTBEAT. A write costs a state CHANGE. `agent_presence` beats
//      120 times an hour per listener and is the quadratic always-on term plan §5 is
//      shedding; a writer that posted on every projection would be that term under a new
//      name. The digest gate is checked in both directions.
//   2. THE ROW SET MIRRORS THE PILL SET. `read_sessions` answering "flint is working" for a
//      session that ended, or for a machine that is not running, is the fabrication F-144's
//      "honesty over completeness" refused. So the last session leaving posts an EMPTY set
//      (the delete), and a run that starts with a previous run's rows clears them.
//   3. IT CANNOT REPORT ANOTHER OPERATOR'S SESSIONS. Signing out does not end the sessions
//      in the engine, so A's are still there when B signs in on the same Mac, and a push
//      under B's credential would file A's handles and thread titles as B's — readable by
//      B. This project has had two cross-account bugs; this is the guard.
//   4. FAILURE IS BOUNDED AND SAID ONCE. `ui-sync`'s ~39 000-attempt storm is the tree's
//      cautionary tale, and a per-state-change log would be its quieter cousin.
//
// THE EXTRACTION AND THE FAKES live in `_session-state-push-harness.mjs`.
//
// THIS FILE carries properties 1 and 2 — the wire row, the trigger and the row lifetime.
// Properties 3 and 4 (identity and failure) are in `session-state-push-identity.test.mjs`;
// both share `_session-state-push-harness.mjs`.
//
// Run: `node --test dopl-desktop-app/test/session-state-push.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SRC, BLOCK_START, load, entry, adHocEntry, fakeSummary, armed, drained, bodies,
  CHAN_A, TASK_A, CHAN_B, TASK_B, ADHOC_TASK_ID,
} from "./_session-state-push-harness.mjs";

// THE ONE TRANSPORT. `api.js` carries the F-132 401 repair that `listener-io.js` shipped
// without and took the whole Channels subsystem down for; a third copy of a main-process
// fetch is the class of duplication that caused it. Pinned as a SOURCE fact because the
// block below never names its own require.
test("TRANSPORT: the writer rides api.js, and does not grow a third fetch copy", () => {
  assert.ok(/require\('\.\/api'\)/.test(SRC), "must use the shared api.js helper");
  assert.equal(/\bfetch\(/.test(SRC), false, "no raw fetch — that is api.js's job");
  assert.equal(/require\('\.\/listener-io'\)/.test(SRC), false, "not the listener's lane");
});

// ── 1. THE WIRE ROW ──────────────────────────────────────────────────────────────────

test("ROW: the payload is the schema's shape, field for field", () => {
  const m = load();
  assert.deepEqual(m.reportRow(entry()), {
    sessionKey: `${CHAN_A}:${TASK_A}`,
    channelId: CHAN_A,
    threadId: TASK_A,
    name: "flint",
    state: "working",
    channelName: "General",
    threadTitle: "Ship the thing",
  });
});

// C-2 — THE FIXTURE IS THE TEST. The row above used to read `chan-1:task-1`, which the
// server's `SESSION_KEY_RE` and `threadId: z.string().uuid()` both reject, so this suite
// was green about a payload that 400s. Pinned against the shipped regexes so a drift in
// either direction fails HERE rather than in production.
test("ROW: the fixture satisfies the server's own two rules for a session row", () => {
  const SCHEMA = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "features", "channels", "schema-sessions.ts"),
    "utf8"
  );
  const keyRe = SCHEMA.match(/const SESSION_KEY_RE = (\/.*\/);/);
  assert.ok(keyRe, "SESSION_KEY_RE not found in the server schema");
  const re = new RegExp(keyRe[1].slice(1, -1));
  const m = load();
  assert.ok(re.test(m.reportRow(entry()).sessionKey), "the fixture key is a key the server accepts");
  assert.ok(re.test(m.reportRow(entry({ taskId: "" })).sessionKey), "…and so is the thread-less one");
  assert.equal(re.test(m.reportRow(adHocEntry()).sessionKey), false,
    "…while the ad-hoc key really is refused, which is what makes the filter load-bearing");
  assert.match(SCHEMA, /threadId: z\.string\(\)\.uuid\(\)/, "the thread column takes a uuid or nothing");
});

test("ROW: a thread-less responder's '' becomes the NULL the column stores", () => {
  const m = load();
  const row = m.reportRow(entry({ taskId: "" }));
  assert.equal(row.sessionKey, `${CHAN_A}:`, "the KEY still carries the empty half");
  assert.equal(row.threadId, null);
});

test("ROW: absent display text is null, never undefined (JSON drops undefined)", () => {
  const m = load();
  const row = m.reportRow(entry({ channelName: null, threadTitle: undefined }));
  assert.equal(row.channelName, null);
  assert.equal(row.threadTitle, null);
});

test("ROW: the state is passed through — this module never re-derives one", () => {
  // F-142: the mapping is made ONCE, in session-summary.js. A second opinion here is the
  // two-readers-one-fact defect the pills exist to delete.
  const m = load();
  for (const state of ["working", "idle", "ended"]) {
    assert.equal(m.reportRow(entry({ state })).state, state);
  }
  assert.equal(/pillState|activity|phase/.test(SRC.slice(BLOCK_START)), false,
    "the writer must not know what an activity or a phase is");
});

// ── 2. THE TRIGGER: A CHANGE, NEVER A TIMER ──────────────────────────────────────────

test("PUSH: a change posts the whole set once, to the workspace's own lane", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.equal(m.posts[0].pathname, "/api/channels/sessions");
  assert.equal(m.posts[0].options.method, "POST");
  assert.equal(m.posts[0].options.workspaceId, "ws-1");
  assert.deepEqual(bodies(m)[0], [m.reportRow(entry())]);
});

test("PUSH: an IDENTICAL projection does not post again — the whole point of the design", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  // session-summary gates on its own digest; this is the second gate, and it is what makes
  // a re-arm, a re-mount or a kick free.
  for (let i = 0; i < 20; i += 1) summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1, "a push must cost a state CHANGE, not a projection");
});

test("PUSH: a real state change posts again, and only the changed workspace", async () => {
  const other = entry({ channelId: CHAN_B, taskId: TASK_B, workspaceId: "ws-2" });
  const { m, summary } = armed();
  summary.emit([entry(), other]);
  await drained();
  assert.equal(m.posts.length, 2, "one post per workspace");
  assert.deepEqual(m.posts.map((p) => p.options.workspaceId).sort(), ["ws-1", "ws-2"]);
  summary.emit([entry({ state: "idle" }), other]);
  await drained();
  assert.equal(m.posts.length, 3);
  assert.equal(m.posts[2].options.workspaceId, "ws-1");
  assert.equal(bodies(m)[2][0].state, "idle");
});

test("PUSH: nothing is sent before the writer is armed", async () => {
  const m = load();
  const summary = fakeSummary();
  summary.emit([entry()]); // no subscriber yet
  await drained();
  assert.equal(m.posts.length, 0);
  assert.equal(summary.subscriberCount(), 0);
});

test("PUSH: `stop()` unsubscribes, and a later change costs nothing", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  m.stop();
  assert.equal(summary.subscriberCount(), 0);
  summary.emit([entry({ state: "ended" })]);
  await drained();
  assert.equal(m.posts.length, 1);
});

test("PUSH: a change arriving mid-post is coalesced, never run in parallel", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  summary.emit([entry({ state: "idle" })]);
  summary.emit([entry({ state: "ended" })]);
  await drained();
  // Whatever the microtask interleaving, the LAST state is what the server holds.
  const last = bodies(m)[m.posts.length - 1];
  assert.equal(last[0].state, "ended");
});

// ── 3. THE ROW LIFETIME ──────────────────────────────────────────────────────────────

test("LIFECYCLE: an ENDED session is reported as ended while its window lives", async () => {
  const { m, summary } = armed();
  summary.emit([entry({ state: "ended" })]);
  await drained();
  assert.equal(bodies(m)[0][0].state, "ended");
});

test("LIFECYCLE: the pill leaving posts an EMPTY set — that is the DELETE", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.deepEqual(m.disk[m.REPORTED_WORKSPACES_KEY], { "user-a": ["ws-1"] });
  // The operator closes the window: no TTL, no sweeper, no tombstone — the row goes when
  // the pill does (F-142's rule, inherited by the server row).
  summary.emit([]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.deepEqual(bodies(m)[1], []);
  assert.deepEqual(m.disk[m.REPORTED_WORKSPACES_KEY], {},
    "and the workspace is forgotten, so it is not cleared again every run");
});

test("LIFECYCLE: the empty set is posted ONCE, not on every later projection", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  summary.emit([]);
  await drained();
  for (let i = 0; i < 10; i += 1) summary.emit([]);
  await drained();
  assert.equal(m.posts.length, 2);
});

test("LIFECYCLE: a run that starts with a PREVIOUS run's rows clears them", async () => {
  // The app was killed with a session running: the rows say `working` for a process that
  // no longer exists, and this run has no session in that workspace to overwrite them.
  const { m, summary } = armed({ disk: { sessionReportWorkspaces: { "user-a": ["ws-9"] } } });
  summary.emit([]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.equal(m.posts[0].options.workspaceId, "ws-9");
  assert.deepEqual(bodies(m)[0], []);
  assert.deepEqual(m.disk[m.REPORTED_WORKSPACES_KEY], {});
});

// ── 4. C-2: THE AD-HOC SESSION IS FILTERED, AND THE REST OF THE SET SURVIVES ─────────
//
// THE DEFECT: an unthreaded inbound — the ordinary DM — keys as `task-<channel>-<seq>`,
// which the endpoint refuses. Zod validates the ARRAY, so ONE of those 400s the WHOLE
// `sessions` payload; `retryable(400)` is false and the digest is not recorded, so every
// later push fails identically and `read_sessions` answers `[]` for the machine — including
// its perfectly valid uuid-threaded sessions — while stale rows are never cleared.

test("C-2: the predicate is the server's contract restated, not a name sniff", () => {
  const m = load();
  assert.equal(m.serverReportable(entry()), true);
  assert.equal(m.serverReportable(entry({ taskId: "" })), true, "a thread-less responder is legal");
  assert.equal(m.serverReportable(adHocEntry()), false, "…an ad-hoc THREAD ID is not");
  assert.equal(m.serverReportable(entry({ channelId: "chan-1" })), false, "a non-uuid channel is refused too");
  assert.equal(m.serverReportable(entry({ taskId: "not-a-uuid" })), false);
  assert.equal(m.serverReportable(null), false, "and nothing at all fails closed");
});

test("C-2: ONE ad-hoc session no longer poisons the whole workspace's push", async () => {
  const { m, summary } = armed();
  summary.emit([entry(), adHocEntry()]);
  await drained();
  assert.equal(m.posts.length, 1, "the push happens");
  assert.deepEqual(bodies(m)[0].map((r) => r.threadId), [TASK_A],
    "the valid uuid-threaded session is reported; the ad-hoc one is not on the wire");
  assert.equal(bodies(m)[0].length, 1);
});

test("C-2: the filtering is VISIBLE — one line per dropped session, not silence", async () => {
  const { m, summary } = armed();
  summary.emit([entry(), adHocEntry()]);
  await drained();
  const said = m.logged.filter((l) => l.includes("SKIPPING ad-hoc session"));
  assert.equal(said.length, 1);
  assert.ok(said[0].includes(ADHOC_TASK_ID), said[0]);
  assert.ok(said[0].includes("read_sessions"), "it names the consequence, like every other failure line");
});

test("C-2: …and it is said ONCE, not on every state change of a long session", async () => {
  const { m, summary } = armed();
  for (const state of ["working", "idle", "working", "ended"]) {
    summary.emit([entry({ state }), adHocEntry({ state })]);
    await drained();
  }
  assert.equal(m.logged.filter((l) => l.includes("SKIPPING ad-hoc session")).length, 1);
});

test("C-2: the digest still gates, and still moves, over the FILTERED set", async () => {
  const { m, summary } = armed();
  summary.emit([entry(), adHocEntry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  // The ad-hoc session's own state moving is invisible on the wire, so it must not cost a
  // write — the digest is over what is really sent.
  summary.emit([entry(), adHocEntry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 1, "a change to a filtered row is not a change to the set");
  // …and a change to a REPORTED row still posts.
  summary.emit([entry({ state: "idle" }), adHocEntry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.equal(bodies(m)[1][0].state, "idle");
});

test("C-2: a workspace whose ONLY sessions are ad-hoc posts the empty set, then stops", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.deepEqual(m.disk[m.REPORTED_WORKSPACES_KEY], { "user-a": ["ws-1"] });
  summary.emit([adHocEntry()]); // the uuid-threaded session ends; only the DM is left
  await drained();
  assert.deepEqual(bodies(m)[1], [], "the previous row is deleted rather than left claiming `working`");
  assert.deepEqual(m.disk[m.REPORTED_WORKSPACES_KEY], {});
  summary.emit([adHocEntry({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 2, "and it does not re-post the same empty set forever");
});

test("C-2: the SKIPPED-log ledger is released with the pill, like the origin stamps", async () => {
  const { m, summary } = armed();
  summary.emit([adHocEntry()]);
  await drained();
  summary.emit([]); // the ad-hoc session ends
  await drained();
  summary.emit([adHocEntry()]); // a NEW one on the same key
  await drained();
  assert.equal(m.logged.filter((l) => l.includes("SKIPPING ad-hoc session")).length, 2,
    "a fresh session says so again — the ledger cannot grow with every DM ever answered");
});

test("LIFECYCLE: `kick()` runs a cycle off the current projection", async () => {
  // Its one caller is the sign-in transition: a fresh credential is not a state change.
  const { m, summary } = armed({ user: null, disk: { sessionReportWorkspaces: { "user-a": ["ws-9"] } } });
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 0, "signed out: nothing is ours to assert");
  assert.equal(m.kick(), undefined);
  await drained();
  assert.equal(m.posts.length, 0, "and a kick while signed out is still nothing");
});

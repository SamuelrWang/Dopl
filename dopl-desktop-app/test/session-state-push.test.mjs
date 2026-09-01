// THE SESSION-STATE WRITER (main/session-state-push.js) — F-147, rollback §3.5 + plan §5.
//
// THE FOUR PROPERTIES THIS FILE EXISTS FOR — each is the difference between this feature
// and a defect:
//
// 1. IT IS A PUSH, NOT A HEARTBEAT. A write costs a state CHANGE. `agent_presence` beats 120 times an hour per
// listener and is the quadratic always-on term plan §5 is shedding; a writer that posted on every projection would be
// that term under a new name. The digest gate is checked in both directions. 2. THE ROW SET MIRRORS THE PILL SET.
// `read_sessions` answering "flint is working" for a session that ended, or for a machine that is not running, is the
// fabrication F-144's "honesty over completeness" refused. So the last session leaving posts an EMPTY set (the
// delete), and a run that starts with a previous run's rows clears them. 3. IT CANNOT REPORT ANOTHER OPERATOR'S
// SESSIONS. Signing out does not end the sessions in the engine, so A's are still there when B signs in on the same
// Mac, and a push under B's credential would file A's handles and thread titles as B's — readable by B. This project
// has had two cross-account bugs; this is the guard. 4. FAILURE IS BOUNDED AND SAID ONCE. `ui-sync`'s ~39 000-attempt
// storm is the tree's cautionary tale, and a per-state-change log would be its quieter cousin.
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

// THE ONE TRANSPORT. `api.js` carries the F-132 401 repair that `listener-io.js` shipped without and took the whole
// Channels subsystem down for; a third copy of a main-process fetch is the class of duplication that caused it.
// Pinned as a SOURCE fact because the block below never names its own require.
test("TRANSPORT: the writer rides api.js, and does not grow a third fetch copy", () => {
  assert.ok(/require\('\.\/api'\)/.test(SRC), "must use the shared api.js helper");
  assert.equal(/\bfetch\(/.test(SRC), false, "no raw fetch — that is api.js's job");
  assert.equal(/require\('\.\/listener-io'\)/.test(SRC), false, "not the listener's lane");
});

// ── 1. THE WIRE ROW ──────────────────────────────────────────────────────────────────

test("ROW: the payload is the schema's shape, field for field", () => {
  const m = load();
  // ⚠ THE EIGHT RICH FIELDS ARRIVE NULL ON THIS FIXTURE AND THEY ARE STILL PRESENT, which is the point of
  // asserting the whole object rather than a subset: `undefined` is dropped by JSON.stringify and would reach
  // the server as a MISSING key, while `null` reaches it as the nullable column's real value. UNMEASURED is a
  // fact the wire has to be able to state.
  assert.deepEqual(m.reportRow(entry()), {
    sessionKey: `${CHAN_A}:${TASK_A}:a1b2c3d4`,
    channelId: CHAN_A,
    threadId: TASK_A,
    name: "a1b2c3d4",
    state: "working",
    channelName: "General",
    threadTitle: "Ship the thing",
    // ⚠ JOINED 2026-08-22 (agent templates, Phase 4's `channel_sessions.template_name`). NULL HERE AND STILL
    // PRESENT, for the reason above: a blank agent has no template, and saying so is not saying nothing.
    templateName: null,
    // ⚠ JOINED 2026-08-31 (20260905120000): the operator-given name, PEER-VISIBLE by design.
    // NULL = never named; the render falls back to `#<id>`.
    displayName: null,
    detail: null,
    toolLabel: null,
    model: null,
    contextUsed: null,
    contextWindow: null,
    tokensSpent: null,
    startedAt: null,
    lastActivityAt: null,
  });
});

// ⚠ THE BELT ON A WIDENED WIRE SHAPE (2026-08-20, the `detail` signal; REWRITTEN 2026-08-22
// for the orchestrator wave). This is the guard the whole by-name design leans on, so it is
// asserted rather than assumed.
//
// `reportRow` picks the server row's columns BY NAME. THE FAILURE IT PREVENTS IS NOT A COSMETIC ONE: the endpoint's
// zod schema validates the ARRAY, so ONE row carrying an unknown key or a fourth `state` value rejects the WHOLE
// payload; `retryable(400)` is false, so the digest is never recorded and EVERY LATER PUSH for that workspace fails
// identically — for the valid sessions too. `read_sessions` then answers [] for this machine and the stale rows are
// never cleared. A row shape that grows by accident is that outage.
//
// ⚠ THE ASSERTION FLIPPED SIDES, AND THE GUARD DID NOT. It used to read "a widened summary entry does NOT widen the
// wire row" and listed SEVEN keys; the orchestrator wave deliberately added EIGHT more, with the columns to receive
// them. So the pin is a closed list either way, and it still catches the case it was written for: a field appearing
// on `session-summary.js` and reaching the table because nobody chose to send it. ⚠ SIXTEEN SINCE 2026-08-22 (agent
// templates): `templateName` was added DELIBERATELY, with the column to receive it (`channel_sessions.template_name`,
// OPERATOR-ONLY — the server's mapper is the fence and the GRANT list is the belt, neither of which is this file's).
test("ROW: the wire row is exactly the sixteen columns, and no summary field rides along free", () => {
  const m = load();
  const wide = entry({
    detail: "tool",
    toolLabel: "Bash",
    model: "claude-opus-5",
    contextUsed: 84_000,
    contextWindow: 200_000,
    tokensSpent: 1_200_000,
    startedAt: 1_700_000_000_000,
    lastActivityAt: 1_700_000_600_000,
    // ⚠ THE ACTUAL SUBJECT OF THIS CASE: a field the summary grows that nobody named in
    // `reportRow`. It must not reach the wire, whatever it is called.
    listening: true,
    toolMode: "bypass",
    messageMode: "auto_both",
    sessionId: "sess-1",
    agentId: "a1b2c3d4",
    templateName: "Code Auditor",
  });
  // ⚠ SEVENTEEN since 2026-08-31: `displayName` joined DELIBERATELY, with the column to
  // receive it (`channel_sessions.display_name`, PEER-VISIBLE by design — Samuel's ruling).
  assert.deepEqual(Object.keys(m.reportRow(wide)).sort(), [
    "channelId", "channelName", "contextUsed", "contextWindow", "detail", "displayName",
    "lastActivityAt", "model", "name", "sessionKey", "startedAt", "state", "templateName",
    "threadId", "threadTitle", "tokensSpent", "toolLabel",
  ]);
  // ⚠ THE NAME CROSSES SANITIZED, exactly as `templateName` does below — `labelOrNull` at 60
  // (`agent-names.js › MAX_NAME`, the column CHECK's own bound).
  assert.equal(m.reportRow(entry({ displayName: "Bug Reviewer" })).displayName, "Bug Reviewer");
  assert.equal(m.reportRow(entry({ displayName: "  a​b\nc  " })).displayName, "a b c");
  assert.equal(m.reportRow(entry({ displayName: "x".repeat(300) })).displayName.length, 60);
  assert.equal(m.reportRow(entry({ displayName: "   " })).displayName, null);
  // ⚠ AND IT IS THE NAME, NEVER THE ID, AND IT IS SANITIZED HERE. The server stores the string verbatim and
  // resolves nothing, so the desktop is the only place the charset and the 120-char bound are applied —
  // through `session-telemetry.js › labelOrNull`, the helper the three telemetry labels take.
  assert.equal(m.reportRow(wide).templateName, "Code Auditor");
  // ⚠ AN UNSAFE CHARACTER BECOMES A SPACE, NOT ELIDED — `labelOrNull`'s rule, and the safe direction:
  // eliding a zero-width would silently JOIN two words a human sees apart.
  assert.equal(m.reportRow(entry({ templateName: "  a\u200bb\nc  " })).templateName, "a b c");
  assert.equal(m.reportRow(entry({ templateName: "x".repeat(300) })).templateName.length, 120);
  assert.equal(m.reportRow(entry({ templateName: "   " })).templateName, null);
  // And the pill value itself is untouched: `state` is the SERVER's closed vocabulary, and
  // a `detail` of "tool" must not leak into it.
  assert.equal(m.reportRow(wide).state, "working");
});

// C-2 — THE FIXTURE IS THE TEST. The row above used to read `chan-1:task-1`, which the server's `SESSION_KEY_RE` and
// `threadId: z.string().uuid()` both reject, so this suite was green about a payload that 400s. Pinned against the
// shipped regexes so a drift in either direction fails HERE rather than in production.
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
  // ⚠ THE KEY STILL CARRIES THE EMPTY MIDDLE SEGMENT — and since 2026-08-21 that shape means
  // something on its own: `<channel>::<agent>` is a CHANNEL-LEVEL agent, whose scope is the
  // main room. `threadId` is null either way; the key is what tells the two apart.
  assert.equal(row.sessionKey, `${CHAN_A}::a1b2c3d4`, "the KEY still carries the empty half");
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
  // ⚠ THE THIRD BEAT WAS `state: "ended"` UNTIL 2026-08-22 and is now a second live state: an ended row no longer
  // goes on the wire at all, so it would have made this case about the ENDED filter rather than about COALESCING. The
  // property under test is unchanged — whatever the microtask interleaving, the LAST state is what the server holds.
  summary.emit([entry({ state: "working", channelName: "Renamed" })]);
  await drained();
  const last = bodies(m)[m.posts.length - 1];
  assert.equal(last[0].state, "working");
  assert.equal(last[0].channelName, "Renamed");
});

// ── 3. THE ROW LIFETIME ──────────────────────────────────────────────────────────────

// ⚠ REVERSED ON 2026-08-22 (Samuel's ended-agent ruling), and the reversal is the point rather than a relaxation.
// This asserted `bodies(m)[0][0].state === "ended"` — an ended session WAS reported, because the retained set was in
// memory, bounded by 12 and cleared by a restart, so the row disappeared almost at once. Retention is now SEVEN DAYS
// and DURABLE, and the server bounds the ARRAY at `SESSION_REPORT_MAX = 32`: reporting them would 400 the whole push,
// unretryably, taking every LIVE session's row down with it. Ended cards are LOCAL now.
test("LIFECYCLE: an ENDED session is NOT reported — its retention is local, not a server row", async () => {
  const { m, summary } = armed();
  summary.emit([entry({ state: "ended" })]);
  await drained();
  // The set it reports is EMPTY, which is the replace protocol's DELETE: a peer's card for a
  // just-ended agent goes on the next state change rather than lingering for a week.
  assert.deepEqual(m.posts.length === 0 ? [] : bodies(m)[0], [],
    "nothing is reported, or an empty set is — either way no ended row reaches the server");
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

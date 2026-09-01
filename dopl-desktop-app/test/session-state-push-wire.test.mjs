// WHAT MAY GO ON THE WIRE — the three client-side refusals (main/session-state-push-wire.js).
//
// ⚠ **SPLIT OUT OF `session-state-push.test.mjs` ON 2026-08-31**, in the same change that split
// the module, and on the same seam. These cases are about the SERVER'S contract for a session row
// — the key charset, `channel_sessions.name`'s CHECK, what the table is even about — where the
// suite they left is about the PUSH: the row shape, the change-not-timer trigger, and the row
// lifetime. Both overran the 500-line cap `test/**/*.mjs` is linted under, which is what forced
// the count; the reason is that they were two subjects sharing a file.
//
// ⚠ **THE THREE ARE ONE FAILURE MODE REACHED BY THREE ROADS, AND THAT IS WHY THEY ARE PINNED
// TOGETHER.** Zod validates the ARRAY, so ONE refused entry 400s the WHOLE payload,
// `retryable(400)` is false, the digest is never recorded, and every later push for that
// workspace fails identically — `read_sessions` answers [] for the machine, valid LIVE rows
// included, and stale rows are never cleared. An ad-hoc key, a nameless row and an ended row all
// arrive there; the tests below are what stop a fourth road being opened by accident.
//
// ⚠ **EVERY ASSERTION DRIVES THE REAL FILTER, NOT A STUB.** `_session-state-push-harness.mjs`
// injects `main/session-state-push-wire.js` itself, so a predicate that stopped restating the
// server's contract would fail here rather than pass against a copy of itself.
//
// THE EXTRACTION AND THE FAKES live in `_session-state-push-harness.mjs`, shared with
// `session-state-push.test.mjs` (the row, the trigger, the lifetime) and
// `session-state-push-identity.test.mjs` (identity and failure).
//
// Run: `node --test dopl-desktop-app/test/session-state-push-wire.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  load, entry, adHocEntry, armed, drained, bodies,
  CHAN_A, TASK_A, TASK_B, ADHOC_TASK_ID,
} from "./_session-state-push-harness.mjs";

// ── 4. C-2: THE AD-HOC SESSION IS FILTERED, AND THE REST OF THE SET SURVIVES ─────────
//
// THE DEFECT: an unthreaded inbound — the ordinary DM — keys as `task-<channel>-<seq>`, which the endpoint refuses.
// Zod validates the ARRAY, so ONE of those 400s the WHOLE `sessions` payload; `retryable(400)` is false and the
// digest is not recorded, so every later push fails identically and `read_sessions` answers `[]` for the machine —
// including its perfectly valid uuid-threaded sessions — while stale rows are never cleared.

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
/**
 * AN ENDED ROW IS LOCAL-ONLY (2026-08-22, Samuel's ended-agent ruling).
 *
 * ⚠ WITHOUT THIS FILTER THE RULING BREAKS THE PUSH ENTIRELY, which is why it is pinned rather than left to the
 * reader. Ended cards are retained for SEVEN DAYS and DURABLY now (`main/agent-history.js`), where they used to be an
 * in-memory set of 12 cleared by a restart. The server bounds the ARRAY at `SESSION_REPORT_MAX = 32`; one oversized
 * payload is a 400, `retryable(400)` is false, the digest is never recorded, and every later push for that workspace
 * fails identically — `read_sessions` answers [] for the machine, LIVE sessions included. Same failure the ad-hoc
 * filter exists for, reached by a different road.
 *
 * ⚠ NOTHING WANTED THEM ON THE WIRE. The OPERATOR's own ended cards come from the LOCAL
 * summaries bridge; PEER cards already filter on row freshness; and `read_sessions` answers
 * "what is this agent DOING", which a dead one is not.
 */
test("ROW/ENDED: ended entries are dropped, and the live ones in the same set still go", () => {
  const m = load();
  const rows = m.reportable([
    entry({ state: "working" }),
    entry({ taskId: TASK_B, agentId: "z9y8x7w6", state: "ended" }),
  ]);
  assert.deepEqual(rows.map((r) => r.state), ["working"]);
});

test("ROW/ENDED: a set of ONLY ended sessions reports the EMPTY set — which is the delete", () => {
  // ⚠ THE ROW STILL LEAVES PROMPTLY. The replace protocol deletes by omission, so a peer's
  // card for a just-ended agent disappears on the next state change rather than lingering a
  // week. Retention keeps the LOCAL card, never the server row.
  const m = load();
  assert.deepEqual(m.reportable([entry({ state: "ended" })]), []);
});

/**
 * A NAMELESS ROW IS REFUSED TOO — THE BELT, NOT THE FIX (2026-08-22).
 *
 * ⚠ THIRD ROAD TO THE SAME WEDGE. `channel_sessions.name` carries CHECK `^[a-z][a-z0-9-]{1,30}$`
 * and `src/features/channels/schema-sessions.ts › SESSION_NAME_RE` restates it; zod validates the
 * ARRAY, so ONE bad name 400s the whole payload, `retryable(400)` is false, the digest is never
 * recorded, and every later push for that workspace fails identically for the life of the run.
 *
 * ⚠ `''` WAS REACHABLE. `session-summary.js › nameOf` answers the empty string for a session with
 * no `agentId` — deliberately, because inventing a name there would be worse — and
 * `session-park.js › startResume` produced exactly that when it resumed a PRE-MULTIPLAYER durable
 * record. That producer is fixed in the same change (it mints an id). This stays because the cost
 * of the NEXT producer getting it wrong is a workspace silently blanked, and the check is a regex.
 */
test("NAME: a row whose handle the server would refuse never reaches the wire", () => {
  const m = load();
  assert.deepEqual(
    m.reportable([entry(), entry({ taskId: TASK_B, agentId: "", name: "" })]).map((r) => r.name),
    ["a1b2c3d4"],
    "the nameless one is dropped; the rest of the set is reported normally"
  );
});

test("NAME: the predicate is `channel_sessions.name`'s CHECK, restated", () => {
  const m = load();
  for (const good of ["a1b2c3d4", "flint", "a-b", "z9", "a".repeat(31)]) {
    assert.equal(m.nameReportable({ name: good }), true, JSON.stringify(good));
  }
  for (const bad of ["", " ", "a", "A1B2C3D4", "1abc", "-abc", "has space", "a_b", "a".repeat(32), null, 7, {}]) {
    assert.equal(m.nameReportable({ name: bad }), false, JSON.stringify(String(bad)));
  }
  assert.equal(m.nameReportable(null), false, "and nothing at all fails closed");
});

test("NAME: the drop is VISIBLE, once per session, and says what it would have cost", async () => {
  const { m, summary } = armed();
  const nameless = entry({ taskId: TASK_B, agentId: "", name: "" });
  summary.emit([entry(), nameless]);
  await drained();
  summary.emit([entry({ state: "idle" }), nameless]); // the same bad row, a later state change
  await drained();
  const said = m.logged.filter((l) => l.includes("SKIPPING nameless session"));
  assert.equal(said.length, 1, "one line per dropped session, not one per push");
  assert.match(said[0], /400s the whole payload/, "it says what the filter is buying");
  assert.equal(
    m.logged.filter((l) => l.includes("SKIPPING ad-hoc session")).length,
    0,
    "…and it is NOT reported as the ad-hoc refusal — different cause, different line"
  );
});

test("ROW/ENDED: the predicate reads the STATE and nothing else", () => {
  const m0 = load();
  assert.equal(m0.liveForWire({ state: "working" }), true);
  assert.equal(m0.liveForWire({ state: "idle" }), true);
  assert.equal(m0.liveForWire({ state: "ended" }), false);
  // Absent / malformed is NOT ended: a row this module cannot classify still goes, and the
  // server's own closed enum is what refuses it. Failing toward "report it" keeps an
  // unrecognised LIVE state visible rather than silently unreported.
  assert.equal(m0.liveForWire({}), true);
  assert.equal(m0.liveForWire(null), true);
});

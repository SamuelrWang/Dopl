// THE CADENCE, DRIVEN THROUGH THE REAL WRITER (main/session-state-push.js › cycle) — the
// orchestrator wave, 2026-08-22.
//
// WHY IT IS A THIRD FILE ON THAT MODULE. `session-telemetry.test.mjs` drives the quantizer and
// the floor as PURE FUNCTIONS; this drives the same rules through the writer's own control flow,
// with the real digest gate, the real replace protocol and the real retry in the loop. The two
// answer different questions and the second is the one that can regress silently: a floor that
// is correct in isolation and consulted in the wrong ORDER inside `cycle` — after the digest is
// recorded, say — is a floor that does nothing, and no unit test of `floorAllows` would notice.
//
// It is not appended to `session-state-push.test.mjs` because that suite measured 493 lines and
// the §1 cap this tree lints `test/**/*.mjs` under is 500. Same seam and same precedent as
// `session-state-push-identity.test.mjs`: shared extraction (`_session-state-push-harness.mjs`),
// cases split by what they are ABOUT.
//
// ⚠ THE PROPERTY UNDER TEST IS AN ABSENCE OF WRITES, WHICH IS THE HARD KIND. Every case here
// counts POSTS, because the defect this whole mechanism exists to prevent — the writer becoming
// a per-SDK-event heartbeat — shows up as nothing but a number of requests. Nothing about the
// row's CONTENT would look wrong.
//
// Run: `node --test dopl-desktop-app/test/session-telemetry-cadence.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telemetry, load, entry, fakeSummary, armed, drained, bodies, CHAN_A, CHAN_B,
} from "./_session-state-push-harness.mjs";

const FLOOR = telemetry.TELEMETRY_MIN_INTERVAL_MS;

/** A writer over a fake summary with a HAND-DRIVEN CLOCK. The floor reads `Date.now()`, so
 *  without this a case would have to wait ten real seconds to observe it once. */
function armedAt(t0 = 1_700_000_000_000, initial = []) {
  const clock = { now: t0 };
  const m = load({ clock });
  const summary = fakeSummary(initial);
  m.start({ getUserId: () => "user-a", summary });
  return { m, summary, clock };
}

/** A working session, at a given moment of its life. `lastActivityAt` is the field that moves
 *  on EVERY engine dispatch — it is the reason the floor exists at all. */
const working = (over = {}) => entry({
  state: "working",
  detail: "thinking",
  model: "claude-opus-5",
  contextUsed: 10_000,
  contextWindow: 200_000, // => 10k buckets
  tokensSpent: 0,
  startedAt: 1_700_000_000_000,
  lastActivityAt: 1_700_000_000_000,
  ...over,
});

// ── 1. THE FLOOR HOLDS CHURN ─────────────────────────────────────────────────────────────
//
// ⚠ THIS IS THE CASE THE WHOLE WAVE TURNS ON. Before the eight rich fields, the set digest
// moved only when a session's coarse state moved — a handful of times per session lifetime. With
// `lastActivityAt` on the wire the digest moves on every dispatch, so WITHOUT the floor this
// writer would post per SDK event: `presence.js`'s always-on cost under a new name, which
// `session-state-push.js`'s own header forbids in capitals.
test("FLOOR: a burst of activity stamps costs ONE write, not one per stamp", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working()]);
  await drained();
  assert.equal(m.posts.length, 1, "the first set is never floored");

  // Thirty dispatches over three seconds — a normal turn.
  for (let i = 1; i <= 30; i += 1) {
    clock.now += 100;
    summary.emit([working({ lastActivityAt: 1_700_000_000_000 + i * 100 })]);
    await drained();
  }
  assert.equal(m.posts.length, 1, "not one of them was worth a write");
});

test("FLOOR: …and the churn DOES ride out once the window has passed", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working()]);
  await drained();
  assert.equal(m.posts.length, 1);

  clock.now += FLOOR - 1;
  summary.emit([working({ lastActivityAt: 1 })]);
  await drained();
  assert.equal(m.posts.length, 1, "one millisecond short");

  clock.now += 1;
  summary.emit([working({ lastActivityAt: 2 })]);
  await drained();
  assert.equal(m.posts.length, 2, "and now it goes");
  // ⚠ ISO ON THE WIRE, EPOCH MS ON THE SUMMARY — `session-telemetry.js › isoOrNull` converts,
  // because the columns are TIMESTAMPTZ and a raw number 400s the whole report.
  assert.equal(bodies(m)[1][0].lastActivityAt, new Date(2).toISOString(),
    "carrying the LATEST churn, not the held one");
});

// ── 2. A STATE CHANGE BYPASSES IT ────────────────────────────────────────────────────────
//
// ⚠ THE ONE DIRECTION THAT MUST NOT BE TRADED AWAY. `state` is what a peer's card is ABOUT, and
// `working -> idle` held back for up to ten seconds to save a write is a card that lies for ten
// seconds — the same class of defect as the freshness guard that made idle peers vanish.
test("BYPASS: a pill move is written immediately, deep inside the floor window", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working()]);
  await drained();
  assert.equal(m.posts.length, 1);

  clock.now += 50; // nowhere near the floor
  summary.emit([working({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 2, "the pill is never delayed");
  assert.equal(bodies(m)[1][0].state, "idle");
});

// ⚠ ARRIVAL AND DEPARTURE ARE STATE TOO. The replace protocol deletes by OMISSION, so an agent
// leaving is a shorter array — and it is the fact a peer card is MOST about. A floor that held
// it would leave a card for an agent that is gone.
test("BYPASS: an agent arriving, and the last one leaving, both skip the floor", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working()]);
  await drained();

  clock.now += 10;
  summary.emit([working(), working({ agentId: "b2c3d4e5", name: "b2c3d4e5" })]);
  await drained();
  assert.equal(m.posts.length, 2, "an arrival is immediate");

  clock.now += 10;
  summary.emit([]);
  await drained();
  assert.equal(m.posts.length, 3, "…and so is the empty set, which IS the delete");
  assert.deepEqual(bodies(m)[2], []);
});

// ⚠ AND THE BYPASS RE-ARMS THE FLOOR RATHER THAN SUSPENDING IT. A state change is a WRITE, so
// it stamps `pushedAt` like any other — otherwise a session that flapped between two states
// would bypass forever and the ceiling would not hold.
test("BYPASS: a state write re-stamps the floor for the churn behind it", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working()]);
  await drained();
  clock.now += 50;
  summary.emit([working({ state: "idle" })]);
  await drained();
  assert.equal(m.posts.length, 2);

  clock.now += 50; // 100ms since the first write, 50ms since the second
  summary.emit([working({ state: "idle", lastActivityAt: 99 })]);
  await drained();
  assert.equal(m.posts.length, 2, "churn is floored from the STATE write, not from the one before it");
});

// ── 3. DIGEST STABILITY UNDER SUB-BUCKET DRIFT ───────────────────────────────────────────
//
// ⚠ THE FLOOR IS THE SECOND LINE OF DEFENCE; THE QUANTIZER IS THE FIRST. Even with the floor
// expired, a set whose only movement is smaller than a bucket must produce the SAME digest and
// therefore no write at all — otherwise every session on the machine would write once per floor
// window forever, which is a heartbeat with a longer period.
test("DIGEST: sub-bucket drift produces no write EVEN when the floor has long expired", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working({ contextUsed: 10_000, tokensSpent: 0 })]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.equal(bodies(m)[0][0].contextUsed, 10_000, "quantized on the way out");

  // Minutes pass. Context creeps by 9 999 tokens (one short of the 10k bucket) and spend by
  // 9 999 (one short of ITS bucket). Nothing a reader could see has changed.
  for (let i = 1; i <= 10; i += 1) {
    clock.now += FLOOR * 3;
    summary.emit([working({ contextUsed: 10_000 + i * 999, tokensSpent: i * 999 })]);
    await drained();
  }
  assert.equal(m.posts.length, 1, "ten expired floor windows and still nothing worth saying");

  // …and crossing the bucket DOES move it.
  clock.now += FLOOR * 3;
  summary.emit([working({ contextUsed: 20_000, tokensSpent: 10_000 })]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.deepEqual(
    [bodies(m)[1][0].contextUsed, bodies(m)[1][0].tokensSpent],
    [20_000, 10_000]
  );
});

// ── 4. NULL PRESERVATION ON THE WIRE, END TO END ─────────────────────────────────────────
//
// ⚠ `undefined` IS NOT `null` HERE: `JSON.stringify` DROPS an undefined value, so a field that
// went missing rather than null reaches the server as an ABSENT key. On a nullable column that
// is the difference between "this build measured nothing" and "this build has no such field",
// and only one of them is true. UNKNOWN is not EMPTY (INVARIANTS §11).
test("NULL: a session that has measured nothing puts eight explicit nulls on the wire", async () => {
  const { summary, m } = armedAt();
  // A SPAWN-IDLE agent: registered, no query started, so nothing has reported a model or a
  // usage block. This is the normal shape, not an edge case.
  summary.emit([entry({ state: "idle" })]);
  await drained();
  const row = bodies(m)[0][0];
  for (const field of ["detail", "toolLabel", "model", "contextUsed", "contextWindow",
    "tokensSpent", "startedAt", "lastActivityAt"]) {
    assert.equal(row[field], null, `${field} must be an explicit null`);
    assert.ok(Object.prototype.hasOwnProperty.call(row, field), `${field} must be PRESENT`);
  }
  // The belt: it really survives serialization as a key.
  assert.match(JSON.stringify(row), /"contextUsed":null/);
});

// ⚠ AND A ZERO IS NOT TURNED INTO ONE. A session that has spent 4 000 tokens quantizes to 0 —
// measured, under a bucket — which is a DIFFERENT claim from "not measured", and the wire keeps
// them apart even though a careless reader might render both as blank.
test("NULL: a measured-but-sub-bucket value crosses as 0, beside a genuinely null neighbour", async () => {
  const { summary, m } = armedAt();
  summary.emit([working({ tokensSpent: 4_000, contextUsed: null, contextWindow: null })]);
  await drained();
  const row = bodies(m)[0][0];
  assert.equal(row.tokensSpent, 0, "measured, under one bucket");
  assert.equal(row.contextUsed, null, "not measured at all");
});

// ── 5. THE FLOOR IS PER WORKSPACE, AND IT IS NOT A SCHEDULE ──────────────────────────────
//
// ⚠ THE PUSH GROUPS BY WORKSPACE AND POSTS EACH SET SEPARATELY, so the floor has to be per
// workspace too: one busy workspace holding a quiet one's write would be a cross-workspace
// coupling nothing else in this module has.
test("FLOOR: one workspace's ceiling never gags another's", async () => {
  const { summary, m, clock } = armedAt();
  const a = () => working({ channelId: CHAN_A, workspaceId: "ws-1" });
  const b = () => working({ channelId: CHAN_B, workspaceId: "ws-2", agentId: "b2c3d4e5", name: "b2c3d4e5" });
  summary.emit([a()]);
  await drained();
  assert.equal(m.posts.length, 1);

  clock.now += 50;
  summary.emit([a(), b()]); // ws-2 has never been written: its first set is unfloored
  await drained();
  assert.equal(m.posts.length, 2);
  assert.equal(m.posts[1].options.workspaceId, "ws-2", "…and ws-1's churn stayed held");
});

// ⚠ THE FLOOR ARMS NO TIMER, WHICH IS THE PROPERTY THAT KEEPS THIS A STATE-CHANGE WRITER. A
// held churn set is simply not written and its digest is NOT recorded; the session's next
// projection move re-evaluates. So a machine that goes quiet inside the window writes NOTHING
// EVER AGAIN until something real happens — where a scheduled flush would fire once more, and
// then the design would be a heartbeat with an apology attached.
test("FLOOR: nothing is queued — a machine that falls silent inside the window stays silent", async () => {
  const { summary, m, clock } = armedAt();
  summary.emit([working()]);
  await drained();
  clock.now += 50;
  summary.emit([working({ lastActivityAt: 42 })]); // held
  await drained();
  assert.equal(m.posts.length, 1);

  // Time passes and NOTHING emits — no dispatch, no state change, no timer.
  clock.now += FLOOR * 100;
  await drained();
  await drained();
  assert.equal(m.posts.length, 1, "the held set was never written by anything on a clock");

  // And the held churn is not LOST either: the next real move carries the latest value.
  summary.emit([working({ state: "idle", lastActivityAt: 43 })]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.equal(bodies(m)[1][0].lastActivityAt, new Date(43).toISOString());
});

// ── 6. THE OPERATOR SWAP CLEARS THE FLOOR WITH THE DIGEST ────────────────────────────────
//
// ⚠ ALL THREE MAPS MOVE TOGETHER. A `pushedAt` surviving a sign-in as a different operator would
// delay the NEW operator's first write for up to the floor, on account of a write they never
// made — and their first write is the one that carries their whole set.
test("IDENTITY: a new operator's first write is never floored by the previous one's", async () => {
  const clock = { now: 1_700_000_000_000 };
  const m = load({ clock });
  const summary = fakeSummary([]);
  const who = { id: "user-a" };
  m.start({ getUserId: () => who.id, summary });

  summary.emit([working()]);
  await drained();
  assert.equal(m.posts.length, 1);

  // B signs in on the same Mac 50ms later, and their own session is already in the registry.
  clock.now += 50;
  who.id = "user-b";
  summary.emit([working({ key: `${CHAN_A}:b:b2c3d4e5`, agentId: "b2c3d4e5", name: "b2c3d4e5" })]);
  await drained();
  // ⚠ The cross-account guard means B may report nothing they did not originate, so the honest
  // set here is EMPTY — and that empty set is a WRITE (the delete), which must not be floored.
  assert.equal(m.posts.length, 2, "B's first cycle wrote, unfloored");
});

// ── 7. THE HEADER'S OWN RULE, PINNED AS SOURCE ───────────────────────────────────────────
//
// ⚠ THE ONE THING NO BEHAVIOURAL CASE CAN CATCH is someone "simplifying" the floor into the
// timer it deliberately is not. `session-state-push.js` has forbidden a timer in capitals since
// F-147; the floor's arrival is the first change that makes one look reasonable.
test("SOURCE: the writer still arms no interval of its own", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "main", "session-state-push.js"),
    "utf8"
  );
  assert.equal(/setInterval\(/.test(src), false, "no interval — this is a push, not a heartbeat");
  // `setTimeout` survives for exactly one thing: the bounded retry's single fixed gap.
  assert.equal((src.match(/setTimeout\(/g) || []).length, 1, "the retry gap, and nothing else");
  assert.match(src, /RETRY_DELAY_MS/, "…and that one is the retry");
});

// THE QUARANTINE — `main/session-state-push-retry.js › makeQuarantine`, wired by
// `main/session-state-push.js › cycle` (2026-09-14).
//
// THE FAILURE IT ENDS. A 4xx is deliberately NOT retryable and the digest is not recorded on a
// failure, so ONE row the SERVER refuses for a reason no client predicate can restate — its
// channel was deleted, this credential is no longer in it — makes EVERY later push for that
// workspace fail identically: `read_sessions` answers [] for the machine, valid rows included,
// and stale rows are never cleared. The three predicates in `session-state-push-wire.js` cover
// the refusals a client CAN restate; this covers the ones only the server knows.
//
// ⚠ WHY THE PROBE IS FULL-SET-MINUS-ONE AND NOT A BISECT, which is the property these cases are
// really defending: the endpoint is REPLACE-BY-OMISSION, so any probe that SUCCEEDS becomes the
// stored set. A bisect isolates in ~5 probes and writes a knowingly truncated projection on every
// successful one — the exact failure being fixed. The sweep's every POST is either a 4xx that
// writes nothing or the CORRECT final set.
//
// Run: `node --test dopl-desktop-app/test/session-state-push-quarantine.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { armed, drained, entry, bodies } from "./_session-state-push-harness.mjs";

const BAD = "dead-channel-agent";
const keysIn = (body) => (body.sessions || []).map((r) => r.name);

/** A server that refuses any payload carrying `name === BAD` — a deleted channel's row. */
const poisonServer = (body) =>
  keysIn(body).includes(BAD) ? { ok: false, status: 400 } : { ok: true, status: 200 };

const three = () => [
  entry({ agentId: "aaaaaaaa", taskId: "11111111-1111-4111-8111-111111111111" }),
  entry({ agentId: BAD, name: BAD, taskId: "22222222-2222-4222-8222-222222222222" }),
  entry({ agentId: "cccccccc", taskId: "33333333-3333-4333-8333-333333333333" }),
];

// ── 1. THE SWEEP ────────────────────────────────────────────────────────────────────────────

test("QUARANTINE: one refused row is found, and the winning probe stores the GOOD set", async () => {
  const { m, summary } = armed({ server: poisonServer });
  summary.emit(three());
  await drained();

  const sent = bodies(m);
  assert.deepEqual(keysIn(m.posts[0].options.body).sort(), ["aaaaaaaa", "cccccccc", BAD].sort(),
    "the first POST is the whole set, as it always was");
  // ⚠ EVERY POST IS EITHER A 4xx THAT WRITES NOTHING OR THE CORRECT FINAL SET. Probe 1 removes
  // `aaaaaaaa` and still carries the poison (400); probe 2 removes the poison and lands.
  assert.equal(sent.length, 3, "the whole set, then two probes — never a bisect's truncated writes");
  assert.deepEqual(keysIn(m.posts[2].options.body).sort(), ["aaaaaaaa", "cccccccc"],
    "the stored set is the full set MINUS the refused row, not half of it");
  assert.ok(m.logged.some((l) => l.includes("QUARANTINED session") && l.includes(BAD)),
    "the refused row must be nameable from the log");
});

test("QUARANTINE: later cycles drop the banished row UP FRONT — the workspace is not wedged", async () => {
  const { m, summary } = armed({ server: poisonServer });
  summary.emit(three());
  await drained();
  const afterSweep = m.posts.length;

  summary.emit(three().map((e) => ({ ...e, state: "idle" }))); // a real state change, same rows
  await drained();

  assert.equal(m.posts.length, afterSweep + 1, "ONE post, not another sweep");
  assert.deepEqual(keysIn(m.posts.at(-1).options.body).sort(), ["aaaaaaaa", "cccccccc"]);
  assert.equal(m.posts.at(-1).options.body.sessions[0].state, "idle", "…and the new state landed");
});

// ── 2. WHAT IT MUST NOT DO ──────────────────────────────────────────────────────────────────

test("QUARANTINE: a healthy workspace never sweeps and never banishes anything", async () => {
  const { m, summary } = armed(); // the harness answers 200 by default
  summary.emit(three());
  await drained();
  assert.equal(m.posts.length, 1, "no probe on the happy path");
  assert.equal(m.retries.count(), 0);
});

test("QUARANTINE: a RETRYABLE failure is the backoff's, never the sweep's", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 503 }] });
  summary.emit(three());
  await drained();
  // Two inner attempts and nothing else: a 5xx may answer differently in 15s, so probing it would
  // spend 32 writes on a server that is simply down.
  assert.equal(m.posts.length, m.MAX_ATTEMPTS, "no probes for a 5xx");
  assert.deepEqual(m.retries.pending(), [15000], "the ladder owns this one");
});

test("QUARANTINE: TWO bad rows banish NOBODY — a guess would stop reporting a live agent", async () => {
  const twoBad = (body) =>
    keysIn(body).some((n) => n === BAD || n === "cccccccc") ? { ok: false, status: 400 } : { ok: true, status: 200 };
  const { m, summary } = armed({ server: twoBad });
  summary.emit(three());
  await drained();

  assert.equal(m.posts.length, 4, "the whole set plus three probes, all refused");
  assert.ok(m.logged.some((l) => l.includes("no single row explains the refusal")));
  assert.equal(m.logged.some((l) => l.includes("QUARANTINED session")), false, "nothing banished on a guess");
});

test("QUARANTINE: a single-row payload is never swept — there is nothing to remove it from", async () => {
  const { m, summary } = armed({ answers: [{ ok: false, status: 400 }] });
  summary.emit([entry({ agentId: BAD, name: BAD })]);
  await drained();
  assert.equal(m.posts.length, 1, "removing the only row would report an EMPTY set, not a repair");
});

// ── 3. THE BANISHMENT IS BOUNDED BY THE SESSION ─────────────────────────────────────────────

test("QUARANTINE: an agent that leaves the projection takes its quarantine with it", async () => {
  const { m, summary } = armed({ server: poisonServer });
  summary.emit(three());
  await drained();

  // The refused agent ends and its row leaves the report list entirely…
  summary.emit(three().filter((e) => e.name !== BAD));
  await drained();
  // …and coming back (a new session on a channel that exists again) is reported, not silently
  // dropped. A permanent banishment keyed on a session that is gone is a row nobody can explain.
  const healthy = armed({ server: poisonServer });
  assert.ok(m.posts.length >= 3);
  healthy.summary.emit([entry({ agentId: "dddddddd" })]);
  await drained();
  assert.deepEqual(keysIn(healthy.m.posts.at(-1).options.body), ["dddddddd"]);
});

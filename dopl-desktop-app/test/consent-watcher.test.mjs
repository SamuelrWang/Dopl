// Tests for the async consent watcher's pure decision helpers (consent-watcher.js,
// Round B). These back the pending-requests model: how a raw server consent status
// maps to a watcher action, the back-off cadence for polling a parked row, and the
// two guards that make the REPLAY-RESPAWN bug impossible — a settled request key is
// never re-acted on, and a record reloaded mid-spawn is never re-run.
//
// Run: `node --test dopl-desktop-app/test/consent-watcher.test.mjs`
//
// WHY SOURCE EXTRACTION: consent-watcher.js is CommonJS and pulls in electron-store
// + electron, so it cannot be imported under `node --test`. The decision helpers
// are deliberately fenced by BEGIN/END sentinel comments as PURE functions (no
// electron/store/network refs), so this test reads the real source, slices the
// fenced block, and evaluates it verbatim — the test stays honest to what ships.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "consent-watcher.js"), "utf8");

const BEGIN = "// ─── BEGIN WATCHER-PURE";
const END = "// ─── END WATCHER-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN WATCHER-PURE sentinel missing");
assert.notEqual(to, -1, "END WATCHER-PURE sentinel missing");
assert.ok(to > from, "watcher-pure sentinels out of order");
const BLOCK = SRC.slice(from, to);

const {
  requestKey,
  mapStatus,
  nextPollDelay,
  isSettledIn,
  isInterruptedSpawn,
  isAwaiting,
  countAwaiting,
} = new Function(
  `${BLOCK}\n return { requestKey, mapStatus, nextPollDelay, isSettledIn, isInterruptedSpawn, isAwaiting, countAwaiting };`
)();

// ── requestKey: the stable per-request identity (channel + seq) ──────────────
test("requestKey is (channelId, seq) — shared across the whole lifecycle", () => {
  assert.equal(requestKey("chan-abc", 42), "chan-abc:42");
  // Inbound and its later outbound review share ONE key so settlement + de-dupe
  // are per REQUEST, not per row.
  assert.equal(requestKey("chan-abc", 42), requestKey("chan-abc", 42));
  assert.notEqual(requestKey("chan-abc", 42), requestKey("chan-abc", 43));
});

// ── mapStatus: raw server status -> watcher action ───────────────────────────
test("allowed and auto_allowed both map to allow (trust + explicit)", () => {
  assert.equal(mapStatus("allowed"), "allow");
  assert.equal(mapStatus("auto_allowed"), "allow"); // standing trust, server-born
});

test("denied -> deny, expired -> expire, pending -> pending", () => {
  assert.equal(mapStatus("denied"), "deny");
  assert.equal(mapStatus("expired"), "expire");
  assert.equal(mapStatus("pending"), "pending");
});

test("unknown / transient status -> unknown (keep waiting, never act)", () => {
  // A transient poll error or an unrecognized status must NOT be read as a
  // decision — the watcher keeps the request pending rather than dropping it.
  assert.equal(mapStatus(""), "unknown");
  assert.equal(mapStatus(null), "unknown");
  assert.equal(mapStatus(undefined), "unknown");
  assert.equal(mapStatus("weird"), "unknown");
});

// ── nextPollDelay: cadence backs off as a request sits unanswered ────────────
test("poll cadence steps down the longer a request is parked", () => {
  assert.equal(nextPollDelay(0), 5_000); // first minute: snappy
  assert.equal(nextPollDelay(59_000), 5_000);
  assert.equal(nextPollDelay(61_000), 10_000); // 1–5 min
  assert.equal(nextPollDelay(4 * 60_000), 10_000);
  assert.equal(nextPollDelay(6 * 60_000), 20_000); // 5–30 min
  assert.equal(nextPollDelay(45 * 60_000), 60_000); // parked long — gentle 60s
});

test("cadence is monotonic non-decreasing in elapsed time", () => {
  let prev = 0;
  for (const e of [0, 30_000, 61_000, 200_000, 6 * 60_000, 60 * 60_000]) {
    const d = nextPollDelay(e);
    assert.ok(d >= prev, `delay should not decrease at ${e}ms`);
    prev = d;
  }
});

// ── isSettledIn: THE replay-respawn guard ────────────────────────────────────
test("a settled request key is recognized (never re-acted on)", () => {
  // The server inbound row can stay `allowed` forever; the settled set is what
  // stops a restart / later poll from re-spawning an already-handled request.
  const settled = { "chan:7": { outcome: "denied", at: 1 }, "chan:8": { outcome: "sent", at: 2 } };
  assert.equal(isSettledIn(settled, "chan:7"), true);
  assert.equal(isSettledIn(settled, "chan:8"), true);
  assert.equal(isSettledIn(settled, "chan:9"), false);
});

test("isSettledIn is safe on empty / missing maps", () => {
  assert.equal(isSettledIn(undefined, "chan:1"), false);
  assert.equal(isSettledIn(null, "chan:1"), false);
  assert.equal(isSettledIn({}, "chan:1"), false);
  // hasOwnProperty-based: a key like 'toString' must not be a false positive.
  assert.equal(isSettledIn({}, "toString"), false);
});

// ── isInterruptedSpawn: never re-run a spawn that died mid-flight ────────────
test("a record reloaded in the 'spawning' phase is treated as interrupted", () => {
  assert.equal(isInterruptedSpawn("spawning"), true);
  assert.equal(isInterruptedSpawn("await-inbound"), false);
  assert.equal(isInterruptedSpawn("await-outbound"), false);
});

// ── isAwaiting: what counts toward the tray "Pending: N" ─────────────────────
test("only await-inbound / await-outbound count as pending", () => {
  assert.equal(isAwaiting("await-inbound"), true); // waiting on Allow/Deny
  assert.equal(isAwaiting("await-outbound"), true); // waiting on Send/Cancel
  assert.equal(isAwaiting("spawning"), false); // active work, not a pending ask
  assert.equal(isAwaiting("done"), false);
});

// ── countAwaiting + sign-out reset (FIX 1) ───────────────────────────────────
// emitCount() derives the tray "Pending: N" from countAwaiting(record phases).
// reset() (sign-out) clears the record set, so the count it emits is 0 — that is
// what makes a stale "Pending: N" impossible after sign-out.
test("countAwaiting counts only the await-* phases", () => {
  assert.equal(
    countAwaiting(["await-inbound", "await-outbound", "spawning", "done"]),
    2
  );
  // Non-awaiting phases (active work / settled) never inflate the tray count.
  assert.equal(countAwaiting(["spawning", "done", "gone"]), 0);
});

test("countAwaiting([]) is 0 — the sign-out reset postcondition", () => {
  // reset() empties records; emitCount then calls countAwaiting over an empty set.
  assert.equal(countAwaiting([]), 0);
});

// ── isInterruptedSpawn: the FIX 2 interrupted-echo gate ──────────────────────
// resume() posts the task_failed + { interrupted: true } terminal echo for EXACTLY
// the records isInterruptedSpawn flags (a 'spawning' record reloaded after a
// mid-spawn crash). Any other reloaded phase must NOT trigger the echo.
test("only a reloaded 'spawning' record routes to the interrupted echo", () => {
  assert.equal(isInterruptedSpawn("spawning"), true); // → post interrupted echo
  assert.equal(isInterruptedSpawn("await-inbound"), false); // re-watched, no echo
  assert.equal(isInterruptedSpawn("await-outbound"), false); // re-watched, no echo
});

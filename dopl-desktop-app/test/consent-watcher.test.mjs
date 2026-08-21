// Tests for the async consent watcher's pure decision helpers (consent-watcher.js,
// Round B). These back the pending-requests model: how a raw server consent status
// maps to a watcher action, the back-off cadence for polling a parked row, and the
// two guards that make the REPLAY-RESPAWN bug impossible — a settled request key is
// never re-acted on, and a record reloaded mid-spawn is never re-run.
//
// ⚠ ONE PHASE LEFT THE VOCABULARY ON 2026-08-20 (Samuel's ruling): `await-outbound`, the
// record waiting on Send/Cancel over a reply the `claude -p` HEADLESS lane had drafted. That
// lane is deleted, and with it `toOutbound` — the phase's only writer — so `isAwaiting` is
// `phase === 'await-inbound'` alone. The cases that named it are REWRITTEN rather than dropped
// (INVARIANTS §14): a phase with no writer is still a phase that arrives out of a persisted
// store written by an older build, and the predicates have to keep answering about it. See the
// two blocks below for which direction each must answer in.
//
// ⚠ `mapStatus` IS UNTOUCHED. It maps a SERVER STATUS, and the server still has the same five;
// nothing about the outbound consent KIND changed, only which component polls its row.
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

// NOTE (Q12, 2026-07-31): the poll-cadence helpers moved OUT of this fence into
// `main/consent-cadence.js` when the file hit the 500-line cap. They are pure and
// electron-free, so that module is `require`d directly — see
// test/consent-cadence.test.mjs for the cadence + scheduler + rate-cap coverage.
const {
  requestKey,
  mapStatus,
  isSettledIn,
  isInterruptedSpawn,
  isAwaiting,
  countAwaiting,
} = new Function(
  `${BLOCK}\n return { requestKey, mapStatus, isSettledIn, isInterruptedSpawn, isAwaiting, countAwaiting };`
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
  // ⚠ KEPT ON PURPOSE THROUGH THE 2026-08-20 DELETION. `await-outbound` no longer has a
  // writer, but this predicate runs over records loaded FROM DISK at `resume()`, so it is
  // exactly where a stale phase from an older build arrives. It must keep answering false —
  // a legacy record read as an interrupted spawn would post the `{ interrupted: true }`
  // terminal echo for a request that was never spawned.
  assert.equal(isInterruptedSpawn("await-outbound"), false);
});

// ── isAwaiting: what counts toward the tray "Pending: N" ─────────────────────
test("ONLY await-inbound counts as pending — it is the one awaiting phase left", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This asserted
  // `isAwaiting('await-outbound') === true` — the record waiting on Send/Cancel over a reply
  // the HEADLESS lane had drafted. That lane is deleted, `toOutbound` went with it, and the
  // phase has no writer, so the predicate is now `phase === 'await-inbound'` alone.
  //
  // ⚠ THE ASSERTION IS INVERTED RATHER THAN DROPPED, AND THAT IS THE POINT. A deleted phase
  // reading as awaiting would be a tray badge counting a decision nobody can make, and
  // `await-outbound` is still spelled in persisted records on installed machines — a store
  // written by 1.12.x can hand `resume()` one tomorrow. It must read as NOT pending.
  assert.equal(isAwaiting("await-inbound"), true); // waiting on Allow/Deny
  assert.equal(isAwaiting("await-outbound"), false, "a phase with no writer is not a pending ask");
  assert.equal(isAwaiting("spawning"), false); // active work, not a pending ask
  assert.equal(isAwaiting("done"), false);
});

// ⚠ APPROVE-OUT IS NOT GONE, AND NOTHING ABOVE SAYS IT IS. A windowless session's own-channel
// post still bridges to an `outbound` consent row (`session-windowless.js › bridgeOutbound`) and
// is still answered in the thread view's send box — but that row is polled BY THE SESSION
// (`watchRow`), never by this watcher, and the agent posts its own bytes when its held tool call
// is released. What died is the watcher PHASE, not the consent KIND.

// ── countAwaiting + sign-out reset (FIX 1) ───────────────────────────────────
// emitCount() derives the tray "Pending: N" from countAwaiting(record phases).
// reset() (sign-out) clears the record set, so the count it emits is 0 — that is
// what makes a stale "Pending: N" impossible after sign-out.
test("countAwaiting counts only await-inbound, over a mixed set", () => {
  // The mix deliberately keeps a legacy `await-outbound` in it: the count is derived from
  // isAwaiting, so a phase that stopped awaiting must stop being counted, and a suite that
  // only ever passed live phases could not tell the difference.
  assert.equal(
    countAwaiting(["await-inbound", "await-outbound", "spawning", "done"]),
    1
  );
  assert.equal(countAwaiting(["await-inbound", "await-inbound"]), 2, "and it really counts");
  // Non-awaiting phases (active work / settled) never inflate the tray count.
  assert.equal(countAwaiting(["spawning", "done", "gone", "await-outbound"]), 0);
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
  // A legacy phase from a pre-2026-08-20 store: re-watched (and then dropped as not pending
  // by isAwaiting), never echoed for.
  assert.equal(isInterruptedSpawn("await-outbound"), false);
});

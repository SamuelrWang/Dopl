// AUDIT D5 — the durable session-record set must be bounded (closes FOLLOW-UP F8).
//
// Records were never pruned (session-store.removeRecord existed with no caller), so every thread
// that ever ran on this machine stayed peer-resurrectable forever: the inbound gate creates a
// parked shell from an inbound message alone, and recreateParkedShell reads the record to do it.
// Combined, that is an unbounded, growing set of windows a peer can pop.
//
// POLICY CHOSEN (main/session-store.js prunableKeys): age + count, with protections checked
// FIRST so nothing an operator might still want is dropped.
//   PROTECTED  a key with a LIVE session (`keep`, the engine registry — this is also what
//              protects an unanswered held/queued message, since that queue is memory-only);
//              a key with a RETAINED sdkSessionId (still reopenable + resumable); any phase
//              that is neither 'ended' nor 'parked' (a record that still looks live).
//   RULE 1     drop an unprotected record last started more than 30 days ago.
//   RULE 2     if more than 200 records survive, drop the oldest unprotected ones (LRU by
//              startedAt) until the TOTAL is back at 200. Protected records are counted but
//              never dropped, so a machine full of live threads prunes nothing instead of
//              evicting something reopenable.
// It runs ONCE per app start, from session-engine.init, AFTER the interrupted-record scan.
//
// SOURCE EXTRACTION: prunableKeys lives in the SESSION-STORE-PURE block, so it evaluates
// verbatim with no electron-store handle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");
const ENGINE_SRC = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-STORE-PURE");
const to = SRC.indexOf("// ─── END SESSION-STORE-PURE");
assert.ok(from !== -1 && to > from, "SESSION-STORE-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

const { prunableKeys, RECORD_TTL_MS, MAX_RECORDS } = new Function(
  `${BLOCK}\n return { prunableKeys, RECORD_TTL_MS, MAX_RECORDS };`
)();

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => NOW - days * DAY;

const rec = (over = {}) => ({ key: "k", channelId: "c", phase: "ended", startedAt: ago(1), ...over });
const prune = (all, over = {}) => prunableKeys(all, { now: NOW, hasSdkId: () => false, ...over });

// ── the bound exists ─────────────────────────────────────────────────────────────

test("D5: a stale, closed record ages out", () => {
  const all = { old: rec({ startedAt: ago(90) }), fresh: rec({ startedAt: ago(2) }) };
  assert.deepEqual(prune(all), ["old"]);
});

test("D5: the TTL boundary is exact (30 days) and nothing younger is touched", () => {
  assert.equal(RECORD_TTL_MS, 30 * DAY);
  assert.deepEqual(prune({ k: rec({ startedAt: NOW - RECORD_TTL_MS }) }), [], "exactly at the TTL survives");
  assert.deepEqual(prune({ k: rec({ startedAt: NOW - RECORD_TTL_MS - 1 }) }), ["k"], "one ms past it does not");
});

test("D5: a count cap drops the OLDEST unprotected records first (LRU)", () => {
  const all = {};
  for (let i = 0; i < MAX_RECORDS + 5; i++) all[`k${i}`] = rec({ startedAt: ago(1) + i });
  const dropped = prune(all);
  assert.equal(dropped.length, 5, "only the excess is dropped");
  assert.deepEqual(dropped.sort(), ["k0", "k1", "k2", "k3", "k4"].sort(), "the five oldest");
});

test("D5: a parked (dormant) record is prunable by age, like any other", () => {
  assert.deepEqual(prune({ k: rec({ phase: "parked", startedAt: ago(90) }) }), ["k"]);
});

// ── the protections ──────────────────────────────────────────────────────────────

test("D5: a record with a LIVE session on this machine is never pruned", () => {
  const all = { live: rec({ startedAt: ago(400) }), dead: rec({ startedAt: ago(400) }) };
  assert.deepEqual(prune(all, { keep: new Set(["live"]) }), ["dead"]);
});

test("D5: a record with a retained sdkSessionId is never pruned (still reopenable)", () => {
  const all = { resumable: rec({ startedAt: ago(400) }), spent: rec({ startedAt: ago(400) }) };
  assert.deepEqual(prune(all, { hasSdkId: (k) => k === "resumable" }), ["spent"]);
});

test("D5: a record that still LOOKS live is never pruned, whatever its age", () => {
  for (const phase of ["launching", "running", "awaiting_permission", "awaiting_inbound", "interrupted"]) {
    assert.deepEqual(prune({ k: rec({ phase, startedAt: ago(999) }) }), [], `${phase} is protected`);
  }
});

test("D5: protected records are COUNTED by the cap but never evicted by it", () => {
  const all = {};
  for (let i = 0; i < MAX_RECORDS + 10; i++) all[`k${i}`] = rec({ phase: "running", startedAt: ago(1) + i });
  assert.deepEqual(prune(all), [], "a machine full of live threads prunes nothing, rather than dropping one");
  // With exactly one droppable record among them, the cap takes that one and stops.
  all.spare = rec({ phase: "ended", startedAt: ago(1) });
  assert.deepEqual(prune(all), ["spare"]);
});

test("D5: a held/queued message is protected through its live session, not by luck", () => {
  // The pending-inbound queue lives ONLY on the in-memory session object (session-gate FOLLOW-UP
  // F13), so `keep` — the engine's live registry — is the only thing that can see it.
  const all = { holding: rec({ phase: "parked", startedAt: ago(400) }) };
  assert.deepEqual(prune(all, { keep: new Set(["holding"]) }), []);
});

// ── input hygiene ────────────────────────────────────────────────────────────────

test("D5: junk in the store cannot crash or protect itself", () => {
  const all = { junk: null, noDate: { phase: "ended" }, good: rec({ startedAt: ago(1) }) };
  const dropped = prune(all).sort();
  assert.deepEqual(dropped, ["junk", "noDate"], "an undated / null entry is stale by definition");
});

test("D5: an UNKNOWN phase (a future version's record) is protected, not guessed at", () => {
  assert.deepEqual(prune({ k: rec({ phase: "some_new_phase", startedAt: ago(999) }) }), []);
});

test("D5: nothing to do -> an empty list (the store is not rewritten)", () => {
  assert.deepEqual(prune({}), []);
  assert.deepEqual(prunableKeys(null, { now: NOW }), []);
  assert.deepEqual(prune({ k: rec() }), []);
});

// ── it is actually wired ─────────────────────────────────────────────────────────

test("D5: session-engine.init prunes AFTER the interrupted-record scan, passing the live keys", () => {
  const at = ENGINE_SRC.indexOf("async function init(");
  assert.notEqual(at, -1, "init() moved");
  const body = ENGINE_SRC.slice(at, ENGINE_SRC.indexOf("\n}", at));
  assert.ok(body.includes("store.pruneRecords("), "the policy is called at startup");
  assert.ok(body.includes("keep: new Set(sessions.keys())"), "and told which keys are live");
  assert.ok(
    body.indexOf("offerResume") < body.indexOf("store.pruneRecords("),
    "an interrupted record must still echo + offer its resume before it can age out"
  );
});

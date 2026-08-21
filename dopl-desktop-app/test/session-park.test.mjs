// Tests for the RESUME machinery (main/session-park.js) — P1: the in-place resume of a session
// whose SDK query was torn down at park, plus startResume's check-then-act guard.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-PARK-PURE block references its leaf
// deps (io / store / crypto / Notification / diag) as free vars (required at the module top,
// like session-dispatch.js) plus a bind()-set `deps` for the engine handles. We slice the block,
// prove it is electron/require-free, inject fakes, and pin the ONE property the lane exists for:
// resumeParked rebuilds the query THROUGH buildSdkOptions (the v1.9 security path) with
// options.resume = the retained sdkSessionId — no divergent option assembly, no new
// auto-approval — and it does so SYNCHRONOUSLY, so the effect the reducer queues right behind it
// lands on the FRESH iterator.
//
// ⚠ THE P2 SHELL-RECREATE HALF OF THIS FILE IS DELETED — 2026-08-20, F-228. Five session-park
// exports went with it (`recreateParkedShell`, `openFromChannel`, `emitParkedShell`,
// `evictIdleShell`, `atCapAfterEvict`), and every one of them existed to OPEN, PAINT or MAKE
// ROOM FOR a v1 SESSION WINDOW — a surface that no longer exists anywhere in the tree (the whole
// `renderer/session/**` tree and `main/session-window.js` are gone; agents run WINDOWLESS on the
// SDK engine). Its four injected handles left too: bind() no longer takes `windowFactoryReady`,
// `atWindowCap`, `loadHistory` or `settleSession`.
//
// ⚠ EVERY REMOVED SECTION IS NAMED IN PLACE BELOW, NOT SILENTLY DROPPED (INVARIANTS §14). A test
// file that loses a section without saying which one is a file nobody can audit against the next
// wave — and twice now a whole-file deletion has taken an unrelated live guard with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-PARK-PURE";
const END = "// ─── END SESSION-PARK-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-PARK-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-PARK-PURE sentinel missing");
assert.ok(to > from, "session-park sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The purity assertion is UNCHANGED by the retirement and is the reason the block can be sliced
// at all: the resume family must stay reachable from a plain `new Function`, so a future edit
// cannot quietly re-import electron into the one path a crash recovery runs through.
for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-PARK-PURE block must not reference ${banned}`);
}

const flush = () => new Promise((r) => setImmediate(r));

function harness(over = {}) {
  const cfg = { gateSdk: null, ...over };
  const calls = { buildSdkOptions: [], consume: [], dispatch: [], startSession: [], query: [] };

  const io = {
    makePushIterator: () => ({ __iter: true, pushed: [], push(m) { this.pushed.push(m); }, close() { this.closed = true; } }),
  };
  const sessions = new Map();
  const store = {
    // D2: session-park resumes on the record's OWN slot (agent for a TEAM record, thread for
    // every other), so the fake mirrors the real store's slotKey. It is the ONE store call the
    // surviving block makes — `getRecord` / `getSdkSessionId` went with the shell-recreate lane,
    // which read a durable record to rebuild a window from.
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
  const crypto = { randomBytes: () => ({ toString: () => "deadbeef" }) };
  const Notification = null; // offerResume is exercised elsewhere; not under test here
  const diag = () => {};

  const fakeSdk = { query: (arg) => { calls.query.push(arg); return { __query: true }; } };
  const deps = {
    sessions,
    // `gateSdk` (a deferred) lets a test hold getSdk mid-await to drive the check-then-act race.
    getSdk: async () => { if (cfg.gateSdk) await cfg.gateSdk; return fakeSdk; },
    buildSdkOptions: (s) => { calls.buildSdkOptions.push(s); return { resume: s.resumeSdkId, canUseTool: "GATE", settingSources: [] }; },
    consume: (s, q) => calls.consume.push({ s, q }),
    dispatch: (s, ev) => calls.dispatch.push({ s, ev }),
    // Real startSession sets the Map entry SYNCHRONOUSLY (before its own first await); the fake
    // mirrors that, so a re-check sees a session created during a getSdk await.
    startSession: async (spec) => { calls.startSession.push(spec); const sess = { key: spec.key, settled: false, ...spec }; sessions.set(spec.key, sess); return sess; },
    hasLiveSession: (a) => { const s = sessions.get(store.slotKey(a)); return !!(s && !s.settled); },
    emit: () => {},
  };

  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, resumeParked, startResume };`
  )(io, store, crypto, Notification, diag);
  api.bind(deps);
  return { ...api, deps, sessions, calls, cfg, store };
}

// ── P1: resumeParked rebuilds the query on the SAME object, through buildSdkOptions ──

test("resumeParked sets up a fresh controller + iterator SYNCHRONOUSLY and resumes the sdk id", () => {
  const h = harness();
  const s = { settled: false, sdkSessionId: "sdk-abc", resumeSdkId: null, query: { __old: true }, lastTotalCost: 0.42 };
  h.resumeParked(s);
  assert.ok(s.abortController instanceof AbortController, "a fresh abort controller is created");
  assert.ok(s.pushIterator && s.pushIterator.__iter, "a fresh push iterator exists BEFORE the async consumer");
  assert.equal(s.resumeSdkId, "sdk-abc", "options.resume will carry the retained sdkSessionId");
  assert.equal(s.lastTotalCost, 0, "cost counter resets so the resumed run accrues from 0");
  assert.equal(s.resuming, true);
  // FIX #2: the old sdk id is dropped so a pre-init crash's lifecycle id can't collide with
  // the prior cycle (it was captured into resumeSdkId above for options.resume first).
  assert.equal(s.sdkSessionId, null, "the new cycle mints its own sdk id at its own init");
  // FIX #1b: the old query is superseded synchronously so its late rejection is ignored.
  assert.equal(s.query, null, "the torn-down query is cleared so consume's `s.query !== q` guard trips");
});

test("resumeParked (async) starts the query THROUGH buildSdkOptions (v1.9 security path)", async () => {
  const h = harness();
  const s = { settled: false, sdkSessionId: "sdk-xyz", resumeSdkId: null };
  h.resumeParked(s);
  await flush();
  assert.equal(h.calls.buildSdkOptions.length, 1, "options assembled through the shared buildSdkOptions, not duplicated");
  assert.equal(h.calls.query.length, 1);
  assert.equal(h.calls.query[0].prompt, s.pushIterator, "the SAME fresh iterator drives the resumed query");
  assert.equal(h.calls.query[0].options.resume, "sdk-xyz", "options.resume = the retained sdkSessionId");
  assert.equal(h.calls.consume.length, 1, "the consumer loop attaches");
  assert.equal(s.resuming, false);
  assert.ok(s.query && s.query.__query);
});

test("resumeParked is a no-op for a settled session or a resume already in flight", () => {
  const h = harness();
  const settled = { settled: true };
  h.resumeParked(settled);
  assert.equal(settled.abortController, undefined, "a settled session is never resumed");
  const busy = { settled: false, resuming: true };
  h.resumeParked(busy);
  assert.equal(busy.abortController, undefined, "a resume already in flight is not restarted");
});

// ⚠ THE P2 RECREATE BLOCK STOOD HERE, AND IT IS GONE WITH `recreateParkedShell` (F-228).
//
// Nine tests. What they pinned, so a reader knows what stopped being checked and why none of it
// is a live rule any more:
//   · a durable record + a retained sdkSessionId recreates a DORMANT shell (spec.parkedShell,
//     spec.resumeSdkId threaded, the FIX L1 counterparty binding preserved);
//   · FIX N2 — a TEAM record reopens on its AGENT slot, a PAIR record on the thread slot;
//   · no record -> {ok:false}, and D3 — a record with NOTHING to resume still opened the window
//     because "always-open window" was the v2.5 intent;
//   · FIX F3 — the recreate AWAITED its history load (and survived a rejected one);
//   · FIX F4 — the held body was recorded on the shell BEFORE the read, so session-history could
//     filter it out of the seed;
//   · one shell per key, and window-mode-off -> {ok:false}.
// EVERY ONE OF THEM IS A PROPERTY OF OPENING A WINDOW. The surfaces are deleted outright —
// `renderer/session/**`, `main/session-window.js`, `session-shell.js`, `session-history.js` — so
// there is no dormant-shell object to build, no replay ring to seed, and no window budget to
// spend. The transcript lives on the channels page and a live agent's VIEW is
// `main/agent-window.js`, neither of which needs a session object to exist before it can paint.

// ⚠ THE FIX #7 LRU-EVICTION BLOCK STOOD HERE (five tests, plus the `shell()` factory they
// shared), AND IT IS GONE WITH `evictIdleShell` / `atCapAfterEvict`.
//
// It pinned: at the cap, the OLDEST untouched parked shell is settled to free a slot; an
// operator-touched shell, a LIVE session and one holding a HELD card are all spared; an eviction
// that does not clear the cap still refuses; and C-5 — the eviction ENDS through the reducer
// (`{type:'inactive'}`), never through a bare settle, so the peer's card stops pulsing.
//
// ⚠ THE WHOLE MECHANISM WAS LRU RELIEF FOR THE **WINDOW** BUDGET, which does not exist. The one
// ceiling left is `session-windowless.js › MAX_CONCURRENT_SESSIONS`, and it is a PLAIN REFUSAL
// with nothing to reclaim (session-engine `launch`: one cap branch, no eviction) — pinned in
// test/session-engine-slot.test.mjs. C-5's real subject, "a terminal goes through the reducer so
// it posts", survives in test/session-inactive-notice.test.mjs on its own terms.

// ⚠ THE FIX #4 WINDOW-BUDGET TEST STOOD HERE. It pinned that a recreate is refused at
// MAX_WINDOWS and closes nothing to make room. `settings.MAX_SESSION_WINDOWS` is gone; its
// replacement is the windowless ceiling above, which no path in this file can reach.

// ⚠ THE FIX #8 PROFILE BLOCK (three tests) STOOD HERE. It pinned that a missing / unknown
// persisted profile recreates as read_only and a real one is not clobbered.
// ⚠ THE RULE IS LIVE AND IS NOT LOST: `knownProfile` survives and `startResume` is now its ONE
// caller. test/session-park-resume-profile.test.mjs owns it (C7), over the same three profiles
// and the same corrupt-input table. Only the recreate CALLER went.

// ⚠ THE FIX #9 COUNTER-REHYDRATE TEST STOOD HERE (recreateParkedShell threads the persisted
// turns/costUsd). Same story: the RULE survives on startResume and on session-engine's preamble,
// and test/main-audit-resume-budget.test.mjs pins both halves (D3(a) and D3(b)).

// ⚠ THE D1 IDENTITY-RESTORE BLOCK (four tests, plus the IDENTITY_REC fixture) STOOD HERE. Two of
// them drove `recreateParkedShell` and one drove `emitParkedShell` — the synthesized `init`
// payload a dormant WINDOW painted, which had no SDK system/init of its own. There is no window
// and no renderer to paint into, so `emitParkedShell` is deleted. `contextFromRecord` itself is
// LIVE, and its startResume half ("D1: startResume restores the same identity context") is
// carried by test/session-park-resume-profile.test.mjs's spec-shape test.

// ── THE CHECK-THEN-ACT GUARD IN startResume — REWRITTEN, NOT REMOVED ──────────────
//
// ⚠ THIS TEST USED TO DRIVE THE RACE WITH `recreateParkedShell` (the operator clicking Reopen
// while a crash resume sat on getSdk). The RACER is deleted; THE GUARD IT RACED IS NOT. The
// re-check after the await is live code in `startResume` and its comment states the failure
// directly: "a reopen shell or racing launch may have created this slot during getSdk, and
// startSession would overwrite the Map entry". Dropping the test with the racer would have taken
// a live overwrite guard with it (INVARIANTS §14), so the racer is now a plain claimant landing
// in the registry mid-await — which is what `launch()` does, and the shape the guard actually
// defends against now that no reopen can create anything.

test("a session created during a resume's getSdk await is NOT overwritten (post-await re-check)", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const rec = { channelId: "c1", taskId: "t1", profile: "full", side: "responder", mode: "autonomous" };
  const h = harness({ gateSdk: gate });

  const resuming = h.startResume(rec, "sdk-1", "nudge"); // claims nothing; suspends at getSdk
  // While startResume is parked on getSdk, another creator claims the slot — a racing
  // `launch()` is the one that can still do this. The registry entry is set synchronously,
  // exactly as the real startSession sets it.
  h.sessions.set("c1:t1", { key: "c1:t1", settled: false });

  release();
  assert.equal(await resuming, false, "startResume bails on the post-await re-check");
  assert.deepEqual(h.calls.startSession, [], "no second session is constructed over the racer's entry");
});

test("startResume refuses BEFORE the await too, when the slot is already live", async () => {
  // The cheap half of the same guard: nothing is asked of the SDK for a slot that is occupied.
  const h = harness();
  h.sessions.set("c1:t1", { key: "c1:t1", settled: false });
  assert.equal(await h.startResume({ channelId: "c1", taskId: "t1" }, "sdk-1", "nudge"), false);
  assert.deepEqual(h.calls.startSession, []);
});

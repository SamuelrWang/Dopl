// Tests for the park/resume machinery (main/session-park.js) — P1 in-place resume and
// P2 parked-shell recreation.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-PARK-PURE block references
// its leaf deps (io / store / crypto / Notification / diag) as free vars (required at
// the module top, like session-dispatch.js) plus a bind()-set `deps` for the engine
// handles. We slice the block, prove it is electron/require-free, inject fakes, and pin:
//   resumeParked rebuilds the query THROUGH buildSdkOptions (the v1.9 security path) with
//   options.resume = the retained sdkSessionId; recreateParkedShell recreates a parked
//   shell only when a durable record AND a retained sdkSessionId survive, one per key.

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

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-PARK-PURE block must not reference ${banned}`);
}

const flush = () => new Promise((r) => setImmediate(r));

function harness(over = {}) {
  const cfg = { record: null, sdkId: null, windowReady: true, atCap: false, gateSdk: null, ...over };
  const calls = { buildSdkOptions: [], consume: [], dispatch: [], startSession: [], query: [] };

  const io = {
    makePushIterator: () => ({ __iter: true, pushed: [], push(m) { this.pushed.push(m); }, close() { this.closed = true; } }),
    frameContinuation: (nonce, msg, who) => `FRAMED:${nonce}:${who}:${msg}`,
  };
  const sessions = new Map();
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    getRecord: () => cfg.record,
    getSdkSessionId: () => cfg.sdkId,
  };
  const crypto = { randomBytes: () => ({ toString: () => "deadbeef" }) };
  const Notification = null; // offerResume is exercised elsewhere; not under test here
  const diag = () => {};

  const fakeSdk = { query: (arg) => { calls.query.push(arg); return { __query: true }; } };
  const deps = {
    sessions,
    // `gateSdk` (a deferred) lets a test hold getSdk mid-await to drive the FIX #7 race.
    getSdk: async () => { if (cfg.gateSdk) await cfg.gateSdk; return fakeSdk; },
    buildSdkOptions: (s) => { calls.buildSdkOptions.push(s); return { resume: s.resumeSdkId, canUseTool: "GATE", settingSources: [] }; },
    consume: (s, q) => calls.consume.push({ s, q }),
    dispatch: (s, ev) => calls.dispatch.push({ s, ev }),
    // Real startSession sets the Map entry SYNCHRONOUSLY (before its own first await); the
    // fake mirrors that so a re-check (FIX #7) sees a session created during a getSdk await.
    startSession: async (spec) => { calls.startSession.push(spec); const sess = { key: spec.key, settled: false, ...spec }; sessions.set(spec.key, sess); return sess; },
    hasLiveSession: (a) => { const s = sessions.get(store.sessionKey(a.channelId, a.taskId)); return !!(s && !s.settled); },
    emit: () => {},
    windowFactoryReady: () => cfg.windowReady,
    atWindowCap: () => !!cfg.atCap, // FIX #4
  };

  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, resumeParked, recreateParkedShell, emitParkedShell, startResume };`
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

// ── P2: recreateParkedShell guards ────────────────────────────────────────────────

test("recreateParkedShell: a record + a retained sdkSessionId recreates a parked shell", async () => {
  const rec = { channelId: "c1", taskId: "t1", workspaceId: "w1", side: "requester", profile: "full", mode: "autonomous", counterpartyId: "peer-1" };
  const h = harness({ record: rec, sdkId: "sdk-1" });
  const r = await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.deepEqual(r, { ok: true });
  assert.equal(h.calls.startSession.length, 1);
  const spec = h.calls.startSession[0];
  assert.equal(spec.parkedShell, true, "the shell starts NO query");
  assert.equal(spec.resumeSdkId, "sdk-1", "the retained sdk id is threaded for the eventual resume");
  assert.equal(spec.counterpartyId, "peer-1", "the feed stays counterparty-bound (FIX L1)");
  assert.equal(spec.side, "requester");
});

test("recreateParkedShell: NO record -> {ok:false}, no window created", async () => {
  const h = harness({ record: null, sdkId: "sdk-1" });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false });
  assert.equal(h.calls.startSession.length, 0);
});

test("recreateParkedShell: record but NO retained sdkSessionId -> {ok:false}", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1" }, sdkId: null });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false });
  assert.equal(h.calls.startSession.length, 0);
});

test("recreateParkedShell: one shell per key — an existing live entry short-circuits (no dupe)", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1" }, sdkId: "sdk-1" });
  h.sessions.set("c1:t1", { settled: false });
  const r = await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.deepEqual(r, { ok: true });
  assert.equal(h.calls.startSession.length, 0, "no second window for a key already in the registry");
});

test("recreateParkedShell: window-mode off (no factory) -> {ok:false}", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1" }, sdkId: "sdk-1", windowReady: false });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false });
  assert.equal(h.calls.startSession.length, 0);
});

// ── FIX #4: the shared window budget gates a reopen ────────────────────────────────

test("FIX #4: recreateParkedShell is refused at the MAX_WINDOWS cap (no window created)", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1" }, sdkId: "sdk-1", atCap: true });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false });
  assert.equal(h.calls.startSession.length, 0, "a capped reopen never opens a window");
});

// ── FIX #8: a missing/unknown persisted profile recreates FAIL-RESTRICTIVE ──

test("FIX #8: a missing persisted profile recreates as read_only", async () => {
  const rec = { channelId: "c1", taskId: "t1", side: "responder", mode: "interactive" }; // no `profile`
  const h = harness({ record: rec, sdkId: "sdk-1" });
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.equal(h.calls.startSession[0].profile, "read_only", "a record-only shell fails restrictive, never full");
});

test("FIX #8: an unrecognized persisted profile recreates as read_only", async () => {
  const rec = { channelId: "c1", taskId: "t1", profile: "super_admin", side: "responder", mode: "interactive" };
  const h = harness({ record: rec, sdkId: "sdk-1" });
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.equal(h.calls.startSession[0].profile, "read_only", "an unknown stored value fails restrictive");
});

test("FIX #8: every known profile is preserved on recreate", async () => {
  for (const profile of ["full", "dopl_only", "read_only"]) {
    const rec = { channelId: "c1", taskId: "t1", profile, side: "responder", mode: "interactive" };
    const h = harness({ record: rec, sdkId: "sdk-1" });
    await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
    assert.equal(h.calls.startSession[0].profile, profile, "a real profile is not clobbered by the fallback");
  }
});

// ── FIX #9: the cap budget is rehydrated so a capped session does not reopen fresh ──

test("FIX #9: recreateParkedShell threads the persisted turns/costUsd into the shell", async () => {
  const rec = { channelId: "c1", taskId: "t1", profile: "full", side: "responder", mode: "autonomous", turns: 24, costUsd: 1.5 };
  const h = harness({ record: rec, sdkId: "sdk-1" });
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  const spec = h.calls.startSession[0];
  assert.equal(spec.turns, 24, "the capped turn count rides into the shell so it does not reset");
  assert.equal(spec.costUsd, 1.5);
});

// ── FIX #7: the check-then-act creator race (interleave with a fake async getSdk) ──

test("FIX #7: a reopen shell created during a resume's getSdk await is NOT overwritten", async () => {
  // A deferred getSdk holds startResume mid-await; during it a reopen recreates the shell.
  let release;
  const gate = new Promise((r) => { release = r; });
  const rec = { channelId: "c1", taskId: "t1", profile: "full", side: "responder", mode: "autonomous" };
  const h = harness({ record: rec, sdkId: "sdk-1", gateSdk: gate });

  const resuming = h.startResume(rec, "sdk-1", "nudge"); // claims nothing; suspends at getSdk
  // While startResume is parked on getSdk, the operator clicks Reopen -> recreate the shell.
  const reopened = await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.deepEqual(reopened, { ok: true }, "the reopen creates the parked shell");
  assert.equal(h.calls.startSession.filter((s) => s.parkedShell).length, 1, "exactly one shell");

  release(); // let getSdk resolve; startResume must now re-check and bail, not create a second window
  assert.equal(await resuming, false, "startResume bails on the post-await re-check");
  assert.equal(h.calls.startSession.length, 1, "only the reopen created a session — no orphaned second window");
});

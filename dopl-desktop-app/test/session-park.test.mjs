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
  const calls = { buildSdkOptions: [], consume: [], dispatch: [], startSession: [], query: [], emit: [], settled: [] };

  const io = {
    makePushIterator: () => ({ __iter: true, pushed: [], push(m) { this.pushed.push(m); }, close() { this.closed = true; } }),
    frameContinuation: (nonce, msg, who) => `FRAMED:${nonce}:${who}:${msg}`,
    // FIX F4: the real recorder's shape — the shell must know the held body BEFORE the read.
    noteGatedBody: (s, body) => { (s.gatedBodies = s.gatedBodies || []).push(body); },
  };
  const sessions = new Map();
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    // D2: session-park resumes on the record's OWN slot (agent for a TEAM record,
    // thread for every other), so the fake mirrors the real store's slotKey too.
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
    // FIX N2: keyed, so a test can prove WHICH slot a reopen looks the record up under.
    // `cfg.record` (key-blind) is kept for every test that does not care.
    getRecord: (key) => (cfg.records ? cfg.records[key] || null : cfg.record),
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
    emit: (s, payload) => calls.emit.push(payload),
    windowFactoryReady: () => cfg.windowReady,
    atWindowCap: () => cfg.atCap === true || (cfg.capAt != null && sessions.size >= cfg.capAt), // FIX #4
    // FIX #7: the engine's own settle(), which deletes the registry entry + destroys the window.
    settleSession: (s, outcome) => { calls.settled.push({ key: s.key, outcome }); s.settled = true; sessions.delete(s.key); },
  };

  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, resumeParked, recreateParkedShell, emitParkedShell, startResume, evictIdleShell };`
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

test("FIX N2: a TEAM record reopens on its AGENT slot, which a thread key could never find", async () => {
  // recreateParkedShell keyed on (channel, thread) alone, so a summoned agent's record —
  // agentId set, taskId '' — was looked up under `c1:`, where it has never been written. A
  // team shell could not be reopened at all, and the lookup could collide with a real
  // thread's record in the same channel.
  const rec = {
    channelId: "c1", taskId: "", agentId: "agent-1", bind: "room", workspaceId: "w1",
    side: "responder", profile: "full", mode: "autonomous",
  };
  const h = harness({ records: { "c1:agent-1": rec }, sdkId: null });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "" }), { ok: false },
    "the thread slot holds nothing, and must not");
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "", agentId: "agent-1" }), { ok: true });
  const spec = h.calls.startSession[0];
  assert.equal(spec.key, "c1:agent-1", "the shell reopens on the record's OWN slot");
  assert.equal(spec.agentId, "agent-1", "…as its agent, or its next saveRecord erases that identity");
  assert.equal(spec.bind, "room", "…and with its room binding, not the narrow default");
});

test("FIX N2: a PAIR record is unchanged — no agentId, so slotKey IS the thread key", async () => {
  const rec = { channelId: "c1", taskId: "t1", workspaceId: "w1", side: "requester", profile: "full", mode: "autonomous" };
  const h = harness({ records: { "c1:t1": rec }, sdkId: "sdk-1" });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: true });
  const spec = h.calls.startSession[0];
  assert.equal(spec.key, "c1:t1");
  assert.equal(spec.agentId, null);
  assert.equal(spec.bind, "pair", "the widening is never reached by forgetting the field");
});

test("recreateParkedShell: NO record -> {ok:false}, no window created", async () => {
  const h = harness({ record: null, sdkId: "sdk-1" });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false });
  assert.equal(h.calls.startSession.length, 0);
});

// v2.5 D3 (ALWAYS-OPEN WINDOW): this used to return {ok:false} — a record with no
// resumable sdk session was a dead end. It now opens the shell anyway: the window shows
// the channel history and the first typed turn starts a FRESH session for the task.
test("D3: a record with NO retained sdkSessionId still recreates the shell (resume null)", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full", side: "responder", mode: "interactive" }, sdkId: null });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: true });
  assert.equal(h.calls.startSession.length, 1, "the operator gets a window, not a dead end");
  const spec = h.calls.startSession[0];
  assert.equal(spec.parkedShell, true);
  assert.equal(spec.resumeSdkId, null, "nothing to resume -> a fresh session on the first turn");
});

test("D3: the recreated shell loads the channel history", async () => {
  const loaded = [];
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: null });
  h.deps.loadHistory = (s) => { loaded.push(s); return Promise.resolve(true); };
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.equal(loaded.length, 1, "the empty replay ring is filled from the channel");
  assert.equal(loaded[0].key, "c1:t1");
});

// ── FIX F3: the history load is AWAITED, not fire-and-forget ───────────────────────
// Unawaited, three things went wrong: an operator who typed first got a cold FRESH run with
// no context, the entries then arrived as turn 2 (painted BELOW their own bubble), and a
// fetch that resolved after a racing system/init dropped the seed entirely.

test("FIX F3: recreateParkedShell does not resolve until the history load settles", async () => {
  let release;
  const pending = new Promise((r) => { release = r; });
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: null });
  let done = false;
  h.deps.loadHistory = () => pending;
  const p = h.recreateParkedShell({ channelId: "c1", taskId: "t1" }).then((r) => { done = true; return r; });
  await flush();
  assert.equal(done, false, "the reopen is still waiting on the thread");
  release(true);
  assert.deepEqual(await p, { ok: true });
  assert.equal(done, true);
});

test("FIX F3: a REJECTED history load still resolves the reopen (calm, not a dead window)", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: null });
  h.deps.loadHistory = () => Promise.reject(new Error("offline"));
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: true });
});

// ── FIX F4: the message that popped the gate is recorded BEFORE the read ───────────

test("FIX F4: `holdBody` is recorded on the shell BEFORE the history load runs", async () => {
  const seen = [];
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: null });
  h.deps.loadHistory = (s) => { seen.push((s.gatedBodies || []).slice()); return Promise.resolve(true); };
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1", holdBody: "the held reply" });
  assert.deepEqual(seen, [["the held reply"]], "session-history can filter it out of the entries");
});

test("FIX F4: no holdBody records nothing (an ordinary tray reopen is unchanged)", async () => {
  const seen = [];
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: null });
  h.deps.loadHistory = (s) => { seen.push(s.gatedBodies); return Promise.resolve(true); };
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.deepEqual(seen, [undefined]);
});

// ── FIX #7: LRU relief for the shared window budget ────────────────────────────────
// A recreated shell never leaves the registry on its own, MAX_WINDOWS is shared with
// consent windows, and the gate now creates shells from an inbound message alone — so six
// peer replies to six old tasks used to own the whole budget forever, after which launches
// and consent windows degraded to cap-skips.

function shell(over = {}) {
  return {
    key: over.key || "c9:t9", settled: false, startedAt: over.startedAt || 1,
    state: { parked: true, hasPendingInbound: false, ...(over.state || {}) },
    ...over,
  };
}

test("FIX #7: at the cap, the OLDEST untouched parked shell is settled to free a slot", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: "sdk-1", capAt: 2 });
  h.sessions.set("old:a", shell({ key: "old:a", startedAt: 10 }));
  h.sessions.set("new:b", shell({ key: "new:b", startedAt: 99 }));
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: true });
  assert.deepEqual(h.calls.settled, [{ key: "old:a", outcome: "interrupted" }], "LRU by creation");
  assert.equal(h.calls.startSession.length, 1, "and the reopen goes through");
});

test("FIX #7: a shell the OPERATOR touched, a LIVE session, and a HELD card are all spared", async () => {
  const spared = [
    { operatorTouched: true },
    { state: { parked: false } },
    { state: { parked: true, hasPendingInbound: true } },
    // The queue is memory-only, so a reply waiting BEHIND the head must not be evicted away.
    { pendingInbound: [{ pendingId: "p2", message: "queued" }] },
  ];
  for (const over of spared) {
    const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: "sdk-1", capAt: 1 });
    h.sessions.set("keep:me", shell({ key: "keep:me", ...over }));
    // FAIL RESTRICTIVE: nothing evictable -> the reopen is refused, exactly as before.
    assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false, reason: "busy" }, JSON.stringify(over));
    assert.deepEqual(h.calls.settled, [], "no window is taken from the operator");
    assert.equal(h.calls.startSession.length, 0);
  }
});

test("FIX #7: eviction that does not clear the cap still refuses (never over-budget)", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: "sdk-1", atCap: true });
  h.sessions.set("old:a", shell({ key: "old:a" }));
  // Q6b: a cap refusal now NAMES itself, so the web card can say "close a window" instead of
  // "this thread has no session on this machine" (which would be a lie).
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false, reason: "busy" });
  assert.deepEqual(h.calls.settled, [{ key: "old:a", outcome: "interrupted" }], "one was freed");
  assert.equal(h.calls.startSession.length, 0, "but the cap still holds, so no window opens");
});

test("FIX #7: evictIdleShell settles 'interrupted', which KEEPS the record + sdk id reopenable", () => {
  const h = harness();
  const victim = shell({ key: "old:a" });
  h.sessions.set("old:a", victim);
  assert.equal(h.evictIdleShell(), true);
  assert.equal(h.calls.settled[0].outcome, "interrupted", "never completed/failed (that clears the sdk id)");
  assert.equal(victim.settled, true);
  assert.equal(h.evictIdleShell(), false, "and a settled shell is not evictable twice");
});

test("FIX #7: no eviction is attempted when the engine wired no settle (mid-wave safety)", () => {
  const h = harness();
  h.sessions.set("old:a", shell({ key: "old:a" }));
  delete h.deps.settleSession;
  assert.equal(h.evictIdleShell(), false, "fail restrictive rather than half-settling a session");
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
  // Nothing evictable in the registry, so FIX #7 changes nothing here: still fail-restrictive.
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false, reason: "busy" });
  assert.equal(h.calls.startSession.length, 0, "a capped reopen never opens a window");
  assert.deepEqual(h.calls.settled, [], "and nothing is closed to make room out of nowhere");
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

// ── D1 (v1.7.5): the HEADER IDENTITY is restored from the durable record ──────────
// Both resume paths used to pass context:{}, so a reopened window lost the peer name,
// the channel, and the task title and its header fell back to a bare "Session".

const IDENTITY_REC = {
  channelId: "c1", taskId: "t1", workspaceId: "w1", side: "responder", profile: "full",
  mode: "autonomous", counterpartyId: "peer-1",
  counterpartyName: "David", channelName: "Ops", taskTitle: "Ship the invoice import",
};

test("D1: recreateParkedShell restores channelName / taskTitle / peer name into the context", async () => {
  const h = harness({ record: IDENTITY_REC, sdkId: "sdk-1" });
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  const ctx = h.calls.startSession[0].context;
  assert.equal(ctx.channelName, "Ops");
  assert.equal(ctx.taskTitle, "Ship the invoice import");
  // `authorName` is the field startSession derives counterpartyName from, so the peer
  // name (and therefore the header avatar + "Sent to X" label) survives a reopen.
  assert.equal(ctx.authorName, "David");
  // v2.x: and the ids the delivery framing addresses, so a reopened shell that starts a
  // FRESH run still knows which channel (and workspace) to post into.
  assert.equal(ctx.channelId, "c1");
  assert.equal(ctx.workspaceId, "w1");
});

test("D1: startResume restores the same identity context (opt-in resume path)", async () => {
  const h = harness({ record: IDENTITY_REC, sdkId: "sdk-1" });
  assert.equal(await h.startResume(IDENTITY_REC, "sdk-1", "nudge"), true);
  const spec = h.calls.startSession[0];
  assert.deepEqual(spec.context, {
    channelName: "Ops", taskTitle: "Ship the invoice import", authorName: "David",
    // v2.x: the two ids ride the restored context too — a recreated shell frames its
    // first turn from it (io.takeFraming), and the framing needs the concrete address.
    channelId: "c1", workspaceId: "w1",
  });
  assert.equal(spec.rawFirstTurn, "nudge", "the resume turn is unchanged by the context restore");
  assert.equal(spec.resumeSdkId, "sdk-1");
});

test("D1: a legacy record with no identity fields restores nulls (never undefined)", async () => {
  const h = harness({ record: { channelId: "c1", taskId: "t1", profile: "full" }, sdkId: "sdk-1" });
  await h.recreateParkedShell({ channelId: "c1", taskId: "t1" });
  assert.deepEqual(h.calls.startSession[0].context, {
    channelName: null, taskTitle: null, authorName: null,
    // The ids come from the record's OWN fields (present on every record), so only a
    // missing workspaceId nulls out; the framing degrades to its id-free wording.
    channelId: "c1", workspaceId: null,
  });
});

test("D1: emitParkedShell synthesizes an init carrying the restored identity", () => {
  const h = harness();
  h.emitParkedShell({
    sessionId: "s1", side: "responder", profile: "full", mode: "autonomous", profileLabel: "Full access",
    counterpartyName: "David", context: { channelName: "Ops", taskTitle: "Ship the invoice import" },
  });
  const init = h.calls.emit.find((p) => p.type === "init");
  assert.ok(init, "the shell paints a synthesized init (no SDK system/init ever lands)");
  assert.equal(init.taskTitle, "Ship the invoice import", "the task title is no longer hardcoded null");
  assert.equal(init.channelName, "Ops");
  assert.equal(init.from, "David");
  assert.equal(init.model, null, "no model — nothing is running yet");
  // The calm reopen note + the Paused pill still follow. FIX #14: the note no longer says
  // "the earlier transcript is in the channel thread" — D3 PAINTS that transcript a moment
  // later, so the old copy sat directly above the thread telling the operator to look
  // elsewhere. session-history owns the two no-history cases and says where to read there.
  assert.equal(h.calls.emit[1].text, "Reopened. Nothing is running yet, so send a message to continue.");
  assert.ok(!h.calls.emit[1].text.includes("transcript"), "it no longer points away from the window");
  assert.ok(!h.calls.emit[1].text.includes("—"), "no em dash in copy");
  assert.deepEqual(h.calls.emit[2], { type: "status", phase: "parked" });
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

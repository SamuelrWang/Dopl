// AUDIT D3 — the turn and cost caps must survive a crash -> opt-in-resume cycle.
//
// Two halves, both pinned here:
//   (a) main/session-park.js startResume (the shared resume the startup interrupted-notice
//       drives) built its startSession spec with NO turns / costUsd, unlike its sibling
//       recreateParkedShell (FIX #9). A session that burned 23 of 24 turns, crashed, and was
//       resumed from the notification started again at zero.
//   (b) main/session-engine.js startSession gated the rehydrate on `if (spec.parkedShell)`,
//       so even a spec that DID carry the counters was ignored on any non-shell resume.
// Both had to move for the budget to hold; each is checked on its own below so a future
// regression names which half broke.
//
// (a) is the session-park PURE-block harness (the session-park.test.mjs idiom). (b) evaluates
// the real startSession preamble — the statements between initialSessionState and the context
// assembly — verbatim against a fake state/spec, so it is behavior, not a source grep.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PARK_SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");
const ENGINE_SRC = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");

const from = PARK_SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = PARK_SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing or out of order");
const BLOCK = PARK_SRC.slice(from, to);

// ── (a) startResume carries the record's counters ────────────────────────────────

function harness(over = {}) {
  const cfg = { record: null, windowReady: true, ...over };
  const calls = { startSession: [] };
  const io = { makePushIterator: () => ({ push() {}, close() {} }), noteGatedBody: () => {} };
  const sessions = new Map();
  const store = { sessionKey: (c, t) => `${c}:${t}`, getRecord: () => cfg.record, getSdkSessionId: () => null };
  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, startResume, recreateParkedShell };`
  )(io, store, { randomBytes: () => ({ toString: () => "beef" }) }, null, () => {});
  api.bind({
    sessions,
    getSdk: async () => ({ query: () => ({}) }),
    startSession: async (spec) => { calls.startSession.push(spec); const s = { key: spec.key, settled: false }; sessions.set(spec.key, s); return s; },
    hasLiveSession: (a) => { const s = sessions.get(`${a.channelId}:${a.taskId}`); return !!(s && !s.settled); },
    windowFactoryReady: () => cfg.windowReady,
    atWindowCap: () => false,
    settleSession: () => {},
    loadHistory: async () => {},
    emit: () => {},
  });
  return { ...api, calls, sessions };
}

// The durable record of a session that nearly spent its budget and then crashed.
const spentRecord = {
  key: "c1:t1", channelId: "c1", taskId: "t1", workspaceId: "w1",
  side: "responder", profile: "full", mode: "interactive", phase: "ended",
  counterpartyId: "peer", turns: 23, costUsd: 4.75,
};

test("D3(a): startResume passes the record's spent turn + cost counters into the new session", async () => {
  const h = harness();
  assert.equal(await h.startResume(spentRecord, "sdk-1", "continue where you left off"), true);
  const spec = h.calls.startSession[0];
  assert.equal(spec.turns, 23, "the spent turn count rides the resume, so the cap still bites");
  assert.equal(spec.costUsd, 4.75, "and so does the spent cost");
  assert.equal(spec.resumeSdkId, "sdk-1", "unchanged: the resume is still the retained sdk session");
});

test("D3(a): a legacy record with no counters resumes at zero, never NaN", async () => {
  const h = harness();
  const legacy = { key: "c1:t1", channelId: "c1", taskId: "t1", workspaceId: "w1", side: "responder", phase: "ended" };
  assert.equal(await h.startResume(legacy, "sdk-1", "go on"), true);
  const spec = h.calls.startSession[0];
  assert.ok(spec.turns === undefined || spec.turns === 0, "nothing to rehydrate");
  // The engine's own coercion (pinned in D3(b) below) turns that into 0, never NaN.
  assert.equal(Number(spec.turns) || 0, 0);
  assert.equal(Number(spec.costUsd) || 0, 0);
});

test("D3(a): recreateParkedShell (FIX #9) still carries them too, so both resume paths agree", async () => {
  const h = harness({ record: spentRecord });
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: true });
  const spec = h.calls.startSession[0];
  assert.equal(spec.turns, 23);
  assert.equal(spec.costUsd, 4.75);
});

// ── (b) startSession applies them on EVERY shape, not just a parked shell ─────────

// The real preamble: everything startSession does to `state` between building it and
// assembling the context. Evaluated verbatim, so this cannot drift from what ships.
const preamble = (() => {
  const at = ENGINE_SRC.indexOf("const state = initialSessionState(");
  assert.notEqual(at, -1, "startSession's state assembly moved");
  const end = ENGINE_SRC.indexOf("const context = {", at);
  assert.ok(end > at, "startSession's context assembly moved");
  const seg = ENGINE_SRC.slice(at, end);
  return seg.slice(seg.indexOf("\n") + 1); // drop the initialSessionState line itself
})();
const applyPreamble = new Function("state", "spec", `${preamble}\n return state;`);
const freshState = () => ({ phase: "launching", parked: false, activity: "working", turns: 0, costUsd: 0 });

test("D3(b): a NON-shell resume rehydrates the cap budget (the parkedShell gate is gone)", () => {
  const state = applyPreamble(freshState(), { turns: 23, costUsd: 4.75 });
  assert.equal(state.turns, 23, "a crash/resume must not mint a fresh turn budget");
  assert.equal(state.costUsd, 4.75, "nor a fresh cost budget");
  assert.equal(state.phase, "launching", "and a non-shell resume still boots live, not parked");
  assert.equal(state.parked, false);
});

test("D3(b): a PARKED SHELL still rehydrates AND still boots dormant (FIX #9 unchanged)", () => {
  const state = applyPreamble(freshState(), { turns: 24, costUsd: 1.5, parkedShell: true });
  assert.equal(state.turns, 24);
  assert.equal(state.costUsd, 1.5);
  assert.equal(state.phase, "parked");
  assert.equal(state.parked, true);
  assert.equal(state.activity, "parked");
});

test("D3(b): a fresh launch passes no counters and starts at zero, never NaN", () => {
  const state = applyPreamble(freshState(), { side: "responder" });
  assert.equal(state.turns, 0);
  assert.equal(state.costUsd, 0);
  // A hand-edited store cannot inject NaN through the spec either.
  const bad = applyPreamble(freshState(), { turns: "x", costUsd: NaN });
  assert.equal(bad.turns, 0);
  assert.equal(bad.costUsd, 0);
});

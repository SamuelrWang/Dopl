// AUDIT D3 — the turn and cost caps must survive a crash -> opt-in-resume cycle.
//
// Two halves, both pinned here:
//   (a) main/session-park.js startResume (the shared resume the startup interrupted-notice
//       drives) built its startSession spec with NO turns / costUsd. A session that burned 23 of
//       24 turns, crashed, and was resumed from the notification started again at zero.
//   (b) main/session-engine.js startSession gated the rehydrate on `if (spec.parkedShell)`, so
//       even a spec that DID carry the counters was ignored on any non-shell resume.
// Both had to move for the budget to hold; each is checked on its own below so a future
// regression names which half broke.
//
// ⚠ THE THIRD PATH IS DELETED — 2026-08-20, F-228. `recreateParkedShell` was the sibling that
// already carried the counters (FIX #9) and the reason (b) had a `parkedShell` gate in the first
// place; it minted a dormant v1 SESSION WINDOW from a durable record, and no session has a
// window. The rule it enforced did not go anywhere — startResume is now the ONLY record-driven
// spawn and (a) below is its whole coverage.
//
// (a) is the session-park PURE-block harness (the session-park.test.mjs idiom). (b) evaluates
// the real startSession preamble — the statements between initialSessionState and the context
// assembly — verbatim against a fake state/spec, so it is behavior, not a source grep.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// 2026-08-22: `startResume` mints its own instance id (it is the one spawn `launch` does not
// funnel), so the block's two new free vars are injected REAL — see test/session-park.test.mjs.
const ids = createRequire(import.meta.url)(join(HERE, "..", "main", "agent-id.js"));
const PARK_SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");
const ENGINE_SRC = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");

const from = PARK_SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = PARK_SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing or out of order");
const BLOCK = PARK_SRC.slice(from, to);

// ── (a) startResume carries the record's counters ────────────────────────────────

function harness() {
  const calls = { startSession: [] };
  const io = { makePushIterator: () => ({ push() {}, close() {} }) };
  const sessions = new Map();
  const store = {
    // The record's OWN slot, all three parts — as `main/session-store.js › slotKey` composes it.
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && a.taskId) || ""}:${(a && a.agentId) || ""}`,
  };
  // ⚠ `sessionWindowless` JOINED 2026-08-22 (F-272): `startResume` now enforces
  // `MAX_CONCURRENT_SESSIONS`, which it did not before — a resume could reach seven. These cases
  // are about the CAP BUDGET (turns and cost) rehydrating, so the CONCURRENCY ceiling is
  // deliberately out of their way; its own cases live in `session-park.test.mjs`. A resume
  // refused here would pass every budget assertion vacuously by constructing nothing.
  const sessionWindowless = { MAX_CONCURRENT_SESSIONS: Number.MAX_SAFE_INTEGER, liveCount: () => 0 };
  const api = new Function(
    "io", "store", "crypto", "newAgentId", "isAgentId", "Notification", "sessionWindowless", "diag",
    `${BLOCK}\n return { bind, startResume };`
  )(io, store, { randomBytes: () => ({ toString: () => "beef" }) }, ids.newAgentId, ids.isAgentId, null,
    sessionWindowless, () => {});
  api.bind({
    sessions,
    getSdk: async () => ({ query: () => ({}) }),
    buildSdkOptions: () => ({}),
    consume: () => {},
    dispatch: () => {},
    startSession: async (spec) => { calls.startSession.push(spec); const s = { key: spec.key, settled: false }; sessions.set(spec.key, s); return s; },
    hasLiveSession: (a) => { const s = sessions.get(store.slotKey(a)); return !!(s && !s.settled); },
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

// ⚠ "D3(a): recreateParkedShell (FIX #9) still carries them too, so both resume paths agree"
// STOOD HERE. It was an AGREEMENT test between two record-driven spawns, and there is one left.
// The rule it asserted for the shell — persisted turns/costUsd ride into the new session — is
// exactly what the two tests above assert for startResume, so nothing about the budget is
// unpinned; only the second caller is.

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

// ⚠ KEPT AND REWRITTEN RATHER THAN DELETED WITH ITS OLD PRODUCER (INVARIANTS §14).
//
// This used to read "a PARKED SHELL still rehydrates AND still boots dormant", and the shell that
// set the flag is deleted. THE BRANCH IT PINS IS NOT: `if (spec.parkedShell) { … }` is still in
// the shipping preamble, evaluated verbatim above, and session-engine.js says in as many words
// why it stayed — the flag is also the guard that stops a woken shell inheriting a posture no
// human armed, "so it stays a recognized spec field rather than being scrubbed, and a future
// non-window dormant shape can set it and get the safe behaviour". A producerless branch that
// nothing tests is a branch that rots into the wrong behaviour before its first caller arrives.
test("D3(b): the producerless parkedShell flag STILL boots dormant and still rehydrates", () => {
  const state = applyPreamble(freshState(), { turns: 24, costUsd: 1.5, parkedShell: true });
  assert.equal(state.turns, 24);
  assert.equal(state.costUsd, 1.5);
  assert.equal(state.phase, "parked");
  assert.equal(state.parked, true);
  assert.equal(state.activity, "parked");
  // ...and the retirement really did remove every producer, so this is the contract for a shape
  // that does not exist yet rather than coverage of one that does.
  assert.ok(!/parkedShell: true/.test(PARK_SRC), "session-park no longer sets the flag");
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

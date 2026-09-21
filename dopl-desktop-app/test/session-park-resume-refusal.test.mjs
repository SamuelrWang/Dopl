// THE RESUME REFUSAL — `main/session-park.js`'s two resume doors against a runtime whose usage
// accounting on resume is UNVERIFIED (2026-09-21, U10).
//
// Split out of `session-park.test.mjs` under the 500-line cap on `test/**/*.mjs`, on the seam
// INVARIANTS §1 names: that file is about what a resume DOES, this one about when it must not
// happen at all. The shared extraction machinery is `_session-park-harness.mjs`.

import { test, assert, harness, RUNTIME } from "./_session-park-harness.mjs";

// ── U10 (2026-09-21): THE CODEX RESUME REFUSAL STATES ITS MEASURED REASON ────────────────────
//
// ⚠ THIS IS THE OPEN QUESTION ITSELF, PINNED. The plan's "Usage on resume" question is unanswered
// — there is no `codex` CLI on this machine (Implementation Log, 2026-09-21) — so Codex declares
// `session.usageResetsOnResume: 'unverified'` and `capability.js › canResume` refuses. Until it is
// MEASURED on a live CLI, these cases exist to make enabling it loud: flipping the declaration
// without measuring turns them red rather than turning a budget control off in silence.
//
// ⚠ WHAT IS AT STAKE IS THE COST CAP, NOT THE RESUME. `resumeParked` zeroes `lastTotalCost` and
// `lastTotalTokens` on the assumption that a resumed conversation restarts its cumulative totals.
// A runtime that CONTINUES them makes every delta negative, `session-io.js` clamps it to zero, and
// `session-state.js › costCapReached` is never reached — with no error and no symptom until a
// bill arrives.

test("U10: a parked CODEX session is refused IN PLACE, with the measured reason in the log", () => {
  const h = harness();
  const s = {
    settled: false, runtimeId: "codex", sdkSessionId: "codex-thread-1", resumeSdkId: null,
    query: { __old: true }, lastTotalCost: 0.42, lastTotalTokens: 1200,
  };
  h.resumeParked(s);
  // ⚠ REFUSED IN PLACE AND STILL PARKED: there is nothing to tear down (no query was rebuilt) and
  // a parked session is resumable the moment the answer lands, so the next wake simply retries.
  assert.equal(s.resuming, undefined, "nothing was started");
  assert.equal(s.query.__old, true, "the torn-down query was not superseded");
  assert.equal(s.lastTotalCost, 0.42, "and the delta BASELINES were not zeroed — the whole point");
  assert.equal(s.lastTotalTokens, 1200);
  assert.deepEqual(h.calls.acquired, [], "no runtime was acquired");
  assert.deepEqual(h.calls.consume, [], "no consumer loop was started");
  // ⚠ THE REASON IS A SENTENCE, NOT A CODE. A refusal an operator cannot read is one they work
  // around — and this one names the MEASUREMENT that is missing, not merely "unsupported".
  const line = h.calls.diag.find((l) => l.includes("resume refused"));
  assert.ok(line, `no refusal line: ${JSON.stringify(h.calls.diag)}`);
  assert.match(line, /usage accounting on resume is unverified/);
  assert.match(line, /stops the cost cap firing/);
});

test("U10: the RECORD-driven resume of a Codex session is refused the same way", async () => {
  // ⚠ THE OTHER RESUME SHAPE — `startResume` rebuilds from the DURABLE RECORD, so the runtime
  // comes off `rec.runtimeId` rather than off a live object. Both doors, one predicate.
  const h = harness();
  const ok = await h.startResume(
    { channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", runtimeId: "codex" }, "codex-thread-1", "continue"
  );
  assert.equal(ok, false);
  assert.deepEqual(h.calls.startSession, [], "no session was constructed");
  assert.deepEqual(h.calls.acquired, [], "and the refusal is BEFORE the runtime probe");
  const line = h.calls.diag.find((l) => l.includes("resume refused"));
  assert.match(line, /usage accounting on resume is unverified/);
});

test("U10: CLAUDE still resumes — the refusal is per runtime, not a new blanket rule", async () => {
  const h = harness();
  const s = { settled: false, runtimeId: "claude", sdkSessionId: "sdk-abc", query: { __old: true }, lastTotalCost: 0.42 };
  h.resumeParked(s);
  assert.equal(s.resuming, true);
  assert.equal(s.lastTotalCost, 0, "Claude DOES reset, so zeroing the baseline is correct there");
  const rec = { channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", runtimeId: "claude" };
  assert.equal(await harness().startResume(rec, "sdk-1", "continue"), true);
});

test("U10: the refusal is read off the DESCRIPTOR, so enabling it cannot be a one-line edit here", () => {
  // ⚠ ONE DECLARATION, ONE ENFORCEMENT. The adapter declares `usageResetsOnResume` and
  // `capability.js › resumeRefusal` is the only thing that reads it — this case pins that the
  // sentence the two lanes above logged is the descriptor's own, so answering the plan's "Usage on
  // resume" question turns all of this green with no change in `session-park.js`.
  const declared = RUNTIME.descriptorFor("codex").session.usageResetsOnResume;
  assert.equal(declared, "unverified", "Codex must stay unverified until a live CLI measures it");
  assert.equal(RUNTIME.capability.canResume(RUNTIME.descriptorFor("codex")), false);
  assert.match(
    RUNTIME.capability.resumeRefusal(RUNTIME.descriptorFor("codex")),
    /usage accounting on resume is unverified/
  );
  assert.equal(RUNTIME.capability.resumeRefusal(RUNTIME.descriptorFor("claude")), null);
});


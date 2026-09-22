// WHEN A RESUME MAY HAPPEN, AND WHAT IT BILLS — `main/session-park.js`'s two resume doors against
// a runtime whose usage accounting on resume does not match what `resumeParked` assumes
// (2026-09-21 U10; the answer MEASURED 2026-09-22; the baseline made runtime-aware by CXP-4).
//
// Split out of `session-park.test.mjs` under the 500-line cap on `test/**/*.mjs`, on the seam
// INVARIANTS §1 names: that file is about what a resume DOES, this one about whether it may happen
// at all and, now, about the arithmetic that decides whether it may. The shared extraction
// machinery is `_session-park-harness.mjs`.
//
// ── 🔒 THE TRIP-WIRE THIS FILE WAS, AND WHY IT MOVED (CXP-4, 2026-09-22) ──────────────────────
//
// ⚠ **THIS SUITE USED TO ASSERT THAT A PARKED CODEX SESSION IS REFUSED, AND IT NO LONGER DOES.**
// That is a deliberate change to a deliberate trip-wire, so the argument is written down here
// rather than inferred from a diff.
//
// The refusal was never about the protocol. `thread/resume` was always real and always declared
// (`session.resume: true`). What refused was `capability.js › canResume` requiring
// `usageResetsOnResume === true`, and the reason it required that is one line of CORE: `resumeParked`
// ZEROED `s.lastTotalCost` / `s.lastTotalTokens` unconditionally, on the assumption that every
// runtime restarts its cumulative total on a resumed conversation. Measured, Codex does not — so
// against it that reset made the first post-resume `result` re-bill the WHOLE thread. The refusal
// was protecting the billing from core, not protecting core from the protocol.
//
// ⚠ SO THE FIX WAS TO REMOVE THE HARM, NOT THE MEASUREMENT. `usageResetsOnResume` is STILL `false`
// for Codex — that is what was measured and it must never move — and the baseline is now decided
// per runtime (`capability.js › resumeZeroesBaseline`). `false` means CARRY IT FORWARD, so only new
// work is billed; `true` means zero it, which is the line Claude always ran.
//
// ⚠ WHAT STILL REFUSES IS `'unverified'`, AND THAT HALF OF THE TRIP-WIRE IS UNCHANGED AND TESTED
// BELOW. An unmeasured runtime gives core no safe direction: zero it and a continuing runtime
// re-bills paid history; preserve it and a resetting runtime reports every later turn as zero
// through `session-io.js › applyCoreEvents`'s `Math.max(0, …)` clamp. UNKNOWN IS NOT EMPTY.
//
// ── THE MEASUREMENT, KEPT VERBATIM ───────────────────────────────────────────────────────────
// (2026-09-22, public `codex-cli 0.155.1`.) One thread: a turn in a cold `codex app-server` child,
// then `thread/resume` in a SECOND child and two more turns. `thread/tokenUsage/updated` reported
// `total.totalTokens` 18,838 → 42,429 → 71,194 against `last.totalTokens` 18,838 / 23,591 /
// 28,765 — every step is the previous total plus that turn's `last`, EXACTLY, and the resume
// restarted nothing.

import { createRequire } from "node:module";
import { test, assert, harness, flush, RUNTIME, HERE, join } from "./_session-park-harness.mjs";

// ⚠ THE REAL BILLING ARITHMETIC, REQUIRED RATHER THAN RESTATED. `session-io.js › applyCoreEvents`
// is what turns a platform total into a charge, and a suite that restated its `total - baseline`
// would be a second, agreeing-with-itself copy of the exact line CXP-4 is about. It is electron-free
// and a dozen suites already require it in plain Node.
const io = createRequire(import.meta.url)(join(HERE, "..", "main", "session-io.js"));
const fakeStore = { setSdkSessionId() {}, saveRecord() {} };

// The three totals the measurement produced, so the cases below bill against real numbers.
const TOTAL_BEFORE_RESUME = 42429;
const TOTAL_AFTER_ONE_MORE_TURN = 71194;
const THAT_TURN = TOTAL_AFTER_ONE_MORE_TURN - TOTAL_BEFORE_RESUME; // 28,765

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────

test("CXP-4: a MEASURED baseline — either direction — is resumable; only the unmeasured is not", () => {
  // ⚠ ONE DECLARATION, ONE ENFORCEMENT. The adapter declares `usageResetsOnResume` and
  // `capability.js` is the only thing that reads it. `false` is what was MEASURED for Codex and
  // moving it to `true` would be a claim the measurement contradicts — this case is what turns
  // that red.
  const codex = RUNTIME.descriptorFor("codex");
  assert.equal(codex.session.usageResetsOnResume, false,
    "MEASURED: Codex continues its cumulative total across a resume");
  assert.equal(RUNTIME.capability.canResume(codex), true,
    "…and a continuing runtime is resumable now that the baseline is carried rather than zeroed");
  assert.equal(RUNTIME.capability.resumeRefusal(codex), null);
  assert.equal(RUNTIME.capability.canResume(RUNTIME.descriptorFor("claude")), true);
  assert.equal(RUNTIME.capability.resumeRefusal(RUNTIME.descriptorFor("claude")), null);
  // ⚠ AND THE HALF THAT STILL REFUSES, driven off a synthetic descriptor rather than whichever
  // adapter happens to be unmeasured this month.
  const unmeasured = { session: { resume: true, usageResetsOnResume: "unverified" } };
  assert.equal(RUNTIME.capability.canResume(unmeasured), false);
  assert.match(String(RUNTIME.capability.resumeRefusal(unmeasured)), /unverified/);
  const absent = { session: { resume: true } };
  assert.equal(RUNTIME.capability.canResume(absent), false, "absent reads like unverified, not like false");
  // A runtime with no resume verb at all is still refused first, and for its own reason.
  assert.match(
    String(RUNTIME.capability.resumeRefusal({ session: { resume: false, usageResetsOnResume: true } })),
    /cannot resume a conversation/
  );
});

test("CXP-4: an UNMEASURED runtime is still refused IN PLACE, with a readable reason", () => {
  // ⚠ REFUSED BEFORE ANYTHING IS TORN DOWN: the session stays parked and the next wake retries
  // the moment the answer lands. Driven through a descriptor the registry really answers with —
  // `RUNTIME.ids()` is asked so this cannot rot into a case about a runtime nobody ships.
  const unmeasuredId = RUNTIME.ids().find(
    (id) => RUNTIME.descriptorFor(id).session.usageResetsOnResume === "unverified"
  );
  assert.ok(unmeasuredId, "no unmeasured adapter is registered — this refusal would be untested");
  const h = harness();
  const s = {
    settled: false, runtimeId: unmeasuredId, sdkSessionId: "sdk-abc", resumeSdkId: null,
    query: { __old: true }, lastTotalCost: 0.42, lastTotalTokens: 1200,
  };
  h.resumeParked(s);
  assert.equal(s.resuming, undefined, "nothing was started");
  assert.equal(s.query.__old, true, "the torn-down query was not superseded");
  assert.equal(s.lastTotalCost, 0.42, "and the delta BASELINES were not touched");
  assert.equal(s.lastTotalTokens, 1200);
  assert.deepEqual(h.calls.acquired, [], "no runtime was acquired");
  assert.deepEqual(h.calls.consume, [], "no consumer loop was started");
  const line = h.calls.diag.find((l) => l.includes("resume refused"));
  assert.ok(line, `no refusal line: ${JSON.stringify(h.calls.diag)}`);
  assert.match(line, /unverified/, "the reason is a SENTENCE, not a code");
});

// ── THE BASELINE ─────────────────────────────────────────────────────────────────────────────

test("CXP-4: a `continues` runtime keeps its baseline; a `resets` runtime still zeroes", () => {
  const cont = harness();
  const continuing = {
    settled: false, runtimeId: "codex", sdkSessionId: "codex-thread-1",
    lastTotalCost: 0.42, lastTotalTokens: TOTAL_BEFORE_RESUME,
  };
  cont.resumeParked(continuing);
  assert.equal(continuing.resuming, true, "the resume really started");
  assert.equal(continuing.lastTotalTokens, TOTAL_BEFORE_RESUME,
    "the pre-resume total is CARRIED FORWARD — post-resume deltas bill only new work");
  assert.equal(continuing.lastTotalCost, 0.42);

  const res = harness();
  const resetting = {
    settled: false, runtimeId: "claude", sdkSessionId: "sdk-abc",
    lastTotalCost: 0.42, lastTotalTokens: 1200,
  };
  res.resumeParked(resetting);
  assert.equal(resetting.lastTotalCost, 0, "Claude DOES restart its totals, so zeroing is correct there");
  assert.equal(resetting.lastTotalTokens, 0);
});

test("CXP-4: the carried baseline bills only the new turn — through the REAL arithmetic", () => {
  // 🔒 ⚠ **THIS IS THE CASE THE FEATURE EXISTS FOR.** `applyCoreEvents` is the shipped line; the
  // numbers are the measured ones. With the baseline carried, the post-resume `result` charges the
  // turn. With it zeroed — the behaviour before CXP-4 — it charges the whole thread a second time,
  // and the asserted difference is exactly the size of that double-charge.
  const h = harness();
  const s = {
    settled: false, runtimeId: "codex", sdkSessionId: "codex-thread-1",
    state: { turns: 2, costUsd: 0 },
    lastTotalCost: 0, lastTotalTokens: TOTAL_BEFORE_RESUME, tokensSpent: TOTAL_BEFORE_RESUME,
  };
  h.resumeParked(s);
  io.applyCoreEvents(
    s, [{ type: "result", costUsd: 0, sessionTokens: TOTAL_AFTER_ONE_MORE_TURN }], () => {}, fakeStore
  );
  assert.equal(s.tokensSpent, TOTAL_AFTER_ONE_MORE_TURN,
    "the lifetime figure is the platform's own running total — nothing was counted twice");
  assert.equal(s.tokensSpent - TOTAL_BEFORE_RESUME, THAT_TURN, "and the turn cost what it cost");

  // The counterfactual, stated rather than trusted: the pre-CXP-4 zeroing on this same runtime.
  const rebilled = { state: { turns: 2, costUsd: 0 }, lastTotalTokens: 0, tokensSpent: TOTAL_BEFORE_RESUME };
  io.applyCoreEvents(
    rebilled, [{ type: "result", costUsd: 0, sessionTokens: TOTAL_AFTER_ONE_MORE_TURN }], () => {}, fakeStore
  );
  assert.equal(rebilled.tokensSpent, TOTAL_BEFORE_RESUME + TOTAL_AFTER_ONE_MORE_TURN,
    "zeroing bills the whole thread again — 42,429 of it already paid for");
});

test("CXP-4: the PERSISTED baseline beats today's descriptor, in both directions", () => {
  // ⚠ THE WHOLE REASON `usageBaseline` IS ON THE RECORD (U10). A build that flips an adapter's
  // declaration must not re-interpret a conversation that already happened under the old answer.
  // `s.usageBaseline` is what `session-boot.js › parkedSessionFromRecord` restored.
  const a = harness();
  const wroteContinues = {
    settled: false, runtimeId: "claude", usageBaseline: "continues",
    sdkSessionId: "sdk-abc", lastTotalCost: 0.42, lastTotalTokens: 1200,
  };
  a.resumeParked(wroteContinues);
  assert.equal(wroteContinues.lastTotalTokens, 1200,
    "the RECORD said this run's totals continue, so today's `resets` descriptor does not zero them");

  const b = harness();
  const wroteResets = {
    settled: false, runtimeId: "codex", usageBaseline: "resets",
    sdkSessionId: "codex-thread-1", lastTotalCost: 0.42, lastTotalTokens: 1200,
  };
  b.resumeParked(wroteResets);
  assert.equal(wroteResets.lastTotalTokens, 0,
    "…and the converse: the record wins over a `continues` descriptor too");

  // ⚠ `'unverified'` AND ABSENT FALL THROUGH TO THE DESCRIPTOR, WHICH IS NOT A WEAKENING. EVERY
  // record written before U10 reads that way, so deciding those off the record would mis-bill
  // every pre-U10 session on the operator's disk. The descriptor is what `resumeRefusal` gates on.
  const c = harness();
  const silent = {
    settled: false, runtimeId: "codex", usageBaseline: "unverified",
    sdkSessionId: "codex-thread-1", lastTotalTokens: TOTAL_BEFORE_RESUME,
  };
  c.resumeParked(silent);
  assert.equal(silent.resuming, true, "a record that states nothing does not refuse a live-measured runtime");
  assert.equal(silent.lastTotalTokens, TOTAL_BEFORE_RESUME, "…it answers off the descriptor, which says `continues`");
});

// ── THE WRITER ───────────────────────────────────────────────────────────────────────────────

test("CXP-4: the PRIOR CHILD IS REAPED BEFORE the resume is attempted", async () => {
  // 🔒 ⚠ **A THREAD HAS ONE WRITER.** Measured against `codex-cli 0.155.1`: `thread/resume` from a
  // second app-server while the first child is still alive is refused JSON-RPC `-32600` — "thread
  // … already has an active writer". So the ordering below is not hygiene, it is the difference
  // between a resume and a race.
  const h = harness();
  let closedAtQueryCount = -1;
  const priorIterator = { __iter: true, closed: false, push() {}, close() { this.closed = true; } };
  const priorController = { aborted: false, abort() { this.aborted = true; } };
  const priorQuery = {
    closed: false,
    close() { this.closed = true; closedAtQueryCount = h.calls.query.length; },
  };
  const s = {
    settled: false, runtimeId: "codex", sdkSessionId: "codex-thread-1",
    query: priorQuery, abortController: priorController, pushIterator: priorIterator,
  };
  h.resumeParked(s);
  await flush();

  assert.equal(priorQuery.closed, true, "the prior handle was CLOSED — the only thing that kills the child");
  // ⚠ THE ORDERING PROOF. `calls.query` gains an entry the moment `rt.resume(...)` is called, so a
  // close that happened at count 0 happened BEFORE the new child was ever asked for.
  assert.equal(closedAtQueryCount, 0, "…and it was closed BEFORE `rt.resume` was called");
  assert.equal(h.calls.query.length, 1, "the resume then really happened");
  assert.equal(priorController.aborted, true, "the prior abort controller was aborted (the Claude reaper)");
  assert.equal(priorIterator.closed, true, "and the prior prompt stream was closed");
  // ⚠ AND THE REBUILD IS ON FRESH HANDLES, which is what made the old ones unreachable before.
  assert.notEqual(s.pushIterator, priorIterator, "the resumed run drives a FRESH iterator");
  assert.notEqual(s.abortController, priorController);
  assert.equal(s.query.__query, true, "…and the new handle is the one the registry returned");
});

test("CXP-4: CLAUDE's resume path is byte-for-byte what it was — the regression", async () => {
  // ⚠ THE CLAUDE SDK'S QUERY IS AN ASYNC GENERATOR WITH NO `close`, so the reap's third step is
  // skipped there and its abort controller stays the one thing that stops the child. This case is
  // what keeps a Codex-shaped teardown from reaching a runtime that does not want it.
  const h = harness();
  const priorController = { aborted: false, abort() { this.aborted = true; } };
  const priorQuery = { interrupt: () => Promise.resolve() }; // no `close` — the SDK shape
  const s = {
    settled: false, runtimeId: "claude", sdkSessionId: "sdk-abc",
    query: priorQuery, abortController: priorController,
    lastTotalCost: 0.42, lastTotalTokens: 1200,
  };
  h.resumeParked(s);
  await flush();
  assert.equal(s.resuming, false, "the resumed consumer ran to its handoff");
  assert.equal(priorController.aborted, true, "the abort controller is still the reaper here");
  assert.equal(s.lastTotalCost, 0, "and the baselines still zero on a runtime that resets");
  assert.equal(s.lastTotalTokens, 0);
  assert.equal(h.calls.query.length, 1);
  assert.equal(h.calls.consume.length, 1, "the consumer loop was handed the new query");

  // The record-driven door, unchanged for Claude: it still resumes, and it hands in a ZERO baseline.
  const g = harness();
  const rec = { channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", runtimeId: "claude", costUsd: 3.5 };
  assert.equal(await g.startResume(rec, "sdk-1", "continue"), true);
  assert.equal(g.calls.startSession[0].usageBaselineCost, 0,
    "a resetting runtime's resumed session starts measuring its deltas from zero");
});

test("CXP-4: the RECORD-driven door resumes Codex, and hands in the baseline it bills from", async () => {
  // ⚠ THE OTHER RESUME SHAPE — `startResume` rebuilds from the DURABLE RECORD after a crash, so
  // there is no live session object to carry a baseline on. The construction site takes it as
  // `usageBaselineCost`, and the value is `rec.costUsd`, because on a CONTINUING runtime the
  // restored cost accumulator IS the platform's cumulative total (the deltas telescope from the
  // cold launch's zero). A baseline that did not pair with its accumulator would bill the gap.
  const h = harness();
  const rec = {
    channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", runtimeId: "codex",
    costUsd: 1.25, usageBaseline: "continues",
  };
  const ok = await h.startResume(rec, "codex-thread-1", "continue");
  assert.equal(ok, true, "a Codex crash record resumes now");
  assert.equal(h.calls.startSession.length, 1);
  const spec = h.calls.startSession[0];
  assert.equal(spec.costUsd, 1.25, "the accumulator is restored…");
  assert.equal(spec.usageBaselineCost, 1.25, "…and the baseline it is measured from starts level with it");
  assert.equal(spec.resumeSdkId, "codex-thread-1", "and it is the SAME conversation");

  // ⚠ THE RECORD'S WORD DECIDES HERE TOO: a record that says `resets` gets a zero baseline even
  // though today's Codex descriptor says `continues`.
  const g = harness();
  const zeroed = await g.startResume(
    { ...rec, usageBaseline: "resets" }, "codex-thread-1", "continue"
  );
  assert.equal(zeroed, true);
  assert.equal(g.calls.startSession[0].usageBaselineCost, 0);
});

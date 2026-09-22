// Tests for the RESUME machinery (main/session-park.js) — P1: the in-place resume of a session
// whose SDK query was torn down at park, plus startResume's check-then-act guard.
//
// ⚠ THE EXTRACTION MACHINERY MOVED TO `_session-park-harness.mjs` ON 2026-09-21 (U10), under the
// 500-line cap on `test/**/*.mjs`. Everything it carries — the source slice, the purity assertion,
// the injected leaf deps, the REAL registry and the REAL ceiling — is unchanged; that file's own
// header states the seam. The RESUME-REFUSAL cases live in `session-park-resume-refusal.test.mjs`.

import { test, assert, harness, flush, agentId, RUNTIME, REAL_MAX, SRC } from "./_session-park-harness.mjs";

// ── P1: resumeParked rebuilds the query on the SAME object, through buildLaunchSpec ──

test("resumeParked sets up a fresh controller + iterator SYNCHRONOUSLY and resumes the sdk id", () => {
  const h = harness();
  const s = { settled: false, sdkSessionId: "sdk-abc", resumeSdkId: null, query: { __old: true }, lastTotalTokens: 1200 };
  h.resumeParked(s);
  assert.ok(s.abortController instanceof AbortController, "a fresh abort controller is created");
  assert.ok(s.pushIterator && s.pushIterator.__iter, "a fresh push iterator exists BEFORE the async consumer");
  assert.equal(s.resumeSdkId, "sdk-abc", "options.resume will carry the retained sdkSessionId");
  // ⚠ THE DEFAULT ADAPTER RESETS ITS TOTALS, so the baseline drops. It was `lastTotalCost` until
  // 2026-09-22; the cost column is deleted and the TOKEN baseline is the one left.
  assert.equal(s.lastTotalTokens, 0, "the token baseline resets so the resumed run accrues from 0");
  assert.equal(s.resuming, true);
  // FIX #2: the old sdk id is dropped so a pre-init crash's lifecycle id can't collide with
  // the prior cycle (it was captured into resumeSdkId above for options.resume first).
  assert.equal(s.sdkSessionId, null, "the new cycle mints its own sdk id at its own init");
  // FIX #1b: the old query is superseded synchronously so its late rejection is ignored.
  assert.equal(s.query, null, "the torn-down query is cleared so consume's `s.query !== q` guard trips");
});

test("resumeParked (async) starts the query THROUGH buildLaunchSpec (v1.9 security path)", async () => {
  const h = harness();
  const s = { settled: false, sdkSessionId: "sdk-xyz", resumeSdkId: null };
  h.resumeParked(s);
  await flush();
  assert.equal(h.calls.buildLaunchSpec.length, 1, "the spec is assembled through the shared buildLaunchSpec, not duplicated");
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
// the turn counter). Same story: the RULE survives on startResume and on session-engine's preamble,
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
// while a crash resume sat on acquireRuntime). The RACER is deleted; THE GUARD IT RACED IS NOT. The
// re-check after the await is live code in `startResume` and its comment states the failure
// directly: "a reopen shell or racing launch may have created this slot during acquireRuntime, and
// startSession would overwrite the Map entry". Dropping the test with the racer would have taken
// a live overwrite guard with it (INVARIANTS §14), so the racer is now a plain claimant landing
// in the registry mid-await — which is what `launch()` does, and the shape the guard actually
// defends against now that no reopen can create anything.

test("a session created during a resume's acquireRuntime await is NOT overwritten (post-await re-check)", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const rec = { channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", profile: "full", side: "responder", mode: "autonomous" };
  const h = harness({ gateSdk: gate });

  const resuming = h.startResume(rec, "sdk-1", "nudge"); // claims nothing; suspends at acquireRuntime
  // While startResume is parked on acquireRuntime, another creator claims the slot — a racing
  // `launch()` is the one that can still do this. The registry entry is set synchronously,
  // exactly as the real startSession sets it.
  h.sessions.set("c1:t1:a1b2c3d4", { key: "c1:t1:a1b2c3d4", settled: false });

  release();
  assert.equal(await resuming, false, "startResume bails on the post-await re-check");
  assert.deepEqual(h.calls.startSession, [], "no second session is constructed over the racer's entry");
});

test("startResume refuses BEFORE the await too, when the slot is already live", async () => {
  // The cheap half of the same guard: nothing is asked of the SDK for a slot that is occupied.
  const h = harness();
  h.sessions.set("c1:t1:a1b2c3d4", { key: "c1:t1:a1b2c3d4", settled: false });
  assert.equal(await h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }, "sdk-1", "nudge"), false);
  assert.deepEqual(h.calls.startSession, []);
});

// ── ⚠ THE CONCURRENCY CEILING, ON THE ONE SPAWN THAT WAS OUTSIDE IT (2026-08-22, F-272) ─────
//
// This function guarded `hasLiveSession(slot)` — "is THIS slot taken" — and never `liveCount`,
// so a machine at all six could resume a seventh. The reachable producer is `offerResume`'s
// notification, which the operator may click at any moment, including one when six agents are
// already running.
//
// ⚠ ENFORCED RATHER THAN DOCUMENTED AS +1 HEADROOM, and these cases are what that decision cost.
// `MAX_CONCURRENT_SESSIONS` is a COST ceiling — every per-session bound is multiplicative against
// it — and a resumed session costs a full `claude` child exactly like a fresh one. A documented
// +1 is also not a bound: nothing would have stopped a second crash record resuming at 7.

/** `n` live agents on unrelated slots, so nothing but the COUNT is in the way. */
function fill(h, n) {
  for (let i = 0; i < n; i += 1) h.sessions.set(`fill-${i}`, { key: `fill-${i}`, settled: false });
}

test("CAP: a resume at the ceiling is refused, and asks nothing of the SDK", async () => {
  const h = harness();
  fill(h, REAL_MAX);
  assert.equal(await h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }, "sdk-1", "n"), false);
  assert.deepEqual(h.calls.startSession, [], "no seventh session");
  assert.deepEqual(h.calls.buildLaunchSpec, [], "and no spec was assembled for one");
});

test("CAP: one below the ceiling still resumes — the guard is a bound, not a block", async () => {
  const h = harness();
  fill(h, REAL_MAX - 1);
  assert.equal(await h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }, "sdk-1", "n"), true);
  assert.equal(h.calls.startSession.length, 1);
});

// ⚠ A SETTLED SESSION IS NOT LIVE, and this is the case that would make the guard WRONG rather
// than merely strict: a crash scan resumes records whose sessions have just been marked ended, so
// counting settled entries would refuse the exact resume the feature exists for.
test("CAP: settled registry entries do not count against it", async () => {
  const h = harness();
  fill(h, REAL_MAX);
  for (const s of h.sessions.values()) s.settled = true;
  assert.equal(await h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }, "sdk-1", "n"), true);
});

// ⚠ THE SAME CHECK-THEN-ACT RACE THE SLOT GUARD ALREADY HANDLED. `acquireRuntime` is wide enough for a
// peer wake or the operator's own button to take the last slot, and `launch()` re-checks its own
// guard after the await for exactly this reason.
test("CAP: a slot taken DURING acquireRuntime is caught by the post-await re-check", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ gateSdk: gate });
  fill(h, REAL_MAX - 1);
  const resuming = h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }, "sdk-1", "n");
  fill(h, REAL_MAX); // a racing launch takes the last one while we are parked on acquireRuntime
  release();
  assert.equal(await resuming, false);
  assert.deepEqual(h.calls.startSession, [], "the cap is re-read after the await, like the slot");
});

// ⚠ THE NUMBER IS NOT THIS FILE'S. The harness stubs `session-windowless.js`, so without this the
// suite could agree with itself about a ceiling production does not enforce.
//
// ⚠ THIS CASE USED TO ASSERT `REAL_MAX === 6` under the note *"Samuel's multi-machine ruling: the
// number does not go up"* (F-272, 2026-08-22). THAT RULING WAS SUPERSEDED ON 2026-09-01 — Samuel
// raised the cap to 15 for the orchestrator-spawns-workers model, `end_agent` having since given
// an agent a way to hand its slot back. The restated literal is deliberately NOT re-pinned at 15:
// it pinned a decision, not a property, and it failed as a POLICY assertion the moment the policy
// changed rather than telling anybody anything about the code. What is pinned instead is the
// property the comment above actually claims — the number is READ FROM PRODUCTION SOURCE and this
// file cannot invent one. `test/launch-budget.test.mjs` pins the one relationship that must hold
// across any future retune: the rolling rate ceiling stays ABOVE this cost ceiling.
test("CAP: the ceiling under test is the one `session-windowless.js` actually declares", () => {
  assert.ok(Number.isInteger(REAL_MAX) && REAL_MAX > 0,
    "the ceiling is parsed from session-windowless.js, never restated here");
  assert.match(SRC, /sessionWindowless\.MAX_CONCURRENT_SESSIONS/,
    "startResume reads the shared constant, never a local copy");
  assert.equal(/MAX_CONCURRENT_SESSIONS = \d/.test(SRC), false,
    "…and does not declare a second one");
});

// ── THE INSTANCE ID A RESUME COMES BACK WEARING (2026-08-22) ──────────────────────
//
// ⚠ THE FAILURE THIS PINS IS NOT LOCAL TO THE DESKTOP. `startResume` is the ONE spawn that does
// not go through `session-launch.js › launch`, and it passed `rec.agentId || null` — but EVERY
// durable record written before the multiplayer wave (2026-08-21) has no `agentId`, and those
// records are on shipped operators' disks. `agentId: null` makes `session-summary.js › nameOf`
// answer `''`, `session-state-push.js` files `name: ""`, and the server's `SESSION_NAME_RE` 400s
// the WHOLE array; `retryable(400)` is false, so the digest is never recorded and every later
// push for that workspace fails identically for the life of the run.

test("a PRE-MULTIPLAYER record (no agentId) resumes with a freshly MINTED id, never null", async () => {
  const h = harness();
  const legacy = { channelId: "c1", taskId: "t1", workspaceId: "w1", side: "responder", profile: "full" };
  assert.equal(await h.startResume(legacy, "sdk-1", "continue"), true);
  const spec = h.calls.startSession[0];
  assert.ok(agentId.isAgentId(spec.agentId), `a real instance id, got ${JSON.stringify(spec.agentId)}`);
  // The name the push files is this id, so it must satisfy `channel_sessions.name`'s CHECK.
  assert.match(spec.agentId, /^[a-z][a-z0-9-]{1,30}$/);
  assert.equal(spec.key, `c1:t1:${spec.agentId}`, "the slot key carries the SAME id, not a second mint");
});

test("a record that HAS an agent id keeps it — a resume must not come back a stranger", async () => {
  const h = harness();
  await h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }, "sdk-1", "continue");
  assert.equal(h.calls.startSession[0].agentId, "a1b2c3d4");
  assert.equal(h.calls.startSession[0].key, "c1:t1:a1b2c3d4");
});

test("a MALFORMED stored agent id is refused and re-minted, not carried through", async () => {
  for (const bad of ["", "  ", "A1B2C3D4", "toolongforanid", "a1b2c3", "agent-1", 42, {}, null]) {
    const h = harness();
    await h.startResume({ channelId: "c1", taskId: "t1", agentId: bad }, "sdk-1", "continue");
    const spec = h.calls.startSession[0];
    assert.ok(agentId.isAgentId(spec.agentId), `stored id ${JSON.stringify(bad)} must be re-minted`);
  }
});

test("the mint is written back, so a SECOND resume of the same record finds the live slot", async () => {
  // `offerResume` holds ONE record object in its notification click handler. Without the
  // write-back a second click mints a second id, matches no live slot, and starts a second
  // session resuming the SAME sdkSessionId — a regression the mint would otherwise introduce,
  // because the guard above was exact for a legacy record while the id was `null`.
  const h = harness();
  const legacy = { channelId: "c1", taskId: "t1", workspaceId: "w1", side: "responder" };
  assert.equal(await h.startResume(legacy, "sdk-1", "continue"), true);
  assert.equal(await h.startResume(legacy, "sdk-1", "continue"), false, "the second click is refused");
  assert.equal(h.calls.startSession.length, 1, "one session, not two on one sdk conversation");
});

test("the record's OWN post counter rides the resume (client_msg_id collision guard)", async () => {
  // `session-outbound-tag.js › nextOwnPostId` stamps `agent-<agentId>-<n>` and the agent id is
  // re-used above, so a counter that restarted at 0 would re-mint ids the server already holds
  // and its idempotency short-circuit would silently discard the resumed agent's replies.
  const h = harness();
  await h.startResume({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", ownPostSeq: 7 }, "sdk-1", "go");
  assert.equal(h.calls.startSession[0].ownPostSeq, 7, "handed over RAW; startSession adds the slack");
});


// ─── BOTH DOORS OWE THE SAME TEARDOWN (2026-09-22) ───────────────────────────────────────────
//
// 🔒 The reap this file proves for the RESUME lane was owed at the PARK door too, and was missing
// there — so a parked Codex session left an idle `codex app-server` alive for the whole park, and
// that child still held the thread's SINGLE WRITER slot (measured: a second `thread/resume` while
// it lives is refused `-32600 "thread … already has an active writer"`).
//
// ⚠ WHY IT WAS MISSED: aborting a signal and closing an iterator IS a full teardown on Claude,
// whose SDK query watches the signal and whose async generator answers `close()`. The Codex
// adapter reads no abort signal at all — `handle.close()` is the only thing that ends its child.
// A teardown written against one runtime's shape silently stopped being one.
//
// ⚠ A SOURCE PIN over `session-engine.js › runEffect`, which has no harness in this tree: its
// effects run against a live registry and a real query object. What is asserted is that the two
// doors carry the SAME call, guarded the same way.

test("the park door closes the runtime handle, exactly as the resume door does", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const read = (rel) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  const engine = read("../main/session-engine.js");
  const abortCase = engine.slice(engine.indexOf("case 'abortQuery':"));
  const body = abortCase.slice(0, abortCase.indexOf("case 'denyPending'"));

  assert.match(body, /s\.query && typeof s\.query\.close === 'function'/,
    "abortQuery must close the runtime's own handle, not only the abort signal");
  // ⚠ THE GUARD IS THE PORTABILITY TEST, NOT DEFENSIVENESS: Claude's query is an async generator
  // with no `close`, so the call is a no-op there and that lane is unchanged. An unguarded call
  // would throw on every Claude park — so the guard and the call must be ONE statement, which is
  // what this asserts rather than merely that both strings appear somewhere in the case.
  assert.match(
    body,
    /if \(s\.query && typeof s\.query\.close === 'function'\) s\.query\.close\(\);/,
    "the close must sit behind its typeof guard, in the same statement"
  );

  // The same shape, at the other door — `session-park.js › reapPriorChild`.
  assert.match(SRC, /typeof prior\.close === 'function'/,
    "the resume lane's reap is the pattern this one follows");
});

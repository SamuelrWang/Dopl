// QUITTING WITH A LIVE AGENT MUST NOT END IT AS NOTHING (2026-10-12).
//
// THE DEFECT, from Samuel's desktop logs. `quit-guard.js › teardown` ran in this order:
//
//     listener.stop();            // every realtime sub + presence down, final `away` posted
//     endLiveSessions();          // NOW end the live session — which issues its terminal posts
//     race(flush, away, 1500ms);  // "the final session-state push did not land … SKIPPED"
//     app.quit();                 // process gone
//
// Two things were wrong and only one of them is the ordering.
//
//   1. THE TERMINAL POSTS WERE NEVER WAITED FOR AT ALL. `trigger-outcomes.js › onEnded` and
//      `session-drop-notice.js › report` both issue their POST as `void Promise.resolve(…)`.
//      Nothing in the quit path held either promise, so `app.quit()` took the process away with
//      the POST in flight and the peer was never told the session went inactive — which is
//      exactly what `quitDetailTail` promises the operator out loud, and what the C-8 invariant
//      claims the quit path does ("ends each through the calm `inactive` terminal so the peer is
//      told"). THIS is the half that lost the notice.
//   2. THE ENDS WERE ISSUED AFTER THE TRANSPORTS CAME DOWN. `postTaskEvent` goes out over
//      `listener-io.js › sendOnce`, which has no running-gate, so the POST itself was still
//      legal — but presence had already declared this machine `away`/`offline`, and the ends got
//      none of the bounded window the away post and the state flush were sharing. Ending FIRST
//      puts all three in ONE bounded moment, which is the whole fix for the latency question.
//
// ⚠ THE DEADLINE IS NOT RAISED. The ends share FLUSH_DEADLINE_MS with the flush and the away
// post rather than adding a second window after it: a quit that took 3s to close would trade one
// honest defect for the "app refuses to close" defect the 1500ms number exists to prevent.
//
// ⚠ AND WHAT IS **NOT** CHANGED, because the brief asked for it and the code already does it:
// an agent ended at quit ALREADY leaves a visible Ended card after relaunch. See the third
// section — `settle` writes `phase:'ended'` and the `agent-history.js › record` entry that
// F-694 calls "the half that makes an Ended card exist at all", synchronously, inside
// `endLiveSessions`. The boot log that prompted the brief ("dormant records 8 → re-parked 8
// ended 0") is CONSISTENT with that: `reparkOne` returns '' for a record whose
// `reloadDisposition` is not 'dormant', so a correctly-ended record is counted in neither
// column by design. Those tests are regression guards, green both sides of this change.
//
// Run: `node --test dopl-desktop-app/test/quit-end-notice.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, codeOf, fnOf } from "./helpers/source-probe.mjs";
import * as terminalPosts from "../main/session-terminal-posts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("quit-guard.js");
const OUTCOMES = M("trigger-outcomes.js");
const DROP = M("session-drop-notice.js");
const TEARDOWN = M("session-teardown.js");
const BOOT = M("session-boot.js");
const ENGINE = M("session-engine.js");

// The teardown, sliced the way quit-guard.test.mjs slices it, so both suites read one region.
const teardownSrc = () =>
  SRC.slice(SRC.indexOf("async function teardown("), SRC.indexOf("function stopWaiting()"));

// ── 1. ORDER: END + FLUSH BEFORE THE TRANSPORTS COME DOWN ────────────────────────────

test("the live sessions are ENDED before the listener is stopped, not after", () => {
  const t = teardownSrc();
  const ended = t.indexOf("deps.endLiveSessions()");
  const stopped = t.indexOf("deps.listener.stop()");
  assert.ok(ended > -1, "endLiveSessions is gone from the teardown");
  assert.ok(stopped > -1, "listener.stop is gone from the teardown");
  assert.ok(
    ended < stopped,
    "the ends must be issued while this machine's transports are still up and before presence " +
      "has declared it away — the shipped order was listener.stop() first"
  );
});

test("the ends are still SYNCHRONOUS — nothing waits on the agent itself", () => {
  // Rule (3): mid-tool-call is not a reason to wait. The only await in the teardown is the wire.
  const t = teardownSrc();
  assert.equal(
    (t.match(/await /g) || []).length,
    1,
    "one await only: the bounded wire moment, never the child"
  );
  assert.ok(
    t.indexOf("deps.endLiveSessions()") < t.indexOf("await"),
    "the kill happens before the deadline, not inside it"
  );
});

// ── 2. THE TERMINAL POSTS ARE FLUSHED, AND THE WAIT IS BOUNDED ───────────────────────

test("the teardown waits for the END's own posts, not only for the state rows", () => {
  const t = teardownSrc();
  assert.match(
    t,
    /terminalPosts\.drain\(\)/,
    "the posts the end issued must be in the bounded moment — unawaited was the whole defect"
  );
  assert.match(
    SRC,
    /const terminalPosts = require\('\.\/session-terminal-posts'\);/,
    "…from the real register, not a copy of its idea"
  );
});

test("the drain shares ONE deadline with the flush and the away post — no second window", () => {
  const t = teardownSrc();
  assert.match(SRC, /const FLUSH_DEADLINE_MS = 1500;/, "the quit-perception number is unchanged");
  // Every bounded item takes the SAME constant, so the worst case stays 1500ms total.
  const bounds = t.match(/FLUSH_DEADLINE_MS/g) || [];
  assert.ok(
    bounds.length >= 3,
    "each of the three waits is bounded by the same number; found " + bounds.length
  );
  assert.ok(
    !/FLUSH_DEADLINE_MS \* 2|END_FLUSH_DEADLINE|\+ FLUSH_DEADLINE_MS/.test(t),
    "the budget may not be stacked: a 3s quit is the defect the 1500ms bound prevents"
  );
});

test("the bound is the real withDeadline primitive, so the quit can never hang on a post", () => {
  assert.match(
    SRC,
    /require\('\.\/deadline'\)/,
    "F-700's one bound for a promise that may never settle, not a hand-rolled race"
  );
  const t = teardownSrc();
  assert.match(t, /withDeadline\(/);
});

test("one wait that THROWS cannot abandon the other two", () => {
  // `deps.flushSessionState` is injected and may throw synchronously. Evaluated in the
  // `Promise.all` argument list it would throw straight past the race into the outer catch and
  // drop the end notice — the one post this fix exists to land — on a failure that has nothing
  // to do with it. So each wait is a THUNK, called inside its own try.
  const t = teardownSrc();
  assert.match(t, /bound\(\(\) => terminalPosts\.drain\(\), 'end notice'\)/,
    "each wait must be passed lazily, never as an already-evaluated promise");
  assert.match(t, /bound\(\(\) => deps\.flushSessionState\(\), 'session-state push'\)/);
  assert.match(t, /try \{ p = make\(\); \} catch/, "…and a thrower is reported, not fatal");
  assert.ok(
    !/bound\(terminalPosts\.drain\(\)|bound\(deps\.flushSessionState\(\)/.test(t),
    "the eager shape is the one that couples the three failures together"
  );
});

test("each wait is reported BY NAME — a landed post may never read as skipped", () => {
  // The module's own honesty rule: Promise.all-ing the three would let a hung away post make a
  // landed end notice report as SKIPPED, which is a lie in the log this module exists to keep.
  const t = teardownSrc();
  assert.match(t, /SKIPPED/, "something that did not land still says so");
  for (const name of ["end notice", "session-state push", "away"]) {
    assert.ok(
      t.includes(name),
      `the log must be able to name "${name}" on its own; found: ${t.slice(0, 0)}`
    );
  }
});

// ── 3. THE REGISTER ITSELF (the real shipped functions) ──────────────────────────────

test("a tracked post is pending until it settles, then drops itself", async () => {
  let release;
  const p = new Promise((r) => { release = r; });
  const before = terminalPosts.pendingCount();
  terminalPosts.track(p);
  assert.equal(terminalPosts.pendingCount(), before + 1);
  release(true);
  await terminalPosts.drain();
  await Promise.resolve();
  assert.equal(terminalPosts.pendingCount(), before, "a register that only grows is the old bug");
});

test("track returns the SAME promise, so a call site's own outcome is untouched", async () => {
  assert.equal(await terminalPosts.track(Promise.resolve("posted")), "posted");
  // …including a rejection: both call sites diag their own failure and must keep that line.
  await assert.rejects(() => terminalPosts.track(Promise.reject(new Error("boom"))), /boom/);
  await terminalPosts.drain();
});

test("drain resolves even when a post FAILED — one dead post may not hold the quit", async () => {
  terminalPosts.track(Promise.reject(new Error("post failed"))).catch(() => {});
  await terminalPosts.drain(); // must not reject
  assert.equal(terminalPosts.pendingCount(), 0);
});

test("drain is a snapshot: a post registered during it does not extend the wait", async () => {
  let releaseFirst;
  let releaseLate;
  terminalPosts.track(new Promise((r) => { releaseFirst = r; }));
  const waiting = terminalPosts.drain();
  // A post that arrives after the snapshot and settles only LATER. An open-ended drain would be
  // a second unbounded await by another name, so this must not hold `waiting` open.
  terminalPosts.track(new Promise((r) => { releaseLate = r; }));
  releaseFirst(true);
  await waiting; // resolves on the snapshot alone, with the late post still pending
  assert.equal(terminalPosts.pendingCount(), 1, "…and the late post is still registered");
  releaseLate(true);
  await terminalPosts.drain();
});

test("an empty register drains instantly — a quit with no agents waits on nothing", async () => {
  await terminalPosts.drain();
  assert.equal(terminalPosts.pendingCount(), 0);
  const src = M("session-terminal-posts.js");
  assert.match(src, /if \(pending\.size === 0\) return Promise\.resolve\(\);/,
    "an already-resolved promise, so the quit path's bound is never even armed");
});

test("the register is dependency-free, so the test drives the SHIPPED function", () => {
  // Checked over CODE, never the file text: the header names `electron` and `diag` to say it
  // reaches neither, and a prose grep would read that as the violation it is describing.
  const src = M("session-terminal-posts.js");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  assert.ok(!/require\s*\(/.test(code), "no imports at all — deadline.js's argument, verbatim");
  for (const banned of ["electron", "process.", "setTimeout"]) {
    assert.ok(!code.includes(banned), `the register must not reach ${banned}`);
  }
});

// ── 4. BOTH TERMINAL POSTS REGISTER THEMSELVES ───────────────────────────────────────

test("the calm inactive note is tracked — it is the post the peer is waiting on", () => {
  const onEnded = codeOf(fnOf(OUTCOMES, "onEnded"));
  assert.match(
    onEnded,
    /terminalPosts\.track\(/,
    "`void Promise.resolve(postTaskEvent(…))` is what app.quit() raced and won"
  );
  assert.match(onEnded, /postTaskEvent\(/, "…and it is still the same one post");
  assert.match(OUTCOMES, /require\('\.\/session-terminal-posts'\)/);
});

test("the drop report is tracked too — the launcher's half of the same end", () => {
  // This module requires its leaves LAZILY (only `diag` sits at module scope), so either
  // spelling of the register counts; what may not happen is the post going out untracked.
  const report = codeOf(fnOf(DROP, "report"));
  assert.match(report, /(terminalPosts|require\('\.\/session-terminal-posts'\))\.track\(/);
  assert.match(report, /postDropNotice\(/, "…still the same post, still best-effort");
  assert.ok(
    !/void Promise\.resolve\(require\('\.\/channel-post'\)\.postDropNotice/.test(report),
    "the untracked fire-and-forget shape is what app.quit() won the race against"
  );
});

test("tracking did not make either call site able to throw into settle", () => {
  // Both run inside the reducer's effect list, where a throw would abort a teardown that has a
  // child process to kill. `track` is wrapped by the caller's existing guard either way.
  const report = codeOf(fnOf(DROP, "report"));
  assert.match(report, /catch \(err\) \{[\s\S]*?return false;/, "report still swallows its own");
  const onEnded = codeOf(fnOf(OUTCOMES, "onEnded"));
  assert.match(onEnded, /\.catch\(\(err\) => diag\(/, "the post's own catch is still there");
});

// ── 5. THE ENDED CARD AFTER A RELAUNCH (regression guards, unchanged by this fix) ────

test("a quit-ended session persists phase 'ended' — the reducer's state is applied first", () => {
  // `dispatch` assigns `s.state = state` BEFORE running effects, so `settle`'s `baseRecord(s)`
  // reads the reducer's new phase. Without that order the record would save as 'working' and the
  // next boot's `reloadDisposition` would call it 'resume' instead of leaving it ended.
  const d = codeOf(fnOf(ENGINE, "dispatch"));
  const applied = d.indexOf("s.state = state");
  const effects = d.indexOf("for (const eff of effects)");
  assert.ok(applied > -1 && effects > -1 && applied < effects,
    "the new state must be applied before the effect list runs");
  assert.match(TEARDOWN, /store\.saveRecord\(deps\.baseRecord\(s\)\);/);
  assert.match(M("session-io.js"), /phase: s\.state\.phase,/);
  // ⚠ SLICED TO THE BRANCH, not matched across the file. `/'inactive'[\s\S]*?phase: 'ended'/`
  // passes on the `crash` branch's own flip twenty lines below, so it survives deleting this
  // one — the fail-open slice `helpers/source-probe.mjs` exists to stop.
  const reducer = M("session-reducer.js");
  const inactive = between(reducer, "if (type === 'inactive') {", "if (type === 'crash') {",
    "the inactive branch");
  assert.match(inactive, /phase: 'ended'/, "the quit sweep's event is what sets it");
  assert.match(inactive, /endEffects\(state, 'ended', 'inactive'\)/);
});

test("…and the agent-history entry F-694 calls the Ended card is written by settle", () => {
  const settle = codeOf(fnOf(TEARDOWN, "settle"));
  // ⚠ AS A STATEMENT, not merely as text. `void 0 && agentHistory.record({` satisfies a bare
  // substring match and writes no card at all, which is the exact shape of the defect — so the
  // line must START the call.
  assert.match(settle, /\n\s*agentHistory\.record\(\{/);
  assert.ok(
    settle.indexOf("agentHistory.record") < settle.indexOf("deps.sessions.delete(s.key)"),
    "the ring lives only on `s`, so the freeze must precede the registry delete"
  );
  // The card is READ from that file, which is why the entry is what makes it exist.
  assert.match(ENGINE, /endedRecords: agentHistory\.listEnded/);
  assert.match(M("agent-history.js"), /function saveAll\(all\) \{\s*\n\s*try \{ store\.set\(/,
    "persisted synchronously: a debounced write would be lost to app.quit()");
});

test("the boot pass leaves an ended record alone — it is not 'nothing', it is a card", () => {
  const one = codeOf(fnOf(BOOT, "reparkOne"));
  assert.match(one, /if \(store\.reloadDisposition\(rec\.phase\) !== 'dormant'\) return '';/);
  assert.match(M("session-store.js"), /return isTerminalPhase\(phase\) \? 'ignore' : 'resume';/);
  // Hence "ended 0" in the boot log: that counter is the boot pass's OWN interrupted-ends, and a
  // record this quit already ended is correctly in neither column.
  assert.match(BOOT, /else if \(outcome === 'ended'\) ended \+= 1;/);
});

test("a PARKED agent is still untouched by the quit — it survives as Idle", () => {
  const reopen = M("session-reopen.js");
  const children = codeOf(fnOf(reopen, "liveChildSessions"));
  assert.match(children, /if \(s\.state && s\.state\.parked === true\) continue;/,
    "parked holds no child, so the quit must not end it (F-694: it comes back as Idle)");
  const t = teardownSrc();
  assert.ok(!/parked/.test(t), "the teardown itself must not grow a second opinion about parked");
});

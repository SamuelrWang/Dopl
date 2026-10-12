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
// an agent ended at quit ALREADY leaves a visible Ended card after relaunch — `settle`
// writes `phase:'ended'` and the `agent-history.js › record` entry F-694 calls "the half
// that makes an Ended card exist at all", synchronously, inside `endLiveSessions`. The boot
// log that prompted the brief ("dormant records 8 → re-parked 8 ended 0") is CONSISTENT with
// that: `reloadDisposition('ended')` is `'ignore'`, so `reparkOne` returns '' and a
// correctly-ended record is counted in neither column by design.
//
// ⚠ THOSE GUARDS, AND THE REGISTER'S OWN TESTS, LIVE IN `test/session-terminal-posts.test.mjs`
// (2026-10-12, split at the 480-line rule). Neither group uses `guard()`, which is the whole
// subject of this file: here the quit path is EXECUTED, there the register and the Ended-card
// rule are each checked on their own terms.
//
// ── 2026-10-12, REVIEW 16: WHY THE QUIT PATH IS NOW EXECUTED, NOT GREPPED ───────────────
//
// The first version of this suite asserted all of the above by reading `quit-guard.js` as TEXT,
// and the reviewer showed what that is worth with two mutations that left every one of its
// twenty tests green:
//
//   • `await teardown(reason)` → `void teardown(reason)` in `finishQuit`. That IS the shipped
//     defect in miniature — `app.quit()` on the next tick, POST dead with the process — and not
//     one probe could see it, because none of them was about WHEN anything happened.
//   • serialising the drain behind the flush. Every text probe still passes ("each wait is
//     bounded by FLUSH_DEADLINE_MS" stays literally true) while a quit with three hung requests
//     takes 4500 ms: the exact "app refuses to close" defect the 1500 number exists to prevent.
//
// So `teardown`, `finishQuit` and `stopWaiting` MOVED into the QUIT-GUARD-PURE block, unchanged
// (the move is proved byte-identical in the commit), and `guard()` below drives them with every
// platform edge faked and `deadline.js › withDeadline` running on a VIRTUAL clock. Tests (a),
// (b), (b2) and (c) are the result; each one kills its own mutation. The probes they subsume
// were deleted rather than left as decoration — one is kept, and only because it pins a choice
// of DEPENDENCY (the real register, the real bound) that no clock can observe.
//
// Run: `node --test dopl-desktop-app/test/quit-end-notice.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, codeOf, fnOf } from "./helpers/source-probe.mjs";
import { DEADLINE, withDeadline as realWithDeadline } from "../main/deadline.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("quit-guard.js");
const OUTCOMES = M("trigger-outcomes.js");
const DROP = M("session-drop-notice.js");

// The teardown, sliced the way quit-guard.test.mjs slices it, so both suites read one region.
const teardownSrc = () => codeOf(fnOf(SRC, "teardown"));

// ── THE HARNESS: the quit path EXECUTED, on a fake clock ─────────────────────────────
//
// ⚠ WHY THIS EXISTS, in the reviewer's own two mutations (review 16). Everything below used to
// be asserted by GREPPING `quit-guard.js`, and a source probe cannot see ordering it does not
// happen to spell out: turning `await teardown(reason)` into `void teardown(reason)`, and
// serialising the drain behind the flush, BOTH left all twenty tests green. So `teardown`,
// `finishQuit` and `stopWaiting` moved into the QUIT-GUARD-PURE block (unchanged) and are driven
// here instead. The source probes that these three tests subsume are gone with them.

const BLOCK = between(SRC, "// ─── BEGIN QUIT-GUARD-PURE", "// ─── END QUIT-GUARD-PURE",
  "quit-guard pure block");

/** A promise nobody will ever settle — the hung POST this whole fix is bounded against. */
const never = () => new Promise(() => {});

/** Let every queued microtask run, so a chained `.then` has landed before we assert. */
async function settleMicrotasks(n = 25) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/**
 * A virtual clock with the `{setTimeout, clearTimeout}` shape `deadline.js › withDeadline` takes
 * as its test seam. `armed` records WHEN each bound was armed and for how long, which is how the
 * parallel-vs-serial question below is answered as a measurement rather than an opinion.
 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  const armed = [];
  // ⚠ CLOSURE, NOT `this`. `withDeadline` lifts the seam out (`const set = timers.setTimeout`)
  // and calls it UNBOUND, so a method reading `this.armed` throws inside the deadline promise's
  // executor — which rejects it, which makes the bound resolve instantly and every test here
  // pass for the wrong reason. Found exactly that way on the first run.
  const clock = {
    armed,
    at: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      armed.push({ t: now, ms });
      return { id, unref: () => undefined };
    },
    clearTimeout: (h) => { if (h && h.id) pending.delete(h.id); },
    /** Move the clock to now+ms, firing what comes due in time order. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settleMicrotasks();
      }
      now = target;
      await settleMicrotasks();
    },
  };
  return clock;
}

/**
 * The real block, evaluated with every platform edge faked. Returns the functions under test
 * plus the recorders: `calls` (what was invoked, in order), `quits` (the fake clock time at each
 * `app.quit()`), `log` (the diag lines) and `clock`.
 */
function guard(over = {}) {
  const clock = fakeClock();
  const calls = [];
  const quits = [];
  const log = [];
  const deps = {
    endLiveSessions: () => { calls.push("endLiveSessions"); return over.ended ?? 1; },
    listener: {
      stop: () => {
        calls.push("listener.stop");
        return (over.away || (() => Promise.resolve("ok")))();
      },
    },
    flushSessionState: () => {
      calls.push("flushSessionState");
      return (over.flush || (() => Promise.resolve()))();
    },
    listOrphanRisk: () => [],
  };
  const posts = {
    drain: () => { calls.push("drain"); return (over.drain || (() => Promise.resolve()))(); },
    pendingCount: () => over.pending ?? 0,
  };
  const api = new Function(
    "deps", "app", "diag", "FLUSH_DEADLINE_MS", "withDeadline", "DEADLINE", "terminalPosts",
    "BUTTON_QUIT", "BUTTON_WAIT", "BUTTON_CANCEL", "WAIT_CAP_MS",
    `${BLOCK}\n return { teardown, finishQuit, stopWaiting };`
  )(
    deps,
    { quit: () => { calls.push("app.quit"); quits.push(clock.at()); }, isQuitting: true },
    (...a) => log.push(a.join(" ")),
    1500,
    // The REAL bound, on the virtual clock: the logic under test is the shipped logic.
    (p, ms, onDeadline) => realWithDeadline(p, ms, onDeadline, clock),
    DEADLINE,
    posts,
    0, 1, 2, 16 * 60 * 1000,
  );
  return { ...api, clock, calls, quits, log };
}

// ── 1. ORDER: END + FLUSH BEFORE THE TRANSPORTS COME DOWN ────────────────────────────

test("(a) EXECUTED: the sessions are ended before listener.stop, with no await between", async () => {
  const g = guard();
  // Not awaited: an async function runs synchronously up to its FIRST await, so whatever has
  // been recorded by the time this line returns is what happens before anything can yield.
  const running = g.teardown("quit anyway");
  assert.deepEqual(
    g.calls,
    ["endLiveSessions", "listener.stop", "drain", "flushSessionState"],
    "the ends go first, the listener comes down second, and both are SYNCHRONOUS — an await " +
      "between them would let a beat land in the gap, and the shipped order was the reverse"
  );
  await running;
  assert.deepEqual(g.quits, [], "teardown itself never closes the app — finishQuit does");
});

test("(b) EXECUTED: a hung end notice holds the quit to the bound, and never past it", async () => {
  // THE MUTATION THIS CATCHES: `await teardown(reason)` -> `void teardown(reason)` in
  // `finishQuit`. That is the shipped defect in miniature — `app.quit()` fires on the next tick
  // and the POST dies with the process — and every source probe in this file stayed green on it.
  const g = guard({ drain: never });
  let done = false;
  const quitting = g.finishQuit("operator chose Quit anyway").then(() => { done = true; });
  await settleMicrotasks();
  assert.equal(done, false, "the quit may not complete while the end notice is still in flight");
  assert.deepEqual(g.quits, [], "…and app.quit() must NOT have been called yet");
  await g.clock.advance(1500);
  // ⚠ ASSERTED BEFORE THE AWAIT, DELIBERATELY. `await quitting` on a quit that never completes
  // is a 20s suite TIMEOUT, not a failure anybody can read — and that is exactly what a stacked
  // budget (FLUSH_DEADLINE_MS * 2) produces here. Checking the flag first turns it into a line.
  assert.equal(done, true, "…but the bound always ends the wait: quitting stays possible");
  await quitting;
  assert.deepEqual(g.quits, [1500], "the app closes AT the bound, not before and not after");
  assert.ok(
    g.log.some((l) => l.includes("end notice") && l.includes("SKIPPED")),
    "a notice that did not land says so by name: " + JSON.stringify(g.log)
  );
});

test("(b2) EXECUTED: a post that DOES land is drained before the quit returns", async () => {
  // The other half of the same property, and the half that says the wait is a BOUND rather than
  // a sleep: the quit must not sit out the full window once the post has landed, and must not
  // close before it has. Released by hand rather than on a timer, so "landed" is a fact about
  // the drain and not about which queue ran first.
  let release;
  let landed = false;
  const g = guard({ drain: () => new Promise((r) => { release = () => { landed = true; r(); }; }) });
  let done = false;
  const quitting = g.finishQuit("operator chose Quit anyway").then(() => { done = true; });
  await settleMicrotasks();
  assert.equal(done, false, "held while the post is in flight");
  release();
  await settleMicrotasks();
  await quitting;
  assert.equal(landed, true, "the post settled");
  assert.equal(done, true);
  assert.deepEqual(g.quits, [0], "closed on the POST, at clock 0 — not held to the 1500ms bound");
  assert.ok(
    !g.log.some((l) => l.includes("SKIPPED")),
    "a landed post may never be reported as skipped: " + JSON.stringify(g.log)
  );
});

// ── 2. ONE WINDOW FOR ALL THREE, MEASURED ────────────────────────────────────────────

test("(c) MEASURED: the three waits run in PARALLEL — worst case ~1500ms, not 3000", async () => {
  // THE MUTATION THIS CATCHES: serialising the drain behind the flush (`await bound(drain); await
  // bound(flush)`). The code still "bounds each wait by FLUSH_DEADLINE_MS", so every text probe
  // keeps passing, while a quit with three hung requests takes 4500ms — the exact "app refuses
  // to close" defect the 1500 number exists to prevent. Only the clock can tell the difference.
  const g = guard({ drain: never, flush: never, away: never });
  let done = false;
  const quitting = g.finishQuit("operator chose Quit anyway").then(() => { done = true; });
  await settleMicrotasks();
  assert.deepEqual(
    g.clock.armed,
    [{ t: 0, ms: 1500 }, { t: 0, ms: 1500 }, { t: 0, ms: 1500 }],
    "all three bounds are armed on the SAME tick for the SAME number; a serialised teardown " +
      "arms the second only after the first has expired (t: 1500) and the third at t: 3000"
  );
  await g.clock.advance(1500);
  assert.equal(
    done, true,
    "ONE 1500ms window covers all three. Serialised, the quit would still be pending here and " +
      "would need 4500ms to finish."
  );
  await quitting;
  assert.deepEqual(g.quits, [1500]);
  // …and all three said so, each by its own name.
  for (const what of ["end notice", "session-state push", "away post"]) {
    assert.ok(
      g.log.some((l) => l.includes(what) && l.includes("SKIPPED")),
      `"${what}" must be reported on its own: ` + JSON.stringify(g.log)
    );
  }
});

test("EXECUTED: one wait that THROWS SYNCHRONOUSLY cannot abandon the other two", async () => {
  // `deps.flushSessionState` is injected and may throw. Evaluated in the `Promise.all` argument
  // list it would throw past the bound into the outer catch and drop the end notice — the one
  // post this fix exists to land — on a failure that has nothing to do with it.
  const g = guard({
    flush: () => { throw new Error("rows exploded"); },
    drain: () => Promise.resolve(),
    away: () => Promise.resolve("ok"),
  });
  await g.finishQuit("operator chose Quit anyway");
  assert.ok(g.calls.includes("drain"), "the end notice was still drained: " + g.calls.join(","));
  assert.deepEqual(g.quits, [0], "and the quit still completed");
  assert.ok(
    g.log.some((l) => l.includes("session-state push") && l.includes("threw before it was sent")),
    "the thrower is reported by name: " + JSON.stringify(g.log)
  );
});

test("EXECUTED: a teardown that throws outright still closes the app (rule 1)", async () => {
  // Quitting must ALWAYS remain possible. `finishQuit` catches the teardown and quits anyway.
  const g = guard({ drain: () => { throw new Error("register exploded"); } });
  await g.finishQuit("operator chose Quit anyway");
  assert.deepEqual(g.quits, [0], "a broken teardown must not become an app that cannot close");
});

// ── THE SHAPE THE CLOCK CANNOT SEE ───────────────────────────────────────────────────
//
// Two text probes are left, and only because they pin a CHOICE OF DEPENDENCY rather than a
// behaviour: the teardown must reach the real register and the real bound, not a local copy of
// either idea. Everything the three tests above measure has had its probe deleted.

test("the teardown reaches the REAL register and the REAL bound, not a copy of either", () => {
  assert.match(SRC, /const terminalPosts = require\('\.\/session-terminal-posts'\);/);
  assert.match(SRC, /require\('\.\/deadline'\)/,
    "F-700's one bound for a promise that may never settle");
  const t = teardownSrc();
  assert.match(t, /terminalPosts\.drain\(\)/);
  assert.match(t, /withDeadline\(/);
  assert.match(SRC, /const FLUSH_DEADLINE_MS = 1500;/, "the quit-perception number is unchanged");
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

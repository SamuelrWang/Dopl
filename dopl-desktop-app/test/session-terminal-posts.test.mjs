// THE TERMINAL-POST REGISTER, and the Ended card a quit-killed agent leaves behind.
//
// SPLIT NOTE (2026-10-12, review 16 follow-up). These two groups were §3 and §5 of
// `test/quit-end-notice.test.mjs`, which reached 482 lines — past the 480 at which a touched
// file gets split. The seam is not the line count, it is the SUBJECT: that suite is about the
// quit path and EXECUTES it through `guard()` on a fake clock, and nothing here touches
// `guard()` at all.
//
//   THE REGISTER (§3) — `main/session-terminal-posts.js`, driven as the real shipped functions.
//   It is the thing the quit path waits for, so it is tested on its own terms: a tracked post is
//   pending until it settles and then drops itself, `track` returns the caller's own promise
//   unchanged, a FAILED post cannot hold the quit, and `drain` is a snapshot.
//
//   THE ENDED CARD (§5) — the F-694 guards. These were never the defect: an agent ended at quit
//   ALREADY leaves a visible Ended card, because `session-teardown.js › settle` persists
//   `phase:'ended'` and writes the `agent-history.js › record` entry synchronously. They are
//   here to keep that true, and they were green before the quit fix and after it. The boot log
//   that prompted the whole investigation ("dormant records 8 → re-parked 8 ended 0") reads the
//   other way round: `reloadDisposition('ended')` is `'ignore'`, so `reparkOne` returns `''` and
//   a correctly-ended record is counted in neither column by design.
//
// ⚠ EVERY TEST BODY BELOW IS THE ONE THAT WAS REVIEWED, moved VERBATIM — the split was required
// to change nothing, and the commit proves the title set and the pass count across both files
// against the single file they came from.
//
// Run: `node --test dopl-desktop-app/test/session-terminal-posts.test.mjs`

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
const TEARDOWN = M("session-teardown.js");
const BOOT = M("session-boot.js");
const ENGINE = M("session-engine.js");

// The quit teardown, read as source. Declared here as well as in quit-end-notice.test.mjs
// because the last guard below asks one question about it — that the teardown grows no second
// opinion about parked sessions — and that question belongs beside the F-694 rule it protects.
const teardownSrc = () => codeOf(fnOf(SRC, "teardown"));

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

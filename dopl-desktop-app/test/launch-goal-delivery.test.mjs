// THE LAUNCH GOAL, END TO END, ON BOTH LANES — and the 2026-08-31 ruling that split them.
//
// ── THE RULING ───────────────────────────────────────────────────────────────────────────────
// Samuel, 2026-08-31: **an MCP-lane (directive) launch carrying a GOAL spawns RUNNING — the goal
// is that session's first turn.** The directive was already approved by the operator on this
// machine (the launch-over-MCP toggle IS that consent), so the human-in-the-loop step ruling 3's
// spawn-idle shape exists to preserve has already happened. **The BUTTON lane keeps ruling 3
// unchanged**: New Agent registers a shell and starts no `claude` child.
//
// ── WHY THE RULING WAS NEEDED, WHICH IS NOT THE SAME AS "THE GOAL WAS DROPPED" ───────────────
// The chain `d.goal` -> `spec.goal` -> `firstMessage` -> `s.launchGoal` -> `session-seed.js ›
// takeFraming` WORKED, at every link, and still does — a parked directive agent holds its goal
// and fences it into the WAKE turn. What was wrong was the premise: **the only caller of the
// directive lane could not produce that wake.** A dormant session woke on a HUMAN-authored
// message, and a directive is filed by an AGENT over MCP whose posts the loop fence refuses. So
// on 2026-08-31 an orchestrator sent a 1 111-character goal, was told the agent was running, and
// the agent sat holding it (ENGINEERING). Two things were ruled in response: this split, and the
// same-account @-wake carve (`test/wake-tier-routing.test.mjs`).
//
// ── WHAT THIS FILE PINS, AND WHY IT IS THREE CASES AND NOT ONE ───────────────────────────────
// The two lanes and the two goal states are the whole contract, and each combination has a
// different failure that has actually happened:
//   directive + goal    -> RUNS.  (The ruling. Its failure is the one above.)
//   directive, no goal  -> IDLE.  (`defaultGoal` is a synthesized stand-by line, not an
//                          instruction anybody wrote; running it spends a child to read a room.)
//   button              -> IDLE.  (Ruling 3, untouched. Its failure would be a `claude` child
//                          per click, which is what ruling 3 was made to stop.)
// …plus the DELIVERY half on both shapes, because a lane that gets the flag right and loses the
// goal is the 1.17.1 defect coming back through a different door.
//
// Run: `node --test dopl-desktop-app/test/launch-goal-delivery.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot, row, MAIN, WS } from "./_launch-directive-harness.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const seed = require(join(MAIN, "session-seed.js"));
const ENGINE = readFileSync(join(MAIN, "session-engine.js"), "utf8");
void HERE;

const GOAL = "Investigate the surface flaw and post what you find.";

// ── 1. THE DIRECTIVE LANE, WITH A GOAL: THE SPEC SAYS RUN ────────────────────────────────────

test("DIRECTIVE + goal: the spawn is NOT idle, and the goal is the launch goal", async () => {
  const h = boot();
  await h.api.handle(row({ goal: GOAL }), WS);
  const spec = h.cfg.lastSpec;
  assert.equal(spec.goal, GOAL, "carried verbatim from the CLAIMED row");
  assert.equal(spec.idle, false, "⚠ THE RULING: an operator-approved goal RUNS");
  // ⚠ Everything else about the spawn is unchanged, and that is the containment claim: the
  // ruling moved WHEN the goal runs, not what the session may do.
  assert.equal(spec.windowless, true);
  assert.equal(spec.operatorArmed, true);
  assert.equal(spec.toolProfile, "full", "still main's own watched-channel DTO");
  assert.equal(spec.launchDepth, undefined, "still absent, so `MAX_LAUNCH_DEPTH` fails closed");
});

test("DIRECTIVE + goal: a CHANNEL-LEVEL directive runs too — the shape the repro used", async () => {
  // ⚠ The 2026-08-31 field directive carried `task_id: null`. A fix that only covered
  // thread-scoped launches would have left the exact case that produced it untouched.
  const h = boot();
  await h.api.handle(row({ goal: GOAL, task_id: null }), WS);
  assert.equal(h.cfg.lastSpec.idle, false);
  assert.equal(h.cfg.lastSpec.taskId, "", "'' is the channel-level scope, not a missing value");
  assert.equal(h.cfg.lastSpec.context.scope, "channel");
});

// ── 2. THE DIRECTIVE LANE, WITHOUT A GOAL: STILL A STAND-BY SHELL ────────────────────────────

test("DIRECTIVE, no goal: still SPAWN-IDLE, and still falls back to the stand-by sentence", async () => {
  // ⚠ `defaultGoal` is text this machine composed, not an instruction an orchestrator wrote.
  // Running it immediately would spend a `claude` child to have an agent read a room and stop.
  const thread = boot();
  await thread.api.handle(row({ goal: "" }), WS);
  assert.equal(thread.cfg.lastSpec.idle, true);
  assert.match(thread.cfg.lastSpec.goal, /Join this thread as my agent/);
  const channel = boot();
  await channel.api.handle(row({ goal: "", task_id: null }), WS);
  assert.equal(channel.cfg.lastSpec.idle, true);
  assert.match(channel.cfg.lastSpec.goal, /Stand by in this channel/);
});

test("DIRECTIVE: a whitespace-only goal is NO goal — the wire already trimmed it", () => {
  // ⚠ `launch-directive-wire.js › directiveFrom` collapses and trims, so `''` is the ONLY
  // spelling of "none" that can reach `idle: !d.goal`. Asserted at the wire rather than
  // re-implemented at the branch, because a second emptiness rule is how the two disagree.
  const wire = require(join(MAIN, "launch-directive-wire.js"));
  for (const blank of ["", "   ", "\n\t ", null, undefined, 7]) {
    assert.equal(wire.directiveFrom(row({ goal: blank }), WS).goal, "", JSON.stringify(blank));
  }
});

// ── 3. THE BUTTON LANE: RULING 3, UNTOUCHED ──────────────────────────────────────────────────

test("BUTTON: New Agent still spawns IDLE — ruling 3 is not what moved", () => {
  // ⚠ SOURCE-PINNED, because `session-launch-op.js` cannot be required under `node --test`
  // (`./diag` pulls Electron). The literal is what matters: the button lane must NOT grow a
  // goal-conditional, because there IS no operator-written goal on it — it composes its own
  // stand-by sentence, and a human is at the keyboard to talk to what it registers.
  const src = readFileSync(join(MAIN, "session-launch-op.js"), "utf8");
  const call = src.slice(src.indexOf("engine.launchRequesterSession({"));
  assert.match(call, /\n\s*idle: true,/, "the button lane spawns idle, unconditionally");
  assert.ok(!/idle: !/.test(call), "…and must not copy the directive lane's conditional");
  // The directive lane's own literal, so the two cannot silently converge.
  // ⚠ `spawn` LEFT `launch-directives.js` ON 2026-09-01 (the §1 split, T24) and took `idle:` with it.
  const dir = readFileSync(join(MAIN, "launch-directive-spawn.js"), "utf8");
  assert.match(dir, /idle: !d\.goal,/);
});

// ── 4. DELIVERY: THE GOAL ACTUALLY BECOMES THE AGENT'S FIRST INSTRUCTION ─────────────────────
//
// ⚠ TWO SHAPES, TWO BUILDERS, ONE REQUIREMENT. A running spawn's goal is built by
// `startSession` into `s.firstTurn` (pushed by `session-query.js › startQuery`); a parked
// shell's is held in `s.launchGoal` and built by `session-seed.js › takeFraming` at the wake.
// Both must put it INSIDE the fence as the request body — it is text another agent wrote.

test("DELIVERY (running): the goal is built into `firstTurn`, fenced, with the profile", () => {
  // ⚠ SOURCE-PINNED for the same reason as above; `startSession` needs Electron. What is pinned
  // is the two facts a running directive spawn depends on: `firstTurn` is BUILT for a non-parked
  // spawn, and its framing context carries `spec.profile`.
  assert.match(ENGINE, /const firstTurn = spec\.parkedShell \? ''/);
  assert.match(
    ENGINE,
    /buildFencedTurn\(\{ side: spec\.side, message: spec\.firstMessage, context: \{ \.\.\.context, profile: spec\.profile \}, nonce \}\)/,
    "⚠ the profile rides in: without it `knowledgeLines` orders a `read_only`-denied tool",
  );
  assert.match(ENGINE, /launchGoal: spec\.parkedShell === true \?/, "…and the parked shape still holds its goal");
  const launch = readFileSync(join(MAIN, "session-launch.js"), "utf8");
  assert.match(launch, /firstMessage: a\.goal \}\);/, "goal -> firstMessage, the one hop between them");
});

test("DELIVERY (parked): a goal-less directive's shell still fences its stand-by line at wake", () => {
  // ⚠ THE 1.17.1 PLUMBING IS NOT DELETED BY THIS RULING — the no-goal branch still uses it, and
  // so does every button launch. Driven through the REAL seed and the REAL framing module.
  const s = {
    side: "requester",
    bind: "pair",
    nonce: "n1",
    freshFraming: true,
    launchGoal: "Stand by in this channel as my agent: watch the main room.",
    pendingHistory: null,
    profile: "full",
    context: { channelName: "Ops", channelId: "c1", workspaceId: "w1", taskId: "", scope: "channel" },
  };
  const woken = seed.withSeed(s, "Alice posted in the room.");
  assert.ok(woken.includes(s.launchGoal), "the goal reaches the agent");
  const lines = woken.split("\n");
  const begin = lines.findIndex((l) => l.trim() === "BEGIN-REQUEST-n1");
  const end = lines.findIndex((l) => l.trim() === "END-REQUEST-n1");
  const at = lines.findIndex((l) => l.includes(s.launchGoal));
  assert.ok(begin !== -1 && end > begin && at > begin && at < end, "…as DATA inside the fence");
});

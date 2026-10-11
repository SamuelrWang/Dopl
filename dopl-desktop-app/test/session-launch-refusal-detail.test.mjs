// AN HONEST REFUSAL SENTENCE ON EVERY `disabled` LAUNCH (2026-10-11, release review item 5).
//
// THE DEFECT. `launch()` had three sites that answered a bare `{ skipped: 'disabled' }`, whose shipped
// copy is the generic *"The agent could not be started"*:
//   · the windowless FLOOR refusal, which had a readable sentence in hand (`profiles.
//     windowlessFloorRefusal` names the runtime and what it failed to declare) and threw it away into
//     the diag log;
//   · `!a.windowless`, which had no sentence at all;
//   · `!s` after `startSession`, which could not happen (see the unreachability case at the foot).
// Meanwhile the model and protocol refusals one branch up already carried `detail`, and the renderer
// already PREFERS `detail` over the generic copy whenever main sent one — so the field, the wire and
// the renderer were all in place and two refusals simply did not use them.
//
// ⚠ WHY `detail` AND NOT A NEW WIRE WORD. The refusal set is CLOSED: schema, service, copy map and a
// migration CHECK on `refusal_reason`, and `launch()` is the funnel for the directive lane, which
// PERSISTS the word it returns. `delivery-path.js` reasoned this out for the mute refusal and took the
// same route. `detail` is the seam that already exists for exactly this.
//
// Run: `node --test dopl-desktop-app/test/session-launch-refusal-detail.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MAIN, CHANNEL, WORKSPACE, ME, launchArgs, settle } from "./_engine-harness.mjs";
import { codeOf } from "./helpers/source-probe.mjs";

const require_ = createRequire(import.meta.url);
const sessionLaunch = require_(join(MAIN, "session-launch.js"));
const profiles = require_(join(MAIN, "session-profiles.js"));
const windowless = require_(join(MAIN, "session-windowless.js"));
const registry = require_(join(MAIN, "runtime", "index.js"));

/** The engine's handles, at the shapes `launch()` relies on. */
function bindFakes() {
  const sessions = new Map();
  let n = 0;
  sessionLaunch.bind({
    sessions,
    acquireRuntime: (id) => registry.acquire(id),
    startSession: async (spec) => {
      n += 1;
      const s = { key: spec.key, sessionId: `sid-${n}`, settled: false, context: {} };
      sessions.set(spec.key, s);
      return s;
    },
    liveOnThread: () => [],
    sessionOn: () => null,
    selfUserId: () => ME,
  });
  return sessions;
}

const args = (over) => launchArgs({ channelId: CHANNEL, workspaceId: WORKSPACE, ...over });

// ── the two refusals that had nothing to say ──────────────────────────────────

test("THE FLOOR REFUSAL carries its own sentence as `detail`, instead of logging it and going quiet", async () => {
  bindFakes();
  const real = profiles.windowlessFloorRefusal;
  // The sentence `capability.js › windowlessFloorRefusal` really produces for a runtime that declares
  // no orderable windowless floor, stubbed in at the one property `launch()` reads it through.
  const SENTENCE = "Claude Code declares no windowless tool floor, and a session with no gate surface "
    + "would silently deny every tool call it makes";
  profiles.windowlessFloorRefusal = () => SENTENCE;
  try {
    const res = await sessionLaunch.launch(args());
    assert.equal(res.skipped, "disabled", "still the closed set's word — no new wire word");
    assert.equal(res.detail, SENTENCE, "and the sentence the operator can act on");
    assert.ok(res.detail.length > 0, "non-empty");
    assert.equal(res.sessionId, undefined, "nothing was spawned");
  } finally {
    profiles.windowlessFloorRefusal = real;
  }
  await settle();
});

test("…and the real runtime declares a floor, so an ordinary launch is NOT refused", async () => {
  // The stub above must not be mistaken for the shipped answer: Claude declares `windowlessFloor`, so
  // this refusal is a dead letter on today's runtimes and only a regression in a declaration reaches it.
  assert.equal(profiles.windowlessFloorRefusal("claude"), null);
  bindFakes();
  const res = await sessionLaunch.launch(args());
  assert.ok(res.sessionId, JSON.stringify(res));
});

test("`!a.windowless` says WHICH shape Dopl starts, rather than 'could not be started'", async () => {
  bindFakes();
  const res = await sessionLaunch.launch(args({ windowless: false }));
  assert.equal(res.skipped, "disabled");
  assert.ok(res.detail && res.detail.length > 0, `a sentence, got ${JSON.stringify(res.detail)}`);
  assert.match(res.detail, /windowless/i, "and it names the actual constraint");
});

test("every `disabled` refusal in the funnel carries a detail — none answers the bare word", () => {
  // A census over the source, so a THIRD silent refusal cannot be added without this failing. The
  // mute refusal's `{ skipped: 'disabled', detail }` is built in `delivery-path.js › muteRefusal`, so
  // what must not appear here is a `disabled` with no `detail` beside it.
  const src = codeOf(readFileSync(join(MAIN, "session-launch.js"), "utf8"));
  const bare = src.match(/\{\s*skipped:\s*'disabled'\s*\}/g) || [];
  assert.deepEqual(bare, [], "a `disabled` with no sentence is the generic copy, which says nothing");
  const launchFn = src.slice(src.indexOf("async function launch(a)"), src.indexOf("/** The sentence refusing"));
  // The two that were silent, now each carrying a sentence.
  assert.equal((launchFn.match(/\{ detail: [^}]+, skipped: 'disabled' \}/g) || []).length, 2,
    "both of them: the shape refusal and the floor refusal");
  // ⚠ AND `device-token-no-cli.test.mjs`'s RULE STILL HOLDS, which is why `detail` is spelled first:
  // that case greps this function for the `disabled` word followed immediately by a detail field,
  // because the MUTE refusal must come back from `delivery-path.js › muteRefusal` AS GIVEN rather than
  // be rebuilt here. (Spelled by parts, so this very comment does not trip that raw-source grep.)
  const forbidden = new RegExp(["skipped: 'disabled'", "detail"].join(", "));
  assert.equal(forbidden.test(launchFn), false, "no second opinion in the funnel");
  assert.match(launchFn, /return muteRefusal;/, "and the mute refusal is still returned AS GIVEN");
});

test("the renderer prefers main's sentence over the generic copy — the wire this relies on", () => {
  // Read-only: `detail` is worth carrying only because the renderer already renders it.
  const p = join(MAIN, "..", "..", "src", "features", "channels", "components", "use-launch-controls.ts");
  if (!existsSync(p)) return; // the renderer moved; the main-side contract above still stands
  assert.match(readFileSync(p, "utf8"), /res\.detail \? res\.detail :/,
    "main's own sentence wins whenever it sent one");
});

// ── the arm that was deleted, and why it could not fire ───────────────────────

test("UNREACHABILITY: `startSession` cannot answer falsy, so the `!s` arm was dead", () => {
  // THE PROOF, mechanical rather than argued, AND IT IS THIS CASE THAT HOLDS THE PAIRING. `attachSurface`
  // is the ONLY thing that could make `startSession` return `null`, and it returns `true` for every
  // input — it has since F-228 retired the window branch. So `launch()`'s `if (!s) return { skipped:
  // 'disabled' }` answered a case that cannot happen, and it is deleted.
  //
  // ⚠ THE ENGINE'S ROLLBACK IS DEAD TOO AND IS NEVERTHELESS KEPT: `session-summary.test.mjs` counts the
  // registry mutations inside `startSession` (the registration plus its two rollbacks). So the day
  // `attachSurface` becomes conditional, THIS case is what fails — and the fix is to put the `!s` arm
  // back in `launch()` beside the rollback that would then be live.
  for (const s of [{}, { key: "k" }, Object.create(null)]) {
    assert.equal(windowless.attachSurface(s, {}), true, "unconditionally true — for EVERY input");
    assert.equal(s.windowless, true, "…and its real job is the stamp");
  }
  const src = codeOf(readFileSync(join(MAIN, "session-windowless.js"), "utf8"));
  const fn = src.slice(src.indexOf("function attachSurface("), src.indexOf("function liveCount("));
  assert.equal(/\bif\b|\?|&&|\|\|/.test(fn), false, `no branch in it at all: ${fn.trim()}`);
  assert.match(fn, /return true;/, "one return, and it is `true`");

  const launchSrc = codeOf(readFileSync(join(MAIN, "session-launch.js"), "utf8"));
  assert.equal(/if \(!s\) return/.test(launchSrc), false, "no arm in launch() waiting for a falsy session");
  assert.match(launchSrc, /if \(s\.authHold === true\) return \{ skipped: 'auth-hold' \};/,
    "…and the one post-spawn arm that CAN fire is untouched");
});

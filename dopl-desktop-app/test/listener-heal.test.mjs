// Q4 fix 2 — reconcile self-heal: bounded re-enumeration that never storms.
//
// THE THREE FIELD STATES THIS LOCKS OUT, all observed in one incident:
//
//   (a) `realtime wake <ch> (loop=miss)` — push was delivering INSERTs for a
//       channel NOTHING was watching. The wake found no loop, called
//       io.wakeEntry(undefined), and returned. Nothing ever re-derived the
//       channel set, so the miss repeated until the app was restarted.
//   (b) The 02:18 boot: one workspace's /api/channels read failed inside an
//       expired-token window. listChannels returned [] for every failure, so
//       reconcile could not tell "no channels" from "no answer" — the workspace's
//       channels were absent from `desired` and the prune step deleted their
//       loops. The name cache loaded 2 of 3 workspaces; the third stayed dark
//       until reboot, with no retry.
//   (c) `want=0` persisting across reboots. realtime's desired set is emptied by
//       reconcile's signed-out branch and refilled ONLY by a successful pass, so
//       one signed-out-looking reconcile killed push permanently.
//
// The counter-requirement is just as important: F-072 — no retry may become a
// storm. A burst of misses across several unwatched channels must produce ONE
// reconcile, and repeated enumeration failures must not stack timers.
//
// Run: `node --test dopl-desktop-app/test/listener-heal.test.mjs`
//
// listener-heal.js is dependency-free ON PURPOSE (no electron, no store, no
// diag), so this imports and drives the REAL shipped module with a fake clock and
// fake timers — no source slicing, no mirrored copy that can drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const require = createRequire(import.meta.url);
const heal = require("../main/listener-heal.js"); // the REAL module

const LISTENER = M("channel-listener.js");
const IO = M("listener-io.js");

// A fake clock + timer set: nothing here waits on real time.
function harness(opts = {}) {
  let t = 1_000_000;
  const runs = [];
  const logs = [];
  let seq = 0;
  const pending = new Map();
  const timers = {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { fn, at: t + ms });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
  };
  const healer = heal.createReconcileHealer({
    run: () => runs.push(t),
    log: (...a) => logs.push(a.join(" ")),
    now: () => t,
    timers,
    ...opts,
  });
  return {
    healer,
    runs,
    logs,
    advance(ms) { t += ms; },
    fireDue() {
      for (const [id, e] of Array.from(pending)) {
        if (e.at <= t) { pending.delete(id); e.fn(); }
      }
    },
    pendingCount: () => pending.size,
  };
}

// ── (a) loop=miss → bounded re-enumeration ──────────────────────────────────

test("missReconcileDue: never-yet admits, then only once the window has elapsed", () => {
  assert.equal(heal.missReconcileDue(5_000, 0, 60_000), true, "first miss always re-enumerates");
  assert.equal(heal.missReconcileDue(5_000, 1_000, 60_000), false);
  assert.equal(heal.missReconcileDue(61_000, 1_000, 60_000), true, "exactly a window later");
  assert.equal(heal.missReconcileDue(60_999, 1_000, 60_000), false);
});

test("a loop=miss wake triggers ONE re-enumeration", () => {
  const h = harness();
  assert.equal(h.healer.onLoopMiss("chan-abc"), true);
  assert.equal(h.runs.length, 1, "reconcile ran");
  assert.match(h.logs.join("\n"), /loop=miss/);
});

test("DOES NOT STORM: a burst of misses inside the window is ONE reconcile", () => {
  const h = harness();
  h.healer.onLoopMiss("c1");
  for (let i = 0; i < 25; i++) {
    h.advance(100); // 2.5s of misses across many channels
    assert.equal(h.healer.onLoopMiss(`c${i}`), false, "every further miss is swallowed");
  }
  assert.equal(h.runs.length, 1, "25 misses in one window must still be a single reconcile");
});

test("…and re-arms once the window has passed", () => {
  const h = harness();
  h.healer.onLoopMiss("c1");
  h.advance(59_999);
  assert.equal(h.healer.onLoopMiss("c1"), false);
  h.advance(1);
  assert.equal(h.healer.onLoopMiss("c1"), true, "one retry per window, not one per miss");
  assert.equal(h.runs.length, 2);
});

test("the suppressed-miss count is reported, so the log shows what was held back", () => {
  const h = harness();
  h.healer.onLoopMiss("c1");
  h.healer.onLoopMiss("c2");
  h.healer.onLoopMiss("c3");
  h.advance(60_000);
  h.healer.onLoopMiss("c4");
  assert.match(h.logs.join("\n"), /\+2 suppressed/);
});

test("the miss window is a real bound, not a per-tick trickle", () => {
  assert.ok(heal.MISS_RECONCILE_WINDOW_MS >= 30_000, "F-072: misses must not drive frequent reconciles");
});

// ── (b) enumeration failure → bounded retry ─────────────────────────────────

test("enumerationRetryDelay walks a short ladder and then gives up", () => {
  assert.equal(heal.enumerationRetryDelay(0), 1_000);
  assert.equal(heal.enumerationRetryDelay(1), 3_000);
  assert.equal(heal.enumerationRetryDelay(2), null, "bounded — never an unbounded retry loop");
  assert.equal(heal.enumerationRetryDelay(99), null);
  assert.equal(heal.enumerationRetryDelay(-1), null);
});

test("the in-pass ladder is short enough not to hold a reconcile open", () => {
  const total = heal.ENUM_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
  assert.ok(total <= 10_000, `retry ladder totals ${total}ms per workspace`);
});

test("a failed enumeration schedules ONE follow-up pass", () => {
  const h = harness();
  assert.equal(h.healer.onEnumerationFailure(1), true);
  assert.equal(h.pendingCount(), 1);
  assert.equal(h.runs.length, 0, "the retry is scheduled, not immediate");
  h.advance(heal.ENUM_RETRY_RECONCILE_MS);
  h.fireDue();
  assert.equal(h.runs.length, 1);
});

test("DOES NOT STORM: repeated failures reuse the one pending retry", () => {
  const h = harness();
  h.healer.onEnumerationFailure(3);
  assert.equal(h.healer.onEnumerationFailure(2), false, "a second failing pass must not stack a timer");
  assert.equal(h.healer.onEnumerationFailure(1), false);
  assert.equal(h.pendingCount(), 1);
});

test("a clean pass schedules nothing", () => {
  const h = harness();
  assert.equal(h.healer.onEnumerationFailure(0), false);
  assert.equal(h.pendingCount(), 0);
});

test("the follow-up beats the 5-minute reconcile timer but is not a hot loop", () => {
  assert.ok(heal.ENUM_RETRY_RECONCILE_MS < 5 * 60 * 1000, "must beat CHANNEL_REFRESH_MS");
  assert.ok(heal.ENUM_RETRY_RECONCILE_MS >= 10_000, "…without becoming a retry storm");
});

test("stop() cancels a pending retry and re-arms the miss gate", () => {
  const h = harness();
  h.healer.onEnumerationFailure(1);
  h.healer.onLoopMiss("c1");
  h.healer.stop();
  assert.equal(h.pendingCount(), 0, "no reconcile fires after the listener stops");
  h.advance(heal.ENUM_RETRY_RECONCILE_MS);
  h.fireDue();
  assert.equal(h.runs.length, 1, "only the original miss reconcile ever ran");
});

test("keepLoopOnPrune: a workspace we could not enumerate keeps its loops", () => {
  const failed = new Set(["ws-broken"]);
  assert.equal(heal.keepLoopOnPrune("ws-broken", failed), true, "the 02:18 silent drop");
  assert.equal(heal.keepLoopOnPrune("ws-ok", failed), false, "a workspace we DID read may prune");
  assert.equal(heal.keepLoopOnPrune("ws-broken", new Set()), false);
  assert.equal(heal.keepLoopOnPrune("ws-broken", null), false, "no failures → normal prune");
});

// ── (c) want=0 with a live credential ───────────────────────────────────────

test("shouldReapplyWorkspaces: want=0 while signed in with a known-good set", () => {
  assert.equal(heal.shouldReapplyWorkspaces(true, 0, 3), true, "the wedged-across-reboots state");
  assert.equal(heal.shouldReapplyWorkspaces(true, 3, 3), false, "push already wants its workspaces");
  assert.equal(heal.shouldReapplyWorkspaces(false, 0, 3), false, "signed out: want=0 is correct");
  assert.equal(heal.shouldReapplyWorkspaces(true, 0, 0), false, "nothing known-good to re-apply yet");
});

// ── The shipped wiring actually calls all of it ─────────────────────────────

test("wakeChannel routes a loop=miss into the healer instead of dropping it", () => {
  const fn = fnOf(LISTENER, "wakeChannel");
  assert.match(fn, /loop=\$\{entry \? 'hit' : 'miss'\}/, "the diag line that exposed the bug stays");
  assert.match(fn, /if \(!entry\) \{ healer\.onLoopMiss\(channelId\); return; \}/);
  const miss = fn.indexOf("healer.onLoopMiss");
  const wake = fn.indexOf("io.wakeEntry");
  assert.ok(miss < wake, "a miss must short-circuit before the no-op wakeEntry");
});

test("reconcile keeps the loops of a workspace it failed to enumerate", () => {
  const fn = fnOf(LISTENER, "reconcileInner");
  assert.match(fn, /const failedWorkspaces = new Set\(\)/);
  assert.match(fn, /await io\.listChannelsWithRetry\(ws\.id\)/, "the bounded retry ladder is used");
  assert.match(fn, /if \(chans === null\)/, "null = 'no answer', which must not read as empty");
  assert.match(fn, /failedWorkspaces\.add\(ws\.id\)/);
  assert.match(fn, /heal\.keepLoopOnPrune\(entry\.workspaceId, failedWorkspaces\)/);
  assert.match(fn, /healer\.onEnumerationFailure\(failedWorkspaces\.size\)/);
});

test("reconcile re-applies the last known-good workspaces when push wants none", () => {
  const fn = fnOf(LISTENER, "reconcileInner");
  assert.match(fn, /heal\.shouldReapplyWorkspaces\(true, realtime\.desiredCount\(\), lastGoodWorkspaceIds\.length\)/);
  const check = fn.indexOf("shouldReapplyWorkspaces");
  const list = fn.indexOf("io.listWorkspaces()");
  assert.ok(check < list, "repair push BEFORE an enumeration that may itself fail");
  assert.match(fn, /realtime\.setWorkspaces\(lastGoodWorkspaceIds\)/);
  assert.match(LISTENER, /desiredCount/);
});

test("listChannels distinguishes 'no answer' from 'no channels'", () => {
  const fn = fnOf(IO, "listChannels");
  assert.match(fn, /if \(res\.status === 404\) \{ featureAvailable = false; return \[\]; \}/,
    "404 is a real answer: the feature is not deployed");
  assert.match(fn, /res\.status === 401.*return null/s, "401 is not an empty workspace");
  assert.match(fn, /if \(!res\.ok\).*return null/s);
  assert.match(fn, /catch \(err\) \{[\s\S]*return null;/, "a thrown fetch is not an empty workspace");
});

test("listWorkspaces also returns null rather than an empty set on failure", () => {
  const fn = fnOf(IO, "listWorkspaces");
  assert.match(fn, /if \(!res\.ok\) \{[^}]*return null/, "an empty array here would prune every loop");
});

test("the retry ladder repairs the session between tries — the 02:18 failure was token expiry", () => {
  const fn = fnOf(IO, "listChannelsWithRetry");
  assert.match(fn, /heal\.enumerationRetryDelay\(attempt\)/);
  assert.match(fn, /auth\.ensureFresh\(\)/);
  assert.match(fn, /await sleep\(delay\)/);
  assert.match(fn, /if \(delay == null\)/, "and it must give up, not loop forever");
});

// ── FIX S7: THE MISS LADDER HAS A FLOOR AS WELL AS A RATE ───────────────────
// The window bounded how OFTEN a miss re-enumerates, but nothing bounded how MANY times.
// A channel that legitimately has no loop — the operator was removed from it, it was
// archived under a still-subscribed Realtime topic, the DTO hides it — therefore drove a
// full reconcile every 60 seconds for as long as the app ran. Each pass was correct and
// each pass re-derived a set that still did not contain it.

test("a channel that never gets a loop is given up on after the cap", () => {
  const h = harness();
  for (let i = 0; i < heal.MISS_GIVE_UP_COUNT; i++) {
    assert.equal(h.healer.onLoopMiss("ghost"), true, `pass ${i + 1} still tries`);
    h.advance(60_000);
  }
  assert.equal(h.runs.length, heal.MISS_GIVE_UP_COUNT);
  assert.equal(h.healer.onLoopMiss("ghost"), false, "…and then stops, however long it runs");
  h.advance(10 * 60_000);
  assert.equal(h.healer.onLoopMiss("ghost"), false, "a later window does not revive it");
  assert.equal(h.runs.length, heal.MISS_GIVE_UP_COUNT, "no reconcile after the cap");
  assert.match(h.logs.join("\n"), /GIVING UP/, "and the escalation is stated once it happens");
});

test("the cap is PER CHANNEL — one ghost must not disarm the self-heal", () => {
  const h = harness();
  for (let i = 0; i < heal.MISS_GIVE_UP_COUNT; i++) {
    h.healer.onLoopMiss("ghost");
    h.advance(60_000);
  }
  assert.equal(h.healer.onLoopMiss("ghost"), false);
  assert.equal(h.healer.onLoopMiss("real"), true, "a different channel gets its own budget");
});

test("a parked channel costs nothing — it does not even consume the window", () => {
  const h = harness();
  for (let i = 0; i < heal.MISS_GIVE_UP_COUNT; i++) { h.healer.onLoopMiss("ghost"); h.advance(60_000); }
  h.healer.onLoopMiss("ghost"); // parked: must not move lastMissAt
  assert.equal(h.healer.onLoopMiss("real"), true, "…so a real miss in the same tick still runs");
});

test("stop() is the reset: a listener restart un-parks every channel", () => {
  const h = harness();
  for (let i = 0; i < heal.MISS_GIVE_UP_COUNT; i++) { h.healer.onLoopMiss("ghost"); h.advance(60_000); }
  assert.equal(h.healer.onLoopMiss("ghost"), false);
  h.healer.stop();
  assert.equal(h.healer.onLoopMiss("ghost"), true, "restart gives it a fresh budget");
});

test("giving up on the SELF-HEAL is not giving up on the channel", () => {
  // The 5-minute periodic reconcile is untouched and still re-derives the whole set, so a
  // channel that really does come back is picked up there.
  assert.match(LISTENER, /CHANNEL_REFRESH_MS/, "the periodic pass still exists");
  const fn = fnOf(M("listener-heal.js"), "onLoopMiss");
  assert.match(fn, /periodic reconcile is now the only retry/, "…and the log says so");
});

// ── FIX S8: AN EMPTY WORKSPACE SET IS AN ANSWER ─────────────────────────────

test("reconcile records the empty workspace set too, so want=0 stops oscillating", () => {
  // `if (wsIds.length) lastGoodWorkspaceIds = wsIds` kept the last non-empty set forever
  // for an operator who left every workspace: realtime.desiredCount() is 0, the last-good
  // count is not, so shouldReapplyWorkspaces fired on every 5-minute pass, re-subscribing
  // push to workspaces we are no longer in — permanently.
  const fn = fnOf(LISTENER, "reconcileInner");
  assert.match(fn, /\n {2}lastGoodWorkspaceIds = wsIds;/, "assigned unconditionally");
  assert.ok(!/if \(wsIds\.length\) lastGoodWorkspaceIds/.test(fn), "the guard is gone");
  // …and the reapply predicate is what makes an empty set harmless rather than a no-op.
  assert.equal(heal.shouldReapplyWorkspaces(true, 0, 0), false, "nothing known-good to re-apply");
  // A FAILED enumeration is still different from an empty one: it returns before here.
  assert.match(fn, /if \(workspaces === null\) \{ healer\.onEnumerationFailure\(1\); setStatus\(\); return; \}/);
});

// ── FIX S6 (io half): the refresh dance is for AUTH failures only ───────────

test("the retry ladder only repairs the session on a 401, not on every failure", () => {
  // A refresh cannot fix a 500, a timeout or a dropped socket. Running it anyway rotated
  // the Supabase refresh token and rewrote the cookie jar on every transient blip.
  const fn = fnOf(IO, "listChannelsWithRetry");
  assert.match(fn, /const authShaped = lastChannelsAuthFailure;/, "the shape is captured per attempt");
  assert.match(fn, /if \(authShaped\) \{[\s\S]*auth\.ensureFresh\(\)/, "…and gates the repair");
  assert.match(fn, /await sleep\(delay\)/, "a non-auth failure still backs off and retries");
  const chans = fnOf(IO, "listChannels");
  assert.match(chans, /lastChannelsAuthFailure = false;/, "reset on entry, so it never goes stale");
  assert.match(chans, /res\.status === 401\) \{ lastChannelsAuthFailure = true;/, "set only by a 401");
});

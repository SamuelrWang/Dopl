// A MUTED `peer_ask` MUST NOT CONSUME THE PEER'S ASK (2026-10-10).
//
// THE DEFECT. `notification-route.js › raiseActionable` grew the operator's preference gate, so
// muting "A peer's agent asks you" made `trigger.js › notifyAsk` answer `null`. `handleTrigger`
// ignored that answer, returned nothing, and `listener-messages.drainPage` read nothing as
// "handled" and advanced the cursor. So a muted switch meant: no banner, no toast, NO LAUNCH, no
// courtesy reply to the peer, and the message marked read. The peer waits forever on an ask this
// machine quietly swallowed — and the only thing the operator asked for was a quieter desk.
//
// THE RULING (@orchestrator, 2026-10-10): a mute suppresses the banner/toast ONLY. It must never
// consume or skip the ask, and the launch path is unchanged — so a mute must not auto-launch
// either. What is left is exactly an UN-PRESSED banner: the cursor advances, the thread and the
// Tags inbox still hold the ask, and the channel's own launch control still answers it.
//
// So the route now answers the truthy `MUTED` for a mute and keeps `null` for the genuine
// no-surface case, and `handleTrigger` tells them apart:
//   MUTED → handled. Identical to a banner nobody pressed.
//   null  → 'no-ask-surface'. Nobody can ever be asked, so C-3 holds the cursor for a retry
//           rather than marking the ask read.
//
// METHOD: the REAL `trigger.js` over fakes, with the REAL route and the REAL prefs module
// underneath it (the route suites' own harness), so the `MUTED` identity being tested is the
// shipped one rather than a copy.
//
// Run: `node --test dopl-desktop-app/test/trigger-ask-mute.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";
import { load } from "./_notification-route-harness.mjs";

const ENTRY = {
  channel: { id: "11111111-2222-3333-4444-555555555555", name: "Design", isDirect: false },
  workspaceId: "ws-1",
  workspaceSegment: "acme",
};
const MSG = { seq: 7, body: "please ship the docs", authorUserId: "user-ada", metadata: {} };

/** The real `trigger.js`, with `route` as its notification route and everything else faked. */
function loadTrigger(route) {
  const calls = { launched: 0, courtesies: [], announced: 0, opened: 0 };
  const src = readFileSync(join(MAIN, "trigger.js"), "utf8");
  const mod = evalModule(src, (id) => {
    if (id === "./notification-route") return route;
    if (id === "./listener-io") return { displayNameFor: () => "Ada" };
    if (id === "./targeting") {
      return {
        firstClassTaskId: () => null,
        metaStr: (m, k) => (m && m.metadata && m.metadata[k]) || "",
        truncate: (s, n) => String(s == null ? "" : s).slice(0, n),
        resolveLaunchToolProfile: () => "narrow",
        openChannelForEntry: () => { calls.opened += 1; },
        mentionsMe: () => false,
      };
    }
    if (id === "./session-spawner") return { sessionSpawnAvailable: async () => true };
    // ⚠ A LAUNCH MUST NOT HAPPEN FROM A MUTE. Counted, never permitted silently.
    if (id === "./session-engine") {
      return { launchResponderSession: async () => { calls.launched += 1; return { sessionId: "s1" }; } };
    }
    if (id === "./channel-dirs") return { liveChannelDirLabel: () => "~/Dopl/design" };
    if (id === "./tool-profiles") return { profileLabel: () => "narrow", profileHint: () => "" };
    if (id === "./task-notify") return { mentionNotice: () => ({ title: "t", body: "b" }) };
    if (id === "./channel-post") return { postCourtesy: async (_e, _m, body) => { calls.courtesies.push(body); } };
    if (id === "./queued-notice") return { announce: async () => { calls.announced += 1; } };
    if (id === "./trigger-outcomes") {
      return { AUTH_HELD_REPLY: "held", RESEND: "resend", CANNOT_RUN: "cannot-run" };
    }
    if (id === "./diag") return { diag: () => {} };
    if (id === "./notification-prefs") return { allowsMessage: () => true, eventForMessage: () => "mention" };
    // Lazily required inside `launchResponderSession`, i.e. only once the button is pressed.
    if (id === "./runtime/launch-default") return { resolveLaunchRuntime: async () => ({ runtimeId: "claude" }) };
    if (id === "./runtime") return { capability: { narrowestToolMode: () => "ask" }, descriptorFor: () => ({}) };
    throw new Error(`unexpected require: ${id}`);
  });
  return { mod, calls };
}

test("THE DEFECT: a muted peer_ask is HANDLED, while a true no-surface HOLDS the cursor", async () => {
  // (a) MUTED. No banner, no toast — and nothing else changes.
  const muted = load({ focused: false, off: ["peer_ask"] });
  await muted.prefs.refresh(true);
  const m = loadTrigger(muted.mod);
  const mutedAnswer = await m.mod.handleTrigger(ENTRY, MSG);

  assert.equal(muted.built.length, 0, "the banner is silenced, which is what the switch is for");
  assert.equal(muted.toasts.length, 0, "and so is the toast");
  assert.ok(!mutedAnswer, "HANDLED: a mute is not a deferral, or the channel would stop draining");
  assert.equal(m.calls.launched, 0, "⚠ THE LAUNCH PATH IS UNCHANGED — a mute never auto-launches");
  assert.deepEqual(m.calls.courtesies, [], "and it is not a terminal, so the peer is not told no");

  // (b) NO SURFACE AT ALL. Not a mute: a machine where no banner can be built, so nobody will
  // ever be asked. ⚠ Before the fix this was INDISTINGUISHABLE from (a) — both answered null and
  // both were consumed.
  const dead = load({ focused: false });
  await dead.prefs.refresh(true);
  dead.notifyAction.buildActionNotification = () => null;
  const d = loadTrigger(dead.mod);
  const deadAnswer = await d.mod.handleTrigger(ENTRY, MSG);

  assert.equal(deadAnswer, "no-ask-surface",
    "⚠ a REASON STRING, so drainPage holds the cursor and the ask is retried, not swallowed");
  assert.equal(d.calls.launched, 0, "still nothing launches by itself");
});

test("unmuted, the ask raises its banner with the launch button, and is handled", async () => {
  const ctx = load({ focused: false });
  await ctx.prefs.refresh(true);
  const { mod, calls } = loadTrigger(ctx.mod);
  const answer = await mod.handleTrigger(ENTRY, MSG);
  assert.ok(!answer, "handled");
  assert.equal(ctx.built.length, 1);
  assert.equal(ctx.built[0].actionText, "Launch agent");
  assert.equal(calls.launched, 0, "the button launches; raising it does not");
  // And the button really is the launch.
  ctx.built[0].onAffirm();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.launched, 1);
});

test("MUTED is the route's own sentinel, not a shape trigger.js guesses at", () => {
  const src = readFileSync(join(MAIN, "trigger.js"), "utf8");
  // Identity, not duck-typing: a `raised.muted` check would pass for any object carrying the key.
  assert.match(src, /raised === notificationRoute\.MUTED/);
  // ⚠ THE SENTINEL MOVED WITH THE ACTIONABLE HALF (2026-10-12, split at the 500-line cap), and
  // the source probe that stood here moved with it — repointed at the file that DECLARES it,
  // never at the barrel, because `notification-route.js` re-exports the name and a probe over
  // the re-export would pass on a module that had stopped returning it.
  const route = readFileSync(join(MAIN, "notification-route-actions.js"), "utf8");
  assert.match(route, /if \(!prefs\.allowsIn\(prefs\.getPrefs\(\), eventId\)\) return MUTED;/);
  // ⚠ THE IDENTITY ACROSS THE RE-EXPORT is not something a regex can say, and it is the thing
  // `raised === notificationRoute.MUTED` depends on. It is pinned BEHAVIOURALLY, over the real
  // modules, by notification-route-actions.test.mjs › "a muted actionable event raises nothing —
  // but it is MUTED, never null", which compares the route's own export against what a muted
  // raise returns. Two names for one object, or that case goes red.
});

test("no agent runtime still defers before any notification is raised", async () => {
  // The pre-existing C-3 deferral, unchanged by the new one beside it.
  const ctx = load({ focused: false });
  await ctx.prefs.refresh(true);
  const src = readFileSync(join(MAIN, "trigger.js"), "utf8");
  const mod = evalModule(src, (id) => {
    if (id === "./session-spawner") return { sessionSpawnAvailable: async () => false };
    if (id === "./notification-route") return ctx.mod;
    if (id === "./diag") return { diag: () => {} };
    if (id === "./listener-io") return { displayNameFor: () => "Ada" };
    if (id === "./targeting") return {};
    if (id === "./session-engine") return {};
    if (id === "./channel-dirs") return {};
    if (id === "./tool-profiles") return { profileLabel: () => "", profileHint: () => "" };
    if (id === "./task-notify") return { mentionNotice: () => ({}) };
    if (id === "./channel-post") return { postCourtesy: async () => {} };
    if (id === "./queued-notice") return { announce: async () => {} };
    if (id === "./trigger-outcomes") return { AUTH_HELD_REPLY: "", RESEND: "", CANNOT_RUN: "" };
    if (id === "./notification-prefs") return { allowsMessage: () => true, eventForMessage: () => "mention" };
    throw new Error(`unexpected require: ${id}`);
  });
  assert.equal(await mod.handleTrigger(ENTRY, MSG), "no-agent-runtime");
  assert.equal(ctx.built.length + ctx.toasts.length, 0, "and it raises nothing on the way out");
});

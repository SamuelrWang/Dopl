// THE NOTIFICATION ROUTE'S AFFIRMATIVE HALF — the events that carry a button — plus coalescing
// and the resume offer. Split from notification-route.test.mjs at the 500-line cap; the harness
// both suites share is in _notification-route-harness.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";
import { load } from "./_notification-route-harness.mjs";

const SPEC = { title: "A peer's agent asked you something" };

// ─── THE ACTIONABLE HALF ──────────────────────────────────────────────────────────────────────
//
// Three events carry the one button that answers them. The hazard these pin is not cosmetic:
// `session-windowless.js:293` DENIES a held tool when the notification is falsy, so a focused
// path that answered with nothing — or with a toast that auto-dismisses — would turn "the
// operator was looking at Dopl" into "the tool was refused".

/** Loads the route with notify-action faked, so the banner is observable. */
function loadActionable(o = {}) {
  const ctx = load(o);
  const built = [];
  const src = readFileSync(join(MAIN, "notification-route.js"), "utf8");
  const mod = evalModule(src, (id) => {
    if (id === "electron") {
      return {
        BrowserWindow: {
          getFocusedWindow: () => (o.focused ? {} : null),
          getAllWindows: () => ctx.windows,
        },
        // ⚠ RECORDS into the same array `load` uses: `raise` builds its banner through electron
        // directly, so a non-recording stub here made every coalesced notice invisible.
        Notification: class {
          constructor(opts) { this.opts = opts; this.handlers = {}; }
          static isSupported() { return true; }
          on(ev, fn) { this.handlers[ev] = fn; }
          show() { ctx.banners.push(this); }
        },
      };
    }
    if (id === "./notification-prefs") return ctx.prefs;
    if (id === "./diag") return { diag: () => {} };
    if (id === "./notify-action") {
      return {
        buildActionNotification: (spec) => {
          built.push(spec);
          return { banner: true, spec };
        },
      };
    }
    throw new Error(`unexpected require: ${id}`);
  });
  return { ...ctx, mod, built };
}

const ASK = { title: "Design", body: "Ada's agent asks: ship it", actionText: "Launch agent", onAffirm: () => {}, onOpen: () => {} };

test("approval raises the BANNER even when Dopl is in front, and answers truthy", async () => {
  const { mod, prefs, built, toasts } = loadActionable({ focused: true });
  await prefs.refresh(true);
  const got = mod.raiseActionable("approval", { ...ASK, bannerAlways: true, actionText: "Allow" });
  assert.ok(got, "⚠ a falsy answer here DENIES the held tool (session-windowless.js:293)");
  assert.equal(built.length, 1, "the banner, not a toast");
  assert.equal(built[0].actionText, "Allow");
  assert.equal(toasts.length, 0, "a 4-second toast may not be the only place an approval is asked");
});

test("approval is LOCKED, so nothing can mute the tool gate into an auto-deny", async () => {
  const { mod, prefs } = loadActionable({ focused: false, off: ["approval"] });
  await prefs.refresh(true);
  assert.equal(prefs.getPrefs().events.approval, true, "the lock holds against a stored false");
  assert.ok(mod.raiseActionable("approval", { ...ASK, bannerAlways: true }), "so it still asks");
});

test("the auto-deny contract itself: the gate's only surface is this banner", () => {
  const windowless = readFileSync(join(MAIN, "session-windowless.js"), "utf8");
  // If this pin ever fails, re-read the ruling before "fixing" it: a falsy notification is the
  // TRUE no-surface case and denies the held call.
  assert.match(windowless, /if \(!notif\) \{/);
  const consent = readFileSync(join(MAIN, "consent.js"), "utf8");
  assert.match(consent, /raiseActionable\('approval', \{\s*bannerAlways: true,/,
    "notifyToolGate must never be focus-gated");
});

test("peer_ask and draft_reply raise the banner when Dopl is away", async () => {
  for (const id of ["peer_ask", "draft_reply"]) {
    const { mod, prefs, built, toasts } = loadActionable({ focused: false });
    await prefs.refresh(true);
    const got = mod.raiseActionable(id, ASK);
    assert.ok(got);
    assert.equal(built.length, 1, `${id}: the banner keeps its button`);
    assert.equal(built[0].onAffirm, ASK.onAffirm, `${id}: and the affirmative is wired to it`);
    assert.equal(toasts.length, 0);
  }
});

test("focused, they raise a toast whose button only NAVIGATES — no decision crosses", async () => {
  const { mod, prefs, built, toasts } = loadActionable({ focused: true });
  await prefs.refresh(true);
  const got = mod.raiseActionable("peer_ask", ASK);
  assert.ok(got, "truthy: a caller must not read this as no-surface");
  assert.equal(built.length, 0, "no banner over the window he is reading");
  assert.equal(toasts.length, 1);
  const p = toasts[0].payload;
  assert.equal(p.actionLabel, "Open");
  assert.ok(p.openId, "it carries a navigation handle");
  // ⚠ THE WHOLE POINT: nothing that decides is in the payload.
  assert.equal(p.onAffirm, undefined);
  assert.equal(p.actionText, undefined);
  assert.deepEqual(Object.keys(p).sort(), ["actionLabel", "body", "eventId", "kind", "openId", "title"]);
});

test("the Open handle runs that toast's navigation, exactly once", async () => {
  const { mod, prefs, toasts } = loadActionable({ focused: true });
  await prefs.refresh(true);
  let opened = 0;
  let affirmed = 0;
  mod.raiseActionable("draft_reply", { ...ASK, onOpen: () => { opened += 1; }, onAffirm: () => { affirmed += 1; } });
  const { openId } = toasts[0].payload;
  assert.equal(mod.openFromToast(openId), true);
  assert.equal(opened, 1);
  assert.equal(mod.openFromToast(openId), false, "one-shot: a second press finds nothing");
  assert.equal(opened, 1);
  assert.equal(affirmed, 0, "⚠ the toast can NEVER reach the affirmative");
});

test("an unknown Open handle is simply false", async () => {
  const { mod, prefs } = loadActionable({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.openFromToast("open-999"), false);
  assert.equal(mod.openFromToast(""), false);
});

test("focused with no window to toast into falls back to the banner, never to nothing", async () => {
  const { mod, prefs, built } = loadActionable({ focused: true, windows: 0 });
  await prefs.refresh(true);
  assert.ok(mod.raiseActionable("peer_ask", ASK));
  assert.equal(built.length, 1, "asking nobody is not an option");
});

test("a muted actionable event raises nothing — but approval cannot be muted", async () => {
  const { mod, prefs, built, toasts } = loadActionable({ focused: false, off: ["peer_ask"] });
  await prefs.refresh(true);
  assert.equal(mod.raiseActionable("peer_ask", ASK), null);
  assert.equal(built.length + toasts.length, 0);
});

// ─── COALESCING ───────────────────────────────────────────────────────────────────────────────

test("a burst raises ONE notice, naming the total", async () => {
  const { mod, prefs, banners } = loadActionable({ focused: false });
  await prefs.refresh(true);
  const built = [];
  assert.equal(mod.raiseCoalesced("agent_started", (n) => { built.push(n); return { title: `${n} agents started` }; }, 5), "opened");
  for (let i = 0; i < 9; i++) {
    assert.equal(mod.raiseCoalesced("agent_started", () => ({ title: "x" }), 5), "coalesced");
  }
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(built, [10], "ten launches, one notice, counted");
  assert.equal(banners.length, 1, "⚠ ten banners for one intention is worse than none");
  assert.equal(banners[0].opts.title, "10 agents started");
});

test("a single arrival still raises, and the window reopens after it fires", async () => {
  const { mod, prefs, banners } = loadActionable({ focused: false });
  await prefs.refresh(true);
  mod.raiseCoalesced("agent_started", (n) => ({ title: `${n} started` }), 5);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(banners.length, 1);
  // A later burst is a NEW window, not a swallowed one.
  assert.equal(mod.raiseCoalesced("agent_started", (n) => ({ title: `${n} again` }), 5), "opened");
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(banners.length, 2);
  assert.equal(banners[1].opts.title, "1 again");
});

test("the switch is read when the window FIRES, not when it opened", async () => {
  const ctx = loadActionable({ focused: false });
  await ctx.prefs.refresh(true);
  ctx.mod.raiseCoalesced("agent_started", (n) => ({ title: `${n} started` }), 20);
  // The operator mutes it while the burst is still filling: the later answer is the true one.
  ctx.record.off = ["agent_started"];
  await ctx.prefs.refresh(true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ctx.banners.length, 0, "muted mid-burst means no notice");
});

test("a build that throws cannot escape into the launch that triggered it", async () => {
  const { mod, prefs } = loadActionable({ focused: false });
  await prefs.refresh(true);
  mod.raiseCoalesced("agent_started", () => { throw new Error("bad copy"); }, 5);
  await new Promise((r) => setTimeout(r, 25));
  // Nothing thrown here, and the window is free again.
  assert.equal(mod.raiseCoalesced("agent_started", (n) => ({ title: `${n}` }), 5), "opened");
});

test("SOURCE PIN: the launch funnel raises agent_started, and only after it has a session", () => {
  const src = readFileSync(join(MAIN, "session-launch.js"), "utf8");
  // ⚠ The emit is wrapped in try/catch (a notice may never change whether a launch succeeded),
  // which also means a stubbed-require failure is SWALLOWED in the harnesses. So the wiring is
  // pinned here, at the source, rather than observed through them.
  assert.match(src, /raiseCoalesced\('agent_started'/);
  const skipDisabled = src.indexOf("return { skipped: 'disabled' }");
  const skipAuth = src.indexOf("return { skipped: 'auth-hold' }");
  const emit = src.indexOf("raiseCoalesced('agent_started'");
  assert.ok(skipDisabled > 0 && skipAuth > 0 && emit > 0, "all three landmarks found");
  assert.ok(emit > skipDisabled && emit > skipAuth,
    "a refused launch must never claim an agent started");
});

test("a click handler that throws (window gone) does not escape", async () => {
  // ⚠ THIS GUARANTEE MOVED HERE on 2026-10-09 from `consent.js › notifyDecisionFailed`, which
  // used to attach and wrap its own click. The route owns every passive banner's click now, so
  // it owns the wrapping: a handler that throws because the window is gone must not escape into
  // whatever is running when the operator presses a banner.
  const { mod, prefs, banners, logs } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise("mention", { ...SPEC, onClick: () => { throw new Error("window gone"); } });
  assert.doesNotThrow(() => banners[0].handlers.click());
  assert.ok(logs.some((l) => /click handler failed/.test(l)), "and it is reported, not swallowed silently");
});

// ─── THE RESUME OFFER ─────────────────────────────────────────────────────────────────────────

const RESUME = { title: "Resume session", body: "A Dopl session was interrupted." };

test("the resume offer is a STICKY popup whose button resumes", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  let resumed = 0;
  assert.equal(mod.raiseResumeOffer({ ...RESUME, onResume: () => { resumed += 1; } }), "popup");
  assert.equal(banners.length, 0, "popup only: it fires at launch, he is already looking");
  const p = toasts[0].payload;
  assert.equal(p.actionLabel, "Resume");
  assert.equal(p.sticky, true, "raised ONCE at startup — a 4-second offer would be lost");
  assert.equal(mod.openFromToast(p.openId), true);
  assert.equal(resumed, 1);
  assert.equal(mod.openFromToast(p.openId), false, "one-shot, so two presses cannot resume twice");
  assert.equal(resumed, 1);
});

test("⚠ it may act where Send and Allow may not, and that is not a precedent", async () => {
  // The resume starts the operator's OWN parked agent, like the New Agent button: no consent row
  // is answered, nothing is auto-denied if it is missed, and ignoring it leaves the session
  // parked — exactly today's behaviour. The consent-class affirmatives stay on the banner.
  const { mod, prefs, toasts } = load({ focused: true });
  await prefs.refresh(true);
  mod.raiseResumeOffer({ ...RESUME, onResume: () => {} });
  mod.raiseActionable?.("peer_ask", { title: "Design", body: "x", actionText: "Launch agent", onAffirm: () => {}, onOpen: () => {} });
  for (const t of toasts) {
    assert.equal(t.payload.actionText, undefined, "no affirmative label ever crosses");
    assert.ok(["Resume", "Open"].includes(t.payload.actionLabel), t.payload.actionLabel);
  }
});

test("with no window to toast into, the offer falls back to the banner", async () => {
  const { mod, prefs, banners } = load({ focused: true, windows: 0 });
  await prefs.refresh(true);
  let resumed = 0;
  assert.equal(mod.raiseResumeOffer({ ...RESUME, onResume: () => { resumed += 1; } }), "mac");
  assert.equal(banners.length, 1, "starting hidden in the tray must not lose the offer");
  banners[0].handlers.click();
  assert.equal(resumed, 1, "and the banner's click resumes, as it always did");
});

test("a muted resume offer raises nothing, and a malformed one is refused", async () => {
  const muted = load({ focused: true, off: ["session_resume"] });
  await muted.prefs.refresh(true);
  assert.equal(muted.mod.raiseResumeOffer({ ...RESUME, onResume: () => {} }), "none");
  assert.equal(muted.toasts.length, 0);

  const ok = load({ focused: true });
  await ok.prefs.refresh(true);
  assert.equal(ok.mod.raiseResumeOffer({ ...RESUME }), "none", "no onResume is nothing to offer");
  assert.equal(ok.mod.raiseResumeOffer({ onResume: () => {} }), "none", "and no title is nothing to show");
});

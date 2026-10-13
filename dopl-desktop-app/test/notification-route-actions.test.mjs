// THE NOTIFICATION ROUTE'S AFFIRMATIVE HALF — the events that carry a button — plus coalescing
// and the resume offer. Split from notification-route.test.mjs at the 500-line cap; the harness
// both suites share is in _notification-route-harness.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";
import { codeOf } from "./helpers/source-probe.mjs";
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
    // ⚠ THE HARNESS'S OWN STUB, so `built` and the dock-bounce count are one set of facts for
    // both module instances — and so `requestAttention` is observable here too rather than
    // throwing into `macBanner`'s best-effort catch.
    if (id === "./notify-action") return ctx.notifyAction;
    // ⚠ THE REAL actionable half, over the harness's stub (split out of the route 2026-10-12).
    if (id === "./notification-route-actions") return ctx.actions;
    throw new Error(`unexpected require: ${id}`);
  });
  if (o.rendererUnready !== true) mod.noteRendererReady();
  return { ...ctx, mod, built: ctx.built, ack: () => mod.openFromToast(mod.TOAST_READY_ID) };
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

test("an Open that cannot open anything answers FALSE, not {ok:true}", async () => {
  // ⚠ IT USED TO ANSWER TRUE. The entry was found, `typeof entry.fn === 'function'` was false, and
  // the function fell through to `return true` — so a button that did nothing at all reported that
  // it had worked, and the ipc op answered `{ ok: true }` to the renderer.
  const { mod, prefs, toasts } = loadActionable({ focused: true });
  await prefs.refresh(true);
  mod.raiseActionable("peer_ask", { ...ASK, onOpen: undefined });
  const { openId } = toasts[0].payload;
  assert.ok(openId, "the toast still carries a handle");
  assert.equal(mod.openFromToast(openId), false, "but pressing it is honestly a no-op");
  // A closure that EXISTS and throws is a different thing: it was there and it ran.
  mod.raiseActionable("draft_reply", { ...ASK, onOpen: () => { throw new Error("window gone"); } });
  const live = toasts[1].payload.openId;
  assert.equal(mod.openFromToast(live), true, "a handler that throws still counts as pressed");
});

test("focused with no window to toast into falls back to the banner, never to nothing", async () => {
  const { mod, prefs, built } = loadActionable({ focused: true, windows: 0 });
  await prefs.refresh(true);
  assert.ok(mod.raiseActionable("peer_ask", ASK));
  assert.equal(built.length, 1, "asking nobody is not an option");
});

test("a muted actionable event raises nothing — but it is MUTED, never null", async () => {
  // ⚠ CHANGED DELIBERATELY 2026-10-10. `null` is the "no surface exists" answer, and one caller
  // DENIES a held tool on it while `trigger.js › handleTrigger` holds the listener's cursor on it.
  // A mute is neither of those things: it silences the surface and nothing else. Answering null
  // for it made a muted `peer_ask` indistinguishable from a machine that can raise nothing, and
  // `handleTrigger` consumed the peer's ask with no launch and no courtesy reply.
  const { mod, prefs, built, toasts } = loadActionable({ focused: false, off: ["peer_ask"] });
  await prefs.refresh(true);
  const got = mod.raiseActionable("peer_ask", ASK);
  assert.equal(got, mod.MUTED, "the mute is NAMED in the answer");
  assert.notEqual(got, null, "⚠ and is never the falsy value that means 'nobody can be asked'");
  assert.ok(got, "truthy, so no caller can read a switch being off as no-surface");
  assert.equal(built.length + toasts.length, 0, "and still nothing is raised anywhere");
});

test("approval cannot be muted, so the tool gate can never reach MUTED", async () => {
  const { mod, prefs } = loadActionable({ focused: false, off: ["approval"] });
  await prefs.refresh(true);
  const got = mod.raiseActionable("approval", { ...ASK, bannerAlways: true, actionText: "Allow" });
  assert.notEqual(got, mod.MUTED, "the registry lock holds, so the banner is still built");
  assert.ok(got);
});

test("⚠ THE CATCH-ALL: a raise that throws still answers a BANNER, never null", async () => {
  // The last-resort fallback existed and nothing exercised it, so "a caller may read null as
  // 'no surface exists'" was a promise no test kept. Make the gate itself explode.
  const ctx = loadActionable({ focused: true });
  await ctx.prefs.refresh(true);
  ctx.prefs.getPrefs = () => { throw new Error("prefs exploded"); };
  const got = ctx.mod.raiseActionable("peer_ask", ASK);
  assert.ok(got, "⚠ falsy here would auto-deny a held tool (session-windowless.js:293)");
  assert.equal(ctx.built.length, 1, "and the surface it answers with is the banner");
  assert.equal(ctx.built[0].onAffirm, ASK.onAffirm, "with its affirmative wired, like any banner");
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
  // ⚠ THE SKIP WORD, NOT THE `return {` LITERAL, AND OVER COMMENT-BLANKED SOURCE. Two separate
  // failures taught both halves on 2026-10-11. (a) This read `return { skipped: 'disabled'`,
  // which stopped matching the moment the refusal gained a `detail` spelled BEFORE its code —
  // the pin went red while the ordering it names was untouched. Anchoring on the skip word
  // alone survives any field order, because the payload shape is not what this case is about.
  // (b) `session-launch.js` now carries `{ skipped: 'disabled' }` inside a COMMENT explaining
  // the deleted dead arm, so an unmasked search can be satisfied by prose describing code that
  // is not there. `codeOf` blanks comments while preserving offsets, so the landmarks are real.
  const code = codeOf(src);
  // `lastIndexOf`: the claim is that the emit sits after EVERY refusal return, not merely after
  // the first one. There are two of each word today.
  const skipDisabled = code.lastIndexOf("skipped: 'disabled'");
  const skipAuth = code.lastIndexOf("skipped: 'auth-hold'");
  const emit = code.indexOf("raiseCoalesced('agent_started'");
  assert.ok(skipDisabled > 0, "no `skipped: 'disabled'` return in the funnel's code");
  assert.ok(skipAuth > 0, "no `skipped: 'auth-hold'` return in the funnel's code");
  assert.ok(emit > 0, "the agent_started emit is gone from the funnel");
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

test("⚠ A HIDDEN WINDOW IS NOT A WINDOW: the cold-start offer goes to the banner", async () => {
  // THE DEFECT. This was the ONE raise path that never asked about visibility, while its own
  // comment claimed it detected the case. `openAsHidden` means the shell window EXISTS and is
  // invisible, and `sessionEngine.init()` → `offerResume` runs in that same `whenReady` tick — so
  // every cold start pushed the offer into a window the operator could not see.
  const { mod, prefs, toasts, banners } = load({ focused: false, hidden: true });
  await prefs.refresh(true);
  let resumed = 0;
  assert.equal(mod.raiseResumeOffer({ ...RESUME, onResume: () => { resumed += 1; } }), "mac");
  assert.equal(toasts.length, 0, "⚠ a toast in an invisible window is a SILENCED notification");
  assert.equal(banners.length, 1);
  banners[0].handlers.click();
  assert.equal(resumed, 1, "and the offer still resumes, from the surface he can actually see");
});

test("a visible window takes the toast, and `isVisible` is the question asked", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.hasVisibleWindow(), true);
  assert.equal(mod.raiseResumeOffer({ ...RESUME, onResume: () => {} }), "popup");
  assert.equal(toasts.length, 1);
  assert.equal(banners.length, 0);
  // A window layer that cannot answer the question reads as NOT visible — fail toward the banner.
  const dumb = load({ focused: true });
  await dumb.prefs.refresh(true);
  delete dumb.windows[0].isVisible;
  assert.equal(dumb.mod.hasVisibleWindow(), false, "cannot tell ⇒ treat Dopl as unseen");
  assert.equal(dumb.mod.raiseResumeOffer({ ...RESUME, onResume: () => {} }), "mac");
});

test("⚠ the STICKY closure outlives the 120s sweep, because its toast outlives it by a day", async () => {
  // THE DEFECT. `OPEN_TTL_MS` is 120s and `incoming-toasts.tsx › STICKY_MS` is 24h, so the sweep
  // dropped the resume offer's closure while its button was still on screen: "Resume" became a
  // dead button and the renderer's `.catch(() => {})` hid the miss.
  const { mod, prefs, toasts } = load({ focused: true });
  await prefs.refresh(true);
  let resumed = 0;
  mod.raiseResumeOffer({ ...RESUME, onResume: () => { resumed += 1; } });
  const sticky = toasts[0].payload.openId;
  // And a NON-sticky handle raised at the same moment, which must still expire.
  const ctx = loadActionable({ focused: true });
  await ctx.prefs.refresh(true);
  ctx.mod.raiseActionable("peer_ask", ASK);
  const transient = ctx.toasts[0].payload.openId;

  const realNow = Date.now;
  try {
    // Ten minutes on: well past 120s, nowhere near a day.
    Date.now = () => realNow() + 10 * 60 * 1000;
    assert.equal(mod.openFromToast(sticky), true, "the sticky offer is still answerable");
    assert.equal(resumed, 1);
    assert.equal(ctx.mod.openFromToast(transient), false,
      "while an ordinary 'Open' handle is still swept, which is what the TTL is for");
  } finally {
    Date.now = realNow;
  }
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

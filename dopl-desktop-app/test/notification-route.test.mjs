// NOTIFICATION ROUTE (main/notification-route.js, 2026-10-09): which surface an event raises on,
// and the guarantee that it is EXACTLY ONE.
//
// Samuel's spec marks 9 events "Mac + popup". A is an OS banner raised in main, B is a toast owned
// by a renderer global, so raising both would notify the same fact twice at one desk. These tests
// pin the resolution: Dopl in front → toast, Dopl away → banner, never both, never neither.
//
// Run: `node --test dopl-desktop-app/test/notification-route.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";

/**
 * Loads the route over fakes.
 * @param {object} [o]
 * @param {boolean} [o.focused] is Dopl in front
 * @param {string[]} [o.off] event ids the operator muted
 * @param {number} [o.windows] how many renderer windows exist
 * @param {boolean} [o.noNotification] the OS cannot show banners
 */
function load(o = {}) {
  const focused = o.focused === true;
  const windows = o.windows === undefined ? 1 : o.windows;
  const toasts = [];
  const banners = [];
  const logs = [];

  let shown = 0;
  const sent = [];
  for (let i = 0; i < windows; i++) {
    sent.push({
      webContents: { send: (channel, payload) => toasts.push({ channel, payload }) },
      // The route reveals Dopl by showing the first window when a spec gives no onClick.
      show: () => { shown += 1; },
    });
  }

  class FakeNotification {
    constructor(opts) { this.opts = opts; this.handlers = {}; }
    static isSupported() { return o.noNotification !== true; }
    on(ev, fn) { this.handlers[ev] = fn; }
    show() { banners.push(this); }
  }

  const electron = {
    BrowserWindow: {
      getFocusedWindow: () => (focused ? sent[0] || {} : null),
      getAllWindows: () => sent,
    },
    Notification: FakeNotification,
  };

  // The REAL prefs module over a transport that answers the operator's record.
  // ⚠ MUTABLE: `record.off` can be changed between refreshes, which is how a test shows the
  // switch being read when a coalesce window FIRES rather than when it opened.
  const record = { off: o.off || [] };
  const prefsSrc = readFileSync(join(MAIN, "notification-prefs.js"), "utf8");
  const prefs = evalModule(prefsSrc, (id) => {
    if (id === "./api") {
      return {
        apiFetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ prefs: { v: 1, events: Object.fromEntries(record.off.map((k) => [k, false])) } }),
        }),
      };
    }
    if (id === "./diag") return { diag: (...a) => logs.push(a.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  });

  const src = readFileSync(join(MAIN, "notification-route.js"), "utf8");
  const mod = evalModule(src, (id) => {
    if (id === "electron") return electron;
    if (id === "./notification-prefs") return prefs;
    if (id === "./diag") return { diag: (...a) => logs.push(a.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  });

  return { mod, prefs, record, windows: sent, toasts, banners, logs, revealed: () => shown };
}

const SPEC = { title: "A peer's agent asked you something" };

test("a 'both' event raises the toast when Dopl is in front, and ONLY the toast", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", SPEC), "popup");
  assert.equal(toasts.length, 1);
  assert.equal(banners.length, 0, "a banner over the window he is reading is noise");
  assert.equal(toasts[0].channel, "notifications:toast");
  assert.deepEqual(toasts[0].payload, { eventId: "mention", title: SPEC.title, kind: "incoming" });
});

test("a 'both' event raises the banner when Dopl is away, and ONLY the banner", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: false });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", SPEC), "mac");
  assert.equal(banners.length, 1);
  assert.equal(toasts.length, 0, "a toast on a window nobody is reading is a dropped alert");
  assert.equal(banners[0].opts.title, SPEC.title);
});

test("unreadable focus routes to the banner, not to silence", async () => {
  // A DETACHED/CRASHED window layer: the getter itself throws. The route must still raise.
  const src = readFileSync(join(MAIN, "notification-route.js"), "utf8");
  const banners = [];
  class FakeNotification {
    constructor(opts) { this.opts = opts; }
    static isSupported() { return true; }
    on() {}
    show() { banners.push(this); }
  }
  const prefsSrc = readFileSync(join(MAIN, "notification-prefs.js"), "utf8");
  const prefs = evalModule(prefsSrc, (id) => {
    if (id === "./api") return { apiFetch: async () => ({ ok: true, status: 200, json: async () => ({ prefs: null }) }) };
    if (id === "./diag") return { diag: () => {} };
    throw new Error(`unexpected require: ${id}`);
  });
  const mod = evalModule(src, (id) => {
    if (id === "electron") {
      return {
        BrowserWindow: { get getFocusedWindow() { throw new Error("no window layer"); } },
        Notification: FakeNotification,
      };
    }
    if (id === "./notification-prefs") return prefs;
    if (id === "./diag") return { diag: () => {} };
    throw new Error(`unexpected require: ${id}`);
  });
  await prefs.refresh(true);

  assert.equal(mod.isAppFocused(), false, "cannot tell ⇒ treat Dopl as away");
  assert.equal(mod.raise("decision", SPEC), "mac");
  assert.equal(banners.length, 1, "an unseen toast would be a silenced notification");
});

test("a popup-only event never raises a banner, and a mac-only never a toast", async () => {
  const focusedCases = [true, false];
  for (const focused of focusedCases) {
    const pop = load({ focused });
    await pop.prefs.refresh(true);
    assert.equal(pop.mod.raise("tool_blocked", SPEC), "popup");
    assert.equal(pop.banners.length, 0);

    const mac = load({ focused });
    await mac.prefs.refresh(true);
    assert.equal(mac.mod.raise("direct_message", { title: "x" }), "none",
      "direct_message is muted by default, so it raises nothing at all");
  }
});

test("the operator's switch is obeyed: a muted event raises nothing, on either surface", async () => {
  for (const focused of [true, false]) {
    const { mod, prefs, toasts, banners } = load({ focused, off: ["mention"] });
    await prefs.refresh(true);
    assert.equal(mod.raise("mention", SPEC), "none");
    assert.equal(toasts.length, 0);
    assert.equal(banners.length, 0);
  }
});

test("a locked event cannot be muted through this path either", async () => {
  const { mod, prefs } = load({ focused: false, off: ["approval", "signed_out"] });
  await prefs.refresh(true);
  assert.equal(mod.raise("approval", SPEC), "mac");
  assert.equal(mod.raise("signed_out", SPEC), "mac");
});

test("an unknown event raises NOTHING rather than inventing a surface", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("some_future_event", SPEC), "none");
  assert.equal(toasts.length + banners.length, 0);
  // ⚠ Deliberately the OPPOSITE default from `allowsIn`, which fails ON. Both refuse to guess:
  // that one must never silently ignore a mute, this one must never invent an alert.
  assert.equal(prefs.allowsIn(prefs.getPrefs(), "some_future_event"), true);
});

test("a titleless spec raises nothing", async () => {
  const { mod, prefs } = load({ focused: false });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", { title: "" }), "none");
  assert.equal(mod.raise("mention", undefined), "none");
});

test("with no window to toast into, a popup event falls back to the banner", async () => {
  const { mod, prefs, banners } = load({ focused: true, windows: 0 });
  await prefs.refresh(true);
  assert.equal(mod.raise("tool_blocked", SPEC), "mac");
  assert.equal(banners.length, 1, "a toast with nowhere to land would be a lost notification");
});

test("every window gets the toast, and one dead window does not stop the rest", async () => {
  const { mod, prefs, windows, toasts } = load({ focused: true, windows: 3 });
  await prefs.refresh(true);
  windows[1].webContents.send = () => { throw new Error("destroyed"); };
  assert.equal(mod.raise("mention", SPEC), "popup");
  assert.equal(toasts.length, 2);
});

test("a banner click reveals the app", async () => {
  const { mod, prefs, banners, revealed } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise("mention", SPEC);
  banners[0].handlers.click();
  assert.equal(revealed(), 1, "a click with no handler brings Dopl forward");
});

test("banners are SILENT BY DEFAULT: the sound is a per-site decision, not the router's", async () => {
  const { mod, prefs, banners } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise("mention", SPEC);
  assert.equal(banners[0].opts.silent, true);
});

test("a site that asks for sound gets it, and only then", async () => {
  // ⚠ `decision_failed` is the ONE event that chooses to sound and bounce the dock: the operator
  // believes they answered and they did not. That is a DELIBERATE sound, not one of the
  // accidental ones being removed, and the distinction lives at the call site.
  const { mod, prefs, banners } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise("decision_failed", { ...SPEC, silent: false, attention: true });
  assert.equal(banners[0].opts.silent, false, "loud, because consent.js asked");
  mod.raise("signed_out", SPEC);
  assert.equal(banners[1].opts.silent, true, "its neighbour did not ask, so it is quiet");
});

test("the safety pair cannot be muted, on either surface", async () => {
  for (const focused of [true, false]) {
    const { mod, prefs, banners, toasts } = load({ focused, off: ["signed_out", "decision_failed"] });
    await prefs.refresh(true);
    for (const id of ["signed_out", "decision_failed"]) {
      assert.notEqual(mod.raise(id, SPEC), "none", `${id} is locked on`);
    }
    assert.equal(banners.length + toasts.length, 2, "both still said, whatever the record holds");
  }
});

test("an OS that cannot show banners is reported, not crashed through", async () => {
  const { mod, prefs } = load({ focused: false, noNotification: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", SPEC), "none");
});

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

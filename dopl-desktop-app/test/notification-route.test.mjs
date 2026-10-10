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
  const off = o.off || [];
  const prefsSrc = readFileSync(join(MAIN, "notification-prefs.js"), "utf8");
  const prefs = evalModule(prefsSrc, (id) => {
    if (id === "./api") {
      return {
        apiFetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ prefs: { v: 1, events: Object.fromEntries(off.map((k) => [k, false])) } }),
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

  return { mod, prefs, windows: sent, toasts, banners, logs, revealed: () => shown };
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

test("banners are silent: the sound is a per-site decision, not the router's", async () => {
  const { mod, prefs, banners } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise("mention", SPEC);
  assert.equal(banners[0].opts.silent, true);
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
        Notification: class {
          static isSupported() { return true; }
          on() {} show() {}
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

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

  const sent = [];
  for (let i = 0; i < windows; i++) {
    sent.push({ webContents: { send: (channel, payload) => toasts.push({ channel, payload }) } });
  }
  let shown = 0;
  const host = { getWindows: () => sent, showWindow: () => { shown += 1; } };

  class FakeNotification {
    constructor(opts) { this.opts = opts; this.handlers = {}; }
    static isSupported() { return o.noNotification !== true; }
    on(ev, fn) { this.handlers[ev] = fn; }
    show() { banners.push(this); }
  }

  const electron = {
    BrowserWindow: { getFocusedWindow: () => (focused ? sent[0] || {} : null) },
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

  return { mod, prefs, host, toasts, banners, logs, clicked: () => shown };
}

const SPEC = { title: "A peer's agent asked you something" };

test("a 'both' event raises the toast when Dopl is in front, and ONLY the toast", async () => {
  const { mod, prefs, host, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "mention", SPEC), "popup");
  assert.equal(toasts.length, 1);
  assert.equal(banners.length, 0, "a banner over the window he is reading is noise");
  assert.equal(toasts[0].channel, "notifications:toast");
  assert.deepEqual(toasts[0].payload, { eventId: "mention", title: SPEC.title, kind: "incoming" });
});

test("a 'both' event raises the banner when Dopl is away, and ONLY the banner", async () => {
  const { mod, prefs, host, toasts, banners } = load({ focused: false });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "mention", SPEC), "mac");
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
  assert.equal(mod.raise({ getWindows: () => [] }, "decision", SPEC), "mac");
  assert.equal(banners.length, 1, "an unseen toast would be a silenced notification");
});

test("a popup-only event never raises a banner, and a mac-only never a toast", async () => {
  const focusedCases = [true, false];
  for (const focused of focusedCases) {
    const pop = load({ focused });
    await pop.prefs.refresh(true);
    assert.equal(pop.mod.raise(pop.host, "tool_blocked", SPEC), "popup");
    assert.equal(pop.banners.length, 0);

    const mac = load({ focused });
    await mac.prefs.refresh(true);
    assert.equal(mac.mod.raise(mac.host, "direct_message", { title: "x" }), "none",
      "direct_message is muted by default, so it raises nothing at all");
  }
});

test("the operator's switch is obeyed: a muted event raises nothing, on either surface", async () => {
  for (const focused of [true, false]) {
    const { mod, prefs, host, toasts, banners } = load({ focused, off: ["mention"] });
    await prefs.refresh(true);
    assert.equal(mod.raise(host, "mention", SPEC), "none");
    assert.equal(toasts.length, 0);
    assert.equal(banners.length, 0);
  }
});

test("a locked event cannot be muted through this path either", async () => {
  const { mod, prefs, host } = load({ focused: false, off: ["approval", "signed_out"] });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "approval", SPEC), "mac");
  assert.equal(mod.raise(host, "signed_out", SPEC), "mac");
});

test("an unknown event raises NOTHING rather than inventing a surface", async () => {
  const { mod, prefs, host, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "some_future_event", SPEC), "none");
  assert.equal(toasts.length + banners.length, 0);
  // ⚠ Deliberately the OPPOSITE default from `allowsIn`, which fails ON. Both refuse to guess:
  // that one must never silently ignore a mute, this one must never invent an alert.
  assert.equal(prefs.allowsIn(prefs.getPrefs(), "some_future_event"), true);
});

test("a titleless spec raises nothing", async () => {
  const { mod, prefs, host } = load({ focused: false });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "mention", { title: "" }), "none");
  assert.equal(mod.raise(host, "mention", undefined), "none");
});

test("with no window to toast into, a popup event falls back to the banner", async () => {
  const { mod, prefs, host, banners } = load({ focused: true, windows: 0 });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "tool_blocked", SPEC), "mac");
  assert.equal(banners.length, 1, "a toast with nowhere to land would be a lost notification");
});

test("every window gets the toast, and one dead window does not stop the rest", async () => {
  const { mod, prefs, host, toasts } = load({ focused: true, windows: 3 });
  await prefs.refresh(true);
  host.getWindows()[1].webContents.send = () => { throw new Error("destroyed"); };
  assert.equal(mod.raise(host, "mention", SPEC), "popup");
  assert.equal(toasts.length, 2);
});

test("a banner click reveals the app", async () => {
  const { mod, prefs, host, banners, clicked } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise(host, "mention", SPEC);
  banners[0].handlers.click();
  assert.equal(clicked(), 1);
});

test("banners are silent: the sound is a per-site decision, not the router's", async () => {
  const { mod, prefs, host, banners } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise(host, "mention", SPEC);
  assert.equal(banners[0].opts.silent, true);
});

test("an OS that cannot show banners is reported, not crashed through", async () => {
  const { mod, prefs, host } = load({ focused: false, noNotification: true });
  await prefs.refresh(true);
  assert.equal(mod.raise(host, "mention", SPEC), "none");
});

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
import { load } from "./_notification-route-harness.mjs";
// The TTL the growth guard runs time past — read from the module, never retyped as a number.
import { createRequire as _cr } from "node:module";
const { OPEN_TTL_MS } = _cr(import.meta.url)("../main/notification-route-actions.js");

/**
 * Loads the route over fakes.
 * @param {object} [o]
 * @param {boolean} [o.focused] is Dopl in front
 * @param {string[]} [o.off] event ids the operator muted
 * @param {number} [o.windows] how many renderer windows exist
 * @param {boolean} [o.noNotification] the OS cannot show banners
 */
const SPEC = { title: "A peer's agent asked you something" };

test("a 'both' event raises the toast when Dopl is in front, and ONLY the toast", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", SPEC), "popup");
  assert.equal(toasts.length, 1);
  assert.equal(banners.length, 0, "a banner over the window he is reading is noise");
  assert.equal(toasts[0].channel, "notifications:toast");
  // ⚠ UPDATED DELIBERATELY 2026-10-10: `body` now rides along (it was dropped). `SPEC` carries
  // none, so the shape is unchanged here — the case that pins the body is the next test.
  assert.deepEqual(toasts[0].payload, { eventId: "mention", title: SPEC.title, kind: "incoming" });
});

test("THE BODY RIDES THE TOAST: a popup event's second line is not dropped", async () => {
  // Dropping `spec.body` made a mention toast say only the channel name, cost `decision_failed`
  // its recovery sentence, and left POPUP-ONLY `tool_blocked` — whose only surface is this one —
  // with no reachable body at all.
  const { mod, prefs, toasts } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", { title: "Design", body: "Ada mentioned you: ship it" }), "popup");
  assert.deepEqual(toasts[0].payload, {
    eventId: "mention", title: "Design", body: "Ada mentioned you: ship it", kind: "incoming",
  });

  const blocked = load({ focused: false });
  await blocked.prefs.refresh(true);
  assert.equal(blocked.mod.raise("tool_blocked", { title: "Bash blocked", body: "ask again to allow it" }), "popup");
  assert.equal(blocked.toasts[0].payload.body, "ask again to allow it",
    "popup-only: if this is dropped the body is unreachable on every surface");
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
    // ⚠ THE REAL actionable half (split out of the route 2026-10-12). Built over the same prefs,
    // not faked: the route constructs its one instance from this at module scope, so a stub that
    // answered nothing would simply crash the load.
    if (id === "./notification-route-actions") {
      return evalModule(readFileSync(join(MAIN, "notification-route-actions.js"), "utf8"), (sub) => {
        if (sub === "./notification-prefs") return prefs;
        if (sub === "./diag") return { diag: () => {} };
        throw new Error(`unexpected require: ${sub}`);
      });
    }
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

    const off = load({ focused });
    await off.prefs.refresh(true);
    assert.equal(off.mod.raise("direct_message", { title: "x" }), "none",
      "direct_message is muted by default, so it raises nothing at all");

    // ⚠ THE SECOND HALF OF THIS TEST'S OWN NAME, WHICH IT NEVER ASSERTED (2026-10-10). It read
    // only the default-off case, so `mac.toasts` was never looked at and `direct_message` — the
    // ONE 'mac' row in the surface map — could have been routed to a toast while Dopl was in
    // front without a single test noticing. Turn it ON in the record and read both surfaces.
    const mac = load({ focused, on: ["direct_message"] });
    await mac.prefs.refresh(true);
    assert.equal(mac.mod.raise("direct_message", { title: "A direct message" }), "mac");
    assert.equal(mac.banners.length, 1, `focused=${focused}: a 'mac' event is the OS banner`);
    assert.equal(mac.toasts.length, 0, `focused=${focused}: and never the toast, focus or not`);
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
  const { mod, prefs, banners, counts } = load({ focused: false });
  await prefs.refresh(true);
  mod.raise("decision_failed", { ...SPEC, silent: false, attention: true });
  assert.equal(banners[0].opts.silent, false, "loud, because consent.js asked");
  // ⚠ AND THE DOCK BOUNCE IS OBSERVED, NOT ASSUMED (2026-10-10). `macBanner` calls
  // `requestAttention` inside a best-effort try/catch, and `./notify-action` was UNSTUBBED in the
  // harness: the require threw, the catch swallowed it, and a typo in that call would have
  // shipped green with every test passing.
  assert.equal(counts.attention, 1, "`attention: true` bounces the dock, exactly once");
  mod.raise("signed_out", SPEC);
  assert.equal(banners[1].opts.silent, true, "its neighbour did not ask, so it is quiet");
  assert.equal(counts.attention, 1, "and a neighbour that did not ask does not bounce it");
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

// ─── SENT IS NOT DELIVERED ────────────────────────────────────────────────────────────────────
//
// `webContents.send` does not throw into a window whose renderer has not mounted `IncomingToasts`
// yet, so `sent === 1` was true for a push nobody could ever see — and the `sent === 0` banner
// fallback never ran. A toast is HELD until the renderer acks, and the banner takes it without one.

test("a toast pushed before the renderer acks is HELD, not counted as delivered", async () => {
  const { mod, prefs, toasts, banners } = load({ focused: true, rendererUnready: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", SPEC), "popup");
  assert.equal(toasts.length, 0, "⚠ an unmounted renderer must not be told it was sent to");
  assert.equal(banners.length, 0, "and the banner waits its turn rather than doubling up");
});

test("the renderer's ack flushes everything held for it, over the op the real one rides", async () => {
  const { mod, prefs, toasts, ack } = load({ focused: true, rendererUnready: true });
  await prefs.refresh(true);
  mod.raise("mention", { title: "first" });
  mod.raise("decision", { title: "second" });
  assert.equal(toasts.length, 0);
  assert.equal(ack(), true, "the ack rides `openFromToast` with main's reserved handle");
  assert.deepEqual(toasts.map((t) => t.payload.title), ["first", "second"], "in order, both of them");
  // Once acked, a later toast goes straight out.
  mod.raise("mention", { title: "third" });
  assert.equal(toasts.length, 3);
});

test("NO ACK, NO TOAST: the OS banner takes it rather than the offer being lost", async () => {
  const { mod, prefs, toasts, banners, logs } = load({ focused: true, rendererUnready: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", SPEC), "popup");
  await new Promise((r) => setTimeout(r, mod.ACK_WAIT_MS + 40));
  assert.equal(toasts.length, 0, "nothing was ever shown in the window");
  assert.equal(banners.length, 1, "⚠ THE WHOLE POINT: the fact is not lost, it changes surface");
  assert.ok(logs.some((l) => /no renderer ack/.test(l)), "and it says so, rather than hiding it");
});

test("a late ack after the banner already took it does not raise a second time", async () => {
  const { mod, prefs, toasts, banners, ack } = load({ focused: true, rendererUnready: true });
  await prefs.refresh(true);
  mod.raise("mention", SPEC);
  await new Promise((r) => setTimeout(r, mod.ACK_WAIT_MS + 40));
  assert.equal(banners.length, 1);
  assert.equal(ack(), true);
  assert.equal(toasts.length, 0, "the held entry is spent; one fact, one surface, still");
  assert.equal(banners.length, 1);
});

test("a window that goes away forgets the ack: the next one starts unmounted", async () => {
  const ctx = load({ focused: true });
  await ctx.prefs.refresh(true);
  assert.equal(ctx.mod.raise("mention", SPEC), "popup");
  assert.equal(ctx.toasts.length, 1);
  // Every window closes, then a new one opens — a fresh renderer that has not acked.
  const gone = ctx.windows.splice(0, ctx.windows.length);
  assert.equal(ctx.mod.raise("mention", SPEC), "mac", "no window at all: the banner, immediately");
  ctx.windows.push(gone[0]);
  ctx.mod.raise("mention", { title: "into the new window" });
  assert.equal(ctx.toasts.length, 1, "⚠ a stale ack must not vouch for a renderer that just booted");
});


// ── THE PLAIN TOAST CARRIES ITS CLICK TARGET (Samuel, 2026-10-12, #4358 opt 1) ───────────────
//
// 🔒 *"Whole in-app mention pop-up clickable, jumps to the message"*, with the 4s dismiss KEPT
// and no Open button. Until this, `raise` dropped `spec.onClick` on the floor: while Dopl was IN
// FRONT a mention toast was a dead card, while the OS banner for the same event navigated. Being
// at your desk was the one state in which the notification could not be followed.
//
// ⚠ THE SHAPE IS THE RULING. `openId` WITHOUT `actionLabel` is what keeps the renderer on its
// plain 4s path (`incoming-toasts.tsx › lifeOf`, `› show`), so these assert the ABSENCE of the
// label as hard as the presence of the handle.

test("a focused mention's toast carries a handle, and NO actionLabel", async () => {
  const opened = [];
  const { mod, prefs, toasts } = load({ focused: true });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", {
    title: "Design", body: "Ada mentioned you: ship it", onClick: () => opened.push("jumped"),
  }), "popup");

  const p = toasts[0].payload;
  // ⚠ EQUALITY, not a spot-check: an `actionLabel` creeping in here is the 15s promotion Samuel
  // refused, and `kind: 'incoming'` is the yield contract the queue reads.
  assert.deepEqual(Object.keys(p).sort(), ["body", "eventId", "kind", "openId", "title"]);
  assert.equal(p.actionLabel, undefined, "a button here is the promotion the ruling refused");
  assert.equal(p.kind, "incoming");
  assert.ok(typeof p.openId === "string" && p.openId.length > 0, "a usable handle");

  // The handle runs the route's own navigation, once, and is then spent.
  assert.equal(mod.openFromToast(p.openId), true);
  assert.deepEqual(opened, ["jumped"]);
  assert.equal(mod.openFromToast(p.openId), false, "one-shot: a press after dismiss is a no-op");
  assert.deepEqual(opened, ["jumped"], "…and it did not run twice");
});

test("no onClick, no handle — a clickable card that does nothing is the bug, not the fix", async () => {
  const { mod, prefs, toasts } = load({ focused: true });
  await prefs.refresh(true);
  mod.raise("mention", { title: "Design", body: "no navigation given" });
  assert.equal(toasts[0].payload.openId, undefined);
  assert.equal(mod.pendingOpenCount(), 0, "nothing parked for a toast that cannot navigate");
});

test("the banner fallback drops the handle rather than parking it for a card nobody sees", async () => {
  // No window at all: `deliverToast` answers 'none' and the OS banner takes the event. A handle
  // left behind here would be a closure held for 120s against a toast that was never shown.
  const { mod, prefs, banners } = load({ focused: true, windows: 0 });
  await prefs.refresh(true);
  assert.equal(mod.raise("mention", { title: "Design", onClick: () => {} }), "mac");
  assert.equal(banners.length, 1);
  assert.equal(mod.pendingOpenCount(), 0, "the parked closure was reclaimed, not leaked");
});

test("GROWTH GUARD: a burst of mention toasts is bounded, and the sweep returns it to baseline", async () => {
  // ⚠ THE COST OF THE RULING, AND THE THING THAT PAYS IT. A plain mention toast now parks a
  // handle whether or not anybody presses it, so the arrival rate is the MENTION rate, not the
  // ask rate. Nothing reclaims an unpressed entry except the TTL sweep that runs on every
  // register — so the ceiling is "what arrives inside one TTL", and this proves it IS a ceiling.
  const { mod, prefs, setNow } = load({ focused: true });
  await prefs.refresh(true);
  const base = mod.pendingOpenCount();
  assert.equal(base, 0, "baseline");

  const T0 = 1_000_000;
  setNow(T0);
  const N = 25;
  for (let i = 0; i < N; i++) mod.raise("mention", { title: `m${i}`, onClick: () => {} });
  assert.equal(mod.pendingOpenCount(), N, "the burst really is held — otherwise the sweep below proves nothing");

  // Still inside the TTL: nothing may be reclaimed yet, or the guard would pass for the wrong reason.
  setNow(T0 + OPEN_TTL_MS);
  mod.raise("mention", { title: "inside the window", onClick: () => {} });
  assert.equal(mod.pendingOpenCount(), N + 1, "a sweep at exactly the TTL must not evict");

  // Past it: the next register sweeps, and only the newcomer survives.
  setNow(T0 + OPEN_TTL_MS * 2 + 1);
  mod.raise("mention", { title: "after the window", onClick: () => {} });
  assert.equal(mod.pendingOpenCount(), 1, "back to baseline + the one that just arrived");
});

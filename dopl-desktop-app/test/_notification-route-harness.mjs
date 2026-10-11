// SHARED HARNESS for the notification route's suites.
//
// ⚠ SPLIT OUT, NOT A RAISED CAP (2026-10-09). The route's own suite crossed the 500-line
// `max-lines` cap once the actionable half, coalescing and the resume offer had their cases. The
// cap is the point, so the harness moved here and the suites split by subject:
//   notification-route.test.mjs         the passive raise: surface choice, the gate, sound
//   notification-route-actions.test.mjs the affirmative half, coalescing, the resume offer
//
// Both drive the REAL route and the REAL prefs module over a faked transport, so what is tested
// is what ships.

// NOTIFICATION ROUTE (main/notification-route.js, 2026-10-09): which surface an event raises on,
// and the guarantee that it is EXACTLY ONE.
//
// Samuel's spec marks 9 events "Mac + popup". A is an OS banner raised in main, B is a toast owned
// by a renderer global, so raising both would notify the same fact twice at one desk. These tests
// pin the resolution: Dopl in front → toast, Dopl away → banner, never both, never neither.
//
// Run: `node --test dopl-desktop-app/test/notification-route.test.mjs`

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";

/**
 * Loads the route over fakes.
 * @param {object} [o]
 * @param {boolean} [o.focused] is Dopl in front
 * @param {string[]} [o.off] event ids the operator muted
 * @param {string[]} [o.on] event ids the operator turned ON (the only way to reach a default-off)
 * @param {number} [o.windows] how many renderer windows exist
 * @param {boolean} [o.hidden] the windows exist but are INVISIBLE (`openAsHidden`, the tray)
 * @param {boolean} [o.rendererUnready] the renderer has not acked its toast layer yet (cold start)
 * @param {boolean} [o.noNotification] the OS cannot show banners
 */
export function load(o = {}) {
  const focused = o.focused === true;
  const windows = o.windows === undefined ? 1 : o.windows;
  const toasts = [];
  const banners = [];
  const built = [];
  const logs = [];
  // Observable side effects of `./notify-action` — see `notifyAction` below.
  const counts = { attention: 0 };

  let shown = 0;
  const sent = [];
  for (let i = 0; i < windows; i++) {
    sent.push({
      webContents: { send: (channel, payload) => toasts.push({ channel, payload }) },
      // The route reveals Dopl by showing the first window when a spec gives no onClick.
      show: () => { shown += 1; },
      // ⚠ ADDED 2026-10-10. A window with no `isVisible` is how `raiseResumeOffer` came to push
      // into the hidden shell window on every cold start: the route could not ask the question,
      // and nothing here could pose it. The route now requires a VISIBLE window, so the fake has
      // to be able to be invisible.
      isVisible: () => o.hidden !== true,
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
  // `record.on` turns a DEFAULT-OFF event on — the only way to reach `direct_message`'s own
  // surface rule, which is the one 'mac' in the map and was never actually exercised.
  const record = { off: o.off || [], on: o.on || [] };
  const prefsSrc = readFileSync(join(MAIN, "notification-prefs.js"), "utf8");
  const events = () => Object.fromEntries([
    ...record.off.map((k) => [k, false]),
    ...record.on.map((k) => [k, true]),
  ]);
  const prefs = evalModule(prefsSrc, (id) => {
    if (id === "./api") {
      return {
        apiFetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ prefs: { v: 1, events: events() } }),
        }),
      };
    }
    if (id === "./diag") return { diag: (...a) => logs.push(a.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  });

  // ⚠ STUBBED, NOT LEFT TO THROW (2026-10-10). `macBanner` calls `requestAttention` inside a
  // best-effort try/catch, so an unstubbed `./notify-action` threw and was SWALLOWED: the dock
  // bounce was never observable here and a typo in that call would have shipped green.
  const notifyAction = {
    requestAttention: () => { counts.attention += 1; },
    buildActionNotification: (spec) => { built.push(spec); return { banner: true, spec }; },
  };

  const src = readFileSync(join(MAIN, "notification-route.js"), "utf8");
  const mod = evalModule(src, (id) => {
    if (id === "electron") return electron;
    if (id === "./notification-prefs") return prefs;
    if (id === "./notify-action") return notifyAction;
    if (id === "./diag") return { diag: (...a) => logs.push(a.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  });

  // ⚠ READY BY DEFAULT, because these suites describe a RUNNING app whose toast layer is mounted.
  // `rendererUnready` is the cold start: the window exists, `IncomingToasts` has not acked, and a
  // toast pushed into it would be lost — which is the whole reason main holds it now.
  if (o.rendererUnready !== true) mod.noteRendererReady();

  return {
    mod, prefs, record, notifyAction, counts,
    windows: sent, toasts, banners, built, logs, revealed: () => shown,
    /** The renderer's ack, over the same op the real one rides. */
    ack: () => mod.openFromToast(mod.TOAST_READY_ID),
  };
}


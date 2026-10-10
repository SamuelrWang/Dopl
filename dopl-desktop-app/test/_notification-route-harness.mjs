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
 * @param {number} [o.windows] how many renderer windows exist
 * @param {boolean} [o.noNotification] the OS cannot show banners
 */
export function load(o = {}) {
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


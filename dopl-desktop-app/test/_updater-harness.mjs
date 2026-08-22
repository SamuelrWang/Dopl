// SHARED HARNESS for the updater suites — a fake main process the REAL `main/updater.js` runs in.
//
// ⚠ IT IS ITS OWN FILE because `update-restart-prompt.test.mjs` crossed the 500-line cap
// `test/**` is linted under when the 2026-08-22 FOCUS-CHECK cases landed, and the alternative — a
// second copy of the boot machinery in a second file — is how two suites drift into testing two
// different programs. Same seam and same precedent as `_ipc-harness.mjs` /
// `_session-summary-harness.mjs`: the machinery is shared, the cases are split by SUBJECT.
//   update-restart-prompt.test.mjs  the download → prompt → install loop, and the state the
//                                   min-version gate decides on.
//   update-focus-check.test.mjs     WHEN the app looks (the interval and the focus signals).
//
// ⚠ THE REAL MODULE, NOT A SLICE. `electron` and `electron-updater` are primed into the require
// cache and `updater.js` is loaded fresh per case, so what these suites drive is the shipped
// control flow — including the event handlers, which are the whole story.

import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = (f) => join(HERE, "..", "main", f);

// Modules that hold state (or read process.env) at require time, reloaded per case.
const RELOAD = ["updater.js", "config.js", "diag.js", "app-version.js", "update-policy.js", "tray.js"];

export function prime(id, exports) {
  const filename = require.resolve(id);
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

export function reset() {
  for (const f of RELOAD) {
    const filename = require.resolve(MAIN(f));
    delete require.cache[filename];
  }
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

// A fake main process: enough electron for updater.js/tray.js, plus the
// electron-updater EventEmitter whose events are the whole story.
export function harness(opts = {}) {
  const { packaged = true, interval, responses = [], sessions = [] } = opts;
  const seen = {
    notes: [], // [text, {busy}] pairs pushed at tray.setUpdateNote
    states: [], // onState fan-out — what the min-version gate decides on
    ready: [], // onReady echoes
    notifications: [],
    dialogs: [],
    installs: 0,
    checks: 0,
    intervalMs: null,
    appEvents: [], // app-level signals the updater armed (2026-08-22: the focus check)
  };

  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = () => {
    seen.checks++;
    return Promise.resolve(null);
  };
  autoUpdater.quitAndInstall = () => { seen.installs++; };

  class FakeNotification {
    constructor(o) {
      this.opts = o;
      this.handlers = {};
      seen.notifications.push(this);
    }
    static isSupported() { return true; }
    on(ev, fn) { this.handlers[ev] = fn; return this; }
    show() { this.shown = true; }
  }

  let replies = [...responses];
  // App-level event listeners the updater arms (2026-08-22): the FOCUS CHECK hangs off
  // `browser-window-focus` + `activate`, so the fake app has to be an emitter for the wiring to
  // be drivable at all. `seen.appEvents` is what the wiring case asserts against.
  const appHandlers = {};
  const electron = {
    app: {
      isPackaged: packaged,
      on: (ev, fn) => {
        (appHandlers[ev] = appHandlers[ev] || []).push(fn);
        seen.appEvents.push(ev);
      },
      getVersion: () => "1.7.18",
      // diag() writes to userData/listener.log; make that path unavailable so the
      // suite never touches the filesystem (diag swallows the throw by design).
      getPath: () => { throw new Error("no userData in tests"); },
    },
    Notification: FakeNotification,
    dialog: {
      showMessageBox: (o) => {
        seen.dialogs.push(o);
        const response = replies.length ? replies.shift() : 0; // default: Later
        return Promise.resolve({ response });
      },
    },
  };

  prime("electron", electron);
  prime("electron-updater", { autoUpdater });
  reset();

  const prevEnv = process.env.DOPL_UPDATE_CHECK_MS;
  if (interval === undefined) delete process.env.DOPL_UPDATE_CHECK_MS;
  else process.env.DOPL_UPDATE_CHECK_MS = String(interval);

  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => {
    seen.intervalMs = ms;
    return { unref() {} };
  };

  let updater;
  try {
    updater = require(MAIN("updater.js"));
    updater.init({
      onReady: (v) => seen.ready.push(v),
      onNote: (text, o) => seen.notes.push([text, o]),
      onState: (s) => seen.states.push(s),
      getLiveSessions: () => sessions,
    });
  } finally {
    globalThis.setInterval = realSetInterval;
    if (prevEnv === undefined) delete process.env.DOPL_UPDATE_CHECK_MS;
    else process.env.DOPL_UPDATE_CHECK_MS = prevEnv;
  }

  return {
    updater,
    autoUpdater,
    seen,
    electron,
    /** Fire an app-level signal the way Electron would. */
    emitApp: (ev) => { for (const fn of appHandlers[ev] || []) fn(); },
    lastNote: () => seen.notes[seen.notes.length - 1] || [null, null],
    noteTexts: () => seen.notes.map(([t]) => t),
    state: () => updater.updateState(),
  };
}

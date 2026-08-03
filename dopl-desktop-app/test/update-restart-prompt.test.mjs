// 2026-08-01 — the update loop as the operator experiences it: check, download,
// and the one click that installs.
//
// WHAT THIS IS FOR. "Closing and reopening usually does not get the new build; it
// takes several tries over a few minutes." The cycle is START (download) → QUIT
// (install) → START, so one close-and-reopen can never be enough, and a quit
// mid-download discards the staged copy. Nothing said either half was happening,
// the interval was a flat 4h, and the restart affordance only existed in a tray
// menu the operator never got to before quitting.
//
// So this suite drives main/updater.js FOR REAL against a fake electron +
// electron-updater (primed into the require cache), and asserts what the operator
// would see: the tray line, the banner, the dialog, and exactly when
// quitAndInstall is reached. The pure copy/threshold decisions live in
// update-policy.test.mjs.
//
// Run: `node --test dopl-desktop-app/test/update-restart-prompt.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = (f) => join(HERE, "..", "main", f);

// Modules that hold state (or read process.env) at require time, reloaded per case.
const RELOAD = ["updater.js", "config.js", "diag.js", "app-version.js", "update-policy.js", "tray.js"];

function prime(id, exports) {
  const filename = require.resolve(id);
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

function reset() {
  for (const f of RELOAD) {
    const filename = require.resolve(MAIN(f));
    delete require.cache[filename];
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// A fake main process: enough electron for updater.js/tray.js, plus the
// electron-updater EventEmitter whose events are the whole story.
function harness(opts = {}) {
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
  const electron = {
    app: {
      isPackaged: packaged,
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
    lastNote: () => seen.notes[seen.notes.length - 1] || [null, null],
    noteTexts: () => seen.notes.map(([t]) => t),
    state: () => updater.updateState(),
  };
}

// ── The state the minimum-version gate decides on ───────────────────────────
// updateState() is the same story the tray note tells, as booleans, because one
// consumer of it decides whether the app may open at all (main/min-version.js).
// `checked` is the load-bearing one: it is the ONLY evidence that a floor sits
// above the newest build that exists, and acting on a wrong answer is a fleet
// outage in either direction. Each transition is pinned here.

test("an unpackaged run reports NO updater, which is what stops a hard block", () => {
  const h = harness({ packaged: false });
  assert.equal(h.state().supported, false);
  assert.equal(h.state().checked, false);
});

test("a packaged run reports a live updater before it has learned anything", () => {
  const h = harness();
  assert.deepEqual(h.state(), {
    supported: true, checked: false, available: false, ready: false,
    checking: false, failed: false, version: null, percent: null,
  });
});

test("'nothing newer' is the ONE outcome that sets `checked` without an update", () => {
  const h = harness();
  h.autoUpdater.emit("checking-for-update");
  assert.equal(h.state().checking, true);
  assert.equal(h.state().checked, false, "in flight is not an answer");
  h.autoUpdater.emit("update-not-available");
  assert.equal(h.state().checked, true);
  assert.equal(h.state().available, false);
  assert.equal(h.state().checking, false);
});

test("a FAILED check never sets `checked` — it learned nothing", () => {
  // The whole anti-brick guard turns on this. A machine that read "the check
  // errored" as "there is nothing newer" would let itself past a floor it really
  // is below, on every network blip.
  const h = harness();
  h.autoUpdater.emit("checking-for-update");
  h.autoUpdater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
  assert.equal(h.state().checked, false);
  assert.equal(h.state().checking, false, "…but it is no longer in flight");
  assert.equal(h.state().failed, true, "and the failure is a fact of its own");
});

test("a DOWNLOAD that dies keeps `available` and reports `failed` beside it", () => {
  // One error, two readers wanting opposite things. Clearing `available` would
  // hand the gate's anti-brick guard a false "nothing is published" and relax a
  // real block; keeping it alone left the blocking screen spinning on a dead
  // download, its only button hidden by `busy`. So both facts are reported.
  const h = harness();
  h.autoUpdater.emit("update-available", { version: "1.9.0" });
  h.autoUpdater.emit("error", new Error("net::ERR_CONNECTION_RESET"));
  assert.equal(h.state().available, true, "the release did not stop existing");
  assert.equal(h.state().failed, true);
});

test("every attempt that gets somewhere clears `failed`, so it never sticks", () => {
  for (const [event, arg] of [["checking-for-update"], ["update-not-available"],
    ["update-available", { version: "1.9.0" }], ["update-downloaded", { version: "1.9.0" }]]) {
    const h = harness();
    h.autoUpdater.emit("error", new Error("boom"));
    assert.equal(h.state().failed, true, `${event}: primed`);
    h.autoUpdater.emit(event, arg);
    assert.equal(h.state().failed, false, `${event} left a stale failure behind`);
  }
});

test("found -> downloading -> ready walks available then ready, and carries the percent", () => {
  const h = harness();
  h.autoUpdater.emit("update-available", { version: "1.7.19" });
  assert.equal(h.state().checked, true);
  assert.equal(h.state().available, true);
  h.autoUpdater.emit("download-progress", { percent: 43.8 });
  assert.equal(h.state().percent, 43);
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  assert.equal(h.state().ready, true);
  assert.equal(h.state().available, false, "it is no longer coming down: it is here");
  assert.equal(h.state().version, "1.7.19");
  assert.equal(h.state().percent, null);
});

test("every transition fans out, including download progress", () => {
  // The blocking screen narrates the download off this fan-out, so a progress
  // event that only reached the tray would leave it looking hung.
  const h = harness();
  const before = h.seen.states.length;
  h.autoUpdater.emit("download-progress", { percent: 10 });
  assert.ok(h.seen.states.length > before);
  assert.equal(h.seen.states[h.seen.states.length - 1].percent, 10);
});

// ── The interval (item 4) ───────────────────────────────────────────────────

test("with no override the production interval is still 4h", () => {
  const h = harness();
  assert.equal(h.seen.intervalMs, 4 * 60 * 60 * 1000);
});

test("DOPL_UPDATE_CHECK_MS is READ, so a publish loop can look every couple of minutes", () => {
  assert.equal(harness({ interval: 120_000 }).seen.intervalMs, 120_000);
});

test("…and CLAMPED, so `=5` is 60s rather than a hot loop against the feed", () => {
  assert.equal(harness({ interval: 5 }).seen.intervalMs, 60_000);
  assert.equal(harness({ interval: "soon" }).seen.intervalMs, 4 * 60 * 60 * 1000);
});

test("a check runs at startup, not only on the interval", () => {
  assert.equal(harness().seen.checks, 1);
});

// ── Progress on a visible surface (item 2) ──────────────────────────────────

test("download-progress reaches the tray, floored to a whole percent", async () => {
  const h = harness();
  h.autoUpdater.emit("download-progress", { percent: 43.8 });
  assert.deepEqual(h.lastNote(), ["Downloading update… 43%", { busy: true }]);
  h.autoUpdater.emit("download-progress", { transferred: 100, total: 200 });
  assert.deepEqual(h.lastNote(), ["Downloading update… 50%", { busy: true }]);
  // An event with nothing usable still says "moving", never a stuck 0%.
  h.autoUpdater.emit("download-progress", {});
  assert.deepEqual(h.lastNote(), ["Downloading update…", { busy: true }]);
});

test("the download is announced the moment it starts, with the version", () => {
  const h = harness();
  h.autoUpdater.emit("update-available", { version: "1.7.19" });
  assert.deepEqual(h.lastNote(), ["Downloading v1.7.19…", { busy: true }]);
});

// ── The manual check (item 3) ───────────────────────────────────────────────

test("a manual check runs a real check and reports each outcome in turn", () => {
  const h = harness();
  h.updater.checkNow();
  assert.equal(h.seen.checks, 2, "startup + this one");
  h.autoUpdater.emit("checking-for-update");
  assert.deepEqual(h.lastNote(), ["Checking for updates…", { busy: true }]);
  h.autoUpdater.emit("update-not-available");
  assert.deepEqual(h.lastNote(), ["Up to date (v1.7.18)", { busy: false }]);
});

test("a manual check that FAILS says so — the silent handler stays silent otherwise", () => {
  const h = harness();
  // Background failure (the startup check): logged, never surfaced. The note is
  // cleared rather than left wedged on "Checking…".
  h.autoUpdater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
  assert.deepEqual(h.lastNote(), ["", { busy: false }]);
  assert.equal(
    h.noteTexts().some((t) => /failed/i.test(t)),
    false,
    "no release published / offline must never nag a background app"
  );
  // The operator asked this time, so silence would read as a broken button.
  h.updater.checkNow();
  h.autoUpdater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
  assert.deepEqual(h.lastNote(), [
    "Update check failed: net::ERR_INTERNET_DISCONNECTED",
    { busy: false },
  ]);
});

test("the failure is reported ONCE: the next background error is silent again", () => {
  const h = harness();
  h.updater.checkNow();
  h.autoUpdater.emit("error", new Error("boom"));
  const after = h.seen.notes.length;
  h.autoUpdater.emit("error", new Error("boom again"));
  assert.deepEqual(h.lastNote(), ["", { busy: false }]);
  assert.equal(h.seen.notes.length, after + 1, "cleared, not re-reported");
});

test("a manual check mid-download reports the download instead of starting a second one", () => {
  const h = harness();
  h.autoUpdater.emit("update-available", { version: "1.7.19" });
  const before = h.seen.checks;
  h.updater.checkNow();
  assert.equal(h.seen.checks, before, "no second fetch of a 200MB artifact");
  assert.deepEqual(h.lastNote(), ["Downloading update…", { busy: true }]);
});

test("in a dev build the click explains itself instead of doing nothing", () => {
  const h = harness({ packaged: false });
  assert.deepEqual(h.lastNote(), ["Updates are off in this build", { busy: false }]);
  assert.equal(h.seen.checks, 0, "an unsigned dev build must not talk to the feed");
  h.updater.checkNow();
  assert.deepEqual(h.lastNote(), ["Updates are off in this build", { busy: false }]);
});

// ── The restart prompt (item 1) ─────────────────────────────────────────────

test("the download completing offers the restart RIGHT THEN, one click away", async () => {
  const h = harness({ responses: [1] }); // the operator clicks "Restart now"
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  assert.deepEqual(h.seen.ready, ["1.7.19"], "the tray still gets its item");
  assert.deepEqual(h.lastNote(), ["Update ready: v1.7.19", { busy: false }]);
  assert.equal(h.seen.dialogs.length, 1, "no waiting for the operator to find the menu");
  assert.equal(h.seen.dialogs[0].message, "Dopl 1.7.19 is ready to install");
  await flush();
  assert.equal(h.seen.installs, 1);
});

test("DISMISSING it does not restart — the whole prompt is opt-in", async () => {
  const h = harness({ responses: [0] }); // "Later" (also the escape / default)
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  await flush();
  assert.equal(h.seen.installs, 0);
  // …and the affordance survives the dismissal: the tray item is still there.
  assert.equal(h.updater.isUpdateReady(), true);
  assert.equal(h.updater.updateReadyVersion(), "1.7.19");
});

test("nothing restarts on its own: no dialog answer, no install", async () => {
  const h = harness({ responses: [] });
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  h.autoUpdater.emit("download-progress", { percent: 100 });
  await flush();
  assert.equal(h.seen.installs, 0, "only an explicit click may kill a live agent turn");
});

test("with a session LIVE the modal is not thrown over it, and the copy names it", async () => {
  const h = harness({ sessions: [{ channelName: "Design", status: "running" }] });
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  await flush();
  assert.equal(h.seen.dialogs.length, 0, "a modal on top of a running turn is the interruption");
  assert.equal(h.seen.installs, 0);
  const banner = h.seen.notifications[0].opts;
  assert.equal(banner.title, "Dopl update ready");
  assert.match(banner.body, /1 session is running right now \(Design\)/);
  // The operator can still get there in one click, and THAT prompt warns.
  h.updater.requestRestart();
  await flush();
  assert.equal(h.seen.dialogs.length, 1);
  assert.equal(h.seen.dialogs[0].type, "warning");
  assert.match(h.seen.dialogs[0].detail, /Restarting ends it mid turn\./);
  assert.equal(h.seen.installs, 0, "still nothing, because the default answer is Later");
});

test("the tray click restarts straight away when nothing is running", () => {
  const h = harness();
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  h.seen.dialogs.length = 0;
  h.updater.requestRestart();
  assert.equal(h.seen.dialogs.length, 0, "the click already said restart");
  assert.equal(h.seen.installs, 1);
});

test("requestRestart with nothing staged falls back to a check, never a silent no-op", () => {
  const h = harness();
  h.updater.requestRestart();
  assert.equal(h.seen.installs, 0);
  assert.equal(h.seen.checks, 2);
});

test("the auto prompt fires at most once, and two clicks cannot stack two dialogs", async () => {
  const h = harness({ responses: [0, 0] });
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  h.autoUpdater.emit("update-downloaded", { version: "1.7.20" });
  await flush();
  assert.equal(h.seen.dialogs.length, 1, "one banner, one prompt per run");
  assert.equal(h.seen.notifications.length, 1);
  // Single-flight: promptRestart while one is open is a no-op, not a second modal.
  const first = h.updater.promptRestart();
  h.updater.promptRestart();
  assert.equal(h.seen.dialogs.length, 2);
  await first;
});

test("the banner offers a restart action AND opens the prompt when clicked", async () => {
  // macOS only RENDERS notification action buttons in alert style (a per-user
  // System Settings choice), so the action is a bonus and the body click is the
  // path that always works. Both come back through the same guarded restart.
  const h = harness({ sessions: [{ channelName: "Design" }] });
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  const n = h.seen.notifications[0];
  assert.deepEqual(n.opts.actions, [{ type: "button", text: "Restart now" }]);
  assert.equal(n.opts.silent, true);
  assert.equal(n.shown, true);
  n.handlers.click();
  await flush();
  assert.equal(h.seen.dialogs.length, 1, "clicking the banner opens the prompt");
  assert.equal(h.seen.installs, 0);
});

test("a manual check with an update already staged goes straight to the prompt", async () => {
  const h = harness({ sessions: [{ channelName: "Design" }] });
  h.autoUpdater.emit("update-downloaded", { version: "1.7.19" });
  await flush();
  const before = h.seen.checks;
  h.updater.checkNow();
  assert.equal(h.seen.checks, before, "the question is already settled");
  assert.deepEqual(h.lastNote(), ["Update ready: v1.7.19", { busy: false }]);
  assert.equal(h.seen.dialogs.length, 1);
});

// ── The tray renders it ─────────────────────────────────────────────────────

function trayHarness() {
  const built = { template: null, tooltip: null, builds: 0 };
  class FakeTray {
    setContextMenu(m) { built.menu = m; }
    setToolTip(t) { built.tooltip = t; }
    setTitle() {}
    destroy() {}
  }
  prime("electron", {
    app: { getVersion: () => "1.7.18", getPath: () => { throw new Error("none"); } },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (t) => { built.template = t; built.builds++; return t; } },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, setTemplateImage() {} }), createEmpty: () => ({}) },
  });
  reset();
  const tray = require(MAIN("tray.js"));
  const clicks = [];
  tray.create({ onCheckUpdates: () => clicks.push("check") });
  return {
    tray,
    clicks,
    item: (label) => built.template.find((i) => i.label === label) || null,
    labels: () => built.template.map((i) => i.label),
    tooltip: () => built.tooltip,
    builds: () => built.builds,
  };
}

test("the tray carries the manual check, and its click is wired", () => {
  const h = trayHarness();
  const item = h.item("Check for updates now");
  assert.ok(item, `no check item in: ${JSON.stringify(h.labels())}`);
  assert.equal(item.enabled, true);
  item.click();
  assert.deepEqual(h.clicks, ["check"]);
});

test("the note prints under it, and busy disables the button", () => {
  const h = trayHarness();
  h.tray.setUpdateNote("Downloading update… 43%", { busy: true });
  assert.equal(h.item("Check for updates now").enabled, false, "no second fetch mid-download");
  const note = h.item("Downloading update… 43%");
  assert.ok(note, `no note line in: ${JSON.stringify(h.labels())}`);
  assert.equal(note.enabled, false, "it is information, not a control");
  assert.match(h.tooltip(), /Downloading update… 43%/, "visible without opening the menu");

  h.tray.setUpdateNote("Up to date (v1.7.18)", { busy: false });
  assert.equal(h.item("Check for updates now").enabled, true, "settled: clickable again");
  assert.ok(h.item("Up to date (v1.7.18)"));
  assert.equal(/Up to date/.test(h.tooltip()), false, "a settled note would go stale on hover");

  h.tray.setUpdateNote("");
  assert.equal(h.labels().includes("Up to date (v1.7.18)"), false, "an empty note clears the line");
});

test("a repeated progress note does not rebuild the menu ~200 times per download", () => {
  const h = trayHarness();
  const before = h.builds(); // the create() build
  for (let i = 0; i < 5; i++) h.tray.setUpdateNote("Downloading update… 7%", { busy: true });
  assert.equal(h.builds(), before + 1, "same text, same busy flag: one rebuild, not five");
  h.tray.setUpdateNote("Downloading update… 8%", { busy: true });
  assert.equal(h.builds(), before + 2, "…but a real change still redraws");
});

// THE POP-OUT THREAD WINDOW (main/popout-window.js) — wiring plan Phase 10, 2026-08-18.
//
// NO APP LAUNCH AND NO SCREENSHOT. The module is evaluated against a FAKE electron (the
// tree's established idiom — see channel-ipc-sender.test.mjs and preload-parity.test.mjs),
// so what is asserted is the object that crosses into `new BrowserWindow` and the calls the
// factory makes, not a picture of a window.
//
// WHAT MATTERS ABOUT THIS WINDOW, in the order it would hurt:
//
//   1. IT IS REGISTERED. Without `app-windows.register` every privileged call from its
//      renderer is refused and the surface renders nothing while reporting nothing — the
//      exact failure Phase 10 exists to prevent, and the one with no error shape.
//   2. IT IS LOCKED DOWN LIKE THE SHELL. Same preload, same sandbox/contextIsolation, the
//      same `setWindowOpenHandler` deny and the same navigation policing — SHARED from
//      spa-window.js rather than re-declared, so the two cannot drift apart.
//   3. IT LANDS ON THE ROUTE PHASE 9 AND THE CUTOVER ALREADY BUILT, via the hash, with the
//      thread as a `?thread=` SELECTION. No new route, no new deep-link grammar.
//   4. IT IS BOUNDED AND DEDUPED. A renderer-driven window factory with no ceiling is a
//      resource primitive; asking twice for one thread fronts the window that has it.
//
// Run: `node --test dopl-desktop-app/test/popout-window.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("popout-window.js");
// Comments blanked: the docblock NAMES the shared policy on purpose, and a check that
// punished the explanation would get the explanation deleted.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const SEGMENT = "acme-a1b2";
const CH = "44444444-4444-4444-8444-444444444444";
const TH = "task-1";

/** A BrowserWindow-shaped fake that records everything the factory does to it. */
function mkFakeWindow(options) {
  const calls = { loadFile: [], loadURL: [], on: [], once: [], windowOpen: 0 };
  let shown = false;
  const wc = {
    id: mkFakeWindow.nextId++,
    mainFrame: {},
    isDestroyed: () => false,
    setWindowOpenHandler: (fn) => { calls.windowOpen += 1; calls.openHandler = fn; },
    on: (evt, fn) => calls.on.push(evt) && fn,
  };
  const win = {
    options,
    calls,
    webContents: wc,
    isDestroyed: () => win.destroyed === true,
    isMinimized: () => false,
    restore: () => {},
    show: () => { shown = true; },
    focus: () => { calls.focused = (calls.focused || 0) + 1; },
    wasShown: () => shown,
    loadFile: (p, o) => calls.loadFile.push([p, o]),
    loadURL: (u) => calls.loadURL.push(u),
    once: (evt, fn) => { calls.once.push(evt); if (evt === "ready-to-show") fn(); },
    on: (evt, fn) => { calls.on.push(evt); (win.handlers ||= {})[evt] = fn; },
  };
  return win;
}
mkFakeWindow.nextId = 100;

/** Evaluate the real module with a fake electron and a recording registry. */
function load({ dev = "" } = {}) {
  const created = [];
  const registered = [];
  const stubRequire = (id) => {
    if (id === "electron") {
      return {
        BrowserWindow: function (options) {
          const w = mkFakeWindow(options);
          created.push(w);
          return w;
        },
      };
    }
    if (id === "./app-windows") {
      return {
        register: (win) => { registered.push(win); return win; },
        isLiveWindow: (win) => !!win && !win.isDestroyed(),
      };
    }
    if (id === "./spa-window") {
      return {
        INDEX_HTML: "/app/renderer/app/index.html",
        devUrl: () => dev,
        spaWebPreferences: () => ({
          preload: "/app/renderer/app-preload.js",
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: true,
          additionalArguments: ["--dopl-app-origin=https://www.usedopl.com"],
        }),
        policeNavigation: (win) => { policed.push(win); return win; },
      };
    }
    if (id === "./shell-mode") return { CHANNELS_PAGE: "channels" };
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const policed = [];
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);
  return { api: mod.exports, created, registered, policed };
}

// ── The route ────────────────────────────────────────────────────────────────

test("the landing route is the channels row the cutover built, with the thread as a SELECTION", () => {
  const { api } = load();
  assert.equal(
    api.threadRoute(SEGMENT, "channels", CH, TH),
    `/${SEGMENT}/channels/${CH}?thread=${TH}`
  );
});

test("the route names NO page of its own — the ONE `channels` string comes from shell-mode", () => {
  // A second `'channels'` literal here would be a second spelling of a route the Phase 12
  // cutover renamed in one edit. It is passed IN, and the module reads it from shell-mode.
  assert.match(SRC, /require\('\.\/shell-mode'\)/);
  assert.match(SRC, /CHANNELS_PAGE/);
  assert.equal(CODE.match(/'channels'/g), null, "no local copy of the page string");
});

test("an empty part yields NO route — the caller then refuses in its own shape", () => {
  const { api } = load();
  for (const args of [
    ["", "channels", CH, TH],
    [SEGMENT, "", CH, TH],
    [SEGMENT, "channels", "", TH],
    [SEGMENT, "channels", CH, ""],
    [null, "channels", CH, TH],
    [SEGMENT, "channels", CH, undefined],
  ]) {
    assert.equal(api.threadRoute(...args), null, JSON.stringify(args));
  }
});

test("the character rule is NOT re-implemented here", () => {
  // INVARIANTS §11: `deep-link-target.js › isSafeSegment` is the ONE answer to "may this
  // string be interpolated into a router path", and the caller (channel-dir-ipc.js) runs
  // it. A regex over here would be a second answer that could drift.
  assert.ok(!/SLUG_RE|\[A-Za-z0-9\]/.test(CODE), "a second character class lives here");
});

// ── The window ───────────────────────────────────────────────────────────────

test("the pop-out is REGISTERED as an app window — the line the whole feature rests on", () => {
  const ctx = load();
  assert.deepEqual(ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH }), { ok: true });
  assert.equal(ctx.created.length, 1);
  assert.deepEqual(ctx.registered, ctx.created,
    "unregistered, every privileged call from this renderer is refused and the window " +
      "renders nothing while reporting nothing");
});

test("the pop-out takes the SPA's own preload and sandbox, SHARED not re-declared", () => {
  const ctx = load();
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH });
  const prefs = ctx.created[0].options.webPreferences;
  assert.equal(prefs.preload, "/app/renderer/app-preload.js", "the same bridge the shell has");
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.sandbox, true);
  // Structural: the preferences come from spa-window, so a hardening there reaches here.
  assert.match(SRC, /spaWindow\.spaWebPreferences\(\)/);
  assert.ok(!/contextIsolation:/.test(CODE), "a local copy of the sandbox shape can drift");
});

test("navigation is locked and window.open denied — through the SHARED policy", () => {
  const ctx = load();
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH });
  assert.deepEqual(ctx.policed, ctx.created, "every pop-out is policed at creation");
  assert.match(SRC, /spaWindow\.policeNavigation\(win\)/);
  assert.ok(!/setWindowOpenHandler/.test(CODE), "a local deny handler can drift from the shell's");
});

test("production loads the LOCAL index with the route on the HASH — never a URL", () => {
  const ctx = load();
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH });
  const [file, opts] = ctx.created[0].calls.loadFile[0];
  assert.equal(file, "/app/renderer/app/index.html");
  assert.deepEqual(opts, { hash: `/${SEGMENT}/channels/${CH}?thread=${TH}` });
  assert.equal(ctx.created[0].calls.loadURL.length, 0, "no remote URL is ever loaded");
});

test("dev loads the Vite origin with the same hash", () => {
  const ctx = load({ dev: "http://localhost:5173" });
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH });
  assert.deepEqual(ctx.created[0].calls.loadURL, [
    `http://localhost:5173#/${SEGMENT}/channels/${CH}?thread=${TH}`,
  ]);
  assert.equal(ctx.created[0].calls.loadFile.length, 0);
});

test("the pop-out is SHOWN once painted — somebody just asked for it", () => {
  const ctx = load();
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH });
  assert.ok(ctx.created[0].calls.once.includes("ready-to-show"));
  assert.equal(ctx.created[0].wasShown(), true);
});

test("it is MOVABLE and resizable — the point of a pop-out", () => {
  const ctx = load();
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH });
  const o = ctx.created[0].options;
  assert.equal(typeof o.width, "number");
  assert.equal(typeof o.height, "number");
  assert.ok(o.minWidth > 0 && o.minHeight > 0, "a floor, not a fixed size");
  assert.notEqual(o.resizable, false);
  assert.notEqual(o.movable, false);
});

// ── Reuse and the budget ─────────────────────────────────────────────────────

test("asking twice for ONE thread FRONTS the window, it does not mint a second", () => {
  const ctx = load();
  const target = { segment: SEGMENT, channelId: CH, threadId: TH };
  assert.deepEqual(ctx.api.openThreadWindow(target), { ok: true });
  assert.deepEqual(ctx.api.openThreadWindow(target), { ok: true });
  assert.equal(ctx.created.length, 1, "one window per (channel, thread)");
  assert.equal(ctx.created[0].calls.focused, 1, "the second ask fronted the first window");
});

test("a DIFFERENT thread gets its own window", () => {
  const ctx = load();
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: "task-1" });
  ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: "task-2" });
  assert.equal(ctx.created.length, 2);
  assert.equal(ctx.api.count(), 2);
});

test("the window budget is a CEILING, and it refuses in the same `{ ok: false }` shape", () => {
  // A renderer-driven window factory with no ceiling is a resource primitive.
  const ctx = load();
  for (let i = 0; i < ctx.api.MAX_POPOUTS; i += 1) {
    assert.deepEqual(
      ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: `task-${i}` }),
      { ok: true },
      `pop-out ${i}`
    );
  }
  assert.deepEqual(
    ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: "task-over" }),
    { ok: false },
    "over the ceiling"
  );
  assert.equal(ctx.created.length, ctx.api.MAX_POPOUTS);
});

test("a CLOSED pop-out frees its slot", () => {
  const ctx = load();
  for (let i = 0; i < ctx.api.MAX_POPOUTS; i += 1) {
    ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: `task-${i}` });
  }
  // Electron destroys, then emits 'closed'.
  const first = ctx.created[0];
  first.destroyed = true;
  first.handlers.closed();
  assert.equal(ctx.api.count(), ctx.api.MAX_POPOUTS - 1);
  assert.deepEqual(
    ctx.api.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: "task-new" }),
    { ok: true }
  );
});

test("a factory that THROWS answers `{ ok: false }` rather than taking the handler down", () => {
  const stubRequire = (id) => {
    if (id === "electron") return { BrowserWindow: function () { throw new Error("no display"); } };
    if (id === "./app-windows") return { register: (w) => w, isLiveWindow: () => true };
    if (id === "./spa-window") {
      return { INDEX_HTML: "x", devUrl: () => "", spaWebPreferences: () => ({}), policeNavigation: (w) => w };
    }
    if (id === "./shell-mode") return { CHANNELS_PAGE: "channels" };
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);
  assert.deepEqual(
    mod.exports.openThreadWindow({ segment: SEGMENT, channelId: CH, threadId: TH }),
    { ok: false }
  );
});

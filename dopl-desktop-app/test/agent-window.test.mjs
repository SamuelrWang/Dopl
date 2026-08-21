// THE AGENT WINDOW (main/agent-window.js) — F-212's closure.
//
// The properties that fail SILENTLY, which is what earns them a test:
//
//  - **THE ROUTE IS A HAND COPY.** Main cannot import the SPA's TypeScript, so
//    `AGENT_WINDOW_PAGE` and `routes.tsx › AGENT_WINDOW_PATH` are two spellings of one
//    route. Drift does not throw: the window opens on a path the router does not match and
//    renders the not-found placeholder, in a window with no nav to escape it.
//  - **THE BUDGET IS A RESOURCE BOUND**, and a renderer-driven window factory without one
//    is a primitive. Refusals share ONE shape so a caller cannot tell a full budget from a
//    bad id.
//  - **IT IS NOT DEEP-LINKABLE**, and that is TWO absences making one decision (neither
//    `WORKSPACE_PAGES` nor `ROOT_ROUTES`). `test/deep-link-target.test.mjs` owns the
//    degradation; this file owns the absence from the SPA table.
//
// Modelled on `test/popout-window.test.mjs`, whose window this one is a sibling of.
//
// Run: `node --test dopl-desktop-app/test/agent-window.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "agent-window.js"), "utf8");

// ── 0. THE REAL MODULE, WITH A FAKE ELECTRON ────────────────────────────────────────
//
// The `popout-window.test.mjs` idiom: evaluate the module verbatim with a stubbed
// `require`, so what is under test is the shipped code and not a slice of it. Every
// dependency this window has is one the pop-out already stubs the same way, which is the
// point — the two windows must not drift.

function mkFakeWindow(options) {
  const calls = { show: 0, focus: 0, restore: 0, on: [] };
  const win = {
    options,
    destroyed: false,
    minimized: false,
    calls,
    webContents: { id: (mkFakeWindow.nextId += 1), isDestroyed: () => false, send: () => {} },
    isDestroyed: () => win.destroyed,
    isMinimized: () => win.minimized,
    restore: () => { calls.restore += 1; win.minimized = false; },
    show: () => { calls.show += 1; },
    focus: () => { calls.focus += 1; },
    once: (evt, fn) => { if (evt === "ready-to-show") fn(); },
    loadURL: (u) => { win.loaded = u; },
    loadFile: (f, o) => { win.loaded = `${f}#${o && o.hash}`; },
    on: (evt, fn) => { (win.handlers ||= {})[evt] = fn; calls.on.push(evt); },
  };
  return win;
}
mkFakeWindow.nextId = 500;

function load({ dev = "" } = {}) {
  const created = [];
  const registered = [];
  const policed = [];
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
        spaWebPreferences: () => ({ contextIsolation: true, sandbox: true, nodeIntegration: false }),
        policeNavigation: (win) => { policed.push(win); return win; },
      };
    }
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);
  return { api: mod.exports, created, registered, policed };
}

// ── 1. THE ROUTE ─────────────────────────────────────────────────────────────────────

const PAGE = "agent-window";

test("ROUTE: the agent rides `?thread=` as a SELECTION, on the channel's path", () => {
  const { api } = load();
  assert.equal(
    api.agentRoute("acme-a1b2", PAGE, "chan-1", "task-9"),
    "/acme-a1b2/agent-window/chan-1?thread=task-9"
  );
});

test("ROUTE: any EMPTY input refuses rather than interpolating a hole", () => {
  // ⚠ It is deliberately NOT a second copy of the character rule — the caller
  // (`channel-dir-ipc.js`) runs the UUID gate and `isSafeSegment`, and a second copy is a
  // second answer to it (INVARIANTS §11). Refusing an empty one is all this owes.
  const { api } = load();
  for (const args of [
    ["", PAGE, "chan-1", "task-9"],
    ["acme", "", "chan-1", "task-9"],
    ["acme", PAGE, "", "task-9"],
    ["acme", PAGE, "chan-1", ""],
  ]) {
    assert.equal(api.agentRoute(...args), null, JSON.stringify(args));
  }
});

test("KEY: one window per (channel, thread) — never per session id", () => {
  // `sessionId` is re-minted by a park+resume, so a window keyed on it would orphan itself
  // under the operator the moment their agent parked.
  const { api } = load();
  assert.equal(api.agentWindowKey("c", "t"), api.agentWindowKey("c", "t"));
  assert.notEqual(api.agentWindowKey("c", "t1"), api.agentWindowKey("c", "t2"));
});

// ── 2. THE HAND COPY ─────────────────────────────────────────────────────────────────

const ROUTES = readFileSync(
  join(HERE, "..", "..", "apps", "desktop-ui", "src", "routes.tsx"),
  "utf8"
);

test("DRIFT: main's page segment is the SPA's own export, character for character", () => {
  const m = ROUTES.match(/export const AGENT_WINDOW_PATH = "([^"]+)"/);
  assert.ok(m, "AGENT_WINDOW_PATH not found in routes.tsx");
  const mainPage = SRC.match(/const AGENT_WINDOW_PAGE = '([^']+)'/);
  assert.ok(mainPage, "AGENT_WINDOW_PAGE not found in agent-window.js");
  assert.equal(
    mainPage[1],
    m[1],
    "the hand copy drifted — the window would open on a path the router does not match, " +
      "in a window with no nav to escape the not-found page"
  );
});

test("DRIFT: the SPA registers a route for it, outside the app shell", () => {
  assert.match(
    ROUTES,
    /path: `\/:workspaceSegment\/\$\{AGENT_WINDOW_PATH\}\/:channelId`/,
    "the row must be built from the exported constant, not a second literal"
  );
});

test("DEEP LINK: the page is in NEITHER SPA table — a link cannot mint a bare window", () => {
  // ⚠ Two absences, one decision. An agent window is created by MAIN at a window main built
  // and registered; a grammar that could mint one from an arbitrary caller's URL would be a
  // new surface, not a shortcut. `deep-link-target.test.mjs` asserts what such a link DOES.
  const table = ROUTES.slice(
    ROUTES.indexOf("export const WORKSPACE_PAGES"),
    ROUTES.indexOf("export const WORKSPACE_HOME_PATH")
  );
  assert.equal(/agent-window/.test(table), false, "it must not be a WORKSPACE_PAGES row");
  const DEEP = readFileSync(join(MAIN, "deep-link-target.js"), "utf8");
  const roots = DEEP.slice(DEEP.indexOf("ROOT_ROUTES"), DEEP.indexOf("ROOT_ROUTES") + 400);
  assert.equal(/agent-window/.test(roots), false, "it must not be a ROOT_ROUTES entry");
});

// ── 3. THE WINDOW LAYER ──────────────────────────────────────────────────────────────

const TARGET = { segment: "acme-a1b2", channelId: "chan-1", taskId: "task-9" };

test("OPEN: it creates ONE window, lands it on the hash, registers and polices it", () => {
  const { api, created, registered, policed } = load();
  assert.deepEqual(api.openAgentWindow(TARGET), { ok: true });
  assert.equal(created.length, 1);
  // ⚠ LANDED AT CREATION, on the hash — the SPA is a hash router over a file:// document,
  // so there is no mount race and nothing is steered over the navigate bridge afterwards.
  assert.match(created[0].loaded, /#\/acme-a1b2\/agent-window\/chan-1\?thread=task-9$/);
  // ⚠ THE LINE THAT MAKES THE WINDOW WORK AT ALL: without registration every privileged
  // call from this renderer is refused and the surface renders nothing while reporting
  // nothing (INVARIANTS §11's silent-feature-deletion shape).
  assert.deepEqual(registered, [created[0]]);
  assert.deepEqual(policed, [created[0]], "the navigation lock is shared, not re-derived");
});

test("OPEN: the default size IS the floor — it opens compact and the operator grows it", () => {
  const { api, created } = load();
  api.openAgentWindow(TARGET);
  const o = created[0].options;
  assert.equal(o.width, o.minWidth);
  assert.equal(o.height, o.minHeight);
});

test("OPEN: asking again for the SAME agent FRONTS the window rather than duplicating it", () => {
  const { api, created } = load();
  api.openAgentWindow(TARGET);
  api.openAgentWindow(TARGET);
  assert.equal(created.length, 1, "one window per (channel, thread)");
  assert.equal(created[0].calls.show >= 1, true);
  assert.equal(created[0].calls.focus, 1);
});

test("OPEN: a DIFFERENT agent gets its own window", () => {
  const { api, created } = load();
  api.openAgentWindow(TARGET);
  api.openAgentWindow({ ...TARGET, taskId: "task-2" });
  assert.equal(created.length, 2);
});

test("BUDGET: it refuses past the cap, in the SAME shape as a bad id", () => {
  // ⚠ A renderer-driven window factory with no ceiling is a resource primitive. The shapes
  // match so a hostile page cannot tell a full budget from an unusable target.
  const { api, created } = load();
  for (let i = 0; i < api.MAX_AGENT_WINDOWS; i += 1) {
    assert.deepEqual(api.openAgentWindow({ ...TARGET, taskId: `t-${i}` }), { ok: true });
  }
  assert.deepEqual(api.openAgentWindow({ ...TARGET, taskId: "one-too-many" }), { ok: false });
  assert.deepEqual(api.openAgentWindow({}), { ok: false });
  assert.equal(created.length, api.MAX_AGENT_WINDOWS);
});

test("BUDGET: a CLOSED window frees its slot", () => {
  const { api, created } = load();
  api.openAgentWindow(TARGET);
  assert.equal(api.count(), 1);
  created[0].destroyed = true;
  assert.equal(api.count(), 0, "the sweep must collect it even without a 'closed' event");
});

test("SHARED, NOT COPIED: it takes the SPA's own webPreferences and navigation lock", () => {
  // A local `webPreferences` literal would let this window's sandbox drift from the shell's.
  assert.match(SRC, /spaWindow\.spaWebPreferences\(\)/);
  assert.match(SRC, /spaWindow\.policeNavigation\(win\)/);
  assert.equal(/webPreferences:\s*\{/.test(SRC), false, "no local webPreferences literal");
});

test("REGISTERED IN MAIN, AT CREATION — never behind an ipcMain handler", () => {
  // `test/app-windows.test.mjs` asserts the structural half over the whole tree; this is
  // the local statement of the same rule.
  assert.match(SRC, /appWindows\.register\(win\)/);
});

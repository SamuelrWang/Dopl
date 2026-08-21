// THE APP-WINDOW REGISTRY (main/app-windows.js) — wiring plan Phase 10, 2026-08-18.
//
// WHY THIS FILE EXISTS. Phase 10 WIDENED the sender binding on every renderer-reachable
// `ipcMain.handle` from "the MAIN window" to "any window in this registry" (Samuel's
// ruling, option (a) — widen, rather than build the thread view twice on the session
// renderer). A widened security guard is worth exactly what the thing behind it is worth,
// and the thing behind it is this Set. So two properties are asserted here, and the
// enumerating half lives next door in `channel-ipc-sender.test.mjs`:
//
//   1. NOTHING RENDERER-REACHABLE CAN ADD TO IT. `register()` takes a live BrowserWindow —
//      an object no renderer can name, let alone hand across IPC — and it is called only by
//      main-process code at window CREATION. There is no `ipcMain.handle` for it and no
//      preload mentions it. Asserted structurally, over the real tree, because "we would
//      never expose it" is the claim that stops being true one wave later.
//   2. A DESTROYED WINDOW LEAVES THE SET. A stale id that stays bound is a sender binding
//      that outlives its subject. Removal is belt AND braces — both lifecycle events, plus
//      a sweep on every read — so a window that dies without emitting either still falls
//      out.
//
// ⚠ 2026-08-20 (F-228): the SESSION WINDOW is gone and `renderer/session/**` with it, so the
// preload half of (1) named a file that no longer exists. It is DISCOVERED over `renderer/`
// now rather than listed — see the note at the assertion. Nothing about the registry, the
// registration sites, or the destroyed-window half changed; the call-site list below is
// still asserted whole, and it still holds four entries.
//
// Run: `node --test dopl-desktop-app/test/app-windows.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const M = (p) => readFileSync(join(MAIN, p), "utf8");
const SRC = M("app-windows.js");

// The real module, evaluated with only `diag` stubbed — it requires no electron at all,
// which is itself part of the point: the registry holds windows, it does not make them.
function load() {
  const stubRequire = (id) => {
    if (id === "./diag") return { diag: () => {} };
    throw new Error("app-windows.js must not require " + JSON.stringify(id));
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);
  return mod.exports;
}

let nextId = 1;
/** A BrowserWindow-shaped fake with real-enough lifecycle. */
function mkWin() {
  const listeners = { win: {}, wc: {} };
  let destroyed = false;
  let wcDestroyed = false;
  const wc = {
    id: nextId++,
    mainFrame: { name: "top" },
    isDestroyed: () => wcDestroyed,
    on: (evt, fn) => { (listeners.wc[evt] ||= []).push(fn); },
  };
  const win = {
    isDestroyed: () => destroyed,
    get webContents() {
      // Electron THROWS here once the window is gone. The registry must survive that.
      if (destroyed) throw new Error("Object has been destroyed");
      return wc;
    },
    on: (evt, fn) => { (listeners.win[evt] ||= []).push(fn); },
  };
  return {
    win,
    wc,
    /** Close the window the way Electron does: destroy, then emit 'closed'. */
    close() {
      destroyed = true;
      for (const fn of listeners.win.closed || []) fn();
    },
    /** Kill only the webContents (a render-process crash), emitting 'destroyed'. */
    killContents() {
      wcDestroyed = true;
      for (const fn of listeners.wc.destroyed || []) fn();
    },
    /** Die with NO event at all — the case the sweep exists for. */
    vanish() { destroyed = true; },
  };
}

test("a registered window is bound, and its id is what the guards are handed", () => {
  const reg = load();
  const a = mkWin();
  reg.register(a.win);
  assert.equal(reg.count(), 1);
  assert.deepEqual([...reg.senderIds()], [a.wc.id]);
  assert.deepEqual(reg.liveWindows(), [a.win]);
});

test("MANY windows bind — the shell and every pop-out (this IS the widening)", () => {
  const reg = load();
  const shell = mkWin();
  const p1 = mkWin();
  const p2 = mkWin();
  for (const w of [shell, p1, p2]) reg.register(w.win);
  assert.equal(reg.count(), 3);
  assert.deepEqual(
    [...reg.senderIds()].sort((x, y) => x - y),
    [shell.wc.id, p1.wc.id, p2.wc.id].sort((x, y) => x - y)
  );
});

test("register is IDEMPOTENT — a double-wire cannot double-count", () => {
  const reg = load();
  const a = mkWin();
  reg.register(a.win);
  reg.register(a.win);
  assert.equal(reg.count(), 1);
});

test("a DEAD window is refused at registration, never bound", () => {
  const reg = load();
  const a = mkWin();
  a.vanish();
  assert.equal(reg.register(a.win), null);
  assert.equal(reg.count(), 0);
  for (const notAWindow of [null, undefined, {}, 7, "win", { isDestroyed: 1 }]) {
    assert.equal(reg.register(notAWindow), null, JSON.stringify(notAWindow));
  }
  assert.equal(reg.count(), 0, "a bound privileged surface must never be a guess");
});

test("a CLOSED window leaves the set — a stale id must not stay bound", () => {
  const reg = load();
  const shell = mkWin();
  const popout = mkWin();
  reg.register(shell.win);
  reg.register(popout.win);
  popout.close();
  assert.deepEqual([...reg.senderIds()], [shell.wc.id], "the closed pop-out is gone");
  assert.deepEqual(reg.liveWindows(), [shell.win]);
});

test("a DESTROYED webContents leaves the set even though the window object survives", () => {
  // The two halves die independently; a webContents torn down under a live window is a
  // renderer that no longer exists, and it must stop being a bound sender.
  const reg = load();
  const a = mkWin();
  reg.register(a.win);
  a.killContents();
  assert.deepEqual([...reg.senderIds()], []);
  assert.equal(reg.count(), 0);
});

test("a window that dies with NO EVENT still falls out — the sweep is the backstop", () => {
  const reg = load();
  const a = mkWin();
  const b = mkWin();
  reg.register(a.win);
  reg.register(b.win);
  a.vanish(); // no 'closed', no 'destroyed'
  assert.deepEqual([...reg.senderIds()], [b.wc.id]);
  assert.equal(reg.count(), 1);
});

test("reading the registry never THROWS on a window mid-teardown", () => {
  // `win.webContents` throws once the window is destroyed. Every read here is defensive,
  // because a throw inside a realtime callback or an IPC guard is worse than a refusal.
  const reg = load();
  const a = mkWin();
  reg.register(a.win);
  a.vanish();
  assert.doesNotThrow(() => reg.senderIds());
  assert.doesNotThrow(() => reg.liveWindows());
  assert.doesNotThrow(() => reg.count());
});

test("isLiveWindow refuses everything that is not a live window", () => {
  const reg = load();
  const a = mkWin();
  assert.equal(reg.isLiveWindow(a.win), true);
  a.killContents();
  assert.equal(reg.isLiveWindow(a.win), false);
  for (const bad of [null, undefined, {}, 0, "win", { isDestroyed: () => false }]) {
    assert.equal(reg.isLiveWindow(bad), false, JSON.stringify(bad));
  }
});

// ── Property 1: registration is main's alone, by construction ────────────────

test("NOTHING renderer-reachable can register a window", () => {
  // The security argument for widening the binding at all. Three greps over the real tree,
  // each closing a different door.
  //
  // (a) No IPC handler anywhere reaches the registry. A handler that could register would
  //     let a compromised renderer enlarge the set it is judged against, which is the whole
  //     threat model this registry replaces.
  for (const file of readdirSync(MAIN).filter((f) => f.endsWith(".js"))) {
    const src = M(file);
    for (const block of src.match(/ipcMain\.handle\([\s\S]{0,1200}?\n  \}\)\);/g) || []) {
      assert.ok(
        !/appWindows\.register|require\('\.\/app-windows'\)\.register/.test(block),
        `main/${file}: an ipcMain handler reaches app-windows.register`
      );
    }
  }

  // (b) No preload REACHES it. The preloads are the entire renderer-visible surface, and
  //     `test/preload-parity.test.mjs` pins their op list — but the reach is worth refusing
  //     on its own. ⚠ CODE ONLY: comments are blanked first, because app-preload.js's
  //     docblock names the registry deliberately (that is where the widening is explained,
  //     and a check that punished the explanation would get the explanation deleted).
  //
  // ⚠ REWRITTEN, NOT NARROWED (2026-08-20, F-228; INVARIANTS §14). This used to name TWO
  //   preloads by path, and the second — `renderer/session/session-preload.js` — went with
  //   the whole `renderer/session/**` tree when the session window was deleted, so the case
  //   died on ENOENT rather than on anything about the registry. A hardcoded list is the
  //   wrong shape for a "nothing renderer-reachable" claim anyway: it goes red when a
  //   preload is DELETED (harmless) and stays green when one is ADDED (the case that
  //   matters). So the preloads are DISCOVERED now, over the real tree, and the discovery
  //   itself is asserted non-empty — a rename that emptied the glob would otherwise turn
  //   this whole property vacuous.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const RENDERER = join(HERE, "..", "renderer");
  const preloads = readdirSync(RENDERER, { recursive: true })
    .map(String)
    .filter((p) => /(^|[\\/])[^\\/]*preload[^\\/]*\.js$/.test(p))
    .sort();
  assert.ok(preloads.length >= 3, `the preload sweep found ${preloads.length} files: ${preloads.join(", ")}`);
  assert.ok(preloads.includes("app-preload.js"), "the shell's preload is the one that MUST be covered");
  for (const p of preloads) {
    const code = stripComments(readFileSync(join(RENDERER, p), "utf8"));
    assert.ok(!/app-windows|appWindows/.test(code), `renderer/${p} reaches the registry`);
  }

  // (c) Every call site is a WINDOW-CREATION path in main. THREE, since 2026-08-20. A new
  //     one must be looked at, not absorbed — and this is the review the third one got:
  //
  //     `agent-window.js` (F-212's closure) registers the AGENT WINDOW at creation, in the
  //     same three lines `popout-window.js` uses and for the same reason: without
  //     registration every privileged call from that renderer is refused and the surface
  //     renders nothing while reporting nothing. It inherits Samuel's option-(a) ruling
  //     rather than re-opening it — the properties that make the widening safe are
  //     unchanged and were each re-checked here:
  //       • MAIN creates the window and MAIN registers it; the renderer can only ASK
  //         (`sessions:openAgentWindow` answers `{ ok }` and hands back no handle);
  //       • it takes `spa-window.js › spaWebPreferences` and `› policeNavigation` VERBATIM,
  //         so sandbox, contextIsolation, the `setWindowOpenHandler` deny and the exact-path
  //         navigation lock cannot drift from the shell's;
  //       • it is capped (`MAX_AGENT_WINDOWS`) and refuses in the one `{ ok: false }` shape;
  //       • its route is in NEITHER `WORKSPACE_PAGES` nor `ROOT_ROUTES`, so no `dopl://`
  //         link can mint one.
  //     ⚠ What is genuinely NEW is that this window's renderer can reach an op that STARTS
  //     A TURN (`sessions:message`). That is reviewed where it is registered
  //     (`channel-dir-ipc.js`) and where it executes (`session-reopen.js › messageByTask`);
  //     registration is not what authorizes it — being an app window is.
  const callers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => /\bregisterAppWindow\b|appWindows\.register\b/.test(M(f)))
    .sort();
  assert.deepEqual(
    callers,
    ["agent-window.js", "index.js", "popout-window.js", "shell-mode.js"],
    "a new registration site is a new bound sender — review it rather than updating this list " +
      "reflexively (index.js WIRES shell-mode's `registerAppWindow`; shell-mode CALLS it; " +
      "popout-window registers its own window at creation)"
  );
});

test("the registry requires no electron — it holds windows, it does not make them", () => {
  assert.ok(!/require\('electron'\)/.test(SRC), "a registry that can create windows is a factory");
  assert.doesNotThrow(load, "the module must load with only diag stubbed");
});

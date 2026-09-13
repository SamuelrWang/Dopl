// THE FRAMELESS WINDOW'S OWN CHROME (main/window-chrome.js) — 2026-09-13.
//
// The properties that fail SILENTLY, which is what earns them a test:
//
//  - **THE SENDER BINDING.** A privileged handler that answers anyone is the F-221 class; a
//    handler on an UNBOUND surface that answers anyway is the same bug from the other side.
//    Neither throws — the window simply obeys a page it should not have heard.
//  - **EACH OP ACTS ON THE CALLER'S OWN WINDOW.** The target is never a payload, so there is
//    nothing to forge; a regression that took an id would look like a feature.
//  - **ZOOM IS A TOGGLE.** A renderer that could only `maximize()` leaves the operator no way
//    back to their own size, and nothing errors.
//  - **CLOSE IS `close()`, NEVER `destroy()`.** `agent-window.js` frees the window's budget slot
//    on the `closed` event; a destroyed window skips the lifecycle every other path runs.
//
// Modelled on `test/agent-window.test.mjs`: the module is evaluated VERBATIM against a stubbed
// `require`, so what is under test is the shipped code and not a slice of it.
//
// Run: `node --test dopl-desktop-app/test/window-chrome.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "window-chrome.js"), "utf8");
/** ⚠ CODE ONLY. This module's header says the words "destroy()" and "payload" while explaining why
 *  it uses NEITHER — a raw scan fails on the docblock recording the decision. Same stripping
 *  `pages/agent-window/frame.test.ts` does, and for the same reason. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

function mkWindow() {
  const calls = { close: 0, maximize: 0, unmaximize: 0 };
  const win = {
    calls,
    destroyed: false,
    maximized: false,
    isDestroyed: () => win.destroyed,
    isMaximized: () => win.maximized,
    maximize: () => { calls.maximize += 1; win.maximized = true; },
    unmaximize: () => { calls.unmaximize += 1; win.maximized = false; },
    close: () => { calls.close += 1; },
  };
  return win;
}

/**
 * Boot the module with a fake electron. `bound` is the set of `webContents` ids main has
 * registered — absent entirely for the UNBOUND surface case.
 */
function boot({ bound = true } = {}) {
  const handlers = {};
  const win = mkWindow();
  const sender = { id: 7, isDestroyed: () => false, mainFrame: {} };
  const stub = (id) => {
    if (id === "electron") {
      return {
        ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
        BrowserWindow: { fromWebContents: (wc) => (wc === sender ? win : null) },
      };
    }
    // ⚠ THE REAL GUARD, not a stub of it. The one thing this file must not do is assert the
    // binding against its own idea of what the binding is.
    if (id === "./ipc-guards") return require_guards();
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  mod.exports.register(bound ? { getSenderIds: () => new Set([sender.id]) } : {});
  const evt = { sender, senderFrame: sender.mainFrame };
  const foreign = { sender: { id: 99, isDestroyed: () => false, mainFrame: {} } };
  foreign.senderFrame = foreign.sender.mainFrame;
  const iframe = { sender, senderFrame: {} };
  return { handlers, win, evt, foreign, iframe };
}

/** `ipc-guards.js`'s pure block, evaluated the way its own suite does. */
function require_guards() {
  const guardSrc = readFileSync(join(MAIN, "ipc-guards.js"), "utf8");
  const block = guardSrc.slice(
    guardSrc.indexOf("// ─── BEGIN IPC-GUARDS"),
    guardSrc.indexOf("// ─── END IPC-GUARDS")
  );
  return new Function(`${block}\n return { isAppWindowSender, isUuid };`)();
}

test("CLOSE: a bound sender closes ITS OWN window, with close() and not destroy()", async () => {
  const { handlers, win, evt } = boot();
  assert.deepEqual(await handlers["window:close"](evt), { ok: true });
  assert.equal(win.calls.close, 1);
  assert.equal(/destroy\(\)/.test(CODE), false, "destroy() skips the lifecycle close() runs");
});

test("ZOOM: it TOGGLES, and answers the state it actually landed in", async () => {
  const { handlers, win, evt } = boot();
  assert.deepEqual(await handlers["window:toggleMaximize"](evt), { ok: true, maximized: true });
  assert.equal(win.calls.maximize, 1);
  assert.deepEqual(await handlers["window:toggleMaximize"](evt), { ok: true, maximized: false });
  assert.equal(win.calls.unmaximize, 1);
});

test("BOTH ops REFUSE a foreign sender, an iframe, and an UNBOUND surface — one shape", async () => {
  // ⚠ ONE SHAPE for every refusal, so a hostile page cannot tell which one it hit.
  for (const name of ["window:close", "window:toggleMaximize"]) {
    const bound = boot();
    assert.deepEqual(await bound.handlers[name](bound.foreign), { ok: false }, name);
    assert.deepEqual(await bound.handlers[name](bound.iframe), { ok: false }, name);
    assert.deepEqual(bound.win.calls, { close: 0, maximize: 0, unmaximize: 0 }, name);
    const unbound = boot({ bound: false });
    assert.deepEqual(await unbound.handlers[name](unbound.evt), { ok: false }, name);
    assert.deepEqual(unbound.win.calls, { close: 0, maximize: 0, unmaximize: 0 }, name);
  }
});

test("NO OP TAKES A WINDOW — the caller's own is the only one reachable", () => {
  // ⚠ STRUCTURAL, because a payload would look like a feature. `agent-window.js ›
  // closeAgentWindow`'s header is the rule: a renderer that could shut ANOTHER app window is a
  // nuisance primitive with no feature behind it.
  assert.match(CODE, /BrowserWindow\.fromWebContents\(event && event\.sender\)/);
  assert.equal(/payload/.test(CODE), false, "these ops take no payload");
  // Every handler goes through the binding, written literally at the site (ipc-guards.js's rule).
  const sites = CODE.match(/ipcMain\.handle\(/g) || [];
  const wrapped = CODE.match(/appWindowOnly\('window:/g) || [];
  // ⚠ THREE SINCE 2026-09-13 (`window:closeTab`), AND THE CLAIM NARROWED WITH THE COUNT. It was
  // "no op takes a TARGET", which `closeTab`'s key would read as a violation — so the property is
  // restated where it actually lives: no op names a WINDOW. The key names a TAB, and the case
  // below is what holds that.
  assert.equal(sites.length, 3);
  assert.equal(wrapped.length, sites.length, "an unwrapped handle site is an unbound one");
});

/**
 * 🔒 **`window:closeTab`'s ARGUMENT NAMES A TAB AND CANNOT NAME A WINDOW** — the second fence.
 * Being a bound app window is not enough: the sender must BE the agent window, so a bound pop-out
 * (or the main window) reaching for another surface's tab set gets the same `{ ok: false }` as a
 * nonsense key.
 */
test("TAB OP: the sender must BE the agent window, not merely a bound one", () => {
  assert.match(CODE, /agentWindow\.isHostWindow\(win\)/);
  // ⚠ AND MAIN OWNS THE LAST-TAB RULE. This file must not close a window itself: `closeAgentTab`
  // decides that, because the delete lane needs the same rule and two copies would part.
  assert.match(CODE, /agentWindow\.closeAgentTab\(/);
  const tabOp = CODE.slice(CODE.indexOf("'window:closeTab'"));
  assert.equal(/win\.close\(\)/.test(tabOp.slice(0, 900)), false, "the tab op must not close a window itself");
});

test("MAIN WIRES IT TO THE SAME REGISTRY every other privileged surface is bound to", () => {
  const INDEX = readFileSync(join(MAIN, "index.js"), "utf8");
  assert.match(INDEX, /windowChrome\.register\(\{ getSenderIds: \(\) => appWindows\.senderIds\(\) \}\)/);
});

// The blocking "update required" screen, and the wiring that makes the block
// total.
//
// THE PROPERTY THIS FILE PROTECTS. A gate that can be walked around is not a
// gate, and the ways around one in this app are not hypothetical: the dock icon,
// the tray's "Open Dopl", a clicked channel notification and a dopl:// deep link
// are four independent paths that each open a window, and the 2026-08-03 fleet
// audit found all four of them resurrecting the WRONG shell because they each
// built their own. The fix then was one factory (shell-mode.createShellWindow);
// the gate rides that same factory, which is why there is exactly one branch to
// pin here rather than four. If someone reintroduces a direct createSpaWindow /
// createMainWindow call site, that is the regression this file is watching for.
//
// The second half is the screen's own contract: it must be able to END the block
// (restart), must always offer a way OUT (quit), and must not be able to grant
// itself anything else — its preload is the whole privileged surface it has.
//
// Run: `node --test dopl-desktop-app/test/update-required-screen.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const R = (p) => readFileSync(join(HERE, "..", "renderer", p), "utf8");

const INDEX = M("index.js");
const SHELL = M("shell-mode.js");
const WINDOW = M("update-required-window.js");
const WAKE = M("wake.js");
const PRELOAD = R("update-required-preload.js");
const HTML = R("update-required.html");

// ── The one enforcement point ────────────────────────────────────────────────

test("the gate branch is INSIDE the one shell factory, ahead of both shells", () => {
  const fn = fnOf(SHELL, "createShellWindow");
  assert.match(fn, /deps\.versionGate && deps\.versionGate\.isBlocked\(\)/);
  assert.match(fn, /createUpdateRequiredWindow\(\)/);
  // Ahead of BOTH shells, or a blocked build would still get the app.
  const gate = fn.indexOf("isBlocked()");
  assert.ok(gate < fn.indexOf("createSpaWindow"), "before the SPA");
  assert.ok(gate < fn.indexOf("createMainWindow"), "before the remote rollback shell");
});

test("index.js hands the gate to that factory and to nothing else", () => {
  assert.match(INDEX, /makeShellHelpers\(\{[\s\S]*?\n {2}versionGate,/);
  // Every open-the-app path already goes through createShellWindow; if any of
  // them grew its own factory call the branch above would be bypassed.
  const direct = INDEX.match(/spaWindow\.createSpaWindow/g) || [];
  assert.equal(direct.length, 1, "the ONE reference is the dep handed to shell-mode");
});

test("the swap is the same two lines in both directions", () => {
  const fn = fnOf(SHELL, "swapShell");
  assert.match(fn, /win\.destroy\(\)/);
  assert.match(fn, /createShellWindow\(\{ show: true \}\)/);
  const wire = fnOf(SHELL, "wireVersionGate");
  assert.match(wire, /onBlock: \(\) => swapShell\(\)/);
  assert.match(wire, /closeUpdateRequiredWindow\(\);/);
  assert.match(wire, /swapShell\(\);/);
});

test("index.js arms the gate, and feeds it the updater state it decides on", () => {
  assert.match(INDEX, /shellHelpers\.wireVersionGate\(\{ onWarn: \(notice\) => tray\.setVersionFloor\(notice\) \}\)/);
  // The anti-brick guard is downstream of this line: without onState, a floor
  // above the newest published build would block the fleet permanently.
  assert.match(INDEX, /onState: \(\) => versionGate\.onUpdaterState\(\)/);
});

test("wake re-asks for the floor: a Mac can sleep across a release", () => {
  assert.match(WAKE, /kick\('version-gate', \(\) => deps\.versionGate\.onWake\(\)\)/);
  assert.match(INDEX, /wake\.arm\(\{[\s\S]*?versionGate,/);
  // The extraction kept every previous participant; losing one here would be a
  // silent multi-minute hang after every unlock.
  for (const name of ["listener", "pool-reset", "token", "ui-sync", "guard"]) {
    assert.match(WAKE, new RegExp(`kick\\('${name}'`), `wake dropped ${name}`);
  }
});

// ── The window ───────────────────────────────────────────────────────────────

test("the window is the repo's local-page shape, and never a browser", () => {
  assert.match(WINDOW, /contextIsolation: true/);
  assert.match(WINDOW, /nodeIntegration: false/);
  assert.match(WINDOW, /sandbox: true/);
  assert.match(WINDOW, /win\.loadFile\(PAGE\)/);
  assert.ok(!/loadURL/.test(WINDOW), "a blocked build must never load a remote page");
  assert.match(WINDOW, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(WINDOW, /on\('will-navigate', police\)/);
  assert.match(WINDOW, /on\('will-redirect', police\)/);
});

test("its three IPC handlers are SENDER-BOUND to this window's top frame", () => {
  // `restart` and `quit` end the process. The H3 idiom (channel-dir-ipc.js): the
  // sender must be this window's webContents AND its main frame, since a
  // cross-origin iframe shares its host's webContents.
  const guard = fnOf(WINDOW, "isGateSender");
  assert.match(guard, /sender !== win\.webContents/);
  assert.match(guard, /frame !== sender\.mainFrame/);
  assert.match(guard, /catch \(_\) \{\s*return false;/, "a detached frame is refused, not waved through");
  for (const ch of ["STATE_CHANNEL", "'update-gate:act'", "'update-gate:quit'"]) {
    assert.match(WINDOW, new RegExp(`ipcMain\\.handle\\(${ch.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")}, gateOnly\\(`),
      `${ch} is not sender-bound`);
  }
});

test("the handlers are registered ONCE, not per window", () => {
  // ipcMain.handle throws on a duplicate channel, and the window is rebuilt on
  // every re-block.
  assert.match(fnOf(WINDOW, "registerIpc"), /if \(registered\) return;\s*registered = true;/);
});

test("quit from the screen is a REAL quit, not a hide", () => {
  assert.match(WINDOW, /app\.isQuitting = true;\s*app\.quit\(\);/);
});

test("the live narration is unsubscribed when the window goes away", () => {
  // A leaked subscriber would keep pushing into a destroyed webContents on every
  // download-progress event for the life of the process.
  assert.match(WINDOW, /unsubscribe = versionGate\.subscribe\(/);
  assert.match(WINDOW, /on\('closed', \(\) => \{[\s\S]*?unsubscribe\(\)/);
  assert.match(fnOf(WINDOW, "closeUpdateRequiredWindow"), /unsubscribe\(\)/);
});

// ── The preload ──────────────────────────────────────────────────────────────

test("the preload exposes FOUR calls and no way to dismiss the gate", () => {
  assert.match(PRELOAD, /contextBridge\.exposeInMainWorld\('doplUpdate'/);
  const keys = [...PRELOAD.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ["state", "act", "quit", "onState"]);
  // No ipcRenderer, no require, no fetch handed to the page.
  assert.ok(!/exposeInMainWorld\('[^']+', ipcRenderer/.test(PRELOAD));
  assert.ok(!/\bfetch\b|\bnode:|require\('fs'\)/.test(PRELOAD));
});

test("the verdict lives in main: the page can only ASK what to draw", () => {
  // Nothing on the bridge names a verdict, a floor or a version — comments
  // excluded, since the file explains exactly that.
  const code = PRELOAD.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/isBlocked|verdict|floor|minSupported/i.test(code));
});

// ── The page ─────────────────────────────────────────────────────────────────

test("the page can reach nothing: default-src 'none' and no network at all", () => {
  assert.match(HTML, /Content-Security-Policy/);
  assert.match(HTML, /default-src 'none'/);
  assert.ok(!/https?:\/\//.test(HTML.replace(/<!--[\s\S]*?-->/g, "")), "no remote URL anywhere");
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(HTML));
});

test("it always offers the way OUT, and says so", () => {
  assert.match(HTML, /id="quit"/);
  assert.match(HTML, /Quit Dopl/);
  assert.match(HTML, /window\.doplUpdate\.quit\(\)/);
  assert.match(HTML, /You can quit at any time/);
});

test("it renders main's answer and holds no state of its own", () => {
  assert.match(HTML, /window\.doplUpdate\.onState\(render\)/);
  assert.match(HTML, /window\.doplUpdate\.state\(\)\.then\(render\)/, "the first paint, not just pushes");
  assert.match(HTML, /window\.doplUpdate\.act\(id\)/);
  // textContent, never innerHTML: the copy comes from main, but it is still
  // strings being written into a document.
  assert.ok(!/innerHTML/.test(HTML));
});

test("no user-facing string on the page uses an em dash (repo copy rule)", () => {
  const body = HTML.slice(HTML.indexOf("<body>"));
  const text = body.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(!text.includes("—"), "em dash in the page copy");
});

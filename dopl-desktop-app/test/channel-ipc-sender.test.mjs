// H3 (2026-07-31) — SENDER BINDING on main/channel-dir-ipc.js.
//
// THE DEFECT. Every handler in that file validated its PAYLOAD (channelId as a UUID, both
// permission modes against frozen enums) and never validated its CALLER. Meanwhile
// renderer/preload.js exposes all of them on the window that loads REMOTE usedopl.com
// content. So any XSS, any compromised script, any injected third-party bundle on that
// origin could call them directly — and the worst of the six is
// `channels:setPermissionPreset`, which arms the permission posture a spawned agent runs
// with. Chained with H2 (before it was fixed) that was zero-click local code execution:
// the page arms bypass/auto_both for every channel id it can see, and the next spawn on
// any of those channels runs with Bash/WebFetch pre-approved and auto-outbound posting.
//
// main/session-ipc.js has always re-derived its target from `event.sender` (the frozen
// §B.3 contract) for exactly this reason. This file pins that the same discipline now
// covers all SIX ops here, and that it is enforced two ways — because one is not enough:
//
//   1. the sender must be the MAIN WINDOW's webContents; and
//   2. it must be that window's TOP FRAME, because a cross-origin iframe SHARES its
//      host's webContents and would otherwise pass check 1 unchallenged.
//
// Run: `node --test dopl-desktop-app/test/channel-ipc-sender.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("channel-dir-ipc.js");

// ── The pure guard, sliced and driven directly ───────────────────────────────

const BEGIN = "// ─── BEGIN CHANNEL-IPC-SENDER";
const END = "// ─── END CHANNEL-IPC-SENDER";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN CHANNEL-IPC-SENDER sentinel missing");
assert.ok(to > from, "CHANNEL-IPC-SENDER sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { isMainWindowSender } = new Function(`${BLOCK}\n return { isMainWindowSender };`)();

const mkWin = () => {
  const mainFrame = { name: "top" };
  const webContents = { id: 1, mainFrame };
  return { win: { isDestroyed: () => false, webContents }, webContents, mainFrame };
};
const evt = (sender, senderFrame) => ({ sender, senderFrame });

test("the guard ACCEPTS the main window's own top frame", () => {
  const { win, webContents, mainFrame } = mkWin();
  assert.equal(isMainWindowSender(evt(webContents, mainFrame), win), true);
});

test("the guard REFUSES a different window's webContents", () => {
  const { win } = mkWin();
  const other = mkWin();
  assert.equal(isMainWindowSender(evt(other.webContents, other.mainFrame), win), false,
    "a session window, a consent window, or anything else, cannot speak for the main window");
});

test("the guard REFUSES an IFRAME inside the main window (same webContents, different frame)", () => {
  // This is the check that identity alone would miss: an embedded cross-origin frame
  // shares its host's webContents, so `event.sender === win.webContents` is TRUE for it.
  const { win, webContents } = mkWin();
  const iframe = { name: "an-embedded-frame" };
  assert.equal(isMainWindowSender(evt(webContents, iframe), win), false);
});

test("the guard FAILS CLOSED on a missing / destroyed / unbuilt window", () => {
  const { webContents, mainFrame } = mkWin();
  const e = evt(webContents, mainFrame);
  assert.equal(isMainWindowSender(e, null), false, "register ran before the window existed");
  assert.equal(isMainWindowSender(e, undefined), false, "no accessor was supplied at all");
  assert.equal(isMainWindowSender(e, {}), false, "not a BrowserWindow shape");
  assert.equal(isMainWindowSender(e, { isDestroyed: () => true, webContents }), false,
    "a destroyed window can never be a legitimate caller");
});

test("the guard FAILS CLOSED on a senderFrame getter that THROWS (a detached frame)", () => {
  // Electron's `senderFrame` throws once the frame is gone. Reading it defensively must
  // refuse, never wave the call through.
  const { win, webContents } = mkWin();
  const hostile = { sender: webContents };
  Object.defineProperty(hostile, "senderFrame", {
    get() { throw new Error("frame detached"); },
  });
  assert.equal(isMainWindowSender(hostile, win), false);
});

test("the guard FAILS CLOSED on a missing sender or a missing event", () => {
  const { win } = mkWin();
  for (const e of [null, undefined, {}, { sender: null }, { sender: undefined }]) {
    assert.equal(isMainWindowSender(e, win), false, JSON.stringify(e));
  }
});

// ── The wiring: all SIX handlers are wrapped, and refuse an unbound sender ───

// The real file, evaluated with a stub `require` so the real guard + the real UUID gate
// are the ones under test; only electron and the two store-backed modules are swapped.
function bootIpc() {
  const handlers = {};
  const writes = [];
  const dialogs = [];
  const reopens = [];
  const stubRequire = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./channel-prefs") {
      return {
        getPermissionPreset: () => ({ tools: "bypass", messages: "auto_both" }),
        armPermissionPreset: (channelId, preset) => { writes.push({ channelId, preset }); return { ok: true }; },
        clearPermissionPreset: () => {},
      };
    }
    if (id === "./channel-dirs") {
      return {
        liveChannelDirLabel: () => "~/Downloads/secret-repo",
        promptAndSetChannelDir: async () => { dialogs.push(1); },
        clearChannelDir: () => { writes.push({ cleared: true }); },
      };
    }
    if (id === "./session-engine") {
      return { reopenByTask: (a) => { reopens.push(a); return { ok: true }; } };
    }
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);
  const { win, webContents, mainFrame } = mkWin();
  mod.exports.register({ getMainWindow: () => win });
  return {
    handlers, writes, dialogs, reopens,
    bound: evt(webContents, mainFrame),
    iframe: evt(webContents, { name: "embedded" }),
    foreign: (() => { const o = mkWin(); return evt(o.webContents, o.mainFrame); })(),
  };
}

const CH = "44444444-4444-4444-8444-444444444444";
const PRESET = { tools: "bypass", messages: "auto_both" };

// name -> [payload, the value a REFUSED call must return]
const OPS = [
  ["channels:getFolderLabel", CH, null],
  ["channels:chooseFolder", CH, null],
  ["channels:clearFolder", CH, null],
  ["channels:getPermissionPreset", CH, null],
  ["channels:setPermissionPreset", { channelId: CH, preset: PRESET }, { ok: false }],
  ["sessions:reopen", { channelId: CH, taskId: "t1" }, { ok: false }],
];

test("all six privileged ops are registered", () => {
  const { handlers } = bootIpc();
  for (const [name] of OPS) assert.equal(typeof handlers[name], "function", name);
});

test("every op REFUSES a foreign sender, and does no work at all", async () => {
  for (const [name, payload, refusal] of OPS) {
    const ipc = bootIpc();
    assert.deepEqual(await ipc.handlers[name](ipc.foreign, payload), refusal, name);
    assert.deepEqual(ipc.writes, [], `${name} must not write`);
    assert.deepEqual(ipc.dialogs, [], `${name} must not pop a native dialog`);
    assert.deepEqual(ipc.reopens, [], `${name} must not open a window`);
  }
});

test("every op REFUSES an iframe inside the main window", async () => {
  for (const [name, payload, refusal] of OPS) {
    const ipc = bootIpc();
    assert.deepEqual(await ipc.handlers[name](ipc.iframe, payload), refusal, name);
    assert.deepEqual(ipc.writes, [], `${name} must not write for an iframe`);
    assert.deepEqual(ipc.dialogs, [], `${name} must not pop a dialog for an iframe`);
  }
});

test("every op REFUSES when no window accessor was supplied (an unbound surface)", async () => {
  // A mid-wave caller / a harness that forgets `getMainWindow` must get a DEAD surface,
  // not an open one — an unbound privileged handler is the bug, not a compatibility mode.
  const handlers = {};
  const stub = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./channel-prefs") return { getPermissionPreset: () => PRESET, armPermissionPreset: () => ({ ok: true }), clearPermissionPreset: () => {} };
    if (id === "./channel-dirs") return { liveChannelDirLabel: () => "x", promptAndSetChannelDir: async () => {}, clearChannelDir: () => {} };
    if (id === "./session-engine") return { reopenByTask: () => ({ ok: true }) };
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  mod.exports.register({}); // no getMainWindow
  const { webContents, mainFrame } = mkWin();
  for (const [name, payload, refusal] of OPS) {
    assert.deepEqual(await handlers[name](evt(webContents, mainFrame), payload), refusal, name);
  }
});

test("the BOUND sender still gets the real behaviour (the guard is not a mute)", async () => {
  const ipc = bootIpc();
  assert.equal(await ipc.handlers["channels:getFolderLabel"](ipc.bound, CH), "~/Downloads/secret-repo");
  assert.deepEqual(await ipc.handlers["channels:getPermissionPreset"](ipc.bound, CH), PRESET);
  assert.deepEqual(await ipc.handlers["channels:setPermissionPreset"](ipc.bound, { channelId: CH, preset: PRESET }), { ok: true });
  assert.deepEqual(ipc.writes, [{ channelId: CH, preset: PRESET }], "the legitimate write lands");
  await ipc.handlers["channels:chooseFolder"](ipc.bound, CH);
  assert.equal(ipc.dialogs.length, 1, "the operator's own picker still opens");
  assert.deepEqual(await ipc.handlers["sessions:reopen"](ipc.bound, { channelId: CH, taskId: "t1" }), { ok: true });
});

test("a refusal is INDISTINGUISHABLE from a bad-payload rejection", async () => {
  // The refusal shape deliberately matches what a non-UUID id already returns, so a
  // hostile page cannot use the difference to probe which window it is running in.
  const ipc = bootIpc();
  for (const [name, payload, refusal] of OPS) {
    const badPayload = typeof payload === "string" ? "not-a-uuid" : { ...payload, channelId: "not-a-uuid" };
    assert.deepEqual(await ipc.handlers[name](ipc.bound, badPayload), refusal, `${name} bad payload`);
    assert.deepEqual(await ipc.handlers[name](ipc.foreign, payload), refusal, `${name} bad sender`);
  }
});

// ── The wiring index.js is responsible for ───────────────────────────────────

test("index.js passes the LIVE main window, lazily (it is rebuilt on reopen)", () => {
  const INDEX = M("index.js");
  assert.match(INDEX, /channelDirIpc\.register\(\{[^}]*getMainWindow: \(\) => mainWindow[^}]*\}\)/,
    "an accessor, not a snapshot: register() runs before the window exists and it is replaced on reopen");
});

test("no handler in the file skips the wrapper", () => {
  // Structural belt: every ipcMain.handle in this file must go through mainOnly, so a new
  // op cannot be added unbound by simply forgetting to wrap it.
  const calls = SRC.match(/ipcMain\.handle\(/g) || [];
  const wrapped = SRC.match(/ipcMain\.handle\('[^']+', mainOnly\(/g) || [];
  assert.equal(calls.length, OPS.length, "the op count changed — update OPS above");
  assert.equal(wrapped.length, calls.length, "every registered handler is sender-bound");
});

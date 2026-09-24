// THE IN-APP CLAUDE CODE SIGN-IN (`main/claude-auth.js`) over a FAKE `claude setup-token` child: the OAuth
// page opens in the browser, the pasted code reaches the child, and the token it prints becomes Dopl's own.
// No real login and no network. Nothing here opens Terminal, a native dialog or a notification.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";
import { codeOf } from "./helpers/source-probe.mjs";

const SRC = readFileSync(join(MAIN, "claude-auth.js"), "utf8");
const TOKEN = `sk-ant-oat01-${"A1b2_C3d4-".repeat(9)}Zz`;
const URL_OSC = "\x1b]8;;https://claude.com/cai/oauth/authorize?code=true&state=S\x07Sign in\x1b]8;;\x07";

// What setup-token prints once the code is accepted, wrapped at 40 columns with the pty's own escapes.
function printed(token, width = 40) {
  const lines = [];
  for (let i = 0; i < token.length; i += width) lines.push(` \x1b[33m${token.slice(i, i + width)}\x1b[39m`);
  return `\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n\r\nYour OAuth token (valid for 1 year):\r\n${lines.join("\r\n")}\r\n\r\n\x1b[2mStore this token securely. You won't be able to see it again.\x1b[22m\r\n`;
}

function world({ bundled = "/bundle/claude" } = {}) {
  const calls = { spawn: [], opened: [], stdin: [], stored: [], windows: [], diag: [] };
  let child = null;
  const handlers = new Map();
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = {}; this.destroyed = false; calls.windows.push(this); }
    setMenuBarVisibility() {}
    loadFile() {}
    isDestroyed() { return this.destroyed; }
    close() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
  }
  const stubs = {
    path: { join: (...p) => p.join("/") },
    child_process: {
      spawn: (cmd, args, opts) => {
        calls.spawn.push({ cmd, args, env: opts.env });
        child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = { write: (s) => calls.stdin.push(s), end: () => {} };
        child.kill = () => {};
        return child;
      },
    },
    electron: {
      shell: { openExternal: async (u) => { calls.opened.push(u); } },
      BrowserWindow,
      ipcMain: { on: (ch, fn) => handlers.set(ch, fn), removeListener: (ch) => handlers.delete(ch) },
    },
    "./session-spawner": { cliEnv: () => ({ PATH: "/bin" }), getClaudeBinPath: async () => "/usr/local/bin/claude" },
    "./claude-token": { setStoredOAuthToken: (t) => { calls.stored.push(t); return true; } },
    "./diag": { diag: (...a) => calls.diag.push(a.join(" ")) },
    "./runtime/claude/loader": { resolveClaudeExecutable: () => bundled },
  };
  // `__dirname` is the one module-scope name the sandbox does not provide.
  const auth = evalModule(`const __dirname = ${JSON.stringify(MAIN)};\n${SRC}`, (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`unexpected require: ${id}`);
  });
  const out = (s) => child.stdout.emit("data", Buffer.from(s, "latin1"));
  const submit = (code) => handlers.get("code-prompt:submit")({ sender: calls.windows[0].webContents }, code);
  return { auth, calls, out, submit, child: () => child };
}

test("browser + paste window, then the token the child PRINTS is stored as Dopl's own", async () => {
  const w = world();
  const p = w.auth.signIn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(w.calls.spawn[0].args, ["-q", "/dev/null", "/bundle/claude", "setup-token"], "the bundled binary, under a pty");
  w.out(`Opening browser to sign in…\r\n${URL_OSC}\r\nPaste code here if prompted > `);
  assert.deepEqual(w.calls.opened, ["https://claude.com/cai/oauth/authorize?code=true&state=S"]);
  assert.equal(w.calls.windows.length, 1, "one paste window");
  w.submit("CODE#STATE");
  assert.deepEqual(w.calls.stdin, ["CODE#STATE\n"]);
  w.out(printed(TOKEN).slice(0, 120)); // a token still arriving is never taken
  assert.deepEqual(w.calls.stored, []);
  w.out(printed(TOKEN).slice(120));
  assert.deepEqual(await p, { ok: true });
  assert.deepEqual(w.calls.stored, [TOKEN], "the whole token, joined across the wrapped lines");
  assert.ok(!w.calls.diag.some((line) => line.includes("sk-ant-")), "the token never reaches a log");
});

test("an exit before a token, or a closed paste window, is a failed sign-in and stores nothing", async () => {
  const exited = world();
  const a = exited.auth.signIn();
  await new Promise((r) => setImmediate(r));
  exited.out(URL_OSC);
  exited.child().emit("close", 0);
  assert.deepEqual(await a, { ok: false }, "a clean exit with no token is not a sign-in");

  const cancelled = world();
  const b = cancelled.auth.signIn();
  await new Promise((r) => setImmediate(r));
  cancelled.out(URL_OSC);
  cancelled.calls.windows[0].close();
  assert.deepEqual(await b, { ok: false });
  assert.deepEqual([...exited.calls.stored, ...cancelled.calls.stored], []);
});

test("a second click while a sign-in runs joins it — one child, one answer", async () => {
  const w = world();
  const first = w.auth.signIn();
  const second = w.auth.signIn();
  assert.equal(first, second);
  await new Promise((r) => setImmediate(r));
  w.out(URL_OSC + printed(TOKEN));
  assert.deepEqual(await first, { ok: true });
  assert.equal(w.calls.spawn.length, 1);
});

test("no bundled binary falls back to the external CLI", async () => {
  const w = world({ bundled: null });
  const p = w.auth.signIn();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.calls.spawn[0].args[2], "/usr/local/bin/claude");
  w.child().emit("close", 1);
  assert.deepEqual(await p, { ok: false });
});

test("the token is read only between its two markers, whatever surrounds it", () => {
  const { extractToken } = world().auth;
  assert.equal(extractToken(printed(TOKEN, 17)), TOKEN);
  assert.equal(extractToken(`echo sk-ant-oat01-${"x".repeat(40)}\r\n`), null, "a token-shaped string outside the markers");
  assert.equal(extractToken(printed(TOKEN).replace(/Store this token securely[^\n]*\n/, "")), null, "not until it has all arrived");
});

test("THE TERMINAL PATH AND THE NATIVE PROMPTS ARE GONE — the runtime-generic prompt is the only one", () => {
  const code = codeOf(SRC);
  for (const gone of [/osascript/, /\/login/, /Terminal/, /showMessageBox/, /Notification/, /terminalFallback/]) {
    assert.equal(gone.test(code), false, `claude-auth.js still carries ${gone}`);
  }
});

// THE IN-APP CLAUDE CODE SIGN-IN (`main/claude-auth.js`) over a FAKE `claude setup-token` child spawned
// directly (no pty, no paste window): the token it prints becomes Dopl's own. No real login and no network.
// Nothing here opens Terminal, a native dialog or a notification.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN } from "./helpers/module-sandbox.mjs";
import { codeOf } from "./helpers/source-probe.mjs";

const SRC = readFileSync(join(MAIN, "claude-auth.js"), "utf8");
const TOKEN = `sk-ant-oat01-${"A1b2_C3d4-".repeat(9)}Zz`;

// What setup-token prints once the browser flow completes, wrapped at 40 columns with its own escapes.
function printed(token, width = 40) {
  const lines = [];
  for (let i = 0; i < token.length; i += width) lines.push(` \x1b[33m${token.slice(i, i + width)}\x1b[39m`);
  return `\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n\r\nYour OAuth token (valid for 1 year):\r\n${lines.join("\r\n")}\r\n\r\n\x1b[2mStore this token securely. You won't be able to see it again.\x1b[22m\r\n`;
}

function world({ bundled = "/bundle/claude" } = {}) {
  const calls = { spawn: [], stored: [], diag: [] };
  let child = null;
  const stubs = {
    child_process: {
      spawn: (cmd, args, opts) => {
        calls.spawn.push({ cmd, args, env: opts.env, stdio: opts.stdio });
        child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        return child;
      },
    },
    "./session-spawner": { cliEnv: () => ({ PATH: "/bin" }), getClaudeBinPath: async () => "/usr/local/bin/claude" },
    "./claude-token": { setStoredOAuthToken: (t) => { calls.stored.push(t); return true; } },
    "./diag": { diag: (...a) => calls.diag.push(a.join(" ")) },
    "./runtime/claude/loader": { resolveClaudeExecutable: () => bundled },
  };
  const auth = evalModule(SRC, (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`unexpected require: ${id}`);
  });
  const out = (s) => child.stdout.emit("data", Buffer.from(s, "utf8"));
  const exit = (code) => child.emit("close", code);
  return { auth, calls, out, exit };
}

const tick = () => new Promise((r) => setImmediate(r));

test("spawns setup-token directly, and the token it PRINTS is stored as Dopl's own", async () => {
  const w = world();
  const p = w.auth.signIn();
  await tick();
  assert.deepEqual(w.calls.spawn[0], {
    cmd: "/bundle/claude",
    args: ["setup-token"],
    env: { PATH: "/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  w.out(printed(TOKEN).slice(0, 120)); // a token still arriving is never taken
  assert.deepEqual(w.calls.stored, []);
  w.out(printed(TOKEN).slice(120));
  assert.deepEqual(await p, { ok: true });
  assert.deepEqual(w.calls.stored, [TOKEN], "the whole token, joined across the wrapped lines");
  assert.ok(!w.calls.diag.some((line) => line.includes("sk-ant-")), "the token never reaches a log");
});

test("without a TTY, a lone token line is taken only once the CLI exits 0", async () => {
  const ok = world();
  const a = ok.auth.signIn();
  await tick();
  ok.out(`Opening browser…\n${TOKEN}\n`);
  assert.deepEqual(ok.calls.stored, [], "not before the exit");
  ok.exit(0);
  assert.deepEqual(await a, { ok: true });
  assert.deepEqual(ok.calls.stored, [TOKEN]);
  assert.ok(!ok.calls.diag.some((line) => line.includes("sk-ant-")));

  const failed = world();
  const b = failed.auth.signIn();
  await tick();
  failed.out(`${TOKEN}\n`);
  failed.exit(1);
  assert.deepEqual(await b, { ok: false }, "a non-zero exit is never a sign-in");
  assert.deepEqual(failed.calls.stored, []);
});

test("an exit before a token is a failed sign-in and stores nothing", async () => {
  const w = world();
  const p = w.auth.signIn();
  await tick();
  w.out("Opening browser…\n");
  w.exit(0);
  assert.deepEqual(await p, { ok: false }, "a clean exit with no token is not a sign-in");
  assert.deepEqual(w.calls.stored, []);
});

test("a second click while a sign-in runs joins it — one child, one answer", async () => {
  const w = world();
  const first = w.auth.signIn();
  const second = w.auth.signIn();
  assert.equal(first, second);
  await tick();
  w.out(printed(TOKEN));
  assert.deepEqual(await first, { ok: true });
  assert.equal(w.calls.spawn.length, 1);
});

test("no bundled binary falls back to the external CLI", async () => {
  const w = world({ bundled: null });
  const p = w.auth.signIn();
  await tick();
  assert.equal(w.calls.spawn[0].cmd, "/usr/local/bin/claude");
  w.exit(1);
  assert.deepEqual(await p, { ok: false });
});

test("the token is read between its markers, or as one whole bare line", () => {
  const { extractToken, extractLoneToken } = world().auth;
  assert.equal(extractToken(printed(TOKEN, 17)), TOKEN);
  assert.equal(extractToken(`echo sk-ant-oat01-${"x".repeat(40)}\r\n`), null, "a token-shaped string outside the markers");
  assert.equal(extractToken(printed(TOKEN).replace(/Store this token securely[^\n]*\n/, "")), null, "not until it has all arrived");
  assert.equal(extractLoneToken(`\x1b[33m${TOKEN}\x1b[39m\r\n`), TOKEN);
  assert.equal(extractLoneToken(`echo ${TOKEN}\n`), null, "a token inside other text");
  assert.equal(extractLoneToken(`${TOKEN}\n${TOKEN}x\n`), null, "two candidates is none");
});

test("THE TERMINAL PATH, THE PTY AND THE PASTE WINDOW ARE GONE", () => {
  const code = codeOf(SRC);
  for (const gone of [/osascript/, /\/login/, /Terminal/, /showMessageBox/, /Notification/, /terminalFallback/, /BrowserWindow/, /ipcMain/, /\/dev\/null/, /code-prompt/]) {
    assert.equal(gone.test(code), false, `claude-auth.js still carries ${gone}`);
  }
});

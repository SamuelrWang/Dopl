// THE IN-APP CLAUDE CODE SIGN-INS (`main/claude-auth.js`) over FAKE children spawned directly (no pty, no paste
// window): the token `setup-token` prints becomes Dopl's own, and "Enable Chrome & connectors" runs
// `auth login` into Dopl's private store. No real login and no network. Nothing here opens Terminal, a native
// dialog or a notification.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evalModule, MAIN, real } from "./helpers/module-sandbox.mjs";
import { codeOf } from "./helpers/source-probe.mjs";

const SRC = readFileSync(join(MAIN, "claude-auth.js"), "utf8");
const TOKEN = `sk-ant-oat01-${"A1b2_C3d4-".repeat(9)}Zz`;

// What setup-token prints once the browser flow completes, wrapped at 40 columns with its own escapes.
function printed(token, width = 40) {
  const lines = [];
  for (let i = 0; i < token.length; i += width) lines.push(` \x1b[33m${token.slice(i, i + width)}\x1b[39m`);
  return `\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\n\r\nYour OAuth token (valid for 1 year):\r\n${lines.join("\r\n")}\r\n\r\n\x1b[2mStore this token securely. You won't be able to see it again.\x1b[22m\r\n`;
}

const DIR = "/userData/claude-full-login";

function world({ bundled = "/bundle/claude", env = { PATH: "/bin" } } = {}) {
  const calls = { spawn: [], stored: [], diag: [], full: [], mkdir: [] };
  const children = [];
  let child = null;
  const stubs = {
    fs: { mkdirSync: (p, o) => calls.mkdir.push([p, o.mode]) },
    child_process: {
      spawn: (cmd, args, opts) => {
        calls.spawn.push({ cmd, args, env: opts.env, stdio: opts.stdio });
        child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        children.push(child);
        return child;
      },
    },
    "./session-spawner": { cliEnv: () => ({ ...env }), getClaudeBinPath: async () => "/usr/local/bin/claude" },
    "./runtime/cli-spawn": real("./runtime/cli-spawn"),
    "./runtime/claude/credential": real("./runtime/claude/credential"),
    "./claude-token": {
      setStoredOAuthToken: (t) => { calls.stored.push(t); return true; },
      fullLoginDir: () => DIR,
      setFullLogin: (on) => { calls.full.push(on); return true; },
    },
    "./diag": { diag: (...a) => calls.diag.push(a.join(" ")) },
    "./runtime/claude/loader": { resolveClaudeExecutable: () => bundled },
  };
  const auth = evalModule(SRC, (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`unexpected require: ${id}`);
  });
  const out = (s) => child.stdout.emit("data", Buffer.from(s, "utf8"));
  const exit = (code) => child.emit("close", code);
  const exitAll = (code) => children.forEach((c) => c.emit("close", code));
  return { auth, calls, out, exit, exitAll };
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

// ── "ENABLE CHROME & CONNECTORS" (Samuel, 2026-09-25, ruling 4) ─────────────────────────────

const STATUS = (method) => `{\n  "loggedIn": true,\n  "authMethod": "${method}",\n  "apiProvider": "firstParty"\n}\n`;

test("FULL LOGIN: `auth login` runs in Dopl's private store with no inherited credential; `auth status` confirms it", async () => {
  const w = world({ env: { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-inherited", CLAUDE_SECURESTORAGE_CONFIG_DIR: "/elsewhere" } });
  const p = w.auth.signInFull();
  await tick();
  const want = { PATH: "/bin", CLAUDE_CONFIG_DIR: DIR, CLAUDE_SECURESTORAGE_CONFIG_DIR: DIR };
  assert.deepEqual(w.calls.spawn[0], { cmd: "/bundle/claude", args: ["auth", "login", "--claudeai"], env: want, stdio: ["ignore", "pipe", "pipe"] });
  assert.deepEqual(w.calls.mkdir, [[DIR, 0o700]], "the private directory is the operator's alone");
  w.out("Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\n");
  w.exit(0);
  await tick();
  assert.deepEqual(w.calls.spawn[1].args, ["auth", "status", "--json"]);
  assert.deepEqual(w.calls.spawn[1].env, want, "the status reads the same private store");
  w.out(STATUS("claude.ai"));
  w.exit(0);
  assert.deepEqual(await p, { ok: true });
  assert.deepEqual(w.calls.full, [true], "only a marker is stored — the login stays in the CLI's store");
  assert.deepEqual(w.calls.stored, [], "the inference token is untouched");
  assert.ok(!w.calls.diag.some((line) => /https?:|sk-ant-/.test(line)), "no URL or credential reaches a log");
});

test("FULL LOGIN: a failed login asks for no status; a non-claude.ai status stores no marker", async () => {
  const failed = world();
  const a = failed.auth.signInFull();
  await tick();
  failed.exit(1);
  assert.deepEqual(await a, { ok: false });
  assert.equal(failed.calls.spawn.length, 1);
  assert.deepEqual(failed.calls.full, []);

  const console_ = world();
  const b = console_.auth.signInFull();
  await tick();
  console_.exit(0);
  await tick();
  console_.out(STATUS("console"));
  console_.exit(0);
  assert.deepEqual(await b, { ok: false }, "a Console (API-key) login carries no claude.ai scopes");
  assert.deepEqual(console_.calls.full, []);
});

test("FULL LOGIN: a second click joins the running flow; it is independent of the token sign-in", async () => {
  const w = world();
  const first = w.auth.signInFull();
  assert.equal(w.auth.signInFull(), first);
  const token = w.auth.signIn();
  assert.notEqual(token, first, "the two kinds never join each other");
  await tick();
  assert.equal(w.calls.spawn.length, 2, "one child each");
  w.exitAll(1);
  assert.deepEqual([await first, await token], [{ ok: false }, { ok: false }]);
});

test("FULL LOGIN: the status parse wants a logged-in claude.ai login and nothing else", () => {
  const { isClaudeAiLogin } = world().auth;
  assert.equal(isClaudeAiLogin(STATUS("claude.ai")), true);
  assert.equal(isClaudeAiLogin(`\x1b[0m${STATUS("claude.ai")}\x1b[0m`), true, "terminal escapes around it");
  assert.equal(isClaudeAiLogin(STATUS("console")), false);
  assert.equal(isClaudeAiLogin('{"loggedIn": false, "authMethod": "none"}'), false);
  assert.equal(isClaudeAiLogin("not json"), false);
});

test("FULL LOGIN: sign-out drops the marker at once, then runs the CLI's own logout on the private store", async () => {
  const w = world();
  w.auth.signOutFull();
  assert.deepEqual(w.calls.full, [false], "no later spawn can pick it up");
  await tick();
  await tick();
  assert.deepEqual(w.calls.spawn[0].args, ["auth", "logout"]);
  assert.equal(w.calls.spawn[0].env.CLAUDE_SECURESTORAGE_CONFIG_DIR, DIR, "it can only empty Dopl's store");
  w.exit(0);
});

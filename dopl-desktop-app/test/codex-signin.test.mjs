// THE IN-APP CODEX SIGN-IN (2026-09-23) — `runtime/codex/login.js` over a FAKE app-server connection,
// and `runtime/codex/credential.js` over fakes. No real login, no OpenAI call:
// the live tier is `codex-signin-live.test.mjs` (CODEX_APP_SERVER_LIVE=1, never completes a login).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync, existsSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { loadWithStubs } from "./helpers/module-sandbox.mjs";

const require = createRequire(import.meta.url);
const login = require("../main/runtime/codex/login.js");

// login.js unrefs its own timers so a pending login never holds the app open; on Node 22 the runner
// then sees an empty event loop mid-await and cancels the file. One referenced handle holds it.
let hold;
before(() => { hold = setInterval(() => {}, 1000); });
after(() => clearInterval(hold));

const AUTH_URL = "https://auth.openai.com/oauth/authorize?state=SECRETSTATE&code_challenge=PKCE";
const DEVICE = { loginId: "D1", userCode: "ABCD-1234", verificationUrl: "https://auth.openai.com/codex/device" };

function fakeServer({ browser = "ok", authUrl = AUTH_URL, stubborn = false } = {}) {
  const calls = [];
  const kills = [];
  let hooks = null;
  let closed = false;
  const conn = {
    // A child that ignores SIGTERM (`stubborn`) exits only on SIGKILL.
    child: { kill: (sig) => { kills.push(sig); if (sig === "SIGKILL") setImmediate(() => hooks.onExit(null, "SIGKILL", null)); } },
    async request(method, params) {
      calls.push({ method, params });
      if (closed) throw new Error("codex app-server is not running");
      if (method === "initialize") return {};
      if (method === "account/login/cancel") return { status: "canceled" };
      if (method === "account/login/start" && params.type === "chatgpt") {
        if (browser === "fail") throw new Error("failed to bind the login callback port");
        return { type: "chatgpt", loginId: "L1", authUrl };
      }
      if (method === "account/login/start" && params.type === "chatgptDeviceCode") {
        return { type: "chatgptDeviceCode", ...DEVICE };
      }
      throw new Error(`unexpected ${method}`);
    },
    notify(method) { calls.push({ method, notify: true }); },
    close() {
      if (closed) return;
      closed = true;
      if (!stubborn) setImmediate(() => hooks.onExit(0, null, null));
    },
    isClosed: () => closed,
  };
  return {
    calls,
    kills,
    connect: (opts) => { hooks = opts; return conn; },
    closed: () => closed,
    home: () => hooks.env.CODEX_HOME,
    // What the real app-server does on success: write `$CODEX_HOME/auth.json`, then notify.
    complete(loginId, success = true) {
      if (success) writeFileSync(join(hooks.env.CODEX_HOME, "auth.json"), '{"tokens":"fixture"}', { mode: 0o644 });
      hooks.onNotification({ method: "account/login/completed", params: { loginId, success, error: success ? null : "denied" } });
    },
    exit() { closed = true; hooks.onExit(1, null, null); },
    methods: () => calls.map((c) => c.params && c.params.type ? `${c.method}:${c.params.type}` : c.method),
  };
}

function world(srv, over = {}) {
  const root = mkdtempSync(join(tmpdir(), "dopl-codex-signin-"));
  const w = { root, opened: [], shown: [], diags: [], quit: null, codeClosed: 0 };
  w.deps = {
    electron: false,
    connect: srv.connect,
    initializeParams: () => ({ clientInfo: { name: "dopl" } }),
    version: () => "0.0.0-test",
    diag: (...a) => w.diags.push(a.map(String).join(" ")),
    openExternal: async (url) => { w.opened.push(url); },
    showCode: (x) => { w.shown.push(x); return () => { w.codeClosed += 1; }; },
    onQuit: (fn) => { w.quit = fn; return () => { w.quit = null; }; },
    userDataRoot: root,
    timeoutMs: 60000,
    ...over,
  };
  w.priv = join(root, "codex-runtime-home-v1", "auth.json");
  w.loginHome = join(root, "codex-login-home-v1");
  w.done = () => rmSync(root, { recursive: true, force: true });
  return w;
}

async function until(pred, what) {
  for (let i = 0; i < 500; i += 1) {
    if (pred()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function assertNoSecretsLogged(w) {
  const all = w.diags.join("\n");
  assert.ok(!/SECRETSTATE|PKCE|code_challenge|ABCD-1234|fixture/.test(all), all);
}

// ── THE LOGIN OP ─────────────────────────────────────────────────────────────────────────────

test("browser flow: opens the OpenAI URL, awaits completion, installs a Dopl-owned 0600 auth.json", async () => {
  const srv = fakeServer();
  const w = world(srv);
  try {
    const p = login.signIn(w.deps);
    await until(() => w.opened.length === 1, "the browser");
    assert.deepEqual(w.opened, [AUTH_URL]);
    assert.equal(srv.home(), w.loginHome, "the login runs in its throwaway home, never the session home");
    srv.complete("L1");
    assert.deepEqual(await p, { ok: true });
    assert.equal(lstatSync(w.priv).isFile(), true);
    assert.equal(lstatSync(w.priv).mode & 0o777, 0o600);
    assert.equal(existsSync(w.loginHome), false, "the login home is removed");
    assert.equal(srv.closed(), true, "the child is closed");
    assert.equal(w.quit, null, "the quit hook is released");
    assert.deepEqual(srv.methods(), ["initialize", "initialized", "account/login/start:chatgpt"]);
    assertNoSecretsLogged(w);
  } finally {
    w.done();
  }
});

test("a login over a linked operator credential replaces the LINK, never the operator's file", async () => {
  const srv = fakeServer();
  const w = world(srv);
  try {
    const operator = join(w.root, "operator-auth.json");
    writeFileSync(operator, '{"operator":true}', { mode: 0o600 });
    mkdirSync(join(w.root, "codex-runtime-home-v1"), { recursive: true });
    symlinkSync(operator, w.priv);
    const p = login.signIn(w.deps);
    await until(() => w.opened.length === 1, "the browser");
    srv.complete("L1");
    assert.equal((await p).ok, true);
    assert.equal(lstatSync(w.priv).isSymbolicLink(), false);
    assert.equal(readFileSync(w.priv, "utf8"), '{"tokens":"fixture"}');
    assert.equal(readFileSync(operator, "utf8"), '{"operator":true}');
  } finally {
    w.done();
  }
});

test("device-code fallback: the browser flow cannot start, so the code is shown and the URL opened", async () => {
  const srv = fakeServer({ browser: "fail" });
  const w = world(srv);
  try {
    const p = login.signIn(w.deps);
    await until(() => w.shown.length === 1 && w.opened.length === 1, "the device code");
    assert.equal(w.shown[0].userCode, "ABCD-1234");
    assert.deepEqual(w.opened, [DEVICE.verificationUrl]);
    srv.complete("D1");
    assert.deepEqual(await p, { ok: true });
    assert.equal(w.codeClosed, 1, "the code sheet is closed when the flow settles");
    assert.deepEqual(srv.methods(),
      ["initialize", "initialized", "account/login/start:chatgpt", "account/login/start:chatgptDeviceCode"]);
    assertNoSecretsLogged(w);
  } finally {
    w.done();
  }
});

test("a browser that cannot open cancels that login and falls back to the device code", async () => {
  const srv = fakeServer();
  const w = world(srv, { openExternal: async (url) => { w.opened.push(url); if (w.opened.length === 1) throw new Error("no browser"); } });
  try {
    const p = login.signIn(w.deps);
    await until(() => w.shown.length === 1, "the device code");
    srv.complete("L1"); // a late completion for the cancelled login is ignored
    srv.complete("D1");
    assert.deepEqual(await p, { ok: true });
    const cancels = srv.calls.filter((c) => c.method === "account/login/cancel").map((c) => c.params.loginId);
    assert.deepEqual(cancels, ["L1"]);
  } finally {
    w.done();
  }
});

test("a non-OpenAI URL is refused: nothing is opened, the login is cancelled, the child cleaned up", async () => {
  for (const authUrl of [
    "https://evil.example/oauth/authorize?state=SECRETSTATE",
    "http://auth.openai.com/oauth/authorize",
    "https://auth.openai.com.evil.example/oauth/authorize",
    "https://user:pw@auth.openai.com/oauth/authorize",
    "https://auth.openai.com:8443/oauth/authorize",
    "javascript:alert(1)",
  ]) {
    const srv = fakeServer({ authUrl });
    const w = world(srv);
    try {
      assert.deepEqual(await login.signIn(w.deps), { ok: false, reason: "untrusted-url" }, authUrl);
      assert.deepEqual(w.opened, [], authUrl);
      assert.ok(srv.calls.some((c) => c.method === "account/login/cancel" && c.params.loginId === "L1"), authUrl);
      assert.equal(srv.closed(), true);
      assert.equal(existsSync(w.loginHome), false);
      assert.equal(existsSync(w.priv), false, "no credential was installed");
      assertNoSecretsLogged(w);
    } finally {
      w.done();
    }
  }
});

test("Cancel on the device-code sheet cancels the login and cleans up", async () => {
  const srv = fakeServer({ browser: "fail" });
  const w = world(srv);
  try {
    const p = login.signIn(w.deps);
    await until(() => w.shown.length === 1, "the device code");
    w.shown[0].onCancel();
    assert.deepEqual(await p, { ok: false, reason: "cancelled" });
    assert.ok(srv.calls.some((c) => c.method === "account/login/cancel" && c.params.loginId === "D1"));
    assert.equal(srv.closed(), true);
    assert.equal(existsSync(w.loginHome), false);
  } finally {
    w.done();
  }
});

test("a timeout cancels the login, closes the child and removes the login home", async () => {
  const srv = fakeServer();
  const w = world(srv, { timeoutMs: 50 });
  try {
    assert.deepEqual(await login.signIn(w.deps), { ok: false, reason: "timeout" });
    assert.ok(srv.calls.some((c) => c.method === "account/login/cancel" && c.params.loginId === "L1"));
    assert.equal(srv.closed(), true);
    assert.equal(existsSync(w.loginHome), false);
    assert.equal(existsSync(w.priv), false);
  } finally {
    w.done();
  }
});

test("a child that ignores SIGTERM is SIGKILLed before the flow settles (the login port is freed)", async () => {
  const srv = fakeServer({ stubborn: true });
  const w = world(srv, { timeoutMs: 20, stepMs: 20 });
  try {
    assert.deepEqual(await login.signIn(w.deps), { ok: false, reason: "timeout" });
    assert.deepEqual(srv.kills, ["SIGKILL"]);
    assert.equal(existsSync(w.loginHome), false);
  } finally {
    w.done();
  }
});

test("a second click cancels the first flow and runs its own", async () => {
  const first = fakeServer();
  const second = fakeServer();
  const w1 = world(first);
  const w2 = world(second, { userDataRoot: w1.root });
  try {
    const p1 = login.signIn(w1.deps);
    await until(() => w1.opened.length === 1, "the first browser");
    const p2 = login.signIn(w2.deps);
    assert.deepEqual(await p1, { ok: false, reason: "superseded" });
    assert.ok(first.calls.some((c) => c.method === "account/login/cancel"));
    assert.equal(first.closed(), true);
    await until(() => w2.opened.length === 1, "the second browser");
    second.complete("L1");
    assert.deepEqual(await p2, { ok: true });
  } finally {
    w1.done();
    w2.done();
  }
});

test("three quick clicks: the newest wins; the ones before it are superseded", async () => {
  const servers = [fakeServer(), fakeServer(), fakeServer()];
  const first = world(servers[0]);
  const ws = [first, world(servers[1], { userDataRoot: first.root }), world(servers[2], { userDataRoot: first.root })];
  try {
    const p1 = login.signIn(ws[0].deps);
    await until(() => ws[0].opened.length === 1, "the first browser");
    const p2 = login.signIn(ws[1].deps);
    const p3 = login.signIn(ws[2].deps);
    assert.deepEqual(await p1, { ok: false, reason: "superseded" });
    assert.deepEqual(await p2, { ok: false, reason: "superseded" });
    await until(() => ws[2].opened.length === 1, "the third browser");
    servers[2].complete("L1");
    assert.deepEqual(await p3, { ok: true });
    assert.equal(servers[0].closed(), true);
    assert.deepEqual(servers[1].calls, [], "the middle click stepped aside before spawning anything");
  } finally {
    ws.forEach((w) => w.done());
  }
});

test("app quit kills the child at once (no cancel round trip) and cleans up", async () => {
  const srv = fakeServer();
  const w = world(srv);
  try {
    const p = login.signIn(w.deps);
    await until(() => w.opened.length === 1, "the browser");
    w.quit();
    assert.deepEqual(await p, { ok: false, reason: "quit" });
    assert.equal(srv.closed(), true);
    assert.ok(!srv.calls.some((c) => c.method === "account/login/cancel"));
    assert.equal(existsSync(w.loginHome), false);
  } finally {
    w.done();
  }
});

test("a failed completion or an exited child installs nothing", async () => {
  const failed = fakeServer();
  const w1 = world(failed);
  const exited = fakeServer();
  const w2 = world(exited);
  try {
    const p1 = login.signIn(w1.deps);
    await until(() => w1.opened.length === 1, "the browser");
    failed.complete("L1", false);
    assert.deepEqual(await p1, { ok: false, reason: "failed" });
    assert.equal(existsSync(w1.priv), false);

    const p2 = login.signIn(w2.deps);
    await until(() => w2.opened.length === 1, "the browser");
    exited.exit();
    assert.deepEqual(await p2, { ok: false, reason: "exited" });
    assert.equal(existsSync(w2.loginHome), false);
  } finally {
    w1.done();
    w2.done();
  }
});

test("isOpenAiUrl: https on an OpenAI/ChatGPT host only", () => {
  for (const ok of ["https://auth.openai.com/x", "https://chatgpt.com/", "https://openai.com"]) {
    assert.equal(login.isOpenAiUrl(ok), true, ok);
  }
  for (const bad of ["https://openai.com.evil.example", "https://notopenai.com", "http://openai.com", "", null, "ftp://openai.com"]) {
    assert.equal(login.isOpenAiUrl(bad), false, String(bad));
  }
  assert.equal(login.redactUrl(AUTH_URL), "https://auth.openai.com/oauth/authorize");
});

// ── credential.js: Dopl's own auth.json is the whole answer ─────────────────────────────────

function credentialWith({ outcome, hasAuth = false, removeThrows = false }) {
  const calls = [];
  const cred = loadWithStubs("runtime/codex/credential.js", {
    "./config-home": {
      hasAuth: () => hasAuth,
      removeAuth: () => { calls.push("remove"); if (removeThrows) throw new Error("EACCES"); },
    },
    "./login": { signIn: async () => { calls.push("login"); if (outcome instanceof Error) throw outcome; return outcome; } },
  });
  return { cred, calls };
}

test("signed in = Dopl's own auth.json in the session home; nothing is spawned to ask", () => {
  assert.deepEqual(credentialWith({ hasAuth: true }).cred.credentialState(), { usable: true, source: "dopl-auth-file" });
  assert.deepEqual(credentialWith({ hasAuth: false }).cred.credentialState(), { usable: false, source: null });
});

test("signIn answers the login's own outcome, and a throwing login is a failed one", async () => {
  assert.deepEqual(await credentialWith({ outcome: { ok: true } }).cred.signIn(), { ok: true });
  assert.deepEqual(await credentialWith({ outcome: { ok: false, reason: "cancelled" } }).cred.signIn(), { ok: false });
  assert.deepEqual(await credentialWith({ outcome: new Error("boom") }).cred.signIn(), { ok: false });
});

test("signOut removes Dopl's auth.json and says whether it could", () => {
  const ok = credentialWith({});
  assert.equal(ok.cred.signOut(), true);
  assert.deepEqual(ok.calls, ["remove"]);
  assert.equal(credentialWith({ removeThrows: true }).cred.signOut(), false);
});

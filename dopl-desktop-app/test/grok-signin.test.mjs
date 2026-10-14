// The in-app Grok sign-in: `grok login --device-auth` under script(1) in a throwaway home, its printed URL +
// code scraped (the REAL 1.0.52 output, `fixtures/grok/login-device-auth-1.0.52.txt`, code redacted), xAI's page
// opened, and the login home's `auth.json` installed as Dopl's on exit 0. A fake child stands in for the CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { g, FIX, until } from "./_grok-harness.mjs";

const login = g("login.js");
const home = g("config-home.js");
const PRINTED = readFileSync(join(FIX, "login-device-auth-1.0.52.txt"), "utf8");

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = () => { c.killed = true; };
  return c;
}

function flow(o = {}) {
  const root = mkdtempSync(join(tmpdir(), "dopl-grok-signin-"));
  const opened = [];
  const shown = [];
  const spawned = [];
  const child = fakeChild();
  const outcome = login.signIn({
    electron: false, userDataRoot: root, bin: async () => "/fake/grok", diag: () => {},
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return child; },
    openExternal: async (u) => { opened.push(u); }, showCode: ({ userCode }) => { shown.push(userCode); return () => {}; },
    onQuit: () => () => {}, ...(o.overrides || {}),
  });
  return { root, child, outcome, opened, shown, spawned };
}

test("the real printed output scrapes to xAI's device page and its code", () => {
  const s = login.scrape(PRINTED);
  assert.equal(s.url, "https://accounts.x.ai/oauth2/device?user_code=WXYZ-2345");
  assert.equal(s.code, "WXYZ-2345");
  assert.deepEqual(login.scrape("To sign in, open this URL in your browser:\r\n"), { url: null, code: null }, "nothing until both are printed");
  assert.equal(login.scrape("open https://evil.example/oauth2/device?user_code=AB12-CD34\nConfirm this code in your browser: AB12-CD34").url, null,
    "a non-xAI URL is never opened");
  assert.equal(login.redactUrl("https://accounts.x.ai/oauth2/device?user_code=WXYZ-2345"), "https://accounts.x.ai/oauth2/device");
});

test("granted: `grok login --device-auth` under script(1) in the LOGIN home; code shown, page opened, credential installed", async () => {
  const h = flow();
  await until(() => h.spawned.length === 1, "no spawn");
  const { cmd, args, opts } = h.spawned[0];
  assert.equal(cmd, "/usr/bin/script");
  assert.deepEqual(args, ["-q", "/dev/null", "/fake/grok", "login", "--device-auth"]);
  assert.deepEqual(opts.stdio, ["ignore", "pipe", "pipe"]);
  assert.ok(opts.env.HOME.includes(home.LOGIN_HOME) && opts.env.GROK_AUTH_PATH.startsWith(opts.env.HOME));
  assert.equal(opts.env.XAI_API_KEY, undefined);
  for (const line of PRINTED.split("\n")) h.child.stdout.emit("data", `${line}\n`);
  await until(() => h.shown.length === 1, "code not shown");
  assert.deepEqual(h.shown, ["WXYZ-2345"]);
  assert.deepEqual(h.opened, ["https://accounts.x.ai/oauth2/device?user_code=WXYZ-2345"]);
  writeFileSync(opts.env.GROK_AUTH_PATH, "{}"); // what Grok writes on success
  h.child.emit("close", 0);
  assert.deepEqual(await h.outcome, { ok: true });
  assert.equal(home.hasAuth(h.root), true);
});

test("an exit without a credential, a failed exit, and Cancel all end without installing anything", async () => {
  const none = flow();
  await until(() => none.spawned.length === 1, "no spawn");
  none.child.emit("close", 0);
  assert.deepEqual(await none.outcome, { ok: false, reason: "no-credential" });
  assert.equal(home.hasAuth(none.root), false);

  const bad = flow();
  await until(() => bad.spawned.length === 1, "no spawn");
  bad.child.emit("close", 1);
  assert.equal((await bad.outcome).ok, false);

  const cancelled = flow();
  await until(() => cancelled.spawned.length === 1, "no spawn");
  assert.equal(login.cancel(), true);
  assert.deepEqual(await cancelled.outcome, { ok: false, reason: "cancelled" });
  assert.equal(cancelled.child.killed, true, "killing script(1) takes the CLI down");
});

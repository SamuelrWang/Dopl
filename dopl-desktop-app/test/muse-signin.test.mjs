// The in-app Muse sign-in: Muse's own device-code login over MSP (`account/loginStart {type:"deviceCode"}`,
// measured live on 1.4.7: `verificationUrl` on auth.meta.com + `userCode`; `account/loginCancel` →
// `loginCompleted {outcome:"cancelled"}`), in a throwaway home, installed as Dopl's `auth.json` on success.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { m, fakeConn, INIT, until } from "./_muse-harness.mjs";

const login = m("login.js");
const home = m("config-home.js");

// login.js unrefs its own timers so a pending login never holds the app open (the real `muse serve` child
// does); the fake conn has no child, so on Node 22 the runner sees an empty event loop mid-await and
// cancels the file. One referenced handle holds it.
let hold;
before(() => { hold = setInterval(() => {}, 1000); });
after(() => clearInterval(hold));

function flow(o = {}) {
  const root = mkdtempSync(join(tmpdir(), "dopl-muse-signin-"));
  const opened = [];
  const shown = [];
  const f = fakeConn(Object.assign({
    initialize: INIT,
    "account/loginStart": () => {
      // Muse writes the credential into the LOGIN home's config dir (file backend).
      const dir = join(home.privateHome(root).replace(home.PRIVATE_HOME, home.LOGIN_HOME), "config", "muse");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "auth.json"), "{\"schema_version\":1}");
      return { verificationUrl: "https://auth.meta.com/oauth/device/?code=ABCD-EFGH", userCode: "ABCD-EFGH" };
    },
    "account/read": { state: "accountLogin", credentialRequired: false },
    "account/loginCancel": { cancelled: true },
  }, o.answers || {}));
  const outcome = login.signIn({
    electron: false, userDataRoot: root, bin: async () => "/fake/muse",
    connect: f.connect, handshake: async (conn) => { await conn.request("initialize", {}); conn.notify("initialized"); return INIT; },
    serveArgs: () => ["serve", "--provider", "meta"], version: () => "1.0.0", diag: () => {},
    openExternal: async (u) => { opened.push(u); }, showCode: ({ userCode }) => { shown.push(userCode); return () => {}; },
    onQuit: () => () => {}, stepMs: 20,
  });
  return { root, f, outcome, opened, shown };
}

test("granted: the code is shown, Meta's page opened, the account read back, and the credential installed as Dopl's", async () => {
  const h = flow();
  await until(() => h.f.hooks() && h.f.calls.some((c) => c.method === "account/loginStart"), "no loginStart");
  assert.deepEqual(h.f.calls.find((c) => c.method === "account/loginStart").params, { type: "deviceCode" });
  await until(() => h.shown.length === 1, "code not shown");
  h.f.notify("account/loginCompleted", { outcome: "granted" });
  assert.deepEqual(await h.outcome, { ok: true });
  assert.deepEqual(h.shown, ["ABCD-EFGH"]);
  assert.deepEqual(h.opened, ["https://auth.meta.com/oauth/device/?code=ABCD-EFGH"]);
  assert.equal(home.hasAuth(h.root), true);
});

test("denied / expired: nothing is installed", async () => {
  for (const outcome of ["denied", "expired"]) {
    const h = flow();
    await until(() => h.shown.length === 1, "code not shown");
    h.f.notify("account/loginCompleted", { outcome });
    assert.deepEqual(await h.outcome, { ok: false, reason: outcome });
    assert.equal(home.hasAuth(h.root), false);
  }
});

test("a verification URL off Meta's hosts is refused and never opened", async () => {
  const h = flow({ answers: { "account/loginStart": { verificationUrl: "https://auth.meta.com.evil.example/x", userCode: "Z" } } });
  assert.deepEqual(await h.outcome, { ok: false, reason: "untrusted-url" });
  assert.deepEqual(h.opened, []);
  assert.equal(login.isMetaUrl("https://auth.meta.com/oauth/device/"), true);
  assert.equal(login.isMetaUrl("http://auth.meta.com/"), false);
  assert.equal(login.redactUrl("https://auth.meta.com/oauth/device/?code=SECRET"), "https://auth.meta.com/oauth/device/");
});

test("Cancel stops the flow with loginCancel, and an account that did not land is not adopted", async () => {
  const h = flow();
  await until(() => h.shown.length === 1, "code not shown");
  assert.equal(login.cancel(), true);
  assert.deepEqual(await h.outcome, { ok: false, reason: "cancelled" });
  assert.ok(h.f.calls.some((c) => c.method === "account/loginCancel"));
  const g = flow({ answers: { "account/read": { state: "loggedOut", credentialRequired: true } } });
  await until(() => g.shown.length === 1, "code not shown");
  g.f.notify("account/loginCompleted", { outcome: "granted" });
  assert.deepEqual(await g.outcome, { ok: false, reason: "no-account" });
  assert.equal(existsSync(home.authFile(g.root)), false);
});

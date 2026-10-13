// Muse's private home and env scrub: HOME + every XDG root inside Dopl's own dir, Muse's process knobs set,
// every inherited credential and Muse knob stripped, ambient config refused, a linked credential removed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, statSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { m } from "./_muse-harness.mjs";

const home = m("config-home.js");
const root = () => mkdtempSync(join(tmpdir(), "dopl-muse-home-"));

test("isolatedEnv: HOME and XDG_* all live inside Dopl's private home, owner-only; Muse's own knobs are set", () => {
  const r = root();
  const env = home.isolatedEnv({ PATH: "/usr/bin", HOME: "/Users/operator", XDG_CONFIG_HOME: "/Users/operator/.config" }, r);
  const dir = home.privateHome(r);
  for (const k of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
    assert.ok(env[k].startsWith(dir), `${k}=${env[k]} escapes the private home`);
  }
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(env.MUSE_NO_AUTO_UPDATE, "1");
  assert.equal(env.TBH_DISABLE_TELEMETRY, "1");
  assert.equal(env.TBH_CREDENTIAL_BACKEND, "file", "never the operator's Keychain");
  assert.equal(env.PATH, "/usr/bin");
});

test("buildScrubbedEnv drops META_API_KEY (it beats the account login), MODEL_API_KEY and every MUSE_/TBH_/META_ knob", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { META_API_KEY: "k", MODEL_API_KEY: "k2", MUSE_CHANNEL: "muse-canary", TBH_CREDENTIAL_BACKEND: "keychain",
      MUSE_PERMISSION_PROFILE_FAIL_OPEN: "1", META_BASE_URL: "x", OPENAI_API_KEY: "o", KEEP_ME: "yes" });
    const env = home.buildScrubbedEnv();
    for (const k of ["META_API_KEY", "MODEL_API_KEY", "MUSE_CHANNEL", "TBH_CREDENTIAL_BACKEND", "MUSE_PERMISSION_PROFILE_FAIL_OPEN", "META_BASE_URL", "OPENAI_API_KEY"]) {
      assert.equal(env[k], undefined, `${k} reached the child`);
    }
    assert.equal(env.KEEP_ME, "yes");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("ambient config in the private home refuses the launch, by name", () => {
  for (const [rel, isDir] of [["config/muse/settings.json", false], ["config/muse/trust.json", false], ["config/muse/skills", true], [".claude", true], [".agents", true]]) {
    const r = root();
    const dir = home.privateHome(r);
    const p = join(dir, rel);
    mkdirSync(isDir ? p : join(p, ".."), { recursive: true });
    if (!isDir) writeFileSync(p, "{}");
    assert.throws(() => home.isolatedEnv({}, r), new RegExp(rel.split("/").pop().replace(".", "\\.")), rel);
  }
});

test("Dopl's credential: a regular file reads present; a SYMLINK is removed, never followed; sign-out removes it", () => {
  const r = root();
  home.isolatedEnv({}, r);
  assert.equal(home.hasAuth(r), false);
  const operator = join(root(), "auth.json");
  writeFileSync(operator, "{}");
  mkdirSync(join(home.privateHome(r), "config", "muse"), { recursive: true });
  symlinkSync(operator, home.authFile(r));
  assert.equal(home.hasAuth(r), false);
  assert.equal(existsSync(home.authFile(r)) || (() => { try { lstatSync(home.authFile(r)); return true; } catch (_) { return false; } })(), false);
  assert.equal(existsSync(operator), true, "the operator's own file is untouched");
  const login = home.loginEnv({}, r);
  mkdirSync(join(login.home, "config", "muse"), { recursive: true });
  writeFileSync(login.authFile, "{\"schema_version\":1}");
  home.installAuth(login.authFile, r);
  assert.equal(home.hasAuth(r), true);
  assert.equal(statSync(home.authFile(r)).mode & 0o777, 0o600);
  home.removeAuth(r);
  assert.equal(home.hasAuth(r), false);
});

test("the login home is a fresh, separate home with the same isolation", () => {
  const r = root();
  const a = home.loginEnv({ HOME: "/Users/operator" }, r);
  assert.notEqual(a.home, home.privateHome(r));
  assert.ok(a.env.HOME === a.home && a.env.XDG_CONFIG_HOME.startsWith(a.home));
  assert.equal(a.authFile, join(a.home, "config", "muse", "auth.json"));
  assert.equal(a.env.TBH_CREDENTIAL_BACKEND, "file");
});

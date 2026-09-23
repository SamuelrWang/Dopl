import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, lstatSync, readFileSync, symlinkSync, existsSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const configHome = require(join(HERE, "..", "main", "runtime", "codex", "config-home.js"));

test("an isolated CODEX_HOME exposes auth but no ambient config", () => {
  const temp = mkdtempSync(join(tmpdir(), "dopl-codex-home-test-"));
  try {
    const source = join(temp, "source");
    const userData = join(temp, "user-data");
    mkdirSync(source);
    writeFileSync(join(source, "auth.json"), '{"fixture":true}', { mode: 0o600 });
    writeFileSync(join(source, "config.toml"), 'approval_policy = "never"\n');

    const env = configHome.isolatedEnv({ CODEX_HOME: source, PATH: "/bin" }, userData);
    assert.equal(env.PATH, "/bin");
    assert.equal(env.CODEX_HOME, join(userData, "codex-runtime-home-v1"));
    assert.equal(realpathSync(join(env.CODEX_HOME, "auth.json")), realpathSync(join(source, "auth.json")));
    assert.equal(configHome.hasAmbientConfig(env.CODEX_HOME), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("an unexpected config in Dopl's private home blocks launch", () => {
  const temp = mkdtempSync(join(tmpdir(), "dopl-codex-home-test-"));
  try {
    const target = join(temp, "codex-runtime-home-v1");
    mkdirSync(target);
    writeFileSync(join(target, "config.toml"), 'approval_policy = "never"\n');
    assert.throws(() => configHome.isolatedEnv({}, temp), /private Codex home contains config\.toml/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

// ── CXP-3A: CODEX WRITES ITS OWN TRUST ENTRY INTO THIS HOME (measured 2026-09-22, 0.155.1) ──

const CODEX_WRITTEN = '[projects."/Users/someone/Downloads"]\ntrust_level = "trusted"\n';

test("a home holding ONLY Codex's own trust entries is retired, and the launch proceeds", () => {
  const temp = mkdtempSync(join(tmpdir(), "dopl-codex-home-test-"));
  try {
    const target = join(temp, "codex-runtime-home-v1");
    mkdirSync(target);
    writeFileSync(join(target, "config.toml"), CODEX_WRITTEN + '[projects."/tmp/x"]\ntrust_level = "untrusted"\n');
    const env = configHome.isolatedEnv({}, temp);
    assert.equal(configHome.hasAmbientConfig(env.CODEX_HOME), false, "the trust-only file is gone");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("…and ANYTHING beside a trust entry is still refused, file untouched", () => {
  for (const extra of ['approval_policy = "never"\n', '[mcp_servers.x]\ncommand = "/bin/sh"\n',
    '[projects."/a"]\ntrust_level = "trusted"\nmodel = "x"\n', '[projects."/a"]\n', 'trust_level = "trusted"\n']) {
    const temp = mkdtempSync(join(tmpdir(), "dopl-codex-home-test-"));
    try {
      const target = join(temp, "codex-runtime-home-v1");
      mkdirSync(target);
      writeFileSync(join(target, "config.toml"), CODEX_WRITTEN + extra);
      assert.throws(() => configHome.isolatedEnv({}, temp), /private Codex home contains config\.toml/, extra);
      assert.equal(configHome.hasAmbientConfig(target), true, "a refused file is left as evidence");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  assert.equal(configHome.onlyTrustEntries(""), true);
});

test("the project-trust fence marks the cwd AND every ancestor untrusted", () => {
  const fence = configHome.projectTrustFence("/Users/someone/Downloads/chan");
  assert.deepEqual(Object.keys(fence), ["/Users/someone/Downloads/chan", "/Users/someone/Downloads", "/Users/someone", "/Users", "/"]);
  for (const v of Object.values(fence)) assert.deepEqual(v, { trust_level: "untrusted" });
  assert.deepEqual(configHome.projectTrustFence(""), {});
});

// ── IN-APP SIGN-IN: the credential precedence (2026-09-23) ──────────────────────────────────
// Dopl-owned auth.json (in-app sign-in) > a link to the operator's auth.json > none. Nothing here
// writes under the operator's real `~/.codex`: every source home is a temp fixture.

function tree() {
  const temp = mkdtempSync(join(tmpdir(), "dopl-codex-home-test-"));
  const source = join(temp, "operator");
  mkdirSync(source);
  return { temp, source, userData: join(temp, "user-data"), done: () => rmSync(temp, { recursive: true, force: true }) };
}

test("a Dopl-owned auth.json wins over the operator's, is kept 0600, and the operator's file is untouched", () => {
  const t = tree();
  try {
    writeFileSync(join(t.source, "auth.json"), '{"operator":true}', { mode: 0o600 });
    const priv = join(t.userData, "codex-runtime-home-v1");
    mkdirSync(priv, { recursive: true });
    writeFileSync(join(priv, "auth.json"), '{"dopl":true}', { mode: 0o644 });
    const env = configHome.isolatedEnv({ CODEX_HOME: t.source }, t.userData);
    const own = lstatSync(join(env.CODEX_HOME, "auth.json"));
    assert.equal(own.isFile(), true, "not replaced by a link");
    assert.equal(own.mode & 0o777, 0o600);
    assert.equal(readFileSync(join(priv, "auth.json"), "utf8"), '{"dopl":true}');
    assert.equal(readFileSync(join(t.source, "auth.json"), "utf8"), '{"operator":true}');
  } finally {
    t.done();
  }
});

test("a stale link is replaced cleanly — removed with no source, repointed to a new one", () => {
  const t = tree();
  try {
    const gone = join(t.temp, "gone-auth.json");
    const priv = join(t.userData, "codex-runtime-home-v1");
    mkdirSync(priv, { recursive: true });
    symlinkSync(gone, join(priv, "auth.json"));
    configHome.isolatedEnv({ CODEX_HOME: t.source }, t.userData);
    assert.equal(existsLink(join(priv, "auth.json")), false, "a dangling link would let a login write through it");
    assert.equal(existsSync(gone), false, "nothing was created at the old target");

    symlinkSync(gone, join(priv, "auth.json"));
    writeFileSync(join(t.source, "auth.json"), '{"operator":true}', { mode: 0o600 });
    configHome.isolatedEnv({ CODEX_HOME: t.source }, t.userData);
    assert.equal(realpathSync(join(priv, "auth.json")), realpathSync(join(t.source, "auth.json")));
  } finally {
    t.done();
  }
});

test("anything but a file or a link at auth.json still refuses the launch", () => {
  const t = tree();
  try {
    mkdirSync(join(t.userData, "codex-runtime-home-v1", "auth.json"), { recursive: true });
    assert.throws(() => configHome.isolatedEnv({ CODEX_HOME: t.source }, t.userData), /unexpected auth\.json/);
  } finally {
    t.done();
  }
});

test("installAuth moves a login over the link without touching the link's target", () => {
  const t = tree();
  try {
    writeFileSync(join(t.source, "auth.json"), '{"operator":true}', { mode: 0o600 });
    configHome.isolatedEnv({ CODEX_HOME: t.source }, t.userData);
    const { home, env } = configHome.loginEnv({ PATH: "/bin" }, t.userData);
    assert.equal(env.CODEX_HOME, home);
    assert.equal(env.CODEX_SQLITE_HOME, home);
    assert.equal(env.PATH, "/bin");
    assert.equal(statSync(home).mode & 0o777, 0o700);
    writeFileSync(join(home, "auth.json"), '{"login":true}', { mode: 0o644 });
    configHome.installAuth(join(home, "auth.json"), t.userData);
    const priv = join(t.userData, "codex-runtime-home-v1", "auth.json");
    assert.equal(lstatSync(priv).isFile(), true);
    assert.equal(lstatSync(priv).mode & 0o777, 0o600);
    assert.equal(readFileSync(priv, "utf8"), '{"login":true}');
    assert.equal(readFileSync(join(t.source, "auth.json"), "utf8"), '{"operator":true}', "never ~/.codex");
    configHome.clearLoginHome(t.userData);
    assert.equal(existsSync(home), false);
    assert.throws(() => configHome.installAuth(join(home, "auth.json"), t.userData), /no credential file/);
  } finally {
    t.done();
  }
});

test("every Dopl-run Codex pins the file credential store", () => {
  assert.deepEqual([...configHome.AUTH_STORE_ARGS], ["-c", 'cli_auth_credentials_store="file"']);
  const client = readFileSync(join(HERE, "..", "main", "runtime", "codex", "client.js"), "utf8");
  assert.match(client, /\['app-server'\]\.concat\(AUTH_STORE_ARGS, o\.args \|\| \[\]\)/);
});

function existsLink(p) {
  try { lstatSync(p); return true; } catch (_) { return false; }
}

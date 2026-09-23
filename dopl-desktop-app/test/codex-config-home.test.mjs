import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
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

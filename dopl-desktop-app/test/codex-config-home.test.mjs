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

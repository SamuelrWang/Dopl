import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const generator = require(join(HERE, "..", "scripts", "codex-app-server-schema.js"));

test("the compatibility fixture refuses private executables inside another app bundle", () => {
  assert.equal(
    generator.excludedFixtureSource("/Applications/ChatGPT.app/Contents/Resources/codex"),
    true,
  );
  assert.equal(
    generator.excludedFixtureSource("/Users/sam/Applications/Preview.app/Contents/MacOS/codex"),
    true,
  );
  assert.equal(generator.excludedFixtureSource("/opt/homebrew/bin/codex"), false);
  assert.equal(generator.excludedFixtureSource("/Users/sam/.local/bin/codex"), false);
});

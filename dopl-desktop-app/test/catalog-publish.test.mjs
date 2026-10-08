// THE DESKTOP'S ROSTER PUBLISH, pinned (2026-10-08, `main/catalog-publish.js`): what crosses to the
// server (labels + dimensions only) and when (a change at once, an unchanged list after 6h).
//
// Run: `node --test dopl-desktop-app/test/catalog-publish.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

const { publishableCatalog, due, REPUBLISH_MS } = new Function(
  `${slice(read("main", "catalog-publish.js"), "CATALOG-PUBLISH-PURE")}; return { publishableCatalog, due, REPUBLISH_MS };`
)();

const CATALOG = {
  status: "ready",
  key: "claude@1.2.3#acct:abcdef",
  models: [
    {
      id: "claude-x-1",
      label: "Claude X 1",
      short: "X 1",
      isDefault: true,
      hidden: false,
      aliases: ["x"],
      launch: "--model claude-x-1",
      dimensions: { effort: { options: [{ value: "high", label: "High", description: "slow" }], default: "high" } },
    },
    { id: "claude-secret-internal", label: "Hidden", hidden: true, dimensions: {} },
    { id: "has space", label: "Bad" },
  ],
};

test("🔒 only labels and dimensions cross — no aliases, launch spelling, roster key or hidden rows", () => {
  const body = publishableCatalog("claude", CATALOG, "1.40.0");
  assert.deepEqual(body, {
    runtime: "claude",
    appVersion: "1.40.0",
    models: [
      {
        id: "claude-x-1",
        label: "Claude X 1",
        short: "X 1",
        isDefault: true,
        dimensions: { effort: { options: [{ value: "high", label: "High" }], default: "high" } },
      },
    ],
  });
  const wire = JSON.stringify(body);
  for (const secret of ["acct:", "--model", "aliases", "description", "Hidden"]) {
    assert.ok(!wire.includes(secret), `${secret} must not cross`);
  }
});

test("nothing to offer ⇒ nothing sent", () => {
  assert.equal(publishableCatalog("claude", { models: [] }, ""), null);
  assert.equal(publishableCatalog("claude", null, ""), null);
  assert.equal(publishableCatalog("claude", { models: [{ id: "a", hidden: true }] }, ""), null);
});

test("shapes to the server schema: long labels clipped, 100 models max, dimension options capped", () => {
  const many = { models: Array.from({ length: 120 }, (_, i) => ({ id: `m-${i}`, label: "L".repeat(200) })) };
  const body = publishableCatalog("codex", many, "");
  assert.equal(body.models.length, 100);
  assert.equal(body.models[0].label.length, 80);
  assert.equal(body.appVersion, undefined);
});

test("a changed list goes at once; an unchanged one only after REPUBLISH_MS; never two at once", () => {
  const now = 10 * REPUBLISH_MS;
  assert.equal(due({ sig: "b", sentSig: "a", sentAt: now, sending: false }, now), true);
  assert.equal(due({ sig: "a", sentSig: "a", sentAt: now - 1000, sending: false }, now), false);
  assert.equal(due({ sig: "a", sentSig: "a", sentAt: now - REPUBLISH_MS, sending: false }, now), true);
  assert.equal(due({ sig: "b", sentSig: "a", sentAt: 0, sending: true }, now), false);
  assert.equal(due(undefined, now), false);
});

test("wiring: catalog fires only LIVE ready reads, index starts the publisher", () => {
  const cat = read("main", "runtime", "model-catalog.js");
  assert.match(cat, /function noteLiveReady[\s\S]*catalog\.persisted\) return;/, "a persisted stand-in must never be published");
  assert.match(read("main", "index.js"), /catalogPublish\.start\(\)/);
  assert.match(read("main", "catalog-publish.js"), /'\/api\/devices\/model-catalog'/);
});

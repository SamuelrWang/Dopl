// CODEX EFFORT, END TO END (2026-10-08): the launcher's per-model pick travels as `overrides.dimensions` →
// `narrowOverrides` (bounded) → the funnel (`session-launch.js › offeredDimensions`: the runtime's
// vocabulary, then what THIS model offers on the live catalog) → `s.dimensions` (persisted with the model
// across park/reopen) → `turn/start.effort`. It used to be read from a state key nothing ever wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { loadCatalog } from "./_model-catalog-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const vocab = require(join(MAIN, "runtime", "selection-vocabulary.js"));
const codex = require(join(MAIN, "runtime", "codex", "index.js")).descriptor;

test("vocabulary: only DECLARED dimensions, only values the declaration accepts (live alphabet or fixed list)", () => {
  assert.deepEqual(vocab.launchDimensionPicks(codex, { reasoningEffort: "xhigh", other: "x" }), { reasoningEffort: "xhigh" });
  assert.deepEqual(vocab.launchDimensionPicks(codex, { reasoningEffort: "telepathic" }), { reasoningEffort: "telepathic" },
    "a level Dopl never heard of passes the alphabet — the catalog decides if the model offers it");
  assert.deepEqual(vocab.launchDimensionPicks(codex, { reasoningEffort: "Bad Value!" }), {});
  assert.deepEqual(vocab.launchDimensionPicks(codex, null), {});
  const fixed = { models: { dimensions: ["speed"], dimensionOptions: { speed: { options: ["fast", { value: "slow" }] } } } };
  assert.deepEqual(vocab.launchDimensionPicks(fixed, { speed: "slow" }), { speed: "slow" });
  assert.deepEqual(vocab.launchDimensionPicks(fixed, { speed: "warp" }), {});
});

test("the live catalog: a value the launched model does not offer is dropped; an unvouched catalog passes it", () => {
  const cat = loadCatalog();
  const ready = cat.catalogFromRoster("codex", { models: { source: "live", dimensions: ["reasoningEffort"] } }, {
    models: [
      { id: "m1", isDefault: true, dimensions: { reasoningEffort: { options: ["low", "high"] } } },
      { id: "m2", dimensions: { reasoningEffort: { options: ["low"] } } },
    ],
  });
  assert.deepEqual(cat.offeredDimensions(ready, "m1", { reasoningEffort: "high" }), { reasoningEffort: "high" });
  assert.deepEqual(cat.offeredDimensions(ready, "m2", { reasoningEffort: "high" }), {}, "m2 does not offer high");
  assert.deepEqual(cat.offeredDimensions(ready, "", { reasoningEffort: "high" }), { reasoningEffort: "high" }, "no pick = the default model's offer");
  assert.deepEqual(cat.offeredDimensions({ status: "loading", models: [] }, "m2", { reasoningEffort: "high" }), { reasoningEffort: "high" });
  assert.deepEqual(cat.offeredDimensions(ready, "m1", {}), {});
});

test("the wire: narrowOverrides keeps bounded string picks only", () => {
  const src = readFileSync(join(MAIN, "identity-resolve.js"), "utf8");
  const fn = new Function(`${/function dimensionsOf\([\s\S]*?\n}\n/.exec(src)[0]}; return dimensionsOf;`)();
  assert.deepEqual(fn({ reasoningEffort: " high ", "bad key": "x", n: 3, long: "x".repeat(65) }), { reasoningEffort: "high" });
  assert.deepEqual(fn(["high"]), {});
});

test("codex: the session's pick becomes turn/start.effort, and no pick sends none", () => {
  const launchSpec = require(join(MAIN, "runtime", "codex", "launch-spec.js"));
  const spec = (dimensions) => launchSpec.buildLaunchSpec({
    session: { profile: "full", channelId: "11111111-1111-4111-8111-111111111111", state: { toolMode: "on-request" },
      workspaceId: "ws", model: "", containerToken: { token: "t" }, dimensions },
    dispatch: () => {},
  });
  assert.deepEqual(spec({ reasoningEffort: "high" }).turnStart, { effort: "high" });
  assert.deepEqual(spec(undefined).turnStart, {});
});

test("the pick is PERSISTED with the model and re-coerced on resume (park/reopen keeps the effort)", () => {
  const io = readFileSync(join(MAIN, "session-io.js"), "utf8");
  const boot = readFileSync(join(MAIN, "session-boot.js"), "utf8");
  const park = readFileSync(join(MAIN, "session-park.js"), "utf8");
  assert.match(io, /dimensions: s\.dimensions && Object\.keys\(s\.dimensions\)\.length \? s\.dimensions : null/);
  assert.match(boot, /launchDimensionPicks\(\s*runtimeRegistry\.descriptorFor\(rec\.runtimeId \|\| null\), rec\.dimensions/);
  assert.match(park, /dimensions: rec\.dimensions \|\| undefined/);
});

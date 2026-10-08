// CROSS-REVIEW M2 (2026-10-08): the updater's live safety probe runs on the CHEAPEST model this Mac has
// seen cost — learned from the CLI's own pricing on real results, never a typed price or model id.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rates = require("../main/runtime/claude/cost-rates.js");
const liveStore = require("../main/runtime/live-store.js");
const models = require("../main/runtime/claude/models.js");
const updateSource = require("../main/runtime/claude/update-source.js");
const normalize = require("../main/runtime/claude/normalize.js").normalize;

let saved = {};
beforeEach(() => {
  saved = {};
  liveStore.inject({ readFile: () => { throw new Error("none"); }, writeFile: (_f, text) => { saved = JSON.parse(text); }, file: () => "/dev/null/x", diag: () => {} });
  rates.reset();
});

const usage = (id, usd, input, output = 0) => ({ [id]: { costUSD: usd, inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });

test("a result teaches each model's blended rate; the cheapest learned id wins; nothing learned = none", () => {
  assert.equal(rates.cheapest(["a", "b"]), null, "no price is ever assumed");
  rates.learn(usage("big", 0.05, 1000));
  rates.learn(usage("small", 0.001, 1000));
  assert.equal(rates.cheapest(["big", "small", "never-seen"]), "small");
  assert.equal(rates.cheapest(["big"]), "big", "only among the ids asked about");
});

test("a block with no price or no tokens teaches nothing (never a zero rate)", () => {
  rates.learn({ m: { inputTokens: 100 } });
  rates.learn({ m: { costUSD: 0.01 } });
  rates.learn({ m: { costUSD: "0.01", inputTokens: 100 } });
  assert.equal(rates.cheapest(["m"]), null);
});

test("the normalizer feeds it from every result", () => {
  normalize({ type: "result", modelUsage: usage("via-result", 0.002, 500) }, { launchContract: false, windows: new Map() });
  assert.equal(rates.cheapest(["via-result"]), "via-result");
});

test("the probe model is the cheapest VISIBLE catalog row's launch value; hidden or unlearned rows never", () => {
  rates.learn(usage("claude-hidden-old", 0.0001, 1000));
  rates.learn(usage("claude-x", 0.01, 1000));
  rates.learn(usage("claude-y", 0.002, 1000));
  models.inject({ catalogModels: () => [
    { id: "claude-x", launch: "x", hidden: false },
    { id: "claude-y", launch: "y", hidden: false },
    { id: "claude-hidden-old", launch: "claude-hidden-old", hidden: true },
  ] });
  try {
    assert.equal(updateSource.cheapestOffered(), "y");
    models.inject({ catalogModels: () => [{ id: "claude-z", launch: "z", hidden: false }] });
    assert.equal(updateSource.cheapestOffered(), null, "nothing learned for what is offered: the CLI's default");
  } finally { models.inject(); }
});

test("semantics runs on the model it is handed, and on the CLI's default when none", async () => {
  const sem = require("../main/runtime/claude/semantics.js");
  const seen = [];
  const sdk = { query: ({ options }) => { seen.push(options.model); return (async function* () { yield { type: "result" }; })(); } };
  await sem.verifySemantics({ sdk, options: {}, model: "y", timeoutMs: 2000 });
  await sem.verifySemantics({ sdk, options: {}, timeoutMs: 2000 });
  assert.ok(seen.slice(0, 4).every((m) => m === "y"));
  assert.ok(seen.slice(4).every((m) => m === undefined));
});

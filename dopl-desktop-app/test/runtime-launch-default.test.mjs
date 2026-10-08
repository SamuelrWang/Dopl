// THE RUNTIME'S OWN DEFAULT MODEL — `main/runtime/launch-default.js` (2026-09-23).
//
// Samuel: "We don't need a pin model in the settings … either the agent will choose it, or the
// agent is launched by another agent … or you can just have it go to the default model." And for
// Codex: "I think we should do Sol." So every launch resolves launcher pick > identity model >
// THIS FILE, and the channel/profile model setting is gone.
//
// THE PROPERTY THIS FILE EXISTS FOR: **a default is never a refusal.** Codex names a Sol model only
// when this account's LIVE catalog is `ready` and carries one; in every other state the launch names NO
// model and Codex picks its own. No real model turn is needed for any case below.
//
// ⚠ 2026-10-08: "Sol" is a PREFERRED FAMILY held as DATA (`runtime/model-preferences.js`, seeded
// `model-preferences.seed.json`), not a model id in adapter code: the NEWEST `*-sol` the roster offers
// runs, so `gpt-7-sol` is picked the day it ships.
//
// Run: `node --test dopl-desktop-app/test/runtime-launch-default.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCatalog } from "./_model-catalog-harness.mjs";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const LD = require(join(MAIN, "runtime", "launch-default.js"));
const REGISTRY = require(join(MAIN, "runtime", "index.js"));

const CODEX = REGISTRY.descriptorFor("codex");
const CLAUDE = REGISTRY.descriptorFor("claude");

const catalog = (status, ids) => ({
  status,
  models: ids.map((id) => ({ id, aliases: [] })),
});
const catalogs = (c) => ({ catalogs: { settle: async () => c } });
const adapterOf = (descriptor) => ({ descriptor, runtime: REGISTRY.runtimeFor(descriptor.id) });

test("Codex's default is a FAMILY preference held as data (sol); Claude declares the CLI's alias", () => {
  assert.equal(LD.preferredDefault(CODEX), "", "no model id in Codex's adapter code");
  assert.equal(LD.preferredFamily(CODEX), "sol", "seeded preference");
  assert.equal(LD.preferredDefault(CLAUDE), "sonnet", "the CLI's alias, never an id this build must re-release");
});

test("THE NEXT RELEASE: gpt-7-sol appears → it is picked, with no Dopl change; the family is a whole token", () => {
  assert.equal(LD.launchDefaultFrom(CODEX, catalog("ready", ["gpt-5.6-sol", "gpt-6-sol", "gpt-7-sol", "gpt-7-luna"])), "gpt-7-sol");
  assert.equal(LD.launchDefaultFrom(CODEX, catalog("ready", ["gpt-6-sol", "gpt-5.6-sol"])), "gpt-6-sol", "6 > 5.6");
  assert.equal(LD.launchDefaultFrom(CODEX, catalog("ready", ["gpt-6-solar", "gpt-6-luna"])), "", "solar is not sol");
  const prefs = require(join(MAIN, "runtime", "model-preferences.js"));
  assert.equal(prefs.pickFamily([{ id: "gpt-8-sol", hidden: true }, { id: "gpt-6-sol" }], "sol").id, "gpt-6-sol", "a hidden model is never the default");
});

test("the preference is a SETTING: stored null = none (server default), stored family overrides the seed", () => {
  const prefs = require(join(MAIN, "runtime", "model-preferences.js"));
  let map = {};
  prefs.inject({ get: () => map, set: (_k, v) => { map = v; } });
  try {
    assert.equal(prefs.setFamily("codex", null), true);
    assert.equal(LD.launchDefaultFrom(CODEX, catalog("ready", ["gpt-6-sol"])), "", "no preference: Codex's own default");
    assert.equal(prefs.setFamily("codex", "luna"), true);
    assert.equal(LD.launchDefaultFrom(CODEX, catalog("ready", ["gpt-6-sol", "gpt-6-luna"])), "gpt-6-luna");
    assert.equal(prefs.setFamily("codex", "Bad Family!"), false, "the alphabet gates a stored value");
  } finally {
    prefs.inject(null);
  }
});

test("PRESENT: a ready catalog carrying Sol → the launch names Sol", async () => {
  const ready = catalog("ready", ["gpt-6-luna", "gpt-6-sol"]);
  assert.equal(LD.launchDefaultFrom(CODEX, ready), "gpt-6-sol");
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "", catalogs(ready)), "gpt-6-sol");
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), undefined, catalogs(ready)), "gpt-6-sol");
});

test("ABSENT: a ready catalog WITHOUT Sol → NO model is sent (Codex's own default), never a refusal", async () => {
  const noSol = catalog("ready", ["gpt-6-luna", "gpt-5.5"]);
  assert.equal(LD.launchDefaultFrom(CODEX, noSol), "");
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "", catalogs(noSol)), "");
});

test("UNKNOWN is not ABSENT, and neither names Sol: loading / unavailable / stale all send no model", async () => {
  for (const status of ["loading", "unavailable", "stale"]) {
    const c = catalog(status, status === "stale" ? ["gpt-6-sol"] : []);
    assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "", catalogs(c)), "", status);
  }
  // …and a roster read that throws is the same no-model answer.
  const boom = { catalogs: { settle: async () => { throw new Error("app-server wedged"); } } };
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "", boom), "");
});

test("an EXPLICIT pick is never replaced — and the roster is not even asked", async () => {
  let asked = 0;
  const spy = { catalogs: { settle: async () => { asked += 1; return catalog("ready", ["gpt-6-sol"]); } } };
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "gpt-6-luna", spy), "gpt-6-luna");
  assert.equal(asked, 0);
  // `'default'` is the Claude lane's "no opinion", so it IS a no-pick.
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "default", spy), "gpt-6-sol");
});

test("a runtime whose adapter spends its own default never waits on a roster", async () => {
  let asked = 0;
  const spy = { catalogs: { settle: async () => { asked += 1; return catalog("ready", ["claude-sonnet-5"]); } } };
  assert.equal(await LD.withRuntimeDefault(adapterOf(CLAUDE), "", spy), "", "Claude resolves '' itself at launch");
  assert.equal(asked, 0, "a Claude no-pick launch must not wait on a roster probe");
  const bare = { descriptor: { id: "x", models: {} }, runtime: { modelArg: () => ({ ok: true, arg: "", id: "" }) } };
  assert.equal(await LD.withRuntimeDefault(bare, "", spy), "", "no declared default: untouched");
  assert.equal(asked, 0);
});

test("THE CATALOG SHOWS WHAT A NO-PICK LAUNCH RUNS ON: Sol is the default when the roster carries it", () => {
  const cat = loadCatalog();
  const withSol = cat.catalogFromRoster("codex", CODEX, {
    source: "live",
    models: [{ id: "gpt-6-luna", isDefault: true }, { id: "gpt-6-sol" }],
  });
  assert.equal(withSol.defaultId, "gpt-6-sol", "the picker preselects what the launch will spend");
  assert.deepEqual(withSol.models.filter((m) => m.isDefault).map((m) => m.id), ["gpt-6-sol"]);
  const withoutSol = cat.catalogFromRoster("codex", CODEX, {
    source: "live",
    models: [{ id: "gpt-6-luna", isDefault: true }],
  });
  assert.equal(withoutSol.defaultId, "gpt-6-luna", "…and the server's own marker otherwise");
  const stale = cat.catalogFromRoster("codex", CODEX, {
    source: "live", stale: true,
    models: [{ id: "gpt-6-luna", isDefault: true }, { id: "gpt-6-sol" }],
  });
  assert.equal(stale.defaultId, "gpt-6-luna", "a stale roster cannot promise Sol, so it does not show it");
});

// THE RUNTIME'S OWN DEFAULT MODEL — `main/runtime/launch-default.js` (2026-09-23).
//
// Samuel: "We don't need a pin model in the settings … either the agent will choose it, or the
// agent is launched by another agent … or you can just have it go to the default model." And for
// Codex: "I think we should do Sol." So every launch resolves launcher pick > identity model >
// THIS FILE, and the channel/profile model setting is gone.
//
// THE PROPERTY THIS FILE EXISTS FOR: **a default is never a refusal.** Codex names `gpt-6-sol`
// only when this account's LIVE catalog is `ready` and carries it; in every other state the launch
// names NO model and Codex picks its own. No real model turn is needed for any case below.
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
const catalogs = (c) => ({ settle: async () => c });
const adapterOf = (descriptor) => ({ descriptor });

test("the SHIPPED Codex descriptor prefers gpt-6-sol; Claude declares no preference", () => {
  assert.equal(LD.preferredDefault(CODEX), "gpt-6-sol");
  assert.equal(LD.preferredDefault(CLAUDE), "",
    "Claude's default is its adapter's own (`LAUNCH_MODEL_FALLBACK` via `modelArg`)");
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
  const boom = { settle: async () => { throw new Error("app-server wedged"); } };
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "", boom), "");
});

test("an EXPLICIT pick is never replaced — and the roster is not even asked", async () => {
  let asked = 0;
  const spy = { settle: async () => { asked += 1; return catalog("ready", ["gpt-6-sol"]); } };
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "gpt-6-luna", spy), "gpt-6-luna");
  assert.equal(asked, 0);
  // `'default'` is the Claude lane's "no opinion", so it IS a no-pick.
  assert.equal(await LD.withRuntimeDefault(adapterOf(CODEX), "default", spy), "gpt-6-sol");
});

test("a runtime with no declared default is untouched, and never waits on a roster", async () => {
  let asked = 0;
  const spy = { settle: async () => { asked += 1; return catalog("ready", ["claude-sonnet-5"]); } };
  assert.equal(await LD.withRuntimeDefault(adapterOf(CLAUDE), "", spy), "");
  assert.equal(asked, 0, "a Claude launch must never wait on a Codex app-server");
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

// `main/claude-runtime.js`, the WHOLE module evaluated over a stubbed registry: `sessionSpawnAvailable`
// answers from the runtime registry only, and `checkRuntimeAtStart` warns only when nothing can run
// (the external CLI's absence is never a reason). Behavioural: calls the exports, asserts outcomes.
//
// Run: `node --test dopl-desktop-app/test/claude-runtime-start.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";

const copy = real("./runtime/runtime-copy.js");

function load(connected) {
  const diags = [];
  const registry = {
    connectedIds: async () => {
      if (connected === "throw") throw new Error("probe exploded");
      return connected;
    },
    copy,
  };
  const mod = loadWithStubs("claude-runtime.js", {
    "./diag": { diag: (...a) => diags.push(a) },
    "./runtime": registry,
  });
  return { mod, diags };
}

test("sessionSpawnAvailable: any connected runtime → true; none → false", async () => {
  assert.equal(await load(["codex"]).mod.sessionSpawnAvailable(), true);
  assert.equal(await load(["claude", "codex"]).mod.sessionSpawnAvailable(), true);
  assert.equal(await load([]).mod.sessionSpawnAvailable(), false);
  assert.equal(await load(null).mod.sessionSpawnAvailable(), false, "a non-list is no runtime");
});

test("sessionSpawnAvailable: a throwing probe answers false and is logged, never a crash", async () => {
  const { mod, diags } = load("throw");
  assert.equal(await mod.sessionSpawnAvailable(), false);
  assert.equal(diags.length, 1);
  assert.match(String(diags[0][1]), /probe exploded/);
});

test("checkRuntimeAtStart: no notice while a runtime can spawn, even with no external CLI", async () => {
  const { mod } = load(["claude"]);
  const notices = [];
  const logs = [];
  const warned = await mod.checkRuntimeAtStart({
    externalCli: async () => false,
    notify: (n) => notices.push(n),
    log: (...a) => logs.push(a),
  });
  assert.equal(warned, false);
  assert.deepEqual(notices, []);
  assert.equal(logs.length, 1, "both facts logged once");
  assert.equal(logs[0][1], true);
  assert.equal(logs[0][3], false);
});

test("checkRuntimeAtStart: nothing can run → one notice naming no runtime", async () => {
  const { mod } = load([]);
  const notices = [];
  const warned = await mod.checkRuntimeAtStart({ externalCli: async () => true, notify: (n) => notices.push(n) });
  assert.equal(warned, true);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "Dopl");
  assert.equal(notices[0].body, "No agent runtime on this Mac, so channel requests cannot be answered.");
});

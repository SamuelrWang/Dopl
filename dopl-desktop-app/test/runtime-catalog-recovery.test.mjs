// REPAIR WITHOUT A RESTART (CXP-5, 2026-09-22) — `main/runtime/model-catalog.js` and the two
// caches `main/channel-runtime-reply.js` makes invalidate each other.
//
// THE PROPERTY THIS FILE EXISTS FOR:
//
//   🔒 **A CODEX ROSTER THAT SETTLED `unavailable` BECOMES `ready` IN THE SAME PROCESS AFTER THE
//      OPERATOR REPAIRS IT** — installs the binary, signs in — with no Dopl restart. And on every
//      step of that recovery (failure, retry in flight, success) the Codex catalog carries NO
//      Claude-owned id: a failure never borrows another runtime's catalog.
//
// The four states themselves are `test/runtime-model-catalog.test.mjs`'s subject; the harness is
// shared with it.
//
// Run: `node --test dopl-desktop-app/test/runtime-catalog-recovery.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadCatalog, loadCodexModels, claudeModels, CLAUDE_IDS, noClaude,
  fakeClient, row, adapter, CODEX_DESCRIPTOR, settle,
} from "./_model-catalog-harness.mjs";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");

/** A Codex adapter whose install is broken until `state.repaired` flips — ONE module instance
 *  of `codex/models.js` for the whole case, exactly as in a running app. */
function repairableCodex() {
  const state = { repaired: false, reads: 0 };
  const client = fakeClient([{ data: [row("gpt-a", { isDefault: true })] }]);
  const realProbe = client.probe;
  client.probe = async () => (state.repaired
    ? realProbe()
    : { ok: false, reason: "`codex` is not installed where Dopl can find it.", version: null, path: null });
  const models = loadCodexModels(client);
  return {
    state,
    codex: adapter(CODEX_DESCRIPTOR, async () => { state.reads += 1; return models.models(); }),
  };
}

const claudeAdapter = () => adapter(
  { id: "claude", label: "Claude Code", models: { source: "frozen", dimensions: null } },
  () => claudeModels.models());

/** Run `fn` with `Date.now` shifted forward by `ms` — the failure floor, without a real wait. */
async function later(ms, fn) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return await fn(); } finally { Date.now = real; }
}

test("🔒 a settled `unavailable` roster recovers after repair at the next look past the floor", async () => {
  const catalog = loadCatalog();
  const { state, codex } = repairableCodex();
  catalog.snapshot(codex);
  await settle();
  const failed = catalog.snapshot(codex);
  assert.equal(failed.status, "unavailable");
  assert.match(failed.reason, /not installed/);
  noClaude(failed, "the failed codex catalog");

  state.repaired = true;
  // Inside the floor the verdict stands — a burst of looks is one probe.
  assert.equal(catalog.snapshot(codex).status, "unavailable");
  assert.equal(state.reads, 1);

  await later(catalog.FAILURE_TTL_MS + 1, async () => {
    // ⚠ THE RETRY IN FLIGHT READS `loading`, not the old failure: that is the status the renderer
    // keeps re-reading on, so the picker follows the retry instead of settling on a stale verdict.
    const retrying = catalog.snapshot(codex);
    assert.equal(retrying.status, "loading");
    assert.deepEqual(retrying.models, []);
    noClaude(retrying, "the retrying codex catalog");
    await settle();
    await settle();
    const ready = catalog.snapshot(codex);
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.models.map((m) => m.id), ["gpt-a"]);
  });
  assert.equal(state.reads, 2);
});

test("`invalidate` over a FAILED catalog is `loading` (not model-less `stale`) and re-reads at once", async () => {
  const catalog = loadCatalog();
  const { state, codex } = repairableCodex();
  catalog.snapshot(codex);
  await settle();
  assert.equal(catalog.snapshot(codex).status, "unavailable");

  state.repaired = true;
  assert.equal(catalog.invalidate("codex", "connected"), true);
  const pending = catalog.snapshot(codex);
  assert.equal(pending.status, "loading", "nothing to label, so nothing to call stale");
  assert.equal(pending.reason, "");
  await settle();
  await settle();
  assert.equal(catalog.snapshot(codex).status, "ready", "no floor after an explicit invalidation");
});

test("`invalidate` during a read in flight does NOT start a second one, and a failed answer is due at once", async () => {
  const catalog = loadCatalog();
  let release;
  let reads = 0;
  const codex = adapter(CODEX_DESCRIPTOR, () => {
    reads += 1;
    if (reads === 1) return new Promise((r) => { release = r; });
    return loadCodexModels(fakeClient([{ data: [row("gpt-a", { isDefault: true })] }])).models();
  });
  catalog.snapshot(codex);
  assert.equal(catalog.invalidate("codex", "connected"), true);
  catalog.snapshot(codex);
  await settle();
  assert.equal(reads, 1, "one app-server, never two racing");

  release({ source: "live", ids: [], models: [], reason: "signed out" });
  await settle();
  await settle();
  // The in-flight read started BEFORE the repair it was asked about: its failure is not floored.
  catalog.snapshot(codex);
  await settle();
  await settle();
  assert.equal(reads, 2);
  assert.equal(catalog.snapshot(codex).status, "ready");
});

test("`onSettled` fires on a CHANGE of verdict, never on the first one or on `loading`", async () => {
  const catalog = loadCatalog();
  const { state, codex } = repairableCodex();
  const seen = [];
  catalog.onSettled((id, from, to) => seen.push([id, from, to]));
  catalog.snapshot(codex);
  await settle();
  assert.deepEqual(seen, [], "the first verdict is not a transition");

  state.repaired = true;
  catalog.invalidate("codex", "connected");
  catalog.snapshot(codex);
  await settle();
  await settle();
  assert.deepEqual(seen, [["codex", "unavailable", "ready"]]);
});

// ── THE REPLY LAYER: EACH CACHE'S CHANGE IS THE OTHER'S INVALIDATION ────────────────────────

function loadReply({ catalog, adapters, connected }) {
  let expired = 0;
  const registry = {
    all: () => adapters,
    DEFAULT_ID: "claude",
    connectedIds: async () => connected.ids.slice(),
    expireConnectivity: () => { expired += 1; },
  };
  const stub = (id) => {
    if (id === "./runtime") return registry;
    if (id === "./runtime/model-catalog") return catalog;
    if (id === "./diag") return { diag: () => {} };
    throw new Error(`unexpected require: ${id}`);
  };
  const m = { exports: {} };
  new Function("require", "module", "exports", readFileSync(join(MAIN, "channel-runtime-reply.js"), "utf8"))(
    stub, m, m.exports);
  return { reply: m.exports.runtimeReply, expired: () => expired };
}

test("🔒 end to end: repair shows up on the SAME process's settings reads, and Codex never shows a Claude id", async () => {
  const catalog = loadCatalog();
  const { state, codex } = repairableCodex();
  const connected = { ids: ["claude"] };
  const { reply, expired } = loadReply({ catalog, adapters: [claudeAdapter(), codex], connected });

  await reply();
  await settle();
  let r = await reply();
  assert.equal(r.catalogs.codex.status, "unavailable");
  noClaude(r.catalogs.codex, "codex before repair");
  assert.deepEqual(r.catalogs.claude.models.map((m) => m.id), CLAUDE_IDS, "the neighbour is untouched");

  // The operator installs and signs in; the next connectivity sweep sees it.
  state.repaired = true;
  connected.ids = ["claude", "codex"];
  r = await reply();
  assert.equal(r.catalogs.codex.status, "loading", "a newly connected runtime re-reads its roster NOW");
  noClaude(r.catalogs.codex, "codex while re-reading");
  await settle();
  await settle();
  r = await reply();
  assert.equal(r.catalogs.codex.status, "ready");
  assert.deepEqual(r.catalogs.codex.models.map((m) => m.id), ["gpt-a"]);
  assert.ok(r.connected.includes("codex"));
  // The catalog's own verdict change expired the connectivity sweep, so `connected` cannot lag it.
  assert.equal(expired(), 1);
});

test("a stubbed catalog without the hooks still answers — a cache hint never fails the read", async () => {
  const connected = { ids: ["claude"] };
  const { reply } = loadReply({
    catalog: { CATALOG_VERSION: 1, catalogs: () => ({}) },
    adapters: [claudeAdapter()],
    connected,
  });
  await reply();
  connected.ids = [];
  const r = await reply();
  assert.deepEqual(r.catalogs, {});
  assert.deepEqual(r.connected, []);
});

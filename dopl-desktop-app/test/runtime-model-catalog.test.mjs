// THE FOUR STATES A MODEL CATALOG IS ALLOWED TO BE IN (U6, 2026-09-21) —
// `main/runtime/model-catalog.js`.
//
// THE PROPERTY THIS FILE EXISTS FOR, and it is the plan's hardest one:
//
//   🔒 **A CATALOG FAILURE MUST NEVER SUBSTITUTE ANOTHER RUNTIME'S MODELS.** The defect U6 closes
//      is that `src/features/channels/lib/agent-models.ts` — four CLAUDE ids — was every
//      runtime's source, so selecting Codex offered Fable. Every failure path here is asserted to
//      contain NONE of those ids, not merely to be "empty".
//
// AND THE FOUR STATES, WHICH ARE FOUR DIFFERENT OPERATOR ACTIONS AND MUST NOT COLLAPSE
// (INVARIANTS §11 — UNKNOWN is not EMPTY):
//
//   loading      nothing read YET — the picker shows the platform default, not "no models"
//   ready        a list an operator may pick from
//   unavailable  a read was ATTEMPTED and FAILED, with the binary's own reason
//   stale        models we can no longer confirm: they still LABEL, they may not be SELECTED
//
// What the reader underneath actually pulls off `model/list` is
// `test/codex-model-list.test.mjs`'s subject. The harness is shared.
//
// Run: `node --test dopl-desktop-app/test/runtime-model-catalog.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadCatalog, loadCodexModels, claudeModels, CLAUDE_IDS, noClaude,
  fakeClient, row, adapter, CODEX_DESCRIPTOR, settle,
} from "./_model-catalog-harness.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "features", "channels", "lib");

test("🔒 a failed Codex catalog contains NO Claude model, on any path, including the whole map", async () => {
  const catalog = loadCatalog();
  const claude = adapter({ id: "claude", label: "Claude Code", models: { source: "frozen", dimensions: null } },
    () => claudeModels.models());
  const codex = adapter(CODEX_DESCRIPTOR,
    () => loadCodexModels(fakeClient([], { probeOk: false, probeReason: "not installed" })).models());
  const all = catalog.catalogs([claude, codex]);
  await settle();
  const after = catalog.catalogs([claude, codex]);
  assert.equal(after.codex.status, "unavailable");
  noClaude(after.codex, "the codex catalog");
  // The default runtime is untouched by its neighbour's outage.
  assert.equal(after.claude.status, "ready");
  assert.deepEqual(after.claude.models.map((m) => m.id), CLAUDE_IDS);
  assert.equal(Object.keys(all).length, 2, "one runtime's outage removes nobody from the map");
});

test("an EMPTY roster is never `ready` — no adapter may say 'this platform has no models'", () => {
  const catalog = loadCatalog();
  const c = catalog.catalogFromRoster("codex", CODEX_DESCRIPTOR,
    { source: "live", ids: [], models: [], reason: "" });
  assert.equal(c.status, "unavailable");
  assert.ok(c.reason.length > 0, "an empty list always carries a sentence");
});

// ── 3. loading / ready / stale — THE THREE THAT ARE NOT `unavailable` ────────────────────────

test("a live roster reads `loading` FIRST and `ready` after the background read — never blocking", async () => {
  const catalog = loadCatalog();
  let calls = 0;
  const codex = adapter(CODEX_DESCRIPTOR, async () => {
    calls += 1;
    return loadCodexModels(fakeClient([{ data: [row("gpt-a", { isDefault: true })] }])).models();
  });
  const first = catalog.snapshot(codex);
  // ⚠ `loading` IS NOT `unavailable`: nothing has been attempted, so there is nothing to explain.
  assert.equal(first.status, "loading");
  assert.deepEqual(first.models, []);
  assert.equal(first.reason, "", "loading explains nothing, because nothing failed");
  await settle();
  const second = catalog.snapshot(codex);
  assert.equal(second.status, "ready");
  assert.deepEqual(second.models.map((m) => m.id), ["gpt-a"]);
  assert.equal(calls, 1, "a settled roster is not re-read on every look");
});

test("a frozen roster is read INLINE and is never `loading`", () => {
  const catalog = loadCatalog();
  const claude = adapter({ id: "claude", label: "Claude Code", models: { source: "frozen", dimensions: null } },
    () => claudeModels.models());
  assert.equal(catalog.snapshot(claude).status, "ready", "a table lookup has no loading state");
});

test("`invalidate` makes a catalog STALE — models kept, status changed, and it re-reads", async () => {
  const catalog = loadCatalog();
  let version = "1.0.0";
  const codex = adapter(CODEX_DESCRIPTOR, async () =>
    loadCodexModels(fakeClient([{ data: [row(`gpt-${version}`, { isDefault: true })] }], { version })).models());
  catalog.snapshot(codex);
  await settle();
  assert.equal(catalog.snapshot(codex).status, "ready");

  assert.equal(catalog.invalidate("codex", "the Codex CLI was upgraded"), true);
  const stale = catalog.snapshot(codex);
  // ⚠ THE MODELS SURVIVE. A stale catalog still LABELS a historical session's model honestly;
  // what it may not do is offer one for a NEW pick — the renderer's `selectableModels` rule.
  assert.deepEqual(stale.models.map((m) => m.id), ["gpt-1.0.0"]);
  assert.match(stale.reason, /upgraded/);
  assert.equal(["stale", "ready"].includes(stale.status), true);

  version = "2.0.0";
  await settle();
  await settle();
  assert.deepEqual(catalog.snapshot(codex).models.map((m) => m.id), ["gpt-2.0.0"], "re-read after invalidate");
});

test("a REFRESH that fails over a roster we already hold is `stale`, not `unavailable`", async () => {
  const catalog = loadCatalog();
  let broken = false;
  const codex = adapter(CODEX_DESCRIPTOR, async () =>
    (broken
      ? loadCodexModels(fakeClient([], { listRejects: "the CLI went away" })).models()
      : loadCodexModels(fakeClient([{ data: [row("gpt-a", { isDefault: true })] }])).models()));
  catalog.snapshot(codex);
  await settle();
  assert.equal(catalog.snapshot(codex).status, "ready");

  broken = true;
  catalog.invalidate("codex", "reconnected");
  catalog.snapshot(codex);
  await settle();
  await settle();
  const after = catalog.snapshot(codex);
  assert.equal(after.status, "stale", "we still have models; we just cannot confirm them");
  assert.deepEqual(after.models.map((m) => m.id), ["gpt-a"]);
  assert.match(after.reason, /went away/);
});

test("a model that DISAPPEARS after an upgrade leaves the catalog, and its raw id is still readable", async () => {
  const catalog = loadCatalog();
  let roster = [row("gpt-old", { isDefault: true }), row("gpt-new")];
  const codex = adapter(CODEX_DESCRIPTOR, async () =>
    loadCodexModels(fakeClient([{ data: roster }])).models());
  catalog.snapshot(codex);
  await settle();
  assert.deepEqual(catalog.snapshot(codex).models.map((m) => m.id), ["gpt-old", "gpt-new"]);

  roster = [row("gpt-new", { isDefault: true })];
  catalog.invalidate("codex", "the Codex CLI was upgraded");
  catalog.snapshot(codex);
  await settle();
  await settle();
  const after = catalog.snapshot(codex);
  assert.deepEqual(after.models.map((m) => m.id), ["gpt-new"]);
  // ⚠ THE DESKTOP DROPS IT FROM THE ROSTER AND STOPS THERE. Rendering `gpt-old` raw on a
  // historical session card is the RENDERER's `modelLabel` rule — this side must not invent a row
  // for a model the platform no longer reports.
  assert.equal(after.models.some((m) => m.id === "gpt-old"), false);
});

// ── 5. REGRESSION — THE DEFAULT RUNTIME, THROUGH THE SAME CONTRACT, UNCHANGED ────────────────

test("the frozen roster delivers the SAME normalized contract, with its labels and one default", () => {
  const catalog = loadCatalog().catalogFromRoster(
    "claude",
    { id: "claude", label: "Claude Code", models: { source: "frozen", dimensions: null } },
    claudeModels.models()
  );
  assert.equal(catalog.status, "ready");
  assert.equal(catalog.source, "frozen");
  assert.deepEqual(catalog.models.map((m) => m.id), CLAUDE_IDS, "the roster order is unchanged");
  assert.deepEqual(catalog.models.map((m) => m.label),
    ["Fable 5", "Opus 5", "Sonnet 5", "Haiku 4.5"], "the labels are unchanged");
  assert.equal(catalog.defaultId, "claude-sonnet-5", "the product's back-fill is the default marker");
  assert.equal(catalog.models.filter((m) => m.isDefault).length, 1);
  // ⚠ NO MODEL-SCOPED DIMENSION on this runtime — absent, never an empty control.
  assert.deepEqual(catalog.dimensions, []);
  for (const m of catalog.models) assert.deepEqual(m.dimensions, {});
});

test("🔒 the desktop's label table AGREES WITH THE WEB'S, because the two trees cannot import each other", () => {
  // The pin `session-model.js › LAUNCH_MODEL_FALLBACK` already had, applied to the labels U6 moved
  // into `claude/models.js`. A change to one side that misses the other fails HERE rather than
  // shipping an operator "Opus" on a card and "Sonnet" in Settings for one agent.
  const web = readFileSync(join(WEB, "agent-models.ts"), "utf8");
  const block = /export const AGENT_MODELS:[\s\S]*?\n\];/.exec(web);
  assert.ok(block, "agent-models.ts › AGENT_MODELS was not found — the pin cannot be read");
  const rows = [...block[0].matchAll(/id:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*short:\s*"([^"]+)"/g)]
    .map(([, id, label, short]) => ({ id, label, short }));
  assert.equal(rows.length, 4, "the web table moved — re-derive this pin");
  const desktop = claudeModels.models().models;
  assert.deepEqual(desktop.map((m) => ({ id: m.id, label: m.label, short: m.short })), rows);

  const fallback = /export const AGENT_MODEL_FALLBACK = "([^"]+)"/.exec(web);
  assert.ok(fallback, "agent-models.ts › AGENT_MODEL_FALLBACK was not found");
  assert.equal(claudeModels.models().defaultId, fallback[1],
    "the catalog's default marker and the web's back-fill are one decision");
});

// ── 6. THE MAP ITSELF ────────────────────────────────────────────────────────────────────────

test("one adapter that THROWS becomes one `unavailable` entry, and takes nobody with it", () => {
  const catalog = loadCatalog();
  const good = adapter({ id: "claude", label: "Claude Code", models: { source: "frozen", dimensions: null } },
    () => claudeModels.models());
  const bad = adapter({ id: "boom", label: "Boom", models: { source: "frozen", dimensions: null } },
    () => { throw new Error("the model table could not be read"); });
  const all = catalog.catalogs([good, bad]);
  assert.equal(all.claude.status, "ready");
  assert.equal(all.boom.status, "unavailable");
  assert.match(all.boom.reason, /could not be read/);
  noClaude(all.boom, "the throwing adapter");
});

test("a frozen adapter that answers ASYNCHRONOUSLY is a mis-declared adapter, not a loading one", () => {
  const catalog = loadCatalog();
  const wrong = adapter({ id: "wrong", label: "Wrong", models: { source: "frozen", dimensions: null } },
    async () => ({ source: "frozen", models: [{ id: "x" }] }));
  const c = catalog.snapshot(wrong);
  assert.equal(c.status, "unavailable");
  assert.match(c.reason, /frozen model table but answered asynchronously/);
});

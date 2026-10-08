// THE CLAUDE MODEL ROSTER IS LIVE (2026-09-22) — `main/runtime/claude/roster.js` + `models.js`.
//
// Samuel: *"can we make sure the models aren't hard coded? Like if claude or codex add a new model,
// would dopl auto mark those as options"*. The Claude roster was a frozen four-id table; it is now
// `Query.supportedModels()`, read off a CLI handshake that spends NO model turn, and the table is
// the fallback only when that read fails. What this file pins:
//
//   1. the MEASURED rows parse into the catalog contract (ids, CLI display names, one default);
//   2. a model this build has never heard of APPEARS as an option, labelled by the CLI;
//   3. a failed read falls back to the table, and the catalog SAYS so (`stale` + a reason);
//   4. the cache is keyed per binary/version/credential, and a moved key re-reads on a look;
//   5. a pick launches as the row it names; an unknown pick is REFUSED, never coerced;
//   6. the launch funnel asks, and fails OPEN when the roster cannot be read;
//   7. LIVE (opt-in, `CLAUDE_SDK_LIVE=1`): the real SDK answers, with zero messages.
//
// Run: `node --test dopl-desktop-app/test/claude-live-roster.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { asyncFnOf } from "./helpers/source-probe.mjs";
import { loadCatalog, settle } from "./_model-catalog-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const roster = require("../main/runtime/claude/roster.js");
const models = require("../main/runtime/claude/models.js");

// ⚠ MEASURED 2026-09-22 on this Mac (SDK 0.3.220, signed in, Max) — `roster.js`'s header.
const MEASURED = [
  { value: "default", resolvedModel: "claude-opus-5[1m]", displayName: "Default (recommended)", description: "Opus 5 with 1M context" },
  { value: "opus[1m]", resolvedModel: "claude-opus-5[1m]", displayName: "Opus (1M context)", description: "Opus 5 with 1M context" },
  { value: "claude-fable-5[1m]", resolvedModel: "claude-fable-5", displayName: "Fable", description: "Fable 5" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", description: "Sonnet 5" },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku", description: "Haiku 4.5" },
];
const DESCRIPTOR = { id: "claude", label: "Claude Code", models: { source: "live", dimensions: null } };

/** Point the adapter at a fake CLI. `rows` may be a function (called per probe). */
function fakeCli(rows, over = {}) {
  const calls = { probes: 0 };
  let credential = over.credential || "dopl-token";
  // 2026-10-08: the adapter keeps no roster; the CATALOG holds the last live read. Here that is the last
  // rows a probe answered, so launch resolution sees what a real catalog would.
  let last = null;
  models.inject({
    loadSdk: async () => ({}), bin: () => "/fake/claude", env: () => ({}),
    credentialSource: () => credential, sdkVersion: () => "0.3.220",
    probe: async () => { calls.probes += 1; if (over.fail) throw new Error(over.fail); last = typeof rows === "function" ? rows() : rows; return last; },
    catalogModels: () => (last ? roster.rosterFrom(last, { fallbackAlias: "sonnet" }).models : []),
  });
  return { calls, signIn: (next) => { credential = next; } };
}
const adapter = () => ({ descriptor: DESCRIPTOR, runtime: { models: () => models.models(), buildIdentity: () => models.buildIdentity() } });

// ── 1 + 2. THE MEASURED ROWS, AND A MODEL NOBODY HARDCODED ───────────────────────────────────

test("the measured supportedModels() rows become the catalog: full ids, the CLI's own names, one default", () => {
  const r = roster.rosterFrom(MEASURED, { legacy: { "claude-opus-5": "opus" }, fallbackId: "claude-sonnet-5", fallbackAlias: "sonnet" });
  assert.deepEqual(r.ids, ["claude-opus-5[1m]", "claude-fable-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    "`default` is the CLI's pointer at another row, not a model — dropped, and the CLI's ORDER kept");
  assert.deepEqual(r.models.map((m) => [m.label, m.short]),
    [["Opus (1M context)", "Opus"], ["Fable", "Fable"], ["Sonnet", "Sonnet"], ["Haiku", "Haiku"]]);
  assert.deepEqual(r.models.map((m) => m.value), ["opus[1m]", "claude-fable-5[1m]", "sonnet", "haiku"], "the launch value is the row's own");
  assert.equal(r.defaultId, "claude-sonnet-5", "the PRODUCT fallback marks the default");
  assert.ok(r.models[0].aliases.includes("claude-opus-5") && r.models[0].aliases.includes("opus"), "legacy spellings find the row");
});

test("🔒 a model this build has never heard of APPEARS as an option — labelled, selectable, launchable", async () => {
  fakeCli([...MEASURED, { value: "claude-opus-6[1m]", resolvedModel: "claude-opus-6[1m]", displayName: "Opus 6 (1M context)" }]);
  try {
    const catalog = loadCatalog();
    catalog.snapshot(adapter());
    await settle(); await settle();
    const c = catalog.snapshot(adapter());
    assert.equal(c.status, "ready");
    const entry = c.models.find((m) => m.id === "claude-opus-6[1m]");
    assert.ok(entry, "offered with no table edit");
    assert.equal(entry.label, "Opus 6 (1M context)", "named by the CLI, never hidden");
    assert.equal(catalog.modelRefusal(c, "claude-opus-6[1m]", "Claude Code"), null, "and a launch naming it is not refused");
    assert.deepEqual(models.resolveLaunchModel("claude-opus-6[1m]"), { ok: true, arg: "claude-opus-6[1m]", id: "claude-opus-6[1m]", reason: "" });
  } finally { models.inject(); }
});

// ⚠ MEASURED 2026-10-08 on runtime 0.3.293 (signed in): the CLI lists its current aliases AND its
// "older models" as pinned ids. Samuel: the picker shows only the current lineup.
const MEASURED_293 = [
  ["default", "claude-opus-5-5", "Default (recommended)"], ["opus", "claude-opus-5-5", "Opus 5.5"],
  ["fable", "claude-fable-5-1", "Fable 5.1"], ["sonnet", "claude-sonnet-5-5", "Sonnet 5.5"],
  ["haiku", "claude-haiku-5-5", "Haiku 5.5"], ["claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001", "Haiku 4.5"],
  ["claude-sonnet-5", "claude-sonnet-5", "Sonnet 5"], ["claude-opus-5", "claude-opus-5", "Opus 5"],
  ["claude-fable-5", "claude-fable-5", "Fable 5"], ["claude-opus-4-8", "claude-opus-4-8", "Opus 4.8"],
  ["claude-opus-4-7", "claude-opus-4-7", "Opus 4.7"], ["claude-opus-4-6", "claude-opus-4-6", "Opus 4.6"],
  ["claude-sonnet-4-6", "claude-sonnet-4-6", "Sonnet 4.6"],
].map(([value, resolvedModel, displayName]) => ({ value, resolvedModel, displayName }));

test("🔒 the CLI's OLDER models are hidden, not dropped: the picker offers the current lineup only", async () => {
  const r = roster.rosterFrom(MEASURED_293, { fallbackAlias: "sonnet" });
  assert.deepEqual(r.models.filter((m) => !m.hidden).map((m) => m.label), ["Opus 5.5", "Fable 5.1", "Sonnet 5.5", "Haiku 5.5"]);
  assert.equal(r.models.filter((m) => m.hidden).length, 8, "every pinned older row is kept, hidden");
  assert.equal(r.defaultId, "claude-sonnet-5-5", "the default is the current Sonnet, never a hidden row");
  assert.ok(!r.models.find((m) => m.id === "claude-sonnet-5").aliases.includes("sonnet"), "a pinned row never claims the alias");
  fakeCli(MEASURED_293);
  try {
    await models.models();
    assert.equal(models.resolveLaunchModel("claude-opus-4-8").arg, "claude-opus-4-8", "a stored older pick still launches as itself");
    assert.equal(models.resolveLaunchModel("sonnet").id, "claude-sonnet-5-5");
    assert.equal(models.resolveLaunchModel("").arg, "sonnet");
    const c = loadCatalog().catalogFromRoster("claude", DESCRIPTOR, await models.models());
    assert.equal(c.models.find((m) => m.id === "claude-opus-4-7").label, "Opus 4.7", "a hidden row still labels a card");
  } finally { models.inject(); }
});

test("a pinned row is offered when no alias supersedes it (an older CLI's only Fable, a newer Opus)", () => {
  const r = roster.rosterFrom([...MEASURED, { value: "claude-opus-6", resolvedModel: "claude-opus-6", displayName: "Opus 6" }], {});
  assert.equal(r.models.some((m) => m.hidden), false);
});

// ── 3. A FAILED READ IS A REJECTION WITH ITS CAUSE — NEVER A SHIPPED TABLE ─────────────────────

test("a FAILED read rejects with the cause; the catalog renders it, and no table answers", async () => {
  fakeCli([], { fail: "spawn ENOENT" });
  try {
    await assert.rejects(models.models(), /could not read Claude Code's model list \(spawn ENOENT\)/);
    const catalog = loadCatalog();
    catalog.snapshot(adapter()); await settle(); await settle();
    const c = catalog.snapshot(adapter());
    assert.equal(c.status, "unavailable", "no models it could not read, and it says why");
    assert.match(c.reason, /spawn ENOENT/);
  } finally { models.inject(); }
});

// ── 4. NO ADAPTER CACHE: THE CATALOG IS THE ONE ──────────────────────────────────────────────

test("signed out, nothing is probed (the operator's own login would answer); signed in, every read is live", async () => {
  const cli = fakeCli(MEASURED.slice(3), { credential: "none" });
  try {
    await assert.rejects(models.models(), /not signed in to Dopl/);
    assert.equal(cli.calls.probes, 0, "no probe without Dopl's token");
    cli.signIn("dopl-token");
    assert.equal((await models.models()).models.length, 2);
    await models.models();
    assert.equal(cli.calls.probes, 2, "the adapter keeps nothing; `model-catalog.js` decides when to read");
  } finally { models.inject(); }
});

test("a READY catalog re-reads on the next LOOK when the key moves (an upgrade), without a timer", async () => {
  const cli = fakeCli(MEASURED.slice(3));
  let version = "0.3.220";
  models.inject({
    loadSdk: async () => ({}), bin: () => "/fake/claude", env: () => ({}),
    credentialSource: () => "dopl-token", sdkVersion: () => version,
    probe: async () => { cli.calls.probes += 1; return MEASURED.slice(3); },
  });
  try {
    const catalog = loadCatalog();
    catalog.snapshot(adapter()); await settle(); await settle();
    assert.equal(cli.calls.probes, 1);
    version = "0.3.221";
    catalog.snapshot(adapter()); await settle(); await settle();
    assert.equal(cli.calls.probes, 2, "the moved key re-read without a timer or an invalidation hook");
  } finally { models.inject(); }
});

// ── 5. A PICK LAUNCHES AS THE ROW IT NAMES; UNKNOWN IS REFUSED ───────────────────────────────

test("resolution: ids, legacy ids, aliases and undated spellings all find their row; unknown REFUSES", async () => {
  fakeCli(MEASURED);
  try {
    await models.models();
    const arg = (v) => models.resolveLaunchModel(v).arg;
    assert.equal(arg("claude-opus-5[1m]"), "opus[1m]");
    assert.equal(arg("claude-opus-5"), "opus[1m]", "a channel stored before the live roster");
    assert.equal(arg("opus"), "opus[1m]", "a parked session's legacy alias");
    assert.equal(arg("claude-haiku-4-5"), "haiku", "undated");
    assert.equal(arg(""), "sonnet", "absent is the product fallback");
    assert.equal(arg("default"), "sonnet", "…and so is the legacy word");
    const bad = models.resolveLaunchModel("claude-fable-5-1");
    assert.equal(bad.ok, false, "the gotcha: an unknown id used to launch the fallback and echo the ask");
    assert.match(bad.reason, /does not offer the model "claude-fable-5-1".*Opus \(1M context\), Fable, Sonnet, Haiku/);
    assert.equal(models.launchArg("claude-opus-4-5"), "claude-opus-4-5", "a resumed session's own id is sent as itself");
    assert.equal(models.launchArg("opus --print"), "sonnet", "what could not BE an id never reaches argv");
  } finally { models.inject(); }
});

test("RC-01: before any roster read, a pick launches as ITSELF — never a short row, never a table", async () => {
  // A parked session on `claude-opus-5[1m]` resumed after a restart, before anything read the live
  // roster. 2026-10-08: no table answers in the meantime, so the pick is sent as itself (an unread
  // roster is not evidence it is gone, RC-03) and no base-id step can strip `[1m]`.
  fakeCli([], { fail: "not read yet" });
  try {
    assert.equal(models.launchArg("claude-opus-5[1m]"), "claude-opus-5[1m]");
    assert.equal(models.resolveLaunchModel("claude-opus-5[1m]").ok, true, "unread is not refused");
    assert.equal(models.launchArg(""), "sonnet", "no pick: the CLI's own alias");
    assert.equal(models.launchArg("opus --print"), "sonnet", "what could not BE an id never reaches argv");
  } finally { models.inject(); }
});

test("the day a newer Sonnet ships, an unpicked channel still gets `the Sonnet` — the alias row", async () => {
  fakeCli([{ value: "sonnet", resolvedModel: "claude-sonnet-6", displayName: "Sonnet" }]);
  try {
    const r = await models.models();
    assert.equal(r.defaultId, "claude-sonnet-6", "the default marker follows the fallback's alias");
    assert.equal(models.resolveLaunchModel("").arg, "sonnet");
    assert.equal(models.resolveLaunchModel("claude-sonnet-5").ok, false, "a pinned retired id is refused, not swapped");
  } finally { models.inject(); }
});

test("🔒 no runtime borrows another's roster: each catalog refuses the other's ids", () => {
  const catalog = loadCatalog();
  const claude = catalog.catalogFromRoster("claude", DESCRIPTOR, roster.rosterFrom(MEASURED, {}));
  const codex = catalog.catalogFromRoster("codex", { id: "codex", models: { source: "live" } },
    { source: "live", models: [{ id: "gpt-6-luna", label: "GPT-6 Luna" }] });
  assert.match(catalog.modelRefusal(claude, "gpt-6-luna", "Claude Code"), /Claude Code does not offer the model "gpt-6-luna"/);
  assert.match(catalog.modelRefusal(codex, "claude-opus-5", "Codex"), /Codex does not offer the model "claude-opus-5"/);
  assert.equal(catalog.modelRefusal(codex, "", "Codex"), null, "no pick is never refused");
  assert.equal(catalog.modelRefusal(catalog.makeCatalog("codex", "live", "unavailable"), "x", "Codex"), null,
    "a roster Dopl could not read is not evidence a model does not exist");
});

// ── 6. THE FUNNEL ────────────────────────────────────────────────────────────────────────────

const LAUNCH_SRC = readFileSync(join(MAIN, "session-launch.js"), "utf8");
function refuser(stub) {
  const logged = [];
  const fn = new Function("require", "diag", `${asyncFnOf(LAUNCH_SRC, "refuseUnknownModel")}\n return refuseUnknownModel;`)(
    (id) => { if (!stub[id]) throw new Error(`unexpected require ${id}`); return stub[id]; }, (...a) => logged.push(a.join(" ")));
  return { fn, logged };
}

test("the funnel REFUSES before constructing anything, and asks only when a model was named", async () => {
  const at = LAUNCH_SRC.indexOf("await refuseUnknownModel(a.runtime, a.model)");
  assert.ok(at !== -1 && at < LAUNCH_SRC.indexOf("await deps.startSession("), "asked before startSession");
  assert.match(LAUNCH_SRC, /return \{ skipped: 'no-model', detail: modelRefusal \};/);
  const asked = [];
  const h = refuser({
    "./runtime": { resolve: (id) => ({ descriptor: { id, label: "Claude Code" } }) },
    "./runtime/model-catalog": { settle: async (a) => { asked.push(a.descriptor.id); return { status: "ready", models: [{ id: "claude-sonnet-5", aliases: [] }] }; },
      modelRefusal: loadCatalog().modelRefusal },
  });
  assert.match(await h.fn("claude", "claude-fable-5-1"), /does not offer the model "claude-fable-5-1"/);
  assert.equal(await h.fn("claude", "claude-sonnet-5"), null);
  assert.equal(await h.fn("claude", ""), null);
  assert.equal(await h.fn("claude", "default"), null);
  assert.deepEqual(asked, ["claude", "claude"], "no roster wait for a launch that names no model");
});

test("the funnel FAILS OPEN when the roster cannot be read — never a refusal over an outage", async () => {
  const h = refuser({ "./runtime": { resolve: () => { throw new Error("registry exploded"); } } });
  assert.equal(await h.fn("claude", "claude-opus-5"), null);
  assert.ok(h.logged.some((l) => l.includes("launch goes ahead")));
});

// ── 7. LIVE — THE REAL SDK, OPT-IN ───────────────────────────────────────────────────────────

test("LIVE: the bundled CLI lists its models with NO model turn (zero SDK messages)", async (t) => {
  if (process.env.CLAUDE_SDK_LIVE !== "1") {
    t.diagnostic("SKIPPED, NOT PASSED — set CLAUDE_SDK_LIVE=1 to read the real CLI's roster");
    t.skip("CLAUDE_SDK_LIVE is not 1");
    return;
  }
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const bin = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`).replace(/package\.json$/, "claude");
  let messages = 0;
  const counting = { ...sdk, query: (args) => { const q = sdk.query(args); const next = q.next.bind(q); q.next = (...a) => next(...a).then((r) => { if (!r.done) messages += 1; return r; }); return q; } };
  const rows = await roster.probe({ sdk: counting, options: { pathToClaudeCodeExecutable: bin, env: { ...process.env } } });
  assert.ok(Array.isArray(rows) && rows.length > 0, "the CLI answered");
  for (const row of rows) assert.ok(row.value && row.displayName, JSON.stringify(row));
  const r = roster.rosterFrom(rows, { fallbackAlias: "sonnet" });
  assert.ok(r.models.length > 0);
  assert.equal(messages, 0, "no user message, so no turn");
  console.log("LIVE supportedModels:", JSON.stringify(rows.map((x) => [x.value, x.resolvedModel, x.displayName])));
});

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
//   7. Codex: a named model no catalog source knows refuses instead of running on generic defaults;
//   8. LIVE (opt-in, `CLAUDE_SDK_LIVE=1`): the real SDK answers, with zero messages.
//
// Run: `node --test dopl-desktop-app/test/claude-live-roster.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";
import { loadCatalog, settle } from "./_model-catalog-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const roster = require("../main/runtime/claude/roster.js");
const models = require("../main/runtime/claude/models.js");
const table = require("../main/session-model.js");

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
  let credential = over.credential || "cli-store";
  models.inject({
    loadSdk: async () => ({}), bin: () => "/fake/claude", env: () => ({}),
    credentialSource: () => credential, sdkVersion: () => "0.3.220",
    probe: async () => { calls.probes += 1; if (over.fail) throw new Error(over.fail); return typeof rows === "function" ? rows() : rows; },
  });
  return { calls, signIn: (next) => { credential = next; } };
}
const adapter = () => ({ descriptor: DESCRIPTOR, runtime: { models: () => models.models(), rosterKey: () => models.rosterKey() } });

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

// ── 3. THE FALLBACK ONLY WHEN THE READ FAILS, AND IT SAYS SO ─────────────────────────────────

test("a FAILED read answers the build's table, marked `stale` with the reason — never an empty picker", async () => {
  fakeCli([], { fail: "spawn ENOENT" });
  try {
    const r = await models.models();
    assert.equal(r.stale, true);
    assert.match(r.reason, /could not read Claude Code's model list \(spawn ENOENT\)/);
    assert.deepEqual(r.ids, table.MODEL_IDS, "the fallback is the frozen table, and only then");
    const c = loadCatalog().catalogFromRoster("claude", DESCRIPTOR, r);
    assert.equal(c.status, "stale", "labels, but not newly selectable — the web's `selectableModels` offers nothing");
    assert.ok(c.reason.length > 0);
  } finally { models.inject(); }
});

// ── 4. THE CACHE KEY ─────────────────────────────────────────────────────────────────────────

test("cached per binary@version#credential: a sign-in is a new key and re-reads on the next LOOK", async () => {
  const cli = fakeCli(MEASURED.slice(3), { credential: "none" });
  try {
    await models.models(); await models.models();
    assert.equal(cli.calls.probes, 1, "same key, one probe");
    const catalog = loadCatalog();
    catalog.snapshot(adapter()); await settle(); await settle();
    assert.equal(catalog.snapshot(adapter()).models.length, 2);
    cli.signIn("cli-store"); // the roster is per ACCOUNT (measured: signed out, no Fable)
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
const asyncFnOf = (src, name) => `async ${fnOf(src, name)}`;
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
    "./runtime/model-catalog": { settle: async (a) => { asked.push(a.descriptor.id); return { models: [{ id: "claude-sonnet-5", aliases: [] }] }; },
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

// ── 7. CODEX: THE DELEGATION FENCE NEVER DEGRADES A NAMED MODEL ──────────────────────────────

test("Codex: a named model NO catalog source knows REFUSES the launch rather than run on generic defaults", () => {
  const catalog = require("../main/runtime/codex/catalog.js");
  const home = mkdtempSync(join(tmpdir(), "dopl-cat-"));
  try {
    writeFileSync(join(home, catalog.CACHE_FILE), JSON.stringify({ models: [{ slug: "gpt-5.5" }] }));
    assert.throws(() => catalog.writeDelegationFreeCatalog(home, { bin: null, model: "gpt-7" }),
      /no entry for "gpt-7".*refusing the launch/);
    assert.ok(catalog.writeDelegationFreeCatalog(home, { bin: null, model: "gpt-5.5" }), "a model the cache knows still launches");
    assert.ok(catalog.writeDelegationFreeCatalog(home, { bin: null }), "and so does the platform's own pick");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 8. LIVE — THE REAL SDK, OPT-IN ───────────────────────────────────────────────────────────

function liveSkip() {
  if (process.env.CLAUDE_SDK_LIVE !== "1") return "SKIPPED, NOT PASSED — set CLAUDE_SDK_LIVE=1 to read the real CLI's roster";
  return false;
}

test("LIVE: the bundled CLI lists its models with NO model turn (zero SDK messages)", { skip: liveSkip() }, async () => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const bin = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`).replace(/package\.json$/, "claude");
  let messages = 0;
  const counting = { ...sdk, query: (args) => { const q = sdk.query(args); const next = q.next.bind(q); q.next = (...a) => next(...a).then((r) => { if (!r.done) messages += 1; return r; }); return q; } };
  const rows = await roster.probe({ sdk: counting, options: { pathToClaudeCodeExecutable: bin, env: { ...process.env } } });
  assert.ok(Array.isArray(rows) && rows.length > 0, "the CLI answered");
  for (const row of rows) assert.ok(row.value && row.displayName, JSON.stringify(row));
  const r = roster.rosterFrom(rows, { fallbackId: table.LAUNCH_MODEL_FALLBACK, fallbackAlias: "sonnet" });
  assert.ok(r.models.length > 0);
  assert.equal(messages, 0, "no user message, so no turn");
  console.log("LIVE supportedModels:", JSON.stringify(rows.map((x) => [x.value, x.resolvedModel, x.displayName])));
});

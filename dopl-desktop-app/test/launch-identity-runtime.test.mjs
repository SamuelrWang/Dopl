// AN IDENTITY'S MODEL COUNTS ONLY ON A RUNTIME THAT OFFERS IT — on EVERY launch lane (2026-09-23).
//
// The agreed order is launcher pick > identity model > runtime default, and the coordinator's
// follow-up pinned the middle link: *"Identity model must belong to launch runtime; foreign-runtime
// identity model = skip to default (not refuse) unless launcher explicitly picked."* A
// Claude-authored identity launched on Codex used to hand `claude-opus-5` to Codex (the button
// lane, refused `no-model`) or be ignored outright (the MCP directive lane on a non-default
// runtime). Both lanes now ask ONE function, `main/runtime/launch-default.js › identityModelFor`.
//
// THREE LAYERS, ONE RULE:
//   1. the rule itself, driven for real over fake catalogs;
//   2. the BUTTON lane (`session-launch-op.js`), sliced and driven with the REAL rule;
//   3. the MCP DIRECTIVE lane (`launch-directive-spawn.js`), on BOTH runtimes, through its harness.
//
// Run: `node --test dopl-desktop-app/test/launch-identity-runtime.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot as bootDirective, row, WS } from "./_launch-directive-harness.mjs";
import { launchDefaultStub } from "./_launch-runtime-stub.mjs";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");
const LD = require(join(MAIN, "runtime", "launch-default.js"));

const CLAUDE_IDS = ["claude-fable-5", "claude-opus-5", "claude-sonnet-5"];
const CODEX_IDS = ["gpt-6-sol", "gpt-6-luna"];
const cat = (ids, status = "ready") => ({ status, models: ids.map((id) => ({ id, aliases: id === "claude-opus-5" ? ["opus"] : [] })) });
const CATALOGS = { claude: cat(CLAUDE_IDS), codex: cat(CODEX_IDS) };
const fakeRegistry = { resolve: (rid) => ({ descriptor: { id: rid || "claude" } }) };
const fakeCatalogs = (map = CATALOGS) => ({ settle: async (a) => map[a.descriptor.id] || null });
const identityOn = (rid, m, map) => LD.identityModelFor(rid, m, fakeCatalogs(map), fakeRegistry);

// ── 1. THE RULE ──────────────────────────────────────────────────────────────────────────────

test("RULE: an identity model the launch runtime offers is kept — by id or by alias", async () => {
  assert.equal(await identityOn("claude", "claude-opus-5"), "claude-opus-5");
  assert.equal(await identityOn("", "opus"), "opus", "'' is the default adapter; an alias counts");
  assert.equal(await identityOn("codex", "gpt-6-luna"), "gpt-6-luna");
});

test("RULE: a FOREIGN identity model is skipped to the runtime default — never refused", async () => {
  assert.equal(await identityOn("codex", "claude-opus-5"), "", "a Claude model on a Codex launch");
  assert.equal(await identityOn("claude", "gpt-6-sol"), "", "a Codex model on a Claude launch");
});

test("RULE: a roster that cannot say leaves the model AS GIVEN (the funnel fails open the same way)", async () => {
  assert.equal(await identityOn("codex", "claude-opus-5", { codex: cat([], "unavailable") }), "claude-opus-5");
  assert.equal(await identityOn("codex", "gpt-6-luna", {}), "gpt-6-luna");
  const boom = { settle: async () => { throw new Error("wedged"); } };
  assert.equal(await LD.identityModelFor("codex", "x", boom, fakeRegistry), "x");
});

test("RULE: no identity model, or the legacy `default` word, is no pick", async () => {
  for (const m of ["", "  ", "default", null, undefined]) assert.equal(await identityOn("codex", m), "");
});

// ── 2. THE BUTTON LANE ───────────────────────────────────────────────────────────────────────

const CH = "11111111-1111-4111-8111-111111111111";
const TPL = "33333333-3333-4333-8333-333333333333";

function bootButton(identityModel) {
  const launches = [];
  const stub = (id) => {
    if (id === "./ipc-guards") return require(join(MAIN, "ipc-guards.js"));
    if (id === "./launch-directive-vocab") return require(join(MAIN, "launch-directive-vocab.js"));
    if (id === "./agent-id") return require(join(MAIN, "agent-id.js"));
    if (id === "./diag") return { diag: () => {} };
    if (id === "./session-model") return require(join(MAIN, "session-model.js"));
    if (id === "./session-telemetry") return require(join(MAIN, "session-telemetry.js"));
    if (id === "./api") {
      return { apiFetch: async () => ({ ok: true, status: 200, json: async () => ({
        name: "Coder", instructions: null, model: identityModel, fields: [], knowledgeBases: [], authoredByCaller: true,
      }) }) };
    }
    if (id === "./identity-resolve") return resolveMod.exports;
    if (id === "./channel-listener") return { watchedChannel: () => ({ channel: { myAgentToolProfile: "full" } }) };
    if (id === "./targeting") return { resolveToolProfile: () => "full", resolveLaunchToolProfile: () => "full" };
    if (id === "./channel-prefs") return { launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }) };
    if (id === "./session-engine") {
      return { launchRequesterSession: async (spec) => { launches.push(spec); return { agentId: "ag-1", sessionId: "s-1" }; } };
    }
    // ⚠ THE REAL RULE, over fake catalogs — not a passthrough.
    if (id === "./runtime/launch-default") return launchDefaultStub({ identityModelFor: (rid, m) => identityOn(rid, m) });
    throw new Error("unexpected require: " + id);
  };
  const resolveMod = { exports: {} };
  new Function("require", "module", "exports", read("identity-resolve.js"))(stub, resolveMod, resolveMod.exports);
  const mod = { exports: {} };
  new Function("require", "module", "exports", read("session-launch-op.js"))(stub, mod, mod.exports);
  const launch = (extra = {}) => mod.exports.launchFromButton({
    channelId: CH, taskId: "", workspaceId: "ws-1", identityId: TPL, ...extra,
  });
  return { launch, launches };
}

test("BUTTON: a Claude identity on a CODEX launch sends no model — the funnel spends Codex's default", async () => {
  const m = bootButton("claude-opus-5");
  assert.equal((await m.launch({ runtime: "codex" })).ok, true, "launched, not refused");
  assert.equal(m.launches[0].runtime, "codex");
  assert.equal(m.launches[0].model, "");
});

test("BUTTON: a Codex identity on Codex, and a Claude identity on Claude, keep their model", async () => {
  const codex = bootButton("gpt-6-luna");
  await codex.launch({ runtime: "codex" });
  assert.equal(codex.launches[0].model, "gpt-6-luna");
  const claude = bootButton("claude-opus-5");
  await claude.launch();
  assert.equal(claude.launches[0].model, "claude-opus-5");
  const foreign = bootButton("gpt-6-luna");
  await foreign.launch();
  assert.equal(foreign.launches[0].model, "", "…and a Codex identity on Claude is skipped too");
});

test("BUTTON: the LAUNCHER's explicit pick is never filtered — the funnel refuses it if unknown", async () => {
  const m = bootButton("claude-opus-5");
  await m.launch({ runtime: "codex", overrides: { model: "claude-fable-5" } });
  assert.equal(m.launches[0].model, "claude-fable-5");
});

// ── 3. THE MCP DIRECTIVE LANE, BOTH RUNTIMES ─────────────────────────────────────────────────

const OFFERED = { claude: CLAUDE_IDS, codex: CODEX_IDS };
const withIdentity = (model, extra = {}) => bootDirective({
  resolve: { ok: true, identity: { name: "Coder", model } }, identityOffered: OFFERED, ...extra,
});
const spec = async (h, over = {}) => {
  await h.api.handle(row({ goal: "go", identity_id: TPL, identity_name: "Coder", ...over }), WS);
  return h.cfg.lastSpec;
};

test("DIRECTIVE/CODEX: the identity's Codex model is spent — the bug this file exists for", async () => {
  const s = await spec(withIdentity("gpt-6-luna", { channelRuntime: "codex", runtimeDefault: "gpt-6-sol" }), { model: "" });
  assert.equal(s.runtime, "codex");
  assert.equal(s.model, "gpt-6-luna");
});

test("DIRECTIVE/CODEX: a Claude identity model is skipped to Codex's default, not refused", async () => {
  const h = withIdentity("claude-opus-5", { channelRuntime: "codex", runtimeDefault: "gpt-6-sol" });
  const s = await spec(h, { model: "" });
  assert.equal(s.model, "", "no model named — the FUNNEL spends Codex's default (P3-09: one path)");
  assert.deepEqual(h.identityAsks, ["codex"], "asked of the LAUNCH runtime");
});

test("DIRECTIVE/CLAUDE: a Claude identity keeps its model; a Codex one is skipped to the default", async () => {
  assert.equal((await spec(withIdentity("claude-opus-5"), { model: "" })).model, "claude-opus-5");
  assert.equal((await spec(withIdentity("gpt-6-luna"), { model: "" })).model, "");
});

test("DIRECTIVE: the orchestrator's explicit `model` outranks the identity on both runtimes", async () => {
  assert.equal((await spec(withIdentity("claude-opus-5"), { model: "claude-fable-5" })).model, "claude-fable-5");
  const codex = withIdentity("gpt-6-luna", {
    channelRuntime: "codex", rosters: { codex: { source: "live", ids: CODEX_IDS, aliases: [""].concat(CODEX_IDS) } },
  });
  assert.equal((await spec(codex, { model: "gpt-6-sol" })).model, "gpt-6-sol");
});

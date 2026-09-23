// CODEX PARITY FENCES (2026-09-22) — the three Claude-lane decisions ported, pinned without a CLI.
//
//   1. the operator's `never` is SENT as a narrower `granular` (`policy.js`)
//   2. native delegation is off on every launch (`tools.js` features + `catalog.js`)
//   3. no skill catalogue reaches the agent (`skills-fence.js`)
//
// The wire behaviour behind each is measured in `codex-parity-fences-live.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, realpathSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const launchSpec = require(join(CODEX, "launch-spec.js"));
const policy = require(join(CODEX, "policy.js"));
const catalog = require(join(CODEX, "catalog.js"));
const skills = require(join(CODEX, "skills-fence.js"));
const tools = require(join(CODEX, "tools.js"));
const descriptor = require(join(CODEX, "index.js")).descriptor;

const specFor = (profile, toolMode) => launchSpec.buildLaunchSpec({
  session: { profile, channelId: null, state: { toolMode }, workspaceId: "ws-1", model: "", containerToken: { token: "t" } },
  dispatch: () => {}, emitQuiet: () => {},
});

// ── 1. `never` ───────────────────────────────────────────────────────────────────────────────

test("1: `never` is sent as granular with ONLY mcp_elicitations asking — every other category rejected", () => {
  assert.deepEqual(launchSpec.approvalPolicy("never"), {
    granular: { sandbox_approval: false, rules: false, skill_approval: false, request_permissions: false, mcp_elicitations: true },
  });
  // Every schema key is present, so the echo comparison is exact.
  assert.deepEqual(Object.keys(policy.NEVER_NATIVE.granular).sort(), policy.GRANULAR_KEYS.slice().sort());
  // A fresh object each call — nothing downstream can mutate the frozen constant.
  assert.notEqual(launchSpec.approvalPolicy("never"), launchSpec.approvalPolicy("never"));
});

test("1: an object policy rides config.approval_policy (the typed field needs the experimental API); strings keep the field", () => {
  const never = specFor("full", "never").threadStart;
  assert.equal(never.approvalPolicy, undefined, "no typed field for an object policy");
  assert.deepEqual(never.config.approval_policy, launchSpec.approvalPolicy("never"));
  const granular = specFor("full", "granular").threadStart;
  assert.deepEqual(granular.config.approval_policy, launchSpec.approvalPolicy("granular"));
  const onRequest = specFor("full", "on-request").threadStart;
  assert.equal(onRequest.approvalPolicy, "on-request");
  assert.equal(onRequest.config.approval_policy, undefined);
  // The rest of the config survives the placement.
  assert.equal(never.config.features.apps, false);
  assert.ok(never.config.projects && never.config.skills);
});

test("1d: a PERSISTED `never` still launches, still reads as `never` to Dopl's gate, and the UI option is unchanged", () => {
  // What storage holds is the bare string; nothing is migrated.
  const spec = specFor("full", "never");
  assert.equal(spec.session.state.toolMode, "never");
  assert.ok(tools.TOOL_MODES.includes("never"));
  assert.equal(tools.TOOL_MODES[tools.TOOL_MODES.length - 1], "never", "still the widest mode");
  assert.equal(tools.axisAAllows("never", "commandExecution"), true, "Dopl's own Axis A is unchanged");
  const option = descriptor.toolMode.options.find((o) => o.value === "never");
  assert.ok(option && option.label === "never" && /No approval prompts from Codex/.test(option.description));
  // Containment still wins on the restricted profiles.
  assert.equal(specFor("read_only", "never").threadStart.approvalPolicy, "untrusted");
});

// ── 2. delegation ────────────────────────────────────────────────────────────────────────────

function tmp(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }

test("2: the catalog is Codex's OWN cache with multi_agent_version nulled on every model", async () => {
  const home = tmp("dopl-cat-");
  try {
    const models = [
      { slug: "gpt-6-luna", tool_mode: "code_mode_only", multi_agent_version: "v2", base_instructions: "x" },
      { slug: "gpt-5.6-luna", multi_agent_version: "v1" },
      { slug: "gpt-5.5" },
    ];
    writeFileSync(join(home, catalog.CACHE_FILE), JSON.stringify({ fetched_at: "t", client_version: "0.155.1", models }));
    const file = await catalog.writeDelegationFreeCatalog(home, { bin: null });
    assert.equal(file, join(home, catalog.CATALOG_FILE));
    const out = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(out), ["models"]);
    assert.deepEqual(out.models.map((m) => m.slug), ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.5"]);
    for (const m of out.models) assert.equal(m.multi_agent_version, null, m.slug);
    assert.equal(out.models[0].base_instructions, "x", "nothing else is touched");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(catalog.catalogArgs(file), ["-c", `model_catalog_json=${JSON.stringify(file)}`]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2: no cache → the binary's bundled catalog; nothing usable → the launch THROWS", async () => {
  const home = tmp("dopl-cat-");
  try {
    const bin = join(home, "fake-codex");
    writeFileSync(bin, `#!/bin/sh\n[ "$1 $2 $3" = "debug models --bundled" ] || exit 3\necho '{"models":[{"slug":"gpt-6-astra","multi_agent_version":"v2"}]}'\n`);
    chmodSync(bin, 0o755);
    const file = await catalog.writeDelegationFreeCatalog(home, { bin, env: process.env });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).models, [{ slug: "gpt-6-astra", multi_agent_version: null }]);
    // A cache that lacks the SESSION'S model loses to Codex's own refresh (`debug models`).
    writeFileSync(join(home, catalog.CACHE_FILE), JSON.stringify({ models: [{ slug: "gpt-5.5" }] }));
    const refresher = join(home, "fake-codex-refresh");
    writeFileSync(refresher, `#!/bin/sh\n[ "$1 $2 $3" = "debug models " ] || exit 3\necho '{"models":[{"slug":"gpt-6-luna","multi_agent_version":"v2"}]}'\n`);
    chmodSync(refresher, 0o755);
    const fresh = await catalog.writeDelegationFreeCatalog(home, { bin: refresher, env: process.env, model: "gpt-6-luna" });
    assert.deepEqual(JSON.parse(readFileSync(fresh, "utf8")).models.map((m) => m.slug), ["gpt-6-luna"]);
    // …but a cache that HAS it (or a platform-default launch) never spawns anything.
    assert.deepEqual(JSON.parse(readFileSync(await catalog.writeDelegationFreeCatalog(home, { bin: null, model: "gpt-5.5" }), "utf8")).models.map((m) => m.slug), ["gpt-5.5"]);
    writeFileSync(join(home, catalog.CACHE_FILE), "{ not json");
    await assert.rejects(catalog.writeDelegationFreeCatalog(home, { bin: join(home, "missing") }), /refusing the launch/);
    writeFileSync(join(home, catalog.CACHE_FILE), JSON.stringify({ models: [] }));
    await assert.rejects(catalog.writeDelegationFreeCatalog(home, { bin: null }), /refusing the launch/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 3. skills ────────────────────────────────────────────────────────────────────────────────

function skill(dir, name, declared) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${declared || name}\ndescription: probe\n---\nbody\n`);
  return join(dir, name, "SKILL.md");
}

test("3: every personal, project and private-home skill is disabled by path AND name; listing and bundled off", () => {
  const root = tmp("dopl-skills-");
  try {
    const home = join(root, "home");
    const codexHome = join(root, "codex-home");
    const cwd = join(root, "proj", "sub", "cwd");
    mkdirSync(cwd, { recursive: true });
    const personal = skill(join(home, ".agents", "skills"), "ce-brainstorm");
    const renamed = skill(join(home, ".agents", "skills"), "dir-name", "declared-name");
    const nested = skill(join(home, ".agents", "skills", "group"), "nested-one");
    const project = skill(join(root, "proj", ".agents", "skills"), "projskill");
    const inCwd = skill(join(cwd, ".codex", "skills"), "cwdcodex");
    const system = skill(join(codexHome, "skills", ".system"), "imagegen");
    const fence = skills.skillsFence({ home, cwd, codexHome });
    assert.equal(fence.include_instructions, false);
    assert.deepEqual(fence.bundled, { enabled: false });
    const paths = fence.config.filter((e) => e.path).map((e) => e.path);
    const names = fence.config.filter((e) => e.name).map((e) => e.name);
    for (const f of [personal, renamed, nested, project, inCwd, system]) {
      assert.ok(paths.includes(f), `path ${f}`);
      assert.ok(paths.includes(realpathSync(f)), `canonical ${f}`);
    }
    for (const n of ["ce-brainstorm", "declared-name", "nested-one", "projskill", "cwdcodex", "imagegen"]) assert.ok(names.includes(n), n);
    assert.ok(fence.config.every((e) => e.enabled === false && !(e.path && e.name)), "one selector per entry");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("3: the roots are a SUPERSET of Codex's — every ancestor of cwd, the operator's home, /etc, the private home", () => {
  const roots = skills.skillRoots({ home: "/h", cwd: "/a/b", codexHome: "/c" });
  for (const r of ["/h/.agents/skills", "/etc/codex/skills", "/c/skills", "/a/b/.agents/skills", "/a/b/.codex/skills",
    "/a/.agents/skills", "/.agents/skills"]) assert.ok(roots.includes(r), r);
});

test("3: every launch carries the skills fence", () => {
  for (const profile of ["read_only", "dopl_only", "channel_agent", "full"]) {
    const s = specFor(profile, "on-request").threadStart.config.skills;
    assert.equal(s.include_instructions, false, profile);
    assert.deepEqual(s.bundled, { enabled: false }, profile);
    assert.ok(Array.isArray(s.config), profile);
  }
});

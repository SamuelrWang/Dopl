// THE ADAPTER SCAFFOLD — one file layout for every runtime under `main/runtime/<id>/`.
//
// `runtime-contract.test.mjs` pins WHAT an adapter exports; this pins WHERE each job lives, so the
// same slot has the same file name in every adapter and a new SDK maps onto it file by file. The
// layout table is docs/INVARIANTS.md §11.0i (the rule) and docs/specs/runtime-scaffold.md §4 (the
// procedure + the per-SDK mapping). Looped over the registry, like the conformance suite.
//
// WHAT IT ASSERTS, per registered adapter:
//   (a) every REQUIRED file exists;
//   (b) each CAPABILITY-GATED file exists EXACTLY WHEN its capability is declared;
//   (c) every other file is a canonical optional slot, or a row in the dated `EXTRA` census — and every
//       census row still exists on disk (it shrinks, never grows quietly: the `core-vocabulary` DEFERRED
//       pattern);
//   (d) `descriptor.toolMode.options` values EQUAL `tools.js › TOOL_MODES`, in order (two copies of one
//       vocabulary per adapter until then, and nothing compared them), and the windowless floor is
//       `tools.js › WINDOWLESS_FLOOR`;
//   (e) the descriptor's keys come in the canonical order.
// Exceptions while the migration runs ride `PENDING`, dated; each row must still be TRUE, so a step
// that lands deletes its row in the same change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(HERE, "..", "main", "runtime");
const require = createRequire(import.meta.url);
const registry = require(join(RUNTIME_DIR, "index.js"));
const ADAPTERS = registry.all();

// Every adapter has these, under these names.
const REQUIRED = [
  "index.js", "client.js", "tools.js", "axis-b.js", "approval.js", "launch-spec.js", "normalize.js",
  "models.js", "mcp.js", "credential.js", "packaging.js",
];

const INDEX_SRC = readFileSync(join(RUNTIME_DIR, "index.js"), "utf8");
const src = (id, file) => readFileSync(join(RUNTIME_DIR, id, file), "utf8");

// Present exactly when the capability is declared — absent means absent, like `null`.
const GATED = {
  "required-shape.js": ({ descriptor }) => descriptor.requiredShape != null,
  "shape.js": ({ descriptor }) => descriptor.requiredShape != null,
  "identity.js": ({ descriptor }) => !/buildIdentity\(\)\s*\{\s*return null;?\s*\}/.test(src(descriptor.id, "index.js")),
  "login.js": ({ descriptor }) => (descriptor.credential || {}).interactiveSignIn === true,
  "update-source.js": ({ descriptor }) => INDEX_SRC.includes(`require('./${descriptor.id}/update-source')`),
  // An RPC transport: the client speaks JSON-RPC to the vendor process.
  "protocol.js": ({ descriptor }) => {
    const client = join(RUNTIME_DIR, descriptor.id, "client.js");
    return existsSync(client) && /\bjsonrpc\b|JSON-RPC/.test(readFileSync(client, "utf8"));
  },
};

// Canonical slots an adapter adds when it needs the job (no declaration to tie them to).
const OPTIONAL = [
  "launch-handle.js", "resolve-bin.js", "config-home.js", "policy.js", "launch-verify.js",
  "operator-tools.js", "usage.js",
];

// Vendor-only files @ 2026-10-13. A row whose file is gone fails: delete the row with the file.
const EXTRA = {
  claude: {
    "fold.js": "mid-turn steer fold over the SDK Query",
    "cost-rates.js": "cheapest-model learning for the semantics probe",
    "semantics.js": "build-verify: the updater's live gate/deny probe",
    "roster.js": "turn-free supportedModels() probe + observeShape",
    "skill-install.js": "installs Dopl skills into ~/.claude/skills",
    "skills": "assets: SKILL.md + .sh (INVARIANTS §11.0 .js rule — finding)",
    "launch-contract.js": "launch-verify slot: per-launch system/init readback (name kept, 2026-10-13)",
  },
  codex: {
    "mcp-ready.js": "first turn waits for Dopl's MCP",
    "fence-verify.js": "build-verify: `features list` check",
    "skills-fence.js": "vendor fence: skills directory",
    "delegation-fence.js": "vendor fence: delegation, via a delegation-free model catalog (catalog.js until 2026-10-13)",
  },
  cursor: {},
};

// Migration exceptions @ 2026-10-13 (docs/specs/runtime-scaffold.md §5). Each must still hold.
const PENDING = {
  claude: {
    present: {},
    missing: {
      "login.js": "Phase 4: the flow is core main/claude-auth.js (core-vocabulary DEFERRED)",
    },
    checks: { windowlessFloor: "Phase 1.10" },
  },
  codex: {
    present: {},
    missing: {},
    checks: { keyOrder: "Phase 1.10" },
  },
  cursor: { present: {}, missing: {}, checks: {} },
};

const KEY_ORDER = [
  "id", "label", "session", "axisB", "approval", "toolMode", "containment", "models", "requiredShape",
  "mcp", "credential", "prose", "packaging",
];

const filesOf = (id) => readdirSync(join(RUNTIME_DIR, id)).filter((f) => !f.startsWith("."));
const pending = (id) => PENDING[id] || { present: {}, missing: {}, checks: {} };

test("every registered adapter has a census row, and no row names an unregistered one", () => {
  assert.ok(ADAPTERS.length >= 3, "fewer adapters than the scaffold was written against");
  const ids = ADAPTERS.map(({ descriptor }) => descriptor.id);
  assert.deepEqual(Object.keys(EXTRA).sort(), [...ids].sort(), "EXTRA rows ≠ registered adapters");
  assert.deepEqual(Object.keys(PENDING).sort(), [...ids].sort(), "PENDING rows ≠ registered adapters");
});

test("(a) every REQUIRED file exists", () => {
  for (const { descriptor: { id } } of ADAPTERS) {
    const have = new Set(filesOf(id));
    for (const f of REQUIRED) {
      if (pending(id).missing[f]) continue;
      assert.ok(have.has(f), `${id}/${f} is missing — every adapter has this slot under this name`);
    }
  }
});

test("(b) a capability-gated file exists EXACTLY when its capability is declared", () => {
  for (const adapter of ADAPTERS) {
    const id = adapter.descriptor.id;
    const have = new Set(filesOf(id));
    for (const [f, declared] of Object.entries(GATED)) {
      if (pending(id).missing[f]) continue;
      assert.equal(have.has(f), declared(adapter),
        `${id}/${f} ${have.has(f) ? "exists but its capability is not declared" : "is missing but its capability is declared"}`);
    }
  }
});

test("(c) every other file is a canonical optional slot or a dated EXTRA row — and every row still exists", () => {
  const canonical = new Set([...REQUIRED, ...Object.keys(GATED), ...OPTIONAL]);
  for (const { descriptor: { id } } of ADAPTERS) {
    const have = filesOf(id);
    for (const f of have) {
      if (canonical.has(f) || EXTRA[id][f] || pending(id).present[f]) continue;
      assert.fail(`${id}/${f} is in no slot — rename it to its slot, or add a dated EXTRA row saying why it is vendor-only`);
    }
    for (const f of Object.keys(EXTRA[id])) {
      assert.ok(have.includes(f), `EXTRA row ${id}/${f} names a file that is gone — delete the row`);
    }
  }
});

test("(c) the PENDING census only shrinks: every row is still true", () => {
  for (const { descriptor: { id } } of ADAPTERS) {
    const have = new Set(filesOf(id));
    for (const f of Object.keys(pending(id).present)) {
      assert.ok(have.has(f), `PENDING ${id}/${f} has moved — delete its row`);
    }
    for (const f of Object.keys(pending(id).missing)) {
      assert.ok(!have.has(f), `PENDING ${id}/${f} now exists — delete its row`);
    }
  }
});

test("(d) toolMode.options IS tools.js › TOOL_MODES, and the windowless floor is tools.js › WINDOWLESS_FLOOR", () => {
  for (const { descriptor } of ADAPTERS) {
    const tools = require(join(RUNTIME_DIR, descriptor.id, "tools.js"));
    assert.ok(Array.isArray(tools.TOOL_MODES), `${descriptor.id}/tools.js exports no TOOL_MODES`);
    assert.deepEqual(descriptor.toolMode.options.map((o) => o.value), tools.TOOL_MODES,
      `${descriptor.id}: the descriptor's tool modes and tools.js › TOOL_MODES are two lists of one vocabulary`);
    const floorPending = pending(descriptor.id).checks.windowlessFloor;
    if (floorPending) {
      assert.equal(tools.WINDOWLESS_FLOOR, undefined, `PENDING ${descriptor.id} windowlessFloor has landed — delete its row`);
      continue;
    }
    assert.equal(descriptor.toolMode.windowlessFloor, tools.WINDOWLESS_FLOOR, `${descriptor.id}: windowless floor`);
  }
});

test("(e) descriptor keys come in the canonical order", () => {
  for (const { descriptor } of ADAPTERS) {
    const keys = Object.keys(descriptor);
    const expected = KEY_ORDER.filter((k) => keys.includes(k));
    for (const k of keys) assert.ok(KEY_ORDER.includes(k), `${descriptor.id}: descriptor key ${k} has no canonical place`);
    const inOrder = JSON.stringify(keys) === JSON.stringify(expected);
    if (pending(descriptor.id).checks.keyOrder) {
      assert.ok(!inOrder, `PENDING ${descriptor.id} keyOrder has landed — delete its row`);
      continue;
    }
    assert.deepEqual(keys, expected, `${descriptor.id}: descriptor key order`);
  }
});

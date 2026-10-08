// CODEX'S `requiredShape` CONTRACT (2026-10-08) — the shared harness (`helpers/shape-contract.mjs`):
//   static  every declared item is read by this adapter's code (no dead item can brick a launch);
//   tier 1  the MEASURED build (`fixtures/codex-shape.json`, `npm run codex:schema`) covers every item;
//   tier 2  `CODEX_APP_SERVER_LIVE=1`: the INSTALLED build's own schema covers safety + core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";
import { runShapeContract } from "./helpers/shape-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const require = createRequire(import.meta.url);
const adapter = require(join(CODEX, "index.js"));
const shape = require(join(CODEX, "shape.js"));
const resolveBin = require(join(CODEX, "resolve-bin.js"));
const fixture = require("./fixtures/codex-shape.json");

// The adapter's own code, minus the declaration itself (a declared item must be READ, not just named).
const SOURCES = readdirSync(CODEX).filter((f) => f.endsWith(".js") && f !== "required-shape.js").map((f) => join(CODEX, f));

runShapeContract({
  runtimeId: "codex",
  required: adapter.descriptor.requiredShape,
  fixture,
  liveProbe: async () => (await shape.describeBuild(resolveBin.resolveCodexBin().path)).shape,
  liveEnv: "CODEX_APP_SERVER_LIVE",
  sources: SOURCES,
});

test("codex: the descriptor's requiredShape IS required-shape.js, and the runtime can describe itself", () => {
  assert.equal(adapter.descriptor.requiredShape, require(join(CODEX, "required-shape.js")));
  assert.equal(typeof adapter.runtime.shape, "function");
  assert.equal(adapter.runtime.shape.length, 0);
  assert.equal(typeof require(join(CODEX, "update-source.js")).probeShape, "function", "the updater can check a candidate");
});

test("codex: replies to server requests come from the build's OWN response schema", () => {
  // Measured from the 0.155.1 schema bundle (the shapes `server-requests.js` hand-writes today).
  const enumReply = (key, values) => ({ schema: { type: "object", required: [key], properties: { [key]: { enum: values } } }, defs: {} });
  assert.deepEqual(shape.replyFromSchema(enumReply("decision", ["accept", "acceptForSession", "decline", "cancel"]), "accept"), { decision: "accept" });
  assert.deepEqual(shape.replyFromSchema(enumReply("action", ["accept", "decline", "cancel"]), "decline"), { action: "decline" });
  // Anything Dopl would have to GUESS answers null: two required fields, or no decision word.
  assert.equal(shape.replyFromSchema({ schema: { type: "object", required: ["a", "b"], properties: { a: {}, b: {} } }, defs: {} }, "accept"), null);
  assert.equal(shape.replyFromSchema(enumReply("mode", ["fast", "slow"]), "accept"), null);
  assert.equal(shape.replyFor("/never/described", "x", "accept"), null);
});

test("codex: fieldPaths resolves refs, unions oneOf, walks arrays, and survives a cycle", () => {
  const defs = {
    Row: { type: "object", properties: { id: { type: "string" }, child: { $ref: "#/definitions/Row" } } },
    Either: { oneOf: [{ properties: { a: {} } }, { properties: { b: {} } }] },
  };
  const paths = Array.from(shape.fieldPaths({ properties: { data: { type: "array", items: { $ref: "#/definitions/Row" } }, e: { $ref: "#/definitions/Either" } } }, defs)).sort();
  assert.deepEqual(paths, ["data", "data.child", "data.id", "e", "e.a", "e.b"]);
});

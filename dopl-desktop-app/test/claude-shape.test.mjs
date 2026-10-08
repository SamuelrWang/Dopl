// SDK RESILIENCE #2 (2026-10-08): the Claude pairing describes itself turn-free and is checked against
// `descriptor.requiredShape` — at launch (`sdk-shape.js › launchShapeRefusal`) and on an update
// (`update-source.js › probeShape`). The live observation is MEASURED on 0.3.293; here a fake SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const roster = require("../main/runtime/claude/roster.js");
const shapeLib = require("../main/runtime/sdk-shape.js");
const claude = require("../main/runtime/claude/index.js");
const updateSource = require("../main/runtime/claude/update-source.js");

// A fake SDK whose query answers like the real one (methods on a prototype, rows from the CLI).
function fakeSdk(rows, over = {}) {
  class Query {
    constructor() { this.closed = false; }
    async supportedModels() { return rows; }
    async interrupt() {}
    async setModel() {}
    close() { this.closed = true; }
    async *[Symbol.asyncIterator]() {}
  }
  const made = [];
  const sdk = { query: (args) => { const q = new Query(); made.push({ q, args }); return q; }, createSdkMcpServer() {}, tool() {}, ...over };
  return { sdk, made };
}
const MEASURED_ROW = { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5", description: "x", supportsEffort: true };

test("observeShape: exports, inherited Query methods, and the supportedModels row fields — turn-free, closed", async () => {
  const { sdk, made } = fakeSdk([MEASURED_ROW]);
  const shape = await roster.observeShape({ sdk, options: { env: {} } });
  assert.deepEqual(shape.exports.sort(), ["createSdkMcpServer", "query", "tool"]);
  for (const m of ["supportedModels", "interrupt", "setModel", "close"]) assert.ok(shape.methods.includes(m), m);
  assert.ok(!shape.methods.includes("constructor"));
  assert.deepEqual(shape.results.supportedModels.sort(), ["description", "displayName", "resolvedModel", "supportsEffort", "value"]);
  assert.equal(made[0].args.options.permissionMode, "default", "the probe's pins apply");
  assert.ok(made[0].q.closed, "the child is always closed");
});

test("the shipped requiredShape passes on the measured pairing", async () => {
  const { sdk } = fakeSdk([MEASURED_ROW]);
  const verdict = shapeLib.checkShape(claude.descriptor.requiredShape, await roster.observeShape({ sdk, options: {} }));
  assert.equal(verdict.ok, true, JSON.stringify(verdict.missing));
});

test("REFUSES when a safety or core item is gone; a cosmetic gap only drifts", async () => {
  const noInterrupt = fakeSdk([MEASURED_ROW]);
  const obs = await roster.observeShape({ sdk: noInterrupt.sdk, options: {} });
  obs.methods = obs.methods.filter((m) => m !== "interrupt");
  assert.deepEqual(shapeLib.checkShape(claude.descriptor.requiredShape, obs).missing.safety, ["method interrupt"]);
  const renamed = fakeSdk([{ value: "sonnet", label: "Sonnet" }]);
  const v = shapeLib.checkShape(claude.descriptor.requiredShape, await roster.observeShape({ sdk: renamed.sdk, options: {} }));
  assert.equal(v.refuse, true, "displayName renamed → the picker cannot label: core");
  const noTools = fakeSdk([MEASURED_ROW], { createSdkMcpServer: undefined });
  const c = shapeLib.checkShape(claude.descriptor.requiredShape, await roster.observeShape({ sdk: noTools.sdk, options: {} }));
  assert.equal(c.refuse, false);
  assert.deepEqual(c.missing.cosmetic, ["export createSdkMcpServer"]);
});

test("the adapter registers with requiredShape + a zero-arg shape(); compatible() is gone", () => {
  assert.deepEqual(shapeLib.requiredShapeProblems(claude.descriptor, claude.runtime), []);
  assert.equal(typeof updateSource.probeShape, "function");
  assert.equal(updateSource.compatible, undefined, "no version range: the shape gate decides");
});

test("a probe that times out is a rejection naming the cause, never a shape", async () => {
  const { sdk } = fakeSdk([MEASURED_ROW]);
  sdk.query = () => ({ supportedModels: () => new Promise(() => {}), close() {}, async *[Symbol.asyncIterator]() {} });
  await assert.rejects(roster.observeShape({ sdk, options: {}, timeoutMs: 20 }), /did not describe itself within 20ms/);
});

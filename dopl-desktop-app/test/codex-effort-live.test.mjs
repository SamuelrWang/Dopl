// The effort send-safety alphabet is LIVE (orchestrator on Codex audit LOW4): the build's own schema's closed
// list for `turn/start effort` when it declares one, else the launched model's live offer; neither → dropped +
// drift. No effort value is typed into Dopl.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const sdkShape = require(join(MAIN, "runtime", "sdk-shape.js"));
const liveStore = require(join(MAIN, "runtime", "live-store.js"));
const catalogs = require(join(MAIN, "runtime", "model-catalog.js"));
const launchSpec = require(join(MAIN, "runtime", "codex", "launch-spec.js"));
const shape = require(join(MAIN, "runtime", "codex", "shape.js"));
const codexModels = require(join(MAIN, "runtime", "codex", "models.js"));

beforeEach(() => {
  liveStore.inject({ file: () => join(mkdtempSync(join(tmpdir(), "dopl-eff-")), "live.json") });
  sdkShape.forgetShape();
  sdkShape.forgetDrift();
  sdkShape.injectDiag(() => {});
  catalogs.forget();
});

const effortOf = (dimensions, model = "") => launchSpec.buildLaunchSpec({
  session: { profile: "full", channelId: "11111111-1111-4111-8111-111111111111", state: { toolMode: "on-request" },
    workspaceId: "ws", model, containerToken: { token: "t" }, dimensions },
  dispatch: () => {},
}).turnStart.effort;

/** Describe a Codex build whose schema declares `values` for `turn/start effort` (or none). */
async function buildDeclares(values) {
  const ad = {
    descriptor: { id: "codex", label: "Codex", requiredShape: { core: { methods: ["turn/start"] } } },
    runtime: {
      buildIdentity: () => ({ path: "/bin/codex", version: "9.9.9", account: "a" }),
      shape: async () => ({ methods: ["turn/start"], ...(values ? { values: { "turn/start effort": values } } : {}) }),
    },
  };
  await sdkShape.settleShape(ad);
}

/** Hold a READY catalog for codex offering `efforts` on model m1. */
async function modelOffers(efforts) {
  await catalogs.settle({
    descriptor: { id: "codex", label: "Codex", models: { source: "live", dimensions: ["reasoningEffort"] } },
    runtime: { buildIdentity: () => null, models: async () => ({ models: [{ id: "m1", isDefault: true, dimensions: { reasoningEffort: { options: efforts } } }] }) },
  });
}

test("the build's schema ADDS a new effort → it is sent; a value outside the build's list is refused (not sent)", async () => {
  await buildDeclares(["low", "high", "hyperdrive"]);
  assert.equal(effortOf({ reasoningEffort: "hyperdrive" }), "hyperdrive", "a level Dopl never heard of, declared by the build");
  assert.equal(effortOf({ reasoningEffort: "ultra" }), undefined, "not in this build's list: dropped");
  assert.match(sdkShape.driftReport("codex").map((d) => d.detail).join(" "), /"ultra" is outside this build's own list/);
});

test("schema declares NO list (0.155.1/0.160.1: any non-empty string) → the model's live offer decides", async () => {
  await buildDeclares(null);
  await modelOffers(["low", "max", "ultra"]);
  assert.equal(effortOf({ reasoningEffort: "ultra" }, "m1"), "ultra", "offered by the model: sent");
  assert.equal(effortOf({ reasoningEffort: "medium" }, "m1"), undefined, "not offered by this model: dropped");
});

test("neither a build list nor a vouching catalog → dropped, with drift", async () => {
  assert.equal(effortOf({ reasoningEffort: "high" }), undefined);
  assert.match(sdkShape.driftReport("codex").map((d) => d.detail).join(" "), /could not be confirmed/);
  assert.equal(effortOf(undefined), undefined, "no pick, nothing sent, nothing said");
});

test("the catalog offers every non-empty value the server lists (no local alphabet hides one)", () => {
  const entry = codexModels.entryFrom({ id: "m", supportedReasoningEfforts: [{ reasoningEffort: "Turbo Max" }, { reasoningEffort: "x".repeat(65) }] });
  assert.deepEqual(entry.dimensions.reasoningEffort.options.map((o) => o.value), ["Turbo Max"], "only a garbage-length row is dropped");
  assert.equal(codexModels.descriptor.dimensionOptions.reasoningEffort.pattern, undefined, "no typed alphabet");
});

test("shape.js reads a field's closed vocabulary from the schema (enum / const / anyOf), and open types read as none", () => {
  const defs = {
    TurnStartParams: { type: "object", properties: {
      effort: { anyOf: [{ $ref: "#/definitions/ReasoningEffort" }, { type: "null" }] },
      mode: { enum: ["a", "b"] },
      kind: { oneOf: [{ const: "x" }, { const: "y" }] },
    } },
    ReasoningEffort: { type: "string", minLength: 1 },
  };
  const dir = mkdtempSync(join(tmpdir(), "dopl-shape-"));
  const fs = require("node:fs");
  const file = (n, o) => fs.writeFileSync(join(dir, n), JSON.stringify(o));
  file("ClientRequest.json", { oneOf: [{ properties: { method: { enum: ["turn/start"] }, params: { $ref: "#/definitions/TurnStartParams" } } }], definitions: defs });
  file("ServerNotification.json", { oneOf: [] });
  file("ServerRequest.json", { oneOf: [] });
  const out = shape.shapeFromDir(dir);
  assert.deepEqual(out.shape.values, { "turn/start mode": ["a", "b"], "turn/start kind": ["x", "y"] }, "an open string declares no list");
});

// What Dopl reads from Muse (`required-shape.js`) against what muse 1.4.7-R6101.1 declares about itself
// (`muse schema generate-json-schema --experimental`, turned into a Shape by `shape.js`, saved as a fixture).
// Every REQUIRED_METHODS entry is required; every required item exists in the measured build.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { FIX, m } from "./_muse-harness.mjs";

const require = createRequire(import.meta.url);
const sdkShape = require("../main/runtime/sdk-shape.js");
const required = m("required-shape.js");
const protocol = m("protocol.js");
const shape = m("shape.js");
const measured = JSON.parse(readFileSync(join(FIX, "shape-1.4.7-R6101.1.json"), "utf8"));

test("the measured 1.4.7 build covers every tier Dopl requires — nothing missing, nothing unexpected", () => {
  const v = sdkShape.checkShape(required, measured.shape);
  assert.equal(v.refuse, false, JSON.stringify(v.missing));
  assert.deepEqual(v.missing, { safety: [], core: [], cosmetic: [] });
  // The EXPERIMENTAL surface's fingerprint (the stable one, which `initialize` reports, is sha256:6de32db0…).
  assert.equal(measured.fingerprint, "sha256:0d803007acbd02ad07a6cec4d5a63b834f4db743886bbaf865b8738116dc212f");
});

test("every method the adapter sends is required (safety or core)", () => {
  const req = new Set([...required.safety.methods, ...required.core.methods]);
  for (const mth of protocol.REQUIRED_METHODS) assert.ok(req.has(mth), `${mth} is sent but not required`);
});

test("a build that dropped an approval mode Dopl sends, or the approval choice list, is REFUSED", () => {
  const s = JSON.parse(JSON.stringify(measured.shape));
  s.values["session/start approvalMode"] = ["allowAll"];
  assert.equal(sdkShape.checkShape(required, s).refuse, true);
  const t = JSON.parse(JSON.stringify(measured.shape));
  t.notifications["approval/requested"] = t.notifications["approval/requested"].filter((p) => !p.startsWith("availableChoices"));
  assert.equal(sdkShape.checkShape(required, t).refuse, true);
});

test("shape.js reads MSP's single-file schema: $defs refs, unions, closed vocabularies", () => {
  const doc = {
    $defs: { P: { properties: { mode: { $ref: "#/$defs/M" }, cfg: { $ref: "#/$defs/C" } } }, M: { enum: ["a", "b"] },
      C: { properties: { servers: { additionalProperties: { oneOf: [{ properties: { url: {} } }, { properties: { command: {} } }] } } } },
      R: { properties: { id: {}, rows: { items: { properties: { x: {} } } } } } },
    methods: { "x/do": { params: { $ref: "#/$defs/P" }, result: { $ref: "#/$defs/R" } } },
    notifications: { "x/did": { params: { $ref: "#/$defs/R" } } },
    requests: { "x/ask": { params: { $ref: "#/$defs/P" } } },
  };
  const out = shape.shapeFromSchema(doc);
  assert.deepEqual(out.methods, ["x/do"]);
  assert.deepEqual(out.results["x/do"].sort(), ["id", "rows", "rows.x"]);
  assert.deepEqual(out.values["x/do mode"], ["a", "b"]);
  assert.ok(out.requests["x/ask"].includes("cfg.servers.url") && out.requests["x/ask"].includes("cfg.servers.command"));
});

test("version reads: `muse --version` prints the release; an unreadable answer is refused; the envelope is v1", () => {
  assert.equal(protocol.releaseOf("Muse Code 1.4.7 (1.4.7-R6101.1)"), "1.4.7-R6101.1");
  assert.deepEqual(protocol.parseVersion("Muse Code 1.4.7 (1.4.7-R6101.1)"), [1, 4, 7]);
  assert.equal(protocol.versionGate("garbage").ok, false);
  assert.doesNotThrow(() => protocol.assertSchema({ schema: { version: 1 } }));
  assert.throws(() => protocol.assertSchema({ schema: { version: 2 } }), /envelope version 2/);
});

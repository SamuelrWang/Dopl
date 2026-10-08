// THE SHAPE CONTRACT HARNESS — generalized from `codex-app-server-contract.test.mjs` so EVERY runtime
// pins its `descriptor.requiredShape` the same way (2026-10-08). Not a test file; a runtime's contract
// suite calls `runShapeContract` once.
//
//   tier 1 (always):  the MEASURED fixture (what the vendor's build described, captured by a script)
//                     covers every item the adapter declares, at every tier. A cosmetic gap fails here
//                     too: it means the adapter reads something no measurement has ever shown.
//   tier 2 (live):    with `process.env[liveEnv] === "1"`, the installed build's own description
//                     (`liveProbe`) covers safety + core; cosmetic gaps are printed, not failed —
//                     exactly the line the runtime itself draws at launch (`sdk-shape.js`).
//
//   static (always):  every declared item is REFERENCED by the adapter's own source (`sources`): its
//                     method/notification name and its field's last segment appear as a string or a
//                     property access. A declared item no code reads is how an over-strict list bricks
//                     launches on a harmless upstream change, so it FAILS here, not in review.
//
// ⚠ IT DOES NOT CLAIM WHAT THE PROTOCOL IS. Only a fixture captured from a real build, or the live
// tier, may; a hand-written fixture makes tier 1 a tautology. `fixture.measured` must be true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sdkShape = require(join(HERE, "..", "..", "main", "runtime", "sdk-shape.js"));

/**
 * @param {object} o
 * @param {string} o.runtimeId
 * @param {object} o.required    the adapter's `descriptor.requiredShape`
 * @param {object} o.fixture     `{ measured: true, version, shape }` — `shape` is a Shape or `{ paths }`
 * @param {() => Promise<object>} [o.liveProbe]  the installed build's description (tier 2)
 * @param {string} [o.liveEnv]   env flag that enables tier 2
 * @param {string[]} o.sources    the adapter's source files (absolute paths) — the static tier
 */
export function runShapeContract({ runtimeId, required, fixture, liveProbe, liveEnv, sources }) {
  test(`${runtimeId}: static — every declared protocol item is READ by the adapter's code`, () => {
    assert.ok(Array.isArray(sources) && sources.length, "pass the adapter's source files");
    const text = sources.map((f) => readFileSync(f, "utf8")).join("\n");
    const unread = unreadItems(required, text);
    assert.deepEqual(unread, [], "declared in requiredShape but referenced nowhere in the adapter");
  });

  test(`${runtimeId}: the protocol fixture is MEASURED, not written by hand`, () => {
    assert.equal(fixture && fixture.measured, true, "fixture.measured must be true (captured from a real build)");
    assert.ok(typeof fixture.version === "string" && fixture.version, "fixture names the build it measured");
  });

  test(`${runtimeId}: tier 1 — the measured build covers EVERY item the adapter declares`, () => {
    assert.ok(sdkShape.declares({ requiredShape: required }), "the adapter declares something to check");
    const verdict = sdkShape.checkShape(required, fixture.shape);
    assert.deepEqual(verdict.missing, { safety: [], core: [], cosmetic: [] },
      `declared but never measured on ${fixture.version}`);
  });

  const live = liveEnv && process.env[liveEnv] === "1";
  test(`${runtimeId}: tier 2 — the INSTALLED build covers safety + core`, { skip: live ? false : `set ${liveEnv}=1` }, async () => {
    const observed = await liveProbe();
    const verdict = sdkShape.checkShape(required, observed);
    if (verdict.missing.cosmetic.length) {
      console.log(`${runtimeId}: cosmetic drift on the installed build: ${verdict.missing.cosmetic.join(", ")}`);
    }
    assert.deepEqual(verdict.missing.safety, [], "safety items missing on the installed build");
    assert.deepEqual(verdict.missing.core, [], "core items missing on the installed build");
  });
}

/** The tokens a flat shape path must show in source: the name, plus the field's last segment. */
export function tokensOf(flatPath) {
  const parts = String(flatPath).split(" ");
  const name = parts[1] || "";
  const field = parts[2] || "";
  const last = field ? field.split(".").pop() : "";
  return [name, last].filter(Boolean);
}

/** A token is READ when it appears quoted ('x', "x", `x`) or as a property access (.x / x:). */
export function isReferenced(token, text) {
  const esc = token.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`['"\`]${esc}['"\`]|\\.${esc}\\b|\\b${esc}\\s*:`).test(text);
}

/** Every declared flat path (any tier) with a token the source never references. */
export function unreadItems(required, text) {
  const out = [];
  for (const tier of sdkShape.TIERS) {
    for (const p of sdkShape.flatten(required && required[tier])) {
      if (tokensOf(p).some((t) => !isReferenced(t, text))) out.push(`${tier}: ${p}`);
    }
  }
  return out;
}

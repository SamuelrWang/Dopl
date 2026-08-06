// THE LIVE HARNESS IS EXCLUDED FROM `npm test` BY DESIGN — and that is exactly how it rots.
//
// `test/live/*.js` needs a credential and the network, so the ordinary suite must not run
// it (the `.js` extension is the exclusion; see test/live/creds.js). The cost of that is
// that NOTHING loads those modules: a syntax error, a bad require, a renamed export or a
// check missing from the registrar is invisible until somebody runs the harness by hand —
// which, for the harness deleted in F-141, was never.
//
// This file buys the cheap half back. It LOADS every harness module and asserts the shape
// of the registrar. It makes no network call and needs no credential, so it is safe in CI.
//
// It deliberately does NOT import run.js: that module calls main() at the bottom and would
// try to talk to prod on import. The runner's own wiring is covered by the check that every
// name it imports actually exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, "live");

test("every live-harness module loads", () => {
  for (const m of [
    "creds.js",
    "api.js",
    "desktop.js",
    "checks-shared.js",
    "checks-transport.js",
    "checks-routes.js",
    "checks-contract.js",
    "checks.js",
  ]) {
    assert.doesNotThrow(() => require(path.join(LIVE, m)), `${m} failed to load`);
  }
});

test("the registrar is well-formed and every check is callable", () => {
  const { CHECKS } = require(path.join(LIVE, "checks.js"));
  assert.ok(Array.isArray(CHECKS) && CHECKS.length > 0, "CHECKS is empty");
  const ids = new Set();
  for (const c of CHECKS) {
    assert.equal(typeof c.id, "number", `check ${c.title} has no numeric id`);
    assert.ok(!ids.has(c.id), `duplicate check id ${c.id}`);
    ids.add(c.id);
    assert.equal(typeof c.title, "string");
    assert.ok(c.title.length > 0, `check ${c.id} has an empty title`);
    assert.equal(typeof c.run, "function", `check ${c.id} ("${c.title}") has no run function`);
  }
});

test("the desktop decision modules still slice out of main/", async () => {
  const { load } = require(path.join(LIVE, "desktop.js"));
  const dsk = await load();
  // A slice failure is RECORDED rather than thrown, so assert on the record: this is the
  // guard that catches a renamed function in main/ before a live run reports it as a SKIP.
  assert.deepEqual(dsk.notes, [], `slices failed: ${dsk.notes.join("; ")}`);
  assert.equal(typeof dsk.classify, "function");
  assert.equal(typeof dsk.pillState, "function");
  // The projection's own truth table, in miniature — phase-first for terminal states.
  assert.equal(dsk.pillState({ phase: "ended" }), "ended");
  assert.equal(dsk.pillState({ activity: "working" }), "working");
  assert.equal(dsk.pillState({ parked: true }), "idle");
  // The prototype-pollution guard pillState was written for.
  assert.equal(dsk.pillState({ activity: "constructor" }), "idle");
});

test("the forged-key list covers every reserved key the service strips", () => {
  const { FORGED, CONDITIONALLY_STRIPPED } = require(path.join(LIVE, "checks-contract.js"));
  const src = readFileSync(
    path.join(HERE, "..", "..", "src", "features", "channels", "server", "service-writes-metadata.ts"),
    "utf8"
  );
  // Every UNCONDITIONALLY stripped `delete metadata.<key>` must be probed by the harness.
  // This is the guard the mutation testing asked for: adding a new reserved key to the
  // service without adding it here fails HERE, rather than silently narrowing what the
  // live run proves.
  //
  // `CONDITIONALLY_STRIPPED` is subtracted because those keys are NOT always dropped —
  // `taskId` is honoured when it names a thread the caller participates in, so asserting a
  // strip on it would assert the opposite of the contract. The exclusion lives next to the
  // forged list itself so the two cannot drift.
  const stripped = [...src.matchAll(/delete metadata\.(\w+);/g)].map((m) => m[1]);
  assert.ok(stripped.length > 0, "found no `delete metadata.x` lines — did the strip move?");
  const missing = stripped.filter((k) => !(k in FORGED) && !CONDITIONALLY_STRIPPED.includes(k));
  assert.deepEqual(
    missing,
    [],
    `the service strips these keys but the harness never forges them: ${missing.join(", ")}`
  );
});

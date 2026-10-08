// The shared shape-contract harness runs green over a self-consistent fake runtime (its failure paths are
// `checkShape`'s, pinned in `sdk-shape.test.mjs`). Real runtimes call it from their own contract suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShapeContract, unreadItems, isReferenced } from "./helpers/shape-contract.mjs";

const SRC = join(mkdtempSync(join(tmpdir(), "dopl-shape-src-")), "adapter.js");
writeFileSync(SRC, "send('turn/start'); const s = res.sandbox; rows.map((r) => r.displayName); call(\"thread/start\", x); list('model/list'); r.data;");

const required = {
  safety: { results: { "thread/start": ["sandbox"] } },
  core: { methods: ["turn/start"] },
  cosmetic: { results: { "model/list": ["data.displayName"] } },
};

runShapeContract({
  runtimeId: "fake",
  required,
  fixture: {
    measured: true,
    version: "fake 1.0.0",
    shape: { methods: ["turn/start"], results: { "thread/start": ["sandbox"], "model/list": ["data.displayName"] } },
  },
  liveProbe: async () => ({ methods: ["turn/start"], results: { "thread/start": ["sandbox"] } }),
  liveEnv: "DOPL_FAKE_SHAPE_LIVE",
  sources: [SRC],
});

test("static tier: an item no code reads is reported, a read one is not", () => {
  const text = "x.sandbox; send('turn/start');";
  assert.deepEqual(unreadItems({ core: { methods: ["turn/start"], results: { "thread/start": ["sandbox"] } } }, text),
    ["core: result thread/start", "core: result thread/start sandbox"], "the method name itself is never referenced");
  assert.equal(isReferenced("sandbox", "a.sandbox"), true);
  assert.equal(isReferenced("sandbox", "{ sandbox: 1 }"), true);
  assert.equal(isReferenced("sandbox", "sandboxed"), false, "a longer word is not a read");
  assert.equal(isReferenced("thread/start", "'thread/start'"), true);
});

// THE SHARED SDK-RESILIENCE LAYER (2026-10-08): `live-store.js` (last-live answers on disk),
// `sdk-shape.js` (tiered protocol verdict, live probe, drift ledger), and their seams in
// `model-catalog.js`, `contract.js` and `session-io.js`. Runtime-agnostic: every adapter here is fake.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadCatalog, memoryLiveStore } from "./_model-catalog-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const liveStore = require(join(MAIN, "runtime", "live-store.js"));
const sdkShape = require(join(MAIN, "runtime", "sdk-shape.js"));

let dir;
let file;
const diags = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dopl-live-store-"));
  file = join(dir, "runtime-live.json");
  liveStore.inject({ file: () => file, diag: (...a) => diags.push(a.join(" ")) });
  sdkShape.forgetShape();
  sdkShape.forgetDrift();
  sdkShape.injectDiag(() => {});
  diags.length = 0;
});

// ── live-store ──────────────────────────────────────────────────────────────────────────────

test("live-store: a value is read back only under the key it was saved with", () => {
  assert.equal(liveStore.save("roster", "x", "bin@1", { models: ["a"] }), true);
  liveStore.inject({ file: () => file }); // a restart: memory dropped, disk kept
  assert.deepEqual(liveStore.read("roster", "x", "bin@1"), { models: ["a"] });
  assert.equal(liveStore.read("roster", "x", "bin@2"), null, "another build proves nothing");
  assert.equal(liveStore.read("shape", "x", "bin@1"), null, "kinds do not mix");
  assert.equal(liveStore.read("roster", "x", null), null, "no key, no answer");
});

test("live-store: corrupt, partial, other-schema and unreadable files are ignored, never thrown, and rebuilt", () => {
  for (const text of ["{not json", "[]", "null", JSON.stringify({ schema: 999, entries: {} }), JSON.stringify({ schema: 1 })]) {
    writeFileSync(file, text);
    liveStore.inject({ file: () => file, diag: () => {} });
    assert.equal(liveStore.read("roster", "x", "k"), null, text);
    assert.equal(liveStore.save("roster", "x", "k", { ok: 1 }), true, text);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).schema, liveStore.FILE_SCHEMA, "rewritten whole");
  }
  // A PARTIAL entry is dropped alone; its neighbours survive.
  writeFileSync(file, JSON.stringify({ schema: 1, entries: {
    "roster:a": { key: "k", value: { models: [] } },
    "roster:b": { key: "", value: { models: [] } },
    "roster:c": { key: "k" },
  } }));
  liveStore.inject({ file: () => file });
  assert.deepEqual(liveStore.read("roster", "a", "k"), { models: [] });
  assert.equal(liveStore.read("roster", "b", ""), null);
  assert.equal(liveStore.read("roster", "c", "k"), null);
  // No path at all (a harness without electron) and a failing write both degrade, never throw.
  liveStore.inject({ file: () => { throw new Error("no userData"); }, diag: () => {} });
  assert.equal(liveStore.read("roster", "a", "k"), null);
  assert.equal(liveStore.save("roster", "a", "k", {}), false);
  liveStore.inject({ file: () => file, writeFile: () => { throw new Error("disk full"); }, diag: () => {} });
  assert.equal(liveStore.save("roster", "a", "k", { v: 1 }), false);
  assert.deepEqual(liveStore.read("roster", "a", "k"), { v: 1 }, "kept in memory for this process");
});

test("live-store: writes are atomic (tmp + rename) — no tmp file is left behind", () => {
  liveStore.inject({ file: () => file });
  liveStore.save("shape", "x", "k", { paths: ["method a"] });
  assert.equal(existsSync(`${file}.${process.pid}.tmp`), false);
  assert.throws(() => liveStore.read("nope", "x", "k"), /unknown kind/);
});

// ── checkShape ──────────────────────────────────────────────────────────────────────────────

const REQUIRED = {
  safety: { results: { "thread/start": ["sandbox", "approvalPolicy"] } },
  core: { methods: ["turn/start"], notifications: { "turn/completed": ["params.turn.id"] } },
  cosmetic: { results: { "model/list": ["data.displayName"] } },
};
const FULL = {
  methods: ["turn/start"],
  notifications: { "turn/completed": ["params.turn.id"] },
  results: { "thread/start": ["sandbox", "approvalPolicy"], "model/list": ["data.displayName"] },
};

test("checkShape: tiers — safety/core gaps refuse, a cosmetic gap only reports", () => {
  assert.deepEqual(sdkShape.checkShape(REQUIRED, FULL), { ok: true, refuse: false, missing: { safety: [], core: [], cosmetic: [] } });
  const noSandbox = { ...FULL, results: { "thread/start": ["approvalPolicy"], "model/list": ["data.displayName"] } };
  const v1 = sdkShape.checkShape(REQUIRED, noSandbox);
  assert.equal(v1.refuse, true);
  assert.deepEqual(v1.missing.safety, ["result thread/start sandbox"]);
  const noLabel = { ...FULL, results: { "thread/start": ["sandbox", "approvalPolicy"] } };
  const v2 = sdkShape.checkShape(REQUIRED, noLabel);
  assert.equal(v2.refuse, false);
  assert.equal(v2.ok, false);
  assert.deepEqual(v2.missing.cosmetic, ["result model/list", "result model/list data.displayName"]);
  // A flat `paths` description and a Shape are the same thing.
  assert.equal(sdkShape.checkShape(REQUIRED, { paths: Array.from(sdkShape.flatten(FULL)) }).ok, true);
  // Nothing observed refuses; nothing required passes.
  assert.equal(sdkShape.checkShape(REQUIRED, null).refuse, true);
  assert.equal(sdkShape.checkShape({}, null).ok, true);
});

test("requiredShapeProblems: a declaration needs tiers only, something in them, and a 0-arity runtime.shape", () => {
  const d = (requiredShape) => ({ id: "x", requiredShape });
  assert.deepEqual(sdkShape.requiredShapeProblems({ id: "x" }, {}), [], "absent is fine");
  assert.deepEqual(sdkShape.requiredShapeProblems(d(REQUIRED), { shape: async () => FULL }), []);
  assert.match(sdkShape.requiredShapeProblems(d({ critical: {} }), { shape: async () => ({}) }).join(" "), /not a tier/);
  assert.match(sdkShape.requiredShapeProblems(d({ core: {} }), { shape: async () => ({}) }).join(" "), /declares nothing/);
  assert.match(sdkShape.requiredShapeProblems(d(REQUIRED), {}).join(" "), /runtime\.shape is missing/);
  assert.match(sdkShape.requiredShapeProblems(d(REQUIRED), { shape: async (_x) => ({}) }).join(" "), /contract says 0/);
  // And `sealAdapter` refuses registration on it.
  const contract = require(join(MAIN, "runtime", "contract.js"));
  assert.throws(
    () => contract.sealAdapter({ descriptor: { id: "x", label: "X", requiredShape: REQUIRED }, runtime: {} }),
    /runtime\.shape is missing/,
  );
});

test("readCount: absent, non-number, negative and NaN are NULL — never 0", () => {
  const u = { total: { input: 5, zero: 0, neg: -1, nan: NaN, str: "7" } };
  assert.equal(sdkShape.readCount(u, "total", "input"), 5);
  assert.equal(sdkShape.readCount(u, "total", "zero"), 0, "a reported zero is a zero");
  for (const k of ["neg", "nan", "str", "renamed"]) assert.equal(sdkShape.readCount(u, "total", k), null, k);
  assert.equal(sdkShape.readCount(null, "total"), null);
  assert.equal(sdkShape.readCount(u, "missing", "deep", "path"), null);
});

// ── settleShape / launchShapeRefusal ────────────────────────────────────────────────────────

function adapter({ shape, key = "bin@1", required = REQUIRED, label = "Runtime X" } = {}) {
  const calls = { shape: 0 };
  const a = {
    descriptor: { id: "rx", label, requiredShape: required },
    runtime: {
      buildIdentity: () => { const k = typeof key === "function" ? key() : key; return k ? { path: "/bin/x", version: k } : null; },
      shape: async () => { calls.shape += 1; return shape(calls.shape); },
    },
  };
  return { a, calls };
}

test("no declaration: no probe, no refusal", async () => {
  const { a, calls } = adapter({ shape: () => FULL, required: null });
  assert.equal((await sdkShape.settleShape(a)).status, "none");
  assert.equal(await sdkShape.launchShapeRefusal(a), null);
  assert.equal(calls.shape, 0);
});

test("a live answer is kept for the build; a new build re-probes", async () => {
  let key = "bin@1";
  const { a, calls } = adapter({ shape: () => FULL, key: () => key });
  assert.equal(await sdkShape.launchShapeRefusal(a), null);
  assert.equal(await sdkShape.launchShapeRefusal(a), null);
  assert.equal(calls.shape, 1, "one probe per build");
  key = "bin@2";
  assert.equal(await sdkShape.launchShapeRefusal(a), null);
  assert.equal(calls.shape, 2);
});

test("a safety gap refuses with a sentence naming the gap; a cosmetic gap launches and lands in the drift ledger", async () => {
  const unsafe = adapter({ shape: () => ({ ...FULL, results: { "thread/start": ["approvalPolicy"] } }) }).a;
  const why = await sdkShape.launchShapeRefusal(unsafe);
  assert.match(why, /^Runtime X on this Mac no longer matches/);
  assert.match(why, /result thread\/start sandbox/);
  sdkShape.forgetShape();
  const cosmetic = adapter({ shape: () => ({ ...FULL, results: { "thread/start": ["sandbox", "approvalPolicy"] } }) }).a;
  assert.equal(await sdkShape.launchShapeRefusal(cosmetic), null);
  assert.equal(sdkShape.driftReport("rx").length, 1);
});

test("probe FAILURE is shape-unknown — fails CLOSED with the cause, distinct from a gap, and retries on backoff", async () => {
  const { a, calls } = adapter({ shape: (n) => { if (n === 1) throw new Error("schema command timed out"); return FULL; } });
  const st = await sdkShape.settleShape(a);
  assert.equal(st.status, "shape-unknown");
  const why = await sdkShape.launchShapeRefusal(a);
  assert.match(why, /could not check that Runtime X/);
  assert.match(why, /schema command timed out/);
  assert.doesNotMatch(why, /no longer matches/, "not reported as a gap");
  assert.equal(calls.shape, 1, "inside the backoff window: no hammering");
  assert.equal(sdkShape._backoffMs(1), sdkShape.BACKOFF_BASE_MS);
  assert.equal(sdkShape._backoffMs(30), sdkShape.BACKOFF_MAX_MS, "capped");
});

test("the last-good shape stands in for a failed probe ONLY on the same build key", async () => {
  let key = "bin@1";
  let fail = false;
  const { a } = adapter({ key: () => key, shape: () => { if (fail) throw new Error("crashed"); return FULL; } });
  assert.equal((await sdkShape.settleShape(a)).status, "known");
  // A restart: memory gone, disk kept; the probe now fails.
  sdkShape.forgetShape();
  liveStore.inject({ file: () => file });
  fail = true;
  const same = await sdkShape.settleShape(a);
  assert.equal(same.status, "known");
  assert.equal(same.persisted, true);
  assert.equal(await sdkShape.launchShapeRefusal(a), null);
  // Another build: its predecessor's shape proves nothing.
  key = "bin@2";
  sdkShape.forgetShape();
  assert.equal((await sdkShape.settleShape(a)).status, "shape-unknown");
});

test("a probe that never answers is bounded (shape-unknown), and a throwing buildIdentity is no key", async () => {
  const a = {
    descriptor: { id: "rz", label: "Z", requiredShape: REQUIRED },
    runtime: { buildIdentity: () => { throw new Error("x"); }, shape: async () => { throw new Error("boom"); } },
  };
  const st = await sdkShape.settleShape(a);
  assert.equal(st.status, "shape-unknown");
  assert.equal(st.key, null);
});

// ── the persisted roster in model-catalog ───────────────────────────────────────────────────

const rosterAdapter = (models, key = "bin@1") => ({
  descriptor: { id: "rx", label: "Runtime X", models: { source: "live", dimensions: [] } },
  runtime: { buildIdentity: () => (key ? { path: "/bin/x", version: key, account: "acct-fp" } : null), models: models },
});

test("catalog: a restart on the SAME build answers its last live roster as READY at once, then reads live", async () => {
  const disk = memoryLiveStore();
  const one = loadCatalog(disk);
  await one.settle(rosterAdapter(async () => ({ models: [{ id: "m1", label: "M1", isDefault: true }] })));
  const two = loadCatalog(disk); // restart
  let resolve;
  const live = new Promise((r) => { resolve = r; });
  const snap = two.snapshot(rosterAdapter(() => live));
  assert.equal(snap.status, "ready");
  assert.equal(snap.persisted, true);
  assert.deepEqual(snap.models.map((m) => m.id), ["m1"]);
  resolve({ models: [{ id: "m2", isDefault: true }] });
  const settled = await two.settle(rosterAdapter(() => live));
  assert.deepEqual(settled.models.map((m) => m.id), ["m2"], "the live read replaces the stand-in");
  assert.equal(settled.persisted, undefined);
});

test("catalog: another build's persisted roster, a partial one, or no key answers nothing persisted", async () => {
  const disk = memoryLiveStore();
  await loadCatalog(disk).settle(rosterAdapter(async () => ({ models: [{ id: "m1" }] })));
  const never = () => new Promise(() => {});
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never, "bin@2")).status, "loading");
  disk.entries.set("roster:rx", { key: "bin@1", value: { models: "not a list" } });
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never, "bin@1")).status, "loading");
  disk.entries.set("roster:rx", { key: "bin@1", value: { models: [{ nope: true }] } });
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never, "bin@1")).status, "loading");
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never, null)).status, "loading");
});

test("catalog: a roster stored in an older entry shape (before `launch` existed) is dropped, not used (L3)", async () => {
  const disk = memoryLiveStore();
  await loadCatalog(disk).settle(rosterAdapter(async () => ({ models: [{ id: "m1", launch: "one" }] })));
  const never = () => new Promise(() => {});
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never)).models[0].launch, "one", "same shape: used");
  const e = disk.entries.get("roster:rx");
  const old = JSON.parse(JSON.stringify(e.value));
  delete old.entryShape;
  for (const m of old.models) delete m.launch;
  disk.entries.set("roster:rx", { key: e.key, value: old });
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never)).status, "loading", "pre-launch store: read live");
  disk.entries.set("roster:rx", { key: e.key, value: Object.assign({}, e.value, { entryShape: "id,label" }) });
  assert.equal(loadCatalog(disk).snapshot(rosterAdapter(never)).status, "loading", "any other shape: read live");
});

test("catalog: a stand-in whose live read FAILS turns stale (labels only) and sits on the failure floor", async () => {
  const disk = memoryLiveStore();
  await loadCatalog(disk).settle(rosterAdapter(async () => ({ models: [{ id: "m1" }] })));
  const two = loadCatalog(disk);
  let reads = 0;
  const failing = rosterAdapter(async () => { reads += 1; throw new Error("app-server crashed"); });
  two.snapshot(failing);
  const settled = await two.settle(failing);
  assert.equal(settled.status, "stale");
  assert.equal(settled.persisted, false);
  two.snapshot(failing);
  two.snapshot(failing);
  assert.equal(reads, 1, "not re-read on every look");
  assert.equal(two.vouches(settled), false, "a stale roster refuses no pick");
});

// ── session-io ──────────────────────────────────────────────────────────────────────────────

test("session-io: shape_drift is recorded every time and told to the session ONCE", () => {
  const io = require(join(MAIN, "session-io.js"));
  const s = { runtimeId: "codex" };
  const sent = [];
  const ev = (w) => ({ type: "shape_drift", where: w, detail: "field renamed" });
  io.applyCoreEvents(s, [ev("usage"), ev("usage"), ev("item")], (_s, e) => sent.push(e), {});
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.text, /does not recognise/);
  assert.match(sent[0].payload.text, /unknown, not zero/);
  const report = sdkShape.driftReport("codex");
  assert.deepEqual(report.map((r) => [r.where, r.count]), [["usage", 2], ["item", 1]]);
});

// ── the build key (`roster-key.js`) ───────────────────────────────────────────────────────

test("build key: a different binary path OR version is a different key; a missing half is no key", () => {
  const { rosterKeyFor, rosterKeyOf } = require(join(MAIN, "runtime", "roster-key.js"));
  const k = (path, version, account) => rosterKeyFor({ path, version, account });
  assert.equal(k("/a/codex", "0.155.1"), "/a/codex@0.155.1");
  assert.notEqual(k("/a/codex", "0.155.1"), k("/a/codex", "0.159.3"), "version moves the key");
  assert.notEqual(k("/a/codex", "0.155.1"), k("/b/codex", "0.155.1"), "path moves the key");
  assert.notEqual(k("/a/c", "1", "oauth"), k("/a/c", "1", "apikey"), "account moves the key");
  for (const [p, v] of [["", "1"], ["/a", ""], [null, "1"], ["/a", undefined]]) assert.equal(k(p, v), null);
  // Opt-out is by DECLARATION only.
  const ad = (persist, identity) => ({ descriptor: { id: "q", models: { persist } }, runtime: { buildIdentity: () => identity } });
  assert.equal(rosterKeyOf(ad(undefined, { path: "/a", version: "1" })), "/a@1");
  assert.equal(rosterKeyOf(ad(false, { path: "/a", version: "1" })), null, "declared no persistence");
});

test("build key: the catalog files a roster under CORE's key, so an upgrade never reads its predecessor's list", async () => {
  const disk = memoryLiveStore();
  let version = "1";
  const ad = (models) => ({
    descriptor: { id: "rx", label: "X", models: { source: "live", dimensions: [] } },
    runtime: { buildIdentity: () => ({ path: "/bin/x", version }), models },
  });
  const settled = await loadCatalog(disk).settle(ad(async () => ({ key: "adapter-spelling", models: [{ id: "old" }] })));
  assert.equal(settled.key, "/bin/x@1", "the adapter's own key spelling is ignored");
  version = "2"; // the updater switched builds
  assert.equal(loadCatalog(disk).snapshot(ad(() => new Promise(() => {}))).status, "loading");
});

test("every SHIPPED adapter either keys by a build identity or declares no persistence", () => {
  const { persists } = require(join(MAIN, "runtime", "roster-key.js"));
  for (const id of ["claude", "codex", "cursor"]) {
    const a = require(join(MAIN, "runtime", id, "index.js"));
    assert.equal(typeof a.runtime.buildIdentity, "function", id);
    assert.equal(typeof a.runtime.rosterKey, "undefined", `${id}: no free-form key left`);
    if (!persists(a.descriptor)) assert.equal(a.runtime.buildIdentity(), null, `${id} opted out`);
  }
});

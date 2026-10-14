// Which `muse` Dopl runs, and how Dopl gets one: the resolver (override > Dopl's download > PATH > well-known,
// never a bundle; Meta's bash launcher mapped to the versioned binary it would exec) and the ON-DEMAND
// update source over Meta's release channel (fixtures: the channel + manifest measured 2026-10-13).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { FIX, m } from "./_muse-harness.mjs";

const require = createRequire(import.meta.url);
const resolveBin = m("resolve-bin.js");
const source = m("update-source.js");
const updates = require("../main/runtime/updates/index.js");
const fs = require("node:fs");
const io = { realpathSync: fs.realpathSync, statSync: fs.statSync, accessSync: fs.accessSync };
const uid = process.getuid();

function bin(dir, name, body = "\x7fELF") {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}
const resolveIn = (o) => resolveBin.resolveWith(Object.assign({ env: {}, home: "/nonexistent", io, uid, execPath: "", platform: "darwin", arch: "arm64", resolvePackage: null, downloaded: null }, o));

test("Meta's bash launcher on PATH is mapped to the versioned binary it would exec (`.muse-version`)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-muse-bin-"));
  bin(dir, "muse", "#!/bin/bash\nexec \"$HOME/.local/bin/muse-bin-$(cat .muse-version)\"\n");
  writeFileSync(join(dir, ".muse-version"), "1.4.7-R6101.1\n");
  const real = bin(dir, "muse-bin-1.4.7-R6101.1");
  const r = resolveIn({ env: { PATH: dir } });
  assert.equal(r.ok, true);
  assert.equal(r.path, fs.realpathSync(real));
  assert.equal(r.source, "path");
});

test("a launcher with no readable version stays the answer; a junk version is never spliced into a path", () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-muse-bin-"));
  const launcher = bin(dir, "muse", "#!/bin/bash\n");
  writeFileSync(join(dir, ".muse-version"), "../../etc/evil");
  assert.equal(resolveBin.launcherVendor(fs.realpathSync(launcher)), null);
});

test("override > download > PATH; no bundle is ever a candidate; a missing override is an ERROR, not a fallback", () => {
  const a = mkdtempSync(join(tmpdir(), "dopl-muse-a-"));
  const b = mkdtempSync(join(tmpdir(), "dopl-muse-b-"));
  const onPath = bin(a, "muse");
  const dl = bin(b, "muse");
  assert.equal(resolveIn({ env: { PATH: a }, downloaded: dl }).source, "downloaded");
  assert.equal(resolveIn({ env: { PATH: a, DOPL_MUSE_BIN: onPath }, downloaded: dl }).source, "override");
  const bad = resolveIn({ env: { PATH: a, DOPL_MUSE_BIN: "/nope/muse" } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /DOPL_MUSE_BIN/);
  assert.equal(resolveIn({ env: {} }).ok, false);
});

const channel = JSON.parse(readFileSync(join(FIX, "channel-muse-stable.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(FIX, "release-manifest-1.4.7-R6101.1.json"), "utf8"));

test("the measured channel + manifest resolve to Meta's arm64 build with its sha256 and size", () => {
  const rel = source.releaseFrom(channel, manifest, "darwin-arm64");
  assert.equal(rel.version, "1.4.7-R6101.1");
  assert.equal(rel.size, 358892272);
  assert.match(rel.sha256, /^87ff5a31b63e30b6/);
  assert.ok(source.isReleaseUrl(rel.url));
  assert.equal(source.releaseFrom(channel, manifest, "darwin-x64").size, 380381680);
});

test("a manifest pointing off Meta's hosts, disagreeing on version, or lacking a digest is refused", () => {
  const evil = JSON.parse(JSON.stringify(manifest));
  evil.artifacts.aarch64_macos.url = "https://evil.example/muse";
  assert.throws(() => source.releaseFrom(channel, evil, "darwin-arm64"), /usable build/);
  assert.throws(() => source.releaseFrom({ ...channel, version: "9.9.9" }, manifest, "darwin-arm64"), /disagree/);
  const noSum = JSON.parse(JSON.stringify(manifest));
  delete noSum.artifacts.aarch64_macos.checksum;
  assert.throws(() => source.releaseFrom(channel, noSum, "darwin-arm64"), /usable build/);
  assert.equal(source.isReleaseUrl("http://api.meta.ai/x"), false);
  assert.equal(source.isReleaseUrl("https://api.meta.ai:8443/x"), false);
});

const body = (buf) => ({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf)); c.close(); } }) });

test("fetchInto: the build lands executable under <staging>/package only when size AND sha256 match", async () => {
  const bytes = Buffer.from("pretend muse binary");
  const meta = { url: "https://lookaside.facebook.com/x", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  const staging = mkdtempSync(join(tmpdir(), "dopl-muse-stage-"));
  const root = await source.fetchInto(meta, staging, async () => body(bytes));
  const file = join(root, "muse");
  assert.equal(readFileSync(file, "utf8"), "pretend muse binary");
  assert.equal(fs.statSync(file).mode & 0o111, 0o111);
  for (const wrong of [{ ...meta, size: meta.size + 1 }, { ...meta, sha256: "0".repeat(64) }]) {
    const st = mkdtempSync(join(tmpdir(), "dopl-muse-stage-"));
    await assert.rejects(source.fetchInto(wrong, st, async () => body(bytes)), /does not match|larger/);
    assert.equal(existsSync(join(st, "package", "muse")), false, "a mismatch leaves nothing behind");
  }
});

test("ON DEMAND: the background check never downloads Muse; the operator's install request does", async () => {
  const base = mkdtempSync(join(tmpdir(), "dopl-muse-upd-"));
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url === source.CHANNEL_URL) return { ok: true, status: 200, json: async () => channel };
    if (url === channel.manifest_url) return { ok: true, status: 200, json: async () => manifest };
    throw new Error("the artifact is not fetched in this test");
  };
  updates.inject({ baseDir: () => base, fetchImpl, requiredShape: () => ({ core: { methods: ["initialize"] } }), log: () => {}, invalidate: () => {} });
  const src = { ...source, pkg: "muse-stable" };
  try {
    assert.equal(await updates.check(src), "not-installed");
    assert.deepEqual(fetched, [], "nothing fetched unasked");
    assert.equal(await updates.check(src, { install: true }), "failed", "asked: it goes to the channel (the download is refused here)");
    assert.ok(fetched.includes(source.CHANNEL_URL) && fetched.includes(channel.manifest_url));
  } finally {
    updates.inject();
  }
  mkdirSync(base, { recursive: true });
});

test("the source pins Meta's Developer ID team, bundles nothing, and describes builds through `muse schema`", () => {
  assert.equal(source.teamId, "V9WTTPBFK9");
  assert.equal(source.bundledVersion(), null);
  assert.equal(source.onDemand, true);
  assert.equal(typeof source.probeShape, "function");
  assert.equal(m("packaging.js").packaging.delivery, "path");
});

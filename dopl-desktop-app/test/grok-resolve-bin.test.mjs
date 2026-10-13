// Which `grok` Dopl runs and how Dopl gets one: the resolver (override > Dopl's download > PATH > well-known,
// never a bundle), the ON-DEMAND update source over xAI's stable channel (no published checksum → the sha256 is
// RECORDED, the response's own md5 checked as transport only, xAI's team pinned), and the shape a build gives
// of itself in `initialize` against what Dopl requires.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { g, INIT, INIT_SIGNED_OUT, fakeConn } from "./_grok-harness.mjs";

const require = createRequire(import.meta.url);
const resolveBin = g("resolve-bin.js");
const source = g("update-source.js");
const shape = g("shape.js");
const required = g("required-shape.js");
const sdkShape = require("../main/runtime/sdk-shape.js");
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

test("override > download > PATH; no bundle is ever a candidate; a missing override is an ERROR, not a fallback", () => {
  const a = mkdtempSync(join(tmpdir(), "dopl-grok-a-"));
  const b = mkdtempSync(join(tmpdir(), "dopl-grok-b-"));
  const onPath = bin(a, "grok");
  const dl = bin(b, "grok");
  assert.equal(resolveIn({ env: { PATH: a } }).source, "path");
  assert.equal(resolveIn({ env: { PATH: a }, downloaded: dl }).source, "downloaded");
  assert.equal(resolveIn({ env: { PATH: a, DOPL_GROK_BIN: onPath }, downloaded: dl }).source, "override");
  const bad = resolveIn({ env: { PATH: a, DOPL_GROK_BIN: "/nope/grok" } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /DOPL_GROK_BIN/);
  assert.equal(resolveIn({ env: {} }).ok, false);
});

test("the channel: `x.ai/cli/stable` text → the per-arch build on x.ai only", () => {
  assert.deepEqual(source.releaseFrom("1.0.52\n", "darwin-arm64"), { version: "1.0.52", url: "https://x.ai/cli/grok-1.0.52-macos-aarch64" });
  assert.equal(source.releaseFrom("1.0.52", "darwin-x64").url, "https://x.ai/cli/grok-1.0.52-macos-x86_64");
  assert.throws(() => source.releaseFrom("<html>", "darwin-arm64"), /did not name a version/);
  assert.throws(() => source.releaseFrom("1.0.52", "linux-x64"), /no Grok build/);
  for (const u of ["http://x.ai/cli/grok", "https://evil.example/grok", "https://x.ai:444/grok", "https://u:p@x.ai/grok"]) assert.equal(source.isReleaseUrl(u), false, u);
  assert.equal(source.isReleaseUrl("https://x.ai/cli/grok-1.0.52-macos-aarch64"), true);
  assert.equal(source.teamId, "5Y6N3AJ54S", "X.AI Corporation's Developer ID team");
  assert.equal(source.onDemand, true, "never fetched unasked");
  assert.equal(source.bundledVersion(), null);
  assert.equal(source.id, "grok");
});

test("latest() reads the pointer; a non-200 is a failure", async () => {
  const ok = await source.latest(async (url) => { assert.equal(url, source.CHANNEL_URL); return new Response("1.0.52\n"); });
  assert.equal(ok.version, "1.0.52");
  await assert.rejects(source.latest(async () => new Response("no", { status: 503 })), /answered 503/);
});

test("fetchInto: the build lands executable, its sha256 + size RECORDED beside it; a wrong transport md5 deletes it", async () => {
  const body = Buffer.from("\xcf\xfa\xed\xfe pretend grok build");
  const md5 = createHash("md5").update(body).digest("base64");
  const staging = mkdtempSync(join(tmpdir(), "dopl-grok-stage-"));
  const meta = { version: "1.0.52", url: "https://x.ai/cli/grok-1.0.52-macos-aarch64" };
  const root = await source.fetchInto(meta, staging, async () => new Response(body, { headers: { "x-goog-hash": `crc32c=EH5otA==,md5=${md5}` } }));
  const exe = source.binary(root);
  assert.equal(statMode(exe), 0o755);
  const rec = JSON.parse(readFileSync(join(root, source.RECORD_FILE), "utf8"));
  assert.equal(rec.sha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(rec.size, body.length);
  assert.equal(rec.transportMd5, "matched");
  const staging2 = mkdtempSync(join(tmpdir(), "dopl-grok-stage-"));
  await assert.rejects(source.fetchInto(meta, staging2, async () => new Response(body, { headers: { "x-goog-hash": "md5=AAAAAAAAAAAAAAAAAAAAAA==" } })), /md5/);
  assert.equal(existsSync(join(staging2, "package", "grok")), false);
  await assert.rejects(source.fetchInto({ version: "1", url: "https://evil.example/grok" }, staging2, async () => new Response(body)), /release host/);
});

function statMode(p) { return fs.statSync(p).mode & 0o777; }

test("the measured `initialize` answer satisfies every tier of Dopl's required shape", () => {
  const observed = shape.shapeFromInit(INIT);
  const verdict = sdkShape.checkShape(required, observed);
  assert.deepEqual(verdict.missing, { safety: [], core: [], cosmetic: [] });
  assert.equal(verdict.refuse, false);
  assert.ok(observed.methods.includes("session/load"));
  assert.deepEqual(observed.values["hooks decisions"], ["deny", "block"]);
  assert.ok(sdkShape.checkShape(required, shape.shapeFromInit(INIT_SIGNED_OUT)).refuse === false, "signed out is not a protocol gap");
});

test("a build that drops the client hook, its deny decision or load-session is REFUSED", () => {
  const noHooks = JSON.parse(JSON.stringify(INIT));
  delete noHooks.agentCapabilities._meta["x.ai/hooks"];
  assert.equal(sdkShape.checkShape(required, shape.shapeFromInit(noHooks)).refuse, true);
  const noDeny = JSON.parse(JSON.stringify(INIT));
  noDeny.agentCapabilities._meta["x.ai/hooks"].decisions = ["block"];
  assert.equal(sdkShape.checkShape(required, shape.shapeFromInit(noDeny)).refuse, true);
  const noLoad = JSON.parse(JSON.stringify(INIT));
  noLoad.agentCapabilities.loadSession = false;
  assert.equal(sdkShape.checkShape(required, shape.shapeFromInit(noLoad)).refuse, true);
  const v2 = Object.assign({}, INIT, { protocolVersion: 2 });
  assert.equal(sdkShape.checkShape(required, shape.shapeFromInit(v2)).refuse, true);
});

test("describeBuild spawns in a THROWAWAY home with Dopl's config, never Dopl's session home", async () => {
  const f = fakeConn({ initialize: INIT });
  const out = await shape.describeBuild("/fake/grok", { connect: f.connect });
  const env = f.hooks().env;
  assert.match(env.HOME, /dopl-grok-shape-/);
  assert.equal(existsSync(env.HOME), false, "removed afterwards");
  assert.ok(out.shape.methods.includes("initialize"));
  assert.ok(f.calls.some((c) => c.method === "close"));
});

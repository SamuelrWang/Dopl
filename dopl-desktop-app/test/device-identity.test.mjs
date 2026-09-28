// DEVICE IDENTITY — this install as a "computer" under Settings > Connect > Devices.
// The pure pieces (name cleanup, clamp, platform), the async name/OS read, the persisted install
// id, the seam header, and mcp-config's token-link helper the heartbeat reports once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const id = require("../main/device-identity.js");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function memStore(seed = {}) {
  const data = { ...seed };
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v; } };
}

test("platform mapping covers the server's three values", () => {
  assert.equal(id.mapPlatform("darwin"), "macos");
  assert.equal(id.mapPlatform("win32"), "windows");
  assert.equal(id.mapPlatform("linux"), "linux");
  assert.equal(id.mapPlatform("freebsd"), "linux");
});

test("hostname cleanup strips the mDNS suffix and turns hyphens into spaces", () => {
  assert.equal(id.cleanHostname("Samuels-MacBook-Pro.local"), "Samuels MacBook Pro");
  assert.equal(id.cleanHostname("desk-box.lan"), "desk box");
  assert.equal(id.cleanHostname("  plain  "), "plain");
  assert.equal(id.cleanHostname(""), "");
});

test("names are clamped to 64 characters with control characters removed", () => {
  assert.equal(id.clampName("x".repeat(100)).length, id.NAME_MAX);
  assert.equal(id.clampName("a\nb\tc"), "a b c");
  // Code points, not UTF-16 units: an emoji at the edge is never split.
  const s = id.clampName("😀".repeat(70));
  assert.equal(Array.from(s).length, 64);
});

function fakeExec(answers, calls = []) {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const a = answers[cmd];
    if (a instanceof Error) throw a;
    if (typeof a === "function") return a();
    return { stdout: a ?? "" };
  };
}

test("friendlyName is sync: cleaned hostname until refresh() lands, then ComputerName verbatim", async () => {
  id._setStore(null);
  const calls = [];
  id._setExec(fakeExec({ "/usr/sbin/scutil": "Sam's Mac-Book Pro\n", "/usr/bin/sw_vers": "15.4.1\n" }, calls));
  assert.equal(id.friendlyName({ hostname: () => "Box-1.local" }), "Box 1");
  assert.equal(calls.length, 0, "no exec on the sync path");
  await id.refresh({ platform: "darwin" });
  assert.equal(id.friendlyName({ hostname: () => "ignored.local" }), "Sam's Mac-Book Pro");
  assert.equal(id.osVersion(), "15.4.1");
  assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]).sort(), [
    ["/usr/bin/sw_vers", "-productVersion"],
    ["/usr/sbin/scutil", "--get", "ComputerName"],
  ]);
  assert.ok(calls.every((c) => c.opts.timeout === 1500), "bounded exec");
  id._setExec(null);
});

test("refresh never rejects, keeps the last good value on failure, and is single-flight", async () => {
  id._setStore(null);
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  id._setExec(fakeExec({ "/usr/sbin/scutil": async () => { n++; await gate; return { stdout: "Mac A" }; } }));
  const p1 = id.refresh({ platform: "darwin" });
  const p2 = id.refresh({ platform: "darwin" });
  assert.equal(p1, p2, "single-flight");
  release();
  await p1;
  assert.equal(n, 1);
  assert.equal(id.friendlyName(), "Mac A");
  id._setExec(fakeExec({ "/usr/sbin/scutil": new Error("timeout"), "/usr/bin/sw_vers": new Error("x") }));
  await id.refresh({ platform: "darwin" });
  assert.equal(id.friendlyName(), "Mac A", "a failed read keeps the cached name");
  id._setExec(null);
});

test("non-macOS never shells out; fallbacks never throw", async () => {
  id._setStore(null);
  const calls = [];
  id._setExec(fakeExec({}, calls));
  await id.refresh({ platform: "linux" });
  assert.equal(calls.length, 0, "scutil/sw_vers are macOS only");
  assert.equal(id.friendlyName({ hostname: () => "srv.lan" }), "srv");
  assert.equal(id.friendlyName({ hostname: () => { throw new Error("no"); } }), "Computer");
  id._setExec(null);
});

test("descriptor is sync and only kicks a background refresh when stale (10 min)", async () => {
  id._setStore(null);
  const calls = [];
  id._setExec(fakeExec({ "/usr/sbin/scutil": "Mac", "/usr/bin/sw_vers": "15.0" }, calls));
  const t0 = Date.now();
  await id.refresh({ platform: process.platform === "darwin" ? "darwin" : "linux", now: () => t0 });
  const before = calls.length;
  const d = id.descriptor("active", { now: t0 + 9 * 60 * 1000 });
  assert.equal(typeof d.then, "undefined", "not a promise");
  assert.equal(calls.length, before, "fresh cache: no refresh");
  id.descriptor("active", { now: t0 + 10 * 60 * 1000 });
  await new Promise((r) => setImmediate(r));
  if (process.platform === "darwin") assert.ok(calls.length > before, "stale: refresh kicked");
  id._setExec(null);
});

test("installId is generated once, persisted under deviceInstallId, and stable", () => {
  const store = memStore();
  id._setStore(store);
  const a = id.installId();
  assert.match(a, UUID);
  assert.equal(store.data[id.STORE_KEY], a);
  assert.equal(id.STORE_KEY, "deviceInstallId");
  assert.equal(id.installId(), a);
  // A fresh process reads the same value back.
  id._setStore(store);
  assert.equal(id.installId(), a);
});

test("a malformed stored id is replaced, never sent", () => {
  const store = memStore({ deviceInstallId: "not a uuid\nX-Evil: 1" });
  id._setStore(store);
  const v = id.installId();
  assert.match(v, UUID);
  assert.equal(store.data.deviceInstallId, v);
});

test("rotateInstallId replaces the id, and the next read sees the new one", () => {
  const store = memStore();
  id._setStore(store);
  const a = id.installId();
  const b = id.rotateInstallId();
  assert.match(b, UUID);
  assert.notEqual(a, b);
  assert.equal(id.installId(), b);
  assert.equal(store.data.deviceInstallId, b);
});

test("with no store at all the id lives in memory and is still stable", () => {
  id._setStore(null);
  const a = id.installId();
  assert.match(a, UUID);
  assert.equal(id.installId(), a);
  const store = { get() { throw new Error("corrupt"); }, set() { throw new Error("corrupt"); } };
  id._setStore(store);
  assert.match(id.installId(), UUID);
});

test("deviceHeaders is { 'X-Dopl-Device': <uuid> }", () => {
  id._setStore(memStore());
  const h = id.deviceHeaders();
  assert.equal(id.HEADER, "X-Dopl-Device");
  assert.deepEqual(Object.keys(h), ["X-Dopl-Device"]);
  assert.match(h["X-Dopl-Device"], UUID);
});

test("descriptor matches the heartbeat contract and carries no token link", () => {
  id._setStore(memStore());
  const d = id.descriptor("active");
  assert.match(d.installId, UUID);
  assert.equal(d.status, "active");
  assert.ok(["macos", "windows", "linux"].includes(d.platform));
  assert.ok(d.name.length >= 1 && d.name.length <= 64);
  if (d.osVersion !== undefined) assert.ok(d.osVersion.length <= 32);
  if (d.appVersion !== undefined) assert.ok(d.appVersion.length <= 32);
  if (d.arch !== undefined) assert.ok(d.arch.length <= 16);
  assert.equal("tokenLabel" in d, false, "the registry adds the link, once");
  assert.equal("tokenId" in d, false);
  assert.equal(/mcp-config/.test(M("device-identity.js")), false, "no token store read per beat");
});

test("requiring the module does not shell out (api.js loads it on every boot)", () => {
  const src = M("device-identity.js");
  assert.equal(/execFileSync|execSync|spawnSync/.test(src), false, "no sync exec anywhere");
  assert.ok(fnOf(src, "run").includes("promisify(execFile)"), "the one exec site is async, inside run()");
  // Every run() call sits in a function body, never at module scope.
  for (const line of src.split("\n")) {
    if (/\brun\(/.test(line) && !/^async function run/.test(line)) assert.match(line, /^\s/, line);
  }
  assert.match(src, /try \{\s*const Store = require\('electron-store'\);/, "electron-store is lazy and guarded");
});

// ── mcp-config › deviceTokenLink ────────────────────────────────────────────

function fnOf(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function linkFn(rec) {
  return new Function(
    "loadDeviceToken", "deviceLabel", "isUuid",
    `${fnOf(M("mcp-config.js"), "deviceTokenLink")}\n return deviceTokenLink;`
  )(() => rec, () => "Dopl Desktop CLI (recomputed)", require("../main/ipc-guards.js").isUuid);
}

const TID = "3f2c1a9e-8b7d-4c6e-9f1a-2b3c4d5e6f70";

test("deviceTokenLink: tokenId when persisted, else the minted/recomputed label, null without a token", () => {
  assert.deepEqual(linkFn({ token: "t", label: "L", tokenId: TID })(), { tokenId: TID });
  assert.deepEqual(linkFn({ token: "t", label: "Dopl Desktop CLI (mac.local)" })(), { tokenLabel: "Dopl Desktop CLI (mac.local)" });
  assert.deepEqual(linkFn({ token: "t", tokenId: "not-a-uuid" })(), { tokenLabel: "Dopl Desktop CLI (recomputed)" });
  assert.equal(linkFn({ label: "orphan" })(), null);
  assert.equal(linkFn(null)(), null);
  const MCP = M("mcp-config.js");
  assert.match(MCP, /\n {2}deviceTokenLink,/, "exported");
  assert.match(MCP, /\n {2}onDeviceTokenMinted,/, "exported");
  assert.equal(/currentDeviceTokenLabel/.test(MCP), false, "per-beat label read is gone");
});

test("obtainDeviceToken persists tokenId (when the server sends one) and notifies in memory", () => {
  const body = fnOf(M("mcp-config.js"), "obtainDeviceToken");
  assert.match(body, /if \(isUuid\(data\.tokenId\)\) rec\.tokenId = data\.tokenId;/);
  assert.ok(body.indexOf("saveDeviceToken(rec)") < body.indexOf("notifyMinted("), "persist, then notify");
  assert.match(body, /notifyMinted\(rec\.tokenId \? \{ tokenId: rec\.tokenId \} : \{ tokenLabel: label \}\)/);
});

// DEVICE IDENTITY — this install as a "computer" under Settings > Connect > Devices.
// The pure pieces (name cleanup, clamp, platform), the persisted install id, the seam header, and
// mcp-config's token-label helper the heartbeat reports.

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

test("friendlyName prefers macOS ComputerName verbatim (hyphens kept)", () => {
  id._setStore(null);
  const calls = [];
  const name = id.friendlyName({
    now: 1, platform: "darwin",
    exec: (cmd, args) => { calls.push([cmd, ...args]); return "Sam's Mac-Book Pro"; },
    hostname: () => "ignored.local",
  });
  assert.equal(name, "Sam's Mac-Book Pro");
  assert.deepEqual(calls, [["/usr/sbin/scutil", "--get", "ComputerName"]]);
});

test("friendlyName falls back to the cleaned hostname, and never throws", () => {
  id._setStore(null);
  assert.equal(
    id.friendlyName({ now: 1, platform: "darwin", exec: () => "", hostname: () => "Box-1.local" }),
    "Box 1"
  );
  id._setStore(null);
  let execd = false;
  assert.equal(
    id.friendlyName({ now: 1, platform: "linux", exec: () => { execd = true; return "x"; }, hostname: () => "srv.lan" }),
    "srv"
  );
  assert.equal(execd, false, "scutil is macOS only");
  id._setStore(null);
  assert.equal(
    id.friendlyName({ now: 1, platform: "linux", hostname: () => { throw new Error("no"); } }),
    "Computer"
  );
});

test("friendlyName is cached, then re-read after ten minutes", () => {
  id._setStore(null);
  let n = 0;
  const opts = (now) => ({ now, platform: "darwin", exec: () => `Mac ${++n}`, hostname: () => "h" });
  assert.equal(id.friendlyName(opts(0)), "Mac 1");
  assert.equal(id.friendlyName(opts(9 * 60 * 1000)), "Mac 1");
  assert.equal(id.friendlyName(opts(10 * 60 * 1000)), "Mac 2");
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

// mcp-config pulls in electron; the descriptor's lazy require gets a stub via the cache.
function primeMcpConfig(label) {
  const filename = require.resolve("../main/mcp-config.js");
  require.cache[filename] = {
    id: filename, filename, loaded: true, children: [], paths: [],
    exports: { currentDeviceTokenLabel: () => label },
  };
  return () => { delete require.cache[filename]; };
}

test("descriptor matches the heartbeat contract", () => {
  id._setStore(memStore());
  const restore = primeMcpConfig("");
  const d = id.descriptor("active");
  assert.match(d.installId, UUID);
  assert.equal(d.status, "active");
  assert.ok(["macos", "windows", "linux"].includes(d.platform));
  assert.ok(d.name.length >= 1 && d.name.length <= 64);
  if (d.osVersion !== undefined) assert.ok(d.osVersion.length <= 32);
  if (d.appVersion !== undefined) assert.ok(d.appVersion.length <= 32);
  if (d.arch !== undefined) assert.ok(d.arch.length <= 16);
  assert.equal("tokenLabel" in d, false, "an unknown label is omitted, not blank");
  restore();
});

test("descriptor carries the current device token's label, clamped to 120", () => {
  id._setStore(memStore());
  let restore = primeMcpConfig("Dopl Desktop CLI (mac.local)");
  assert.equal(id.descriptor("away").tokenLabel, "Dopl Desktop CLI (mac.local)");
  restore();
  restore = primeMcpConfig("L".repeat(200));
  assert.equal(id.descriptor("away").tokenLabel.length, 120);
  restore();
  const filename = require.resolve("../main/mcp-config.js");
  require.cache[filename] = { id: filename, filename, loaded: true, children: [], paths: [],
    exports: { currentDeviceTokenLabel: () => { throw new Error("store gone"); } } };
  assert.equal("tokenLabel" in id.descriptor("away"), false, "a throwing helper never breaks the beat");
  delete require.cache[filename];
});

test("requiring the module does not shell out (api.js loads it on every boot)", () => {
  const src = M("device-identity.js");
  const calls = [...src.matchAll(/execFileSync\(/g)].length;
  assert.equal(calls, 1, "one exec site");
  assert.ok(fnOf(src, "run").includes("execFileSync("), "and it is inside run()");
  // Every run() call sits in a function body, never at module scope.
  for (const line of src.split("\n")) {
    if (/\brun\(/.test(line) && !/^function run/.test(line)) assert.match(line, /^\s/, line);
  }
  assert.match(src, /try \{\s*const Store = require\('electron-store'\);/, "electron-store is lazy and guarded");
});

// ── mcp-config › currentDeviceTokenLabel ────────────────────────────────────

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

function labelFn(rec) {
  return new Function(
    "loadDeviceToken", "deviceLabel",
    `${fnOf(M("mcp-config.js"), "currentDeviceTokenLabel")}\n return currentDeviceTokenLabel;`
  )(() => rec, () => "Dopl Desktop CLI (recomputed)");
}

test("currentDeviceTokenLabel: the minted label, the recomputed one for legacy records, '' without a token", () => {
  assert.equal(labelFn({ token: "t", label: "Dopl Desktop CLI (mac.local)" })(), "Dopl Desktop CLI (mac.local)");
  assert.equal(labelFn({ token: "t" })(), "Dopl Desktop CLI (recomputed)");
  assert.equal(labelFn({ label: "orphan" })(), "");
  assert.equal(labelFn(null)(), "");
  assert.match(M("mcp-config.js"), /\n {2}currentDeviceTokenLabel,/, "exported");
  assert.match(M("device-identity.js"), /require\('\.\/mcp-config'\)\.currentDeviceTokenLabel\(\)/);
});

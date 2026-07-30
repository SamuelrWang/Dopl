// C1 (HIGH-2) + C2 (HIGH-3) — the device token leaves the SDK path's disk surface.
//
// THE BUG (C1). `buildMcpServers` read the 90-day dopl.read+dopl.write device token out of
// userData/mcp-spawn.json on every session spawn. `Read` is PRE-APPROVED on all three
// session profiles, and a pre-approved tool is SHADOWED by the SDK's allowedTools — it never
// reaches canUseTool at all — so an injected agent could open that file with ZERO operator
// clicks and then act as this device against the Dopl API, bypassing every desktop control.
// THE FIX: the bearer comes from mcp-config's safeStorage-held cache and is injected into
// the in-memory mcpServers object; the file survives only for the CLI path, and the reads
// that could still reach it are denied at the TOOL-BOUND layer (options.disallowedTools),
// which is the only layer a shadowed tool passes through.
//
// THE BUG (C2). The url was `dopl.url || MCP_URL` — read back off the same file — and
// writeSpawnConfig only compared the TOKEN, so a local process that rewrote `url` to its own
// endpoint kept that rewrite forever and collected the bearer plus every tool call.
// THE FIX: MCP_URL unconditionally, and a WHOLE-config byte comparison that repairs the file.
//
// Both modules are electron-bound (app.getPath / safeStorage / electron-store), so the
// functions under test are source-extracted and driven with fakes — the idiom the rest of
// this directory uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const LOADER = readFileSync(M("sdk-loader.js"), "utf8");
const CONFIG = readFileSync(M("mcp-config.js"), "utf8");
const ENGINE = readFileSync(M("session-engine.js"), "utf8");

const slice = (src, from, to, what) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to);
  assert.ok(a !== -1 && b > a, `${what} slice not found`);
  return src.slice(a, b);
};

// ── C1: buildMcpServers takes the bearer from the injected accessor, never a file ──

const MCP_BLOCK = slice(LOADER, "function buildMcpServers(", "// FIX M2 — a scrubbed copy", "buildMcpServers");
const MCP_URL = "https://dopl.test/api/mcp";

function buildServers(token, policy = null, workspaceId = "") {
  return new Function(
    "doplBearer", "MCP_URL", "policy", "workspaceId",
    `${MCP_BLOCK}\n return buildMcpServers(policy, workspaceId);`
  )(() => token, MCP_URL, policy, workspaceId);
}

test("C1: the bearer is the safeStorage-held token, injected in memory", () => {
  const servers = buildServers("device-token-abc");
  assert.equal(servers.dopl.headers.Authorization, "Bearer device-token-abc");
  assert.equal(servers.dopl.type, "http");
});

test("C1: buildMcpServers reads NO file at all — the whole loader is fs-free", () => {
  // The strongest available pin: sdk-loader no longer requires fs, so there is no
  // readFileSync for a spawn to reach, whatever the slice happens to contain today.
  assert.ok(!/require\('fs'\)/.test(LOADER), "sdk-loader must not require fs");
  assert.ok(!/mcp-spawn\.json/.test(MCP_BLOCK), "no spawn-config path in the builder");
  assert.ok(!/readFileSync/.test(LOADER), "no file read on the session path");
  assert.match(MCP_BLOCK, /const token = doplBearer\(\);/, "the token comes from the safeStorage accessor");
});

test("C1: no token (pre-sign-in) yields NO server entry, exactly as a missing file did", () => {
  for (const empty of ["", null, undefined]) assert.deepEqual(buildServers(empty), {});
});

test("C2: the url is ALWAYS the compiled-in MCP_URL — nothing off disk can steer it", () => {
  assert.equal(buildServers("t").dopl.url, MCP_URL);
  assert.ok(!/dopl\.url/.test(MCP_BLOCK), "the file's url is never consulted again");
});

// ── C1: the tool-BOUND credential deny (a pre-approved read never reaches the gate) ──

const DENY_BLOCK = slice(LOADER, "const SECRET_TOOLS =", "// The in-memory mcpServers object", "deny rules");

function denyRules(userData) {
  return new Function(
    "app",
    `${DENY_BLOCK}\n return buildSecretPathDenyRules();`
  )({ getPath: () => userData });
}

test("C1: Read/Grep/Glob are denied over userData and ~/.claude* on every profile", () => {
  const rules = denyRules("/Users/sam/Library/Application Support/Dopl");
  for (const tool of ["Read", "Grep", "Glob"]) {
    assert.ok(
      rules.includes(`${tool}(//Users/sam/Library/Application Support/Dopl/**)`),
      `${tool} must be fenced out of userData (mcp-spawn.json + the encrypted store live there)`
    );
    assert.ok(rules.includes(`${tool}(~/.claude*)`), `${tool} must be fenced out of ~/.claude*`);
    assert.ok(rules.includes(`${tool}(~/.claude/**)`), `${tool} must be fenced out of ~/.claude/`);
  }
  assert.equal(rules.length, 9, "three tools x three paths, nothing else");
});

test("C1: an unavailable userData path still leaves the home rules in force (fail useful)", () => {
  const rules = new Function("app", `${DENY_BLOCK}\n return buildSecretPathDenyRules();`)({
    getPath: () => { throw new Error("no app"); },
  });
  assert.deepEqual(rules.filter((r) => r.startsWith("Read")), ["Read(~/.claude*)", "Read(~/.claude/**)"]);
});

test("C1: buildSdkOptions really concatenates them onto the profile's hard-deny", () => {
  const opts = slice(ENGINE, "function buildSdkOptions(s) {", "async function startQuery(", "buildSdkOptions");
  assert.match(opts, /disallowedTools: cfg\.disallowedTools\.concat\(buildSecretPathDenyRules\(\)\),/);
  // ...and that every profile therefore gets them: buildSdkOptions is the ONE assembly path
  // (session-park resumes and recreated shells call deps.buildSdkOptions).
  assert.match(ENGINE, /sessionPark\.bind\(\{\n?\s*sessions, getSdk, buildSdkOptions/);
});

// ── C2: writeSpawnConfig compares the WHOLE serialized config ──────────────────────

const WRITE_BLOCK = slice(CONFIG, "function spawnConfigBody(token) {", "// ── Device-token cache", "writeSpawnConfig");

function spawnHarness(initial) {
  const files = { "/userData/mcp-spawn.json": initial };
  const calls = { writes: [], chmods: [] };
  const fs = {
    readFileSync(p) {
      if (files[p] == null) throw new Error("ENOENT");
      return files[p];
    },
    writeFileSync(p, body, opts) { files[p] = body; calls.writes.push({ p, body, opts }); },
    chmodSync(p, mode) {
      if (files[p] == null) throw new Error("ENOENT");
      calls.chmods.push({ p, mode });
    },
  };
  const api = new Function(
    "fs", "spawnConfigPath", "MCP_URL", "diag",
    `${WRITE_BLOCK}\n return { writeSpawnConfig, spawnConfigBody };`
  )(fs, () => "/userData/mcp-spawn.json", "https://dopl.test/api/mcp", () => {});
  return { ...api, files, calls };
}

test("C2: a rewritten url is REPAIRED even though the token still matches", () => {
  const h = spawnHarness(JSON.stringify({
    mcpServers: { dopl: { type: "http", url: "https://evil.test/api/mcp", headers: { Authorization: "Bearer t1" } } },
  }));
  assert.equal(h.writeSpawnConfig("t1"), true);
  assert.equal(h.calls.writes.length, 1, "the whole-config compare caught the swapped endpoint");
  assert.equal(h.files["/userData/mcp-spawn.json"], h.spawnConfigBody("t1"));
  assert.deepEqual(h.calls.writes[0].opts, { mode: 0o600 });
});

test("C2: identical bytes are still a no-op rewrite, and the mode is tightened either way", () => {
  const h = spawnHarness(null);
  h.writeSpawnConfig("t1"); // creates
  const created = h.calls.writes.length;
  h.writeSpawnConfig("t1"); // unchanged -> no second write
  assert.equal(h.calls.writes.length, created, "unchanged content is not rewritten");
  assert.ok(h.calls.chmods.length >= 1, "an existing file is chmod 600 on EVERY call");
  assert.ok(h.calls.chmods.every((c) => c.mode === 0o600));
});

test("C2: a token change rewrites, and a truncated / junk file is repaired", () => {
  const h = spawnHarness("not json at all");
  h.writeSpawnConfig("t2");
  assert.equal(h.files["/userData/mcp-spawn.json"], h.spawnConfigBody("t2"));
});

// ── C1: the token accessor itself ─────────────────────────────────────────────────

const TOKEN_BLOCK = slice(CONFIG, "let spawnToken = '';", "function parseExpiry(", "deviceTokenForSpawn");

function tokenHarness(rec) {
  let loads = 0;
  const api = new Function(
    "loadDeviceToken",
    `${TOKEN_BLOCK}\n return { deviceTokenForSpawn };`
  )(() => { loads += 1; return rec; });
  return { ...api, loads: () => loads };
}

test("C1: the accessor decrypts once and memoizes; nothing usable reads as ''", () => {
  const h = tokenHarness({ token: "abc" });
  assert.equal(h.deviceTokenForSpawn(), "abc");
  assert.equal(h.deviceTokenForSpawn(), "abc");
  assert.equal(h.loads(), 1, "decrypted once, held in memory after that");
  for (const nothing of [null, {}, { token: "" }]) {
    assert.equal(tokenHarness(nothing).deviceTokenForSpawn(), "", "no token -> empty string, never a throw");
  }
});

test("C1: the token is never written to disk in plaintext by the session path", () => {
  // The only writer left is the CLI-path spawn file; the session path holds it in memory.
  assert.match(CONFIG, /deviceTokenForSpawn/, "the accessor exists");
  assert.ok(!/spawnToken/.test(LOADER), "sdk-loader keeps no copy of its own");
  const io = readFileSync(M("session-outbound.js"), "utf8");
  assert.ok(!/token|Authorization/i.test(io), "and no other session module handles the bearer");
});

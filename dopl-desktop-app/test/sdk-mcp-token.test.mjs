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
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const LOADER = readFileSync(M("sdk-loader.js"), "utf8");
const CONFIG = readFileSync(M("mcp-config.js"), "utf8");
const ENGINE = readFileSync(M("session-engine.js"), "utf8");
// §3 split: the SDK option assembly + the query lifecycle live in session-query.js;
// session-engine.js still binds them (asserted below), which is what makes the park /
// reopen paths share the one assembly.
const QUERY = readFileSync(M("session-query.js"), "utf8");

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
    "doplBearer", "clientTimeoutMs", "MCP_URL", "policy", "workspaceId",
    `${MCP_BLOCK}\n return buildMcpServers(policy, workspaceId);`
  )(() => token, () => SHIPPED_TIMEOUT_MS, MCP_URL, policy, workspaceId);
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
  // 🔒 THE CONTAINER LOCK (2026-08-26, plan §4.4 B1) widened this line: a session spawned into a
  // SHARED link container presents a CHILD credential locked to that workspace, and every other
  // session falls back to the device token exactly as before. What this assertion still pins is
  // the property it always pinned — **the fallback is the safeStorage accessor, never a file** —
  // and the override rides in as an ARGUMENT from `buildSdkOptions`, so it cannot be a disk read
  // either. `session-audience-ceiling.test.mjs` pins the override's own behaviour.
  assert.match(MCP_BLOCK, /const token = override \|\| doplBearer\(\);/, "the fallback is the safeStorage accessor");
  assert.match(MCP_BLOCK, /const override = typeof bearerOverride === 'string'/, "the lock arrives as an argument, never off disk");
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
  const opts = slice(QUERY, "function buildSdkOptions(s) {", "async function startQuery(", "buildSdkOptions");
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
    "fs", "spawnConfigPath", "MCP_URL", "diag", "MCP_CLIENT_TIMEOUT_MS",
    `${WRITE_BLOCK}\n return { writeSpawnConfig, spawnConfigBody };`
  )(fs, () => "/userData/mcp-spawn.json", "https://dopl.test/api/mcp", () => {}, SHIPPED_TIMEOUT_MS);
  return { ...api, files, calls };
}

// The value the shipped module defines, read out of the source rather than
// copied — a harness that hardcoded its own number would keep passing after the
// constant was edited away.
const SHIPPED_TIMEOUT_MS = (() => {
  const m = /MCP_CLIENT_TIMEOUT_MS = ([\d_]+);/.exec(CONFIG);
  assert.ok(m, "mcp-config.js must define MCP_CLIENT_TIMEOUT_MS");
  return Number(m[1].replace(/_/g, ""));
})();

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

// ── L4 (WAKE-V1): the CLI spawn path is desktop-owned too ─────────────────────────

test("L4: the spawn config carries X-Dopl-Runtime alongside the bearer", () => {
  // A headless spawn is a session THIS APP owns, but it reaches MCP through this
  // file instead of sdk-loader's in-memory entry. Without the header the server read
  // it as an EXTERNAL session, so the two spawn paths disagreed about the same
  // machine (and a headless requester thread opened no window).
  const h = spawnHarness(null);
  const cfg = JSON.parse(h.spawnConfigBody("t1"));
  assert.deepEqual(cfg.mcpServers.dopl.headers, {
    Authorization: "Bearer t1",
    "X-Dopl-Runtime": "desktop-session",
  });
  // The literal is what the server matches — pinned here as it is for sdk-loader.
  assert.match(CONFIG, /'X-Dopl-Runtime': 'desktop-session',/);
});

test("L4: a file written by an older build (no runtime header) is REPAIRED", () => {
  const stale = JSON.stringify({
    mcpServers: {
      dopl: {
        type: "http",
        url: "https://dopl.test/api/mcp",
        headers: { Authorization: "Bearer t1" },
      },
    },
  });
  const h = spawnHarness(stale);
  assert.equal(h.writeSpawnConfig("t1"), true);
  assert.equal(h.calls.writes.length, 1, "the whole-config compare catches a missing header");
  assert.equal(h.files["/userData/mcp-spawn.json"], h.spawnConfigBody("t1"));
});

// ── L8 (Q9): the per-server call timeout is part of the config, not a comment ─────

test("L8: the spawn config carries the per-server `timeout`, and it clears the 60s abort", () => {
  // WITHOUT this key a Claude Code client aborts every call to `dopl` at 60s —
  // `min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647)` in the
  // 2.1.220 binary this app bundles. That is BEFORE the ~2min mark at which a
  // pending MCP call is backgrounded, which is the entire mechanism that turns
  // `dopl_channel(op="await")` into a wake. Deleting it would break the
  // headless-spawn wake with every other assertion in this file still green.
  const cfg = JSON.parse(spawnHarness(null).spawnConfigBody("t1"));
  assert.equal(cfg.mcpServers.dopl.timeout, SHIPPED_TIMEOUT_MS);
  assert.ok(SHIPPED_TIMEOUT_MS > 60_000, "or the client floor wins and nothing changed");
  // The full arithmetic (cap + margin <= this) lives in mcp-client-timeout.test.mjs,
  // which reads the server's own constants instead of restating a literal here.
});

test("L8: ONE definition feeds BOTH entries this app owns", () => {
  // The spawn-config file (CLI path) and sdk-loader's in-memory server (session
  // path) must not drift: same client, same endpoint. sdk-loader used to restate
  // the literal, which is exactly how they drifted (280_000 vs a moved server cap).
  assert.match(CONFIG, /timeout: MCP_CLIENT_TIMEOUT_MS,/, "the spawn file uses the constant");
  assert.match(CONFIG, /MCP_CLIENT_TIMEOUT_MS, \/\/ Q9/, "…and it is exported for sdk-loader");
  assert.match(LOADER, /timeout: clientTimeoutMs\(\),/, "sdk-loader reads it, never a literal");
  assert.match(
    fnOf(LOADER, "clientTimeoutMs"),
    /require\('\.\/mcp-config'\)\.MCP_CLIENT_TIMEOUT_MS/,
    "…from mcp-config, the one owner"
  );
  assert.ok(
    !/timeout: \d[\d_]*,/.test(LOADER),
    "no numeric timeout literal may reappear in sdk-loader"
  );
});

// ── TASK 4: the operator's own ~/.claude.json is NOT ours to rewrite ──────────

test("nothing in this app patches the CLI's user-scope config in place", () => {
  // main/mcp-cli-entry.js rewrote ~/.claude.json — a file that holds the operator's
  // `oauthAccount` block — to inject a per-server `timeout`. It is DELETED: the
  // streaming fix (c2f6a7e) removed the reason, and `timeout` also lowers the hard
  // tool-call ceiling for the operator's OWN terminal sessions. The in-app entries
  // above are where the fix belongs, and they stay.
  assert.ok(!/patchCliEntryTimeout/.test(CONFIG), "the call sites are gone");
  assert.ok(!/require\('\.\/mcp-cli-entry'\)/.test(CONFIG), "…and so is the require");
  // The removal REASONS stay in the source, or the next round re-adds it.
  const prose = CONFIG.replace(/\n\/\/ ?/g, " ");
  assert.match(prose, /mcp-cli-entry\.js REMOVED/);
  assert.match(prose, /oauthAccount/, "reason 1: the file holds a credential block");
  assert.match(prose, /streams \(c2f6a7e\)/, "reason 2: the 60s silence is gone");
  assert.match(prose, /hard tool-call ceiling/, "reason 3: the second, unasked-for effect");
  assert.ok(!existsSync(M("mcp-cli-entry.js")), "the module itself is deleted");
  const cliAdd = readFileSync(M("mcp-cli-add.js"), "utf8");
  assert.ok(
    !/writeFileSync|renameSync/.test(cliAdd),
    "the CLI half shells out to `claude mcp …` and writes no config file of its own"
  );
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

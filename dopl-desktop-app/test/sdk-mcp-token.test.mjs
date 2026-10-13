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
// THE FIX: MCP_URL unconditionally, and (then) a WHOLE-config byte comparison that repaired it.
//
// THE BUG (S3, 2026-08-26) — WHAT C1 LEFT STANDING. C1 took the bearer off the SDK path and
// fenced userData for SECRET_TOOLS = Read/Grep/Glob, but `writeSpawnConfig` kept writing the
// UNLOCKED 90-day `dopl.read`+`dopl.write` token to userData/mcp-spawn.json in PLAINTEXT on
// every signed-in launch, and `Bash` is not on that list. One `cat` lifted the credential; at the
// `bypass` posture, without even a prompt. Adding `'Bash'` to SECRET_TOOLS would NOT have closed
// it — Claude Code `Bash` rules match COMMAND STRINGS, not path globs, so `Bash(//Users/…/**)`
// matches no command and denies nothing while reading as coverage.
// THE FIX: stop writing the file AND delete it on sight, so installed machines shed the token on
// their next signed-in launch rather than carrying it for up to 90 more days. The C2 assertions
// below are therefore replaced by their successors: there is no body to compare and no write to
// make. What survives from C2 is the property that mattered — nothing off disk steers the url —
// and it now holds vacuously plus by construction in sdk-loader.
//
// The loader is still source-extracted (another sector's file). The mcp-config side is the REAL
// `mcp-config.js` + `mcp-device-token-lifecycle.js` + `mcp-device-token.js`, each loaded whole over
// a strict stub map (`_device-token-harness.mjs`, cleanup D04 2026-10-11).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { codeOf, fnOf } from "./helpers/source-probe.mjs";
import { deviceTokenWorld, freshRecord, MCP_URL as CURRENT_MCP_URL, SPAWN_JSON } from "./_device-token-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const LOADER = readFileSync(M(join("runtime", "claude", "loader.js")), "utf8");
// The session's MCP entry (`buildMcpServers`, `clientTimeoutMs`) moved to the adapter's `mcp.js` (2026-10-13).
const MCP = readFileSync(M(join("runtime", "claude", "mcp.js")), "utf8");
const CONFIG = readFileSync(M("mcp-config.js"), "utf8");
const LIFECYCLE = readFileSync(M("mcp-device-token-lifecycle.js"), "utf8");
const ENGINE = readFileSync(M("session-engine.js"), "utf8");
// §3 split: the SDK option assembly + the query lifecycle live in session-query.js;
// session-engine.js still binds them (asserted below), which is what makes the park /
// reopen paths share the one assembly.
const SPEC = readFileSync(M(join("runtime", "claude", "launch-spec.js")), "utf8");

const slice = (src, from, to, what) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to);
  assert.ok(a !== -1 && b > a, `${what} slice not found`);
  return src.slice(a, b);
};

// ── C1: buildMcpServers takes the bearer from the injected accessor, never a file ──

const MCP_BLOCK = codeOf(fnOf(MCP, "buildMcpServers"));
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
  assert.ok(!/require\('fs'\)/.test(LOADER + MCP), "sdk-loader and the MCP module must not require fs");
  assert.ok(!/mcp-spawn\.json/.test(MCP_BLOCK), "no spawn-config path in the builder");
  assert.ok(!/readFileSync/.test(LOADER + MCP), "no file read on the session path");
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

// 2026-10-13 (scaffold Phase 1.5): the rules are `claude/tools.js › buildSecretPathDenyRules`, electron-free —
// userData is passed in by the launch spec (`launch-spec.js › userDataDir`), so the REAL table runs here.
const CLAUDE_TOOLS = require(M(join("runtime", "claude", "tools.js")));
const denyRules = (userData) => CLAUDE_TOOLS.buildSecretPathDenyRules(userData);

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
  // No app (a harness): the launch spec's `userDataDir` answers '' and only the home rules remain.
  assert.match(fnOf(SPEC, "userDataDir"), /catch \(_\) \{ return ''; \}/, "an unreadable userData answers ''");
  const rules = denyRules("");
  assert.deepEqual(rules.filter((r) => r.startsWith("Read")), ["Read(~/.claude*)", "Read(~/.claude/**)"]);
});

test("C1: the launch spec really concatenates them onto the profile's hard-deny", () => {
  // ⚠ 2026-08-31 (runtime-adapter port): the option assembly is the RUNTIME ADAPTER's — it is
  // written in one platform's option vocabulary. The rule it carries is unchanged, and so is the
  // reason it is pinned: a pre-approved read is SHADOWED past the gate, so only this tool-bound
  // layer can fence the credential directories.
  const opts = slice(SPEC, "function buildOptions(s, dispatch) {", "function buildLaunchSpec(", "buildOptions");
  assert.match(opts, /disallowedTools: cfg\.disallowedTools\.concat\(tools\.buildSecretPathDenyRules\(userDataDir\(\)\)\),/);
  // ...and that every profile therefore gets them: it is the ONE assembly path
  // (session-park resumes and recreated shells call deps.buildLaunchSpec).
  assert.match(ENGINE, /sessionPark\.bind\(\{\n?\s*sessions, acquireRuntime, buildLaunchSpec/);
});

// ── S3: the spawn-config file is REMOVED, and never written ────────────────────────

// The REAL ensure, on a signed-in reuse boot whose CLI entry is already correct, so the only
// disk work it can do is the spawn-file migration. The harness fs records EVERY call, so "no
// write happened" is an observation and not an assumption.
async function spawnHarness(initial, rmThrows) {
  const world = deviceTokenWorld({
    record: freshRecord(),
    spawnFile: initial,
    rmThrows,
    probe: { state: "present", url: CURRENT_MCP_URL },
  });
  await world.config.ensureMcpConfig();
  return { world, files: world.files, calls: world.calls };
}

// The value the shipped module EXPORTS — a harness that hardcoded its own number would keep
// passing after the constant was edited away.
const SHIPPED_TIMEOUT_MS = (() => {
  const v = deviceTokenWorld().config.MCP_CLIENT_TIMEOUT_MS;
  assert.equal(typeof v, "number", "mcp-config.js must define MCP_CLIENT_TIMEOUT_MS");
  return v;
})();

test("S3: THE MIGRATION — a pre-existing file, bearer and all, is REMOVED", async () => {
  // The property that makes this a fix rather than a promise. An install that has been running
  // an older build already has the 90-day token on disk; merely ceasing to write it would leave
  // that copy readable for the rest of its life.
  const stale = JSON.stringify({
    mcpServers: {
      dopl: {
        type: "http",
        url: "https://dopl.test/api/mcp",
        timeout: SHIPPED_TIMEOUT_MS,
        headers: { Authorization: "Bearer dopl_at_STALESECRET", "X-Dopl-Runtime": "desktop-session" },
      },
    },
  });
  assert.ok(deviceTokenWorld({ spawnFile: stale }).files.get(SPAWN_JSON).includes("dopl_at_STALESECRET"),
    "control: the token starts on disk");
  const h = await spawnHarness(stale);
  assert.equal(h.files.has(SPAWN_JSON), false, "the file — and the bearer in it — is gone");
  assert.deepEqual(h.calls.writes, [], "and nothing was written in its place");
});

test("S3: the removal is `force`, so a machine with no file is a clean no-op", async () => {
  // Post-migration this runs on every signed-in launch and must never surface an ENOENT as a
  // failure. `force` is the flag that makes the steady state silent.
  const h = await spawnHarness(null);
  assert.equal(h.calls.rms.length, 1, "the rm is still ISSUED — it is not conditional on a stat");
  assert.equal(h.calls.rms[0].p, SPAWN_JSON);
  assert.deepEqual(h.calls.rms[0].opts, { force: true });
  assert.ok(h.calls.diags.length > 0, "control: the ensure did log its other steps");
  assert.ok(!h.calls.diags.some((d) => /spawn config/.test(d)), "and it says nothing about the file on the happy path");
});

test("S3: a removal that throws is REPORTED and never breaks the launch", async () => {
  // ensureMcpConfigInner runs this before the CLI-entry work; an EPERM must not abort the rest
  // of the ensure, and it must not be swallowed silently either — a machine still carrying the
  // token has to be visible in diag.
  const h = await spawnHarness('{"mcpServers":{}}', true);
  assert.ok(h.calls.seq.includes("probe"), "the rest of the ensure still ran");
  const named = h.calls.diags.filter((d) => /spawn config/.test(d));
  assert.equal(named.length, 1, "…and the failure is named in diag, once");
  assert.match(named[0], /spawn config removal failed/);
});

test("S3: ABSENCE PIN — no source in mcp-config writes a bearer to disk", async () => {
  // The link-container-guard technique: a fake cannot see a NEW writer being added, and this is
  // the exact regression that would silently restore the defect. Read the module's own source.
  for (const [name, src] of [["mcp-config.js", CONFIG], ["mcp-device-token-lifecycle.js", LIFECYCLE]]) {
    assert.ok(!/fs\.writeFileSync\(\s*spawnConfigPath\(\)/.test(src), `${name}: nothing may write the spawn-config path again`);
    assert.ok(!/fs\.writeFileSync/.test(src), `${name} writes NO file at all any more`);
  }
  // The body-builder and the writer are gone as CODE — a surviving definition, call site or
  // export would let a caller re-adopt them. Their NAMES stay legal in prose.
  for (const src of [CONFIG, LIFECYCLE]) {
    for (const dead of ["spawnConfigBody", "writeSpawnConfig", "currentSpawnBody"]) {
      assert.ok(!new RegExp(`^\\s*function\\s+${dead}\\b`, "m").test(src), `${dead} is not defined`);
      assert.ok(!new RegExp(`(^|[^\`\\w.])${dead}\\s*\\(`, "m").test(src.replace(/\n\/\/[^\n]*/g, "")),
        `${dead} is not called`);
    }
    assert.ok(!/`Bearer \$\{token\}`/.test(src),
      "the bearer is not serialized in either module (the argv build lives in mcp-cli-add.js)");
  }
  const exported = Object.keys(deviceTokenWorld().config);
  for (const dead of ["spawnConfigBody", "writeSpawnConfig", "currentSpawnBody"]) {
    assert.ok(!exported.includes(dead), `${dead} is not exported`);
  }
  // …and the removal really is wired into the launch path, not just defined.
  const h = await spawnHarness(null);
  assert.deepEqual(h.calls.rms.map((r) => r.p), [SPAWN_JSON], "every signed-in launch runs the migration");
});

test("S3: the path itself SURVIVES, because sign-out still tears the file down", () => {
  // auth-signed-in.test.mjs pins the rmSync inside clearDeviceToken; deleting spawnConfigPath as
  // 'dead' would break the belt for a machine that signs out before its next signed-in launch.
  const world = deviceTokenWorld({ record: freshRecord(), spawnFile: "{}" });
  assert.equal(typeof world.config.spawnConfigPath, "function", "…and it is still exported");
  assert.equal(world.config.spawnConfigPath(), SPAWN_JSON);
  world.config.clearDeviceToken();
  assert.deepEqual(world.calls.rms, [{ p: SPAWN_JSON, opts: { force: true } }], "sign-out removes it");
  assert.equal(world.files.has(SPAWN_JSON), false);
});

// ── L8 (Q9): ONE definition of the per-server call timeout ───────────────────────

test("L8: mcp-config OWNS the number and the loader's entry is the only one that reads it", () => {
  // The loader used to restate the literal, which is exactly how the two entries drifted
  // (280_000 vs a moved server cap). There is now only ONE entry — the spawn-config file that
  // was the second one is deleted — so the rule is simply: the constant lives here, is exported,
  // and no numeric literal reappears downstream.
  // ⚠ 2026-08-31: the loader is `main/runtime/claude/loader.js` and reaches the owner through
  // `../../`; 2026-10-13 the entry moved to `main/runtime/claude/mcp.js`. The rule is unchanged.
  assert.equal(typeof SHIPPED_TIMEOUT_MS, "number", "it is exported for the loader");
  assert.match(codeOf(MCP), /timeout: clientTimeoutMs\(\),/, "the entry reads it, never a literal");
  assert.match(
    fnOf(MCP, "clientTimeoutMs"),
    /require\('\.\.\/\.\.\/mcp-config'\)\.MCP_CLIENT_TIMEOUT_MS/,
    "…from mcp-config, the one owner"
  );
  assert.ok(
    !/timeout: \d[\d_]*,/.test(codeOf(LOADER) + codeOf(MCP)),
    "no numeric timeout literal may reappear in sdk-loader"
  );
  assert.ok(SHIPPED_TIMEOUT_MS > 60_000, "or the client's own 60s floor wins and the key is inert");
});

// ── TASK 4: the operator's own ~/.claude.json is NOT ours to rewrite ──────────

test("nothing in this app patches the CLI's user-scope config in place", () => {
  // main/mcp-cli-entry.js rewrote ~/.claude.json — a file that holds the operator's
  // `oauthAccount` block — to inject a per-server `timeout`. It is DELETED: the
  // streaming fix (c2f6a7e) removed the reason, and `timeout` also lowers the hard
  // tool-call ceiling for the operator's OWN terminal sessions. The in-app entries
  // above are where the fix belongs, and they stay.
  assert.ok(!/patchCliEntryTimeout/.test(codeOf(CONFIG)), "the call sites are gone");
  assert.ok(!/require\('\.\/mcp-cli-entry'\)/.test(codeOf(CONFIG)), "…and so is the require");
  assert.ok(!existsSync(M("mcp-cli-entry.js")), "the module itself is deleted");
  const cliAdd = readFileSync(M("mcp-cli-add.js"), "utf8");
  assert.ok(
    !/writeFileSync|renameSync/.test(cliAdd),
    "the CLI half shells out to `claude mcp …` and writes no config file of its own"
  );
});

// ── C1: the token accessor itself ─────────────────────────────────────────────────

// The REAL accessor over the real store; every store read is counted.
function tokenHarness(rec) {
  const world = deviceTokenWorld({ record: rec });
  let loads = 0;
  const get = world.store.get.bind(world.store);
  world.store.get = (k) => { loads += 1; return get(k); };
  return { deviceTokenForSpawn: world.config.deviceTokenForSpawn, loads: () => loads };
}

test("C1: the accessor decrypts once and memoizes; nothing usable reads as ''", () => {
  const h = tokenHarness({ token: "abc" });
  assert.equal(h.deviceTokenForSpawn(), "abc");
  assert.equal(h.deviceTokenForSpawn(), "abc");
  assert.ok(h.loads() >= 1, "control: the first call really read the store");
  const after = h.loads();
  for (let i = 0; i < 3; i++) assert.equal(h.deviceTokenForSpawn(), "abc");
  assert.equal(h.loads(), after, "decrypted once, held in memory after that");
  for (const nothing of [null, {}, { token: "" }]) {
    assert.equal(tokenHarness(nothing).deviceTokenForSpawn(), "", "no token -> empty string, never a throw");
  }
});

test("C1: a fresh mint refreshes a WARM memo, so the next spawn carries the new bearer", async () => {
  // Pins mcp-device-token-lifecycle.js › obtainDeviceToken's `spawnToken = String(rec.token)`:
  // without it the memo keeps serving the token the mint just revoked server-side.
  const world = deviceTokenWorld({
    record: { token: "dopl_at_old", expiresAt: Date.now() + 86400e3 }, // inside the 7-day reuse margin
    fetch: async () => ({ ok: true, status: 200,
      json: async () => ({ token: "dopl_at_new", expiresAt: Date.now() + 90 * 86400e3 }) }),
  });
  assert.equal(world.config.deviceTokenForSpawn(), "dopl_at_old", "control: the memo is warm on the old token");
  assert.equal(await world.lifecycle.ensureDeviceToken(), "dopl_at_new", "control: the near-expiry record re-minted");
  assert.equal(world.config.deviceTokenForSpawn(), "dopl_at_new", "the warm memo now serves the fresh bearer");
});

test("C1: the token is never written to disk in plaintext — by ANY path in this app", () => {
  // This used to read "…by the session path", with the CLI-path spawn file admitted as the one
  // remaining writer. S3 removed that writer, so the exemption is gone and the claim is total:
  // the only persistence left is the safeStorage-encrypted electron-store, and the only other
  // place the bearer is spelled is an execFile argv (mcp-cli-add.js), which is not a file.
  assert.equal(typeof deviceTokenWorld().config.deviceTokenForSpawn, "function", "the accessor exists");
  assert.ok(!/spawnToken/.test(LOADER + MCP), "sdk-loader keeps no copy of its own");
});

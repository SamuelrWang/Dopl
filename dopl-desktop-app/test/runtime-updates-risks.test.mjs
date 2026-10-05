// THE SELF-UPDATING RUNTIME'S FOUR CLOSED RISKS (2026-10-04): prune never removes a build a process runs;
// an updated binary meets no Keychain ACL; a slow first exec is not a bad build (retry, then fall back to the
// bundle, never "no runtime"); the outdated line is one true sentence plus the one control that helps.
// No network, no model turn.
//
// Run: `node --test dopl-desktop-app/test/runtime-updates-risks.test.mjs`

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  require, MAIN, updates, verify, MACHO, registry, runner, source, h, setup, entries,
} from "./_runtime-updates-harness.mjs";

beforeEach(() => updates.inject());

// ── RISK 4: THE COPY SAYS ONLY WHAT IS TRUE, IN ONE LINE ───────────────────────────────────────

test("the outdated line names the one control that helps: relaunch, or Update Dopl when no build can be taken", async () => {
  const copy = require(join(MAIN, "runtime", "runtime-copy.js"));
  const d = { label: "Runtime X" };
  for (const outcome of [null, "updated", "current", "failed"]) {
    assert.equal(copy.runtimeOutdated(d, outcome), "Runtime X is out of date for this model. Relaunch the agent.", String(outcome));
  }
  for (const outcome of ["incompatible", "unsupported", "rejected"]) {
    assert.equal(copy.runtimeOutdated(d, outcome), "Runtime X is out of date for this model. Update Dopl.", outcome);
  }
  // End to end: the line is chosen off the LAST finished check (here: a newer minor no patch can reach).
  const io = require(join(MAIN, "session-io.js"));
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.4.0"), runner());
  const claude = require(join(MAIN, "runtime", "claude", "update-source.js"));
  await updates.start([source({ id: "claude", compatible: claude.compatible })]);
  assert.equal(await updates.checkNow("claude"), "incompatible");
  const sent = [];
  io.applyCoreEvents({ runtimeId: "claude" }, [{ type: "runtime_outdated" }], (_s, ev) => sent.push(ev), {});
  assert.match(sent[0].payload.text, / is out of date for this model\. Update Dopl\.$/);
});

// ── RISK 1: PRUNE NEVER REMOVES A BUILD A RUNNING PROCESS IS ON ────────────────────────────────

test("prune spares every version a running process executes from, and prunes nothing when ps cannot answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const src = source();
  // A child that outlived a crashed Dopl (or another Dopl on this userData) is running 0.3.5.
  let running = [];
  setup(registry(dir, "0.3.10"), runner(), { runningExecutables: async () => running });
  assert.equal(await updates.check(src), "updated");
  for (const v of ["0.3.5", "0.3.6"]) {
    mkdirSync(join(h.base, "runtimes", "fake", v));
    writeFileSync(join(h.base, "runtimes", "fake", v, "fake"), MACHO);
  }
  running = [join(h.base, "runtimes", "fake", "0.3.5", "fake"), "/usr/bin/unrelated"];
  await updates.start([src]);
  assert.deepEqual(entries(), ["0.3.10", "0.3.5", "active.json"], "0.3.5 is running; 0.3.6 is not");

  // No process list: nothing is removed, not even what looks idle.
  mkdirSync(join(h.base, "runtimes", "fake", "0.3.7"));
  updates.inject({ baseDir: () => join(h.base, "runtimes"), runningExecutables: async () => null });
  await updates.start([src]);
  assert.deepEqual(entries(), ["0.3.10", "0.3.5", "0.3.7", "active.json"]);

  // The process scan is real on macOS: `ps` lists this very test runner by its full path.
  updates.inject();
  const real = await (async () => {
    const { execFileSync: ex } = await import("node:child_process");
    return ex("/bin/ps", ["-axww", "-o", "comm="], { encoding: "utf8" });
  })();
  assert.ok(real.split("\n").some((l) => l.trim() === process.execPath || l.trim().endsWith("/node")), "ps comm= carries full paths");
});

test("a check started before the start-time prune finishes waits for it (no prune under a staging dir)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  let release;
  const gate = new Promise((r) => { release = r; });
  setup(registry(dir, "0.3.10"), runner(), { runningExecutables: async () => { await gate; return []; } });
  const src = source();
  const pruned = updates.start([src]);
  const checked = updates.checkNow("fake");
  let done = false;
  checked.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false, "the check is held behind the prune");
  release();
  await pruned;
  assert.equal(await checked, "updated");
  assert.deepEqual(entries(), ["0.3.10", "active.json"]);
});

// ── RISK 3: A SLOW FIRST EXEC IS NOT A BAD BUILD ───────────────────────────────────────────────

test("install: a --version that times out once is retried longer before the build is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  const timeouts = [];
  let calls = 0;
  const run = runner();
  const slowFirst = async (file, args, opts) => {
    if (file === "/usr/bin/tar" || file === "/usr/bin/codesign") return run.run(file, args, opts);
    calls += 1;
    timeouts.push(opts && opts.timeout);
    return calls === 1 ? { code: 1, stdout: "" } : { code: 0, stdout: "2.1.300 (Fake)\n" };
  };
  setup(registry(dir, "0.3.10"), { run: slowFirst });
  assert.equal(await updates.check(source()), "updated");
  assert.deepEqual(timeouts, verify.VERSION_TIMEOUTS_MS, "two runs, the second longer");
  assert.ok(timeouts[1] > timeouts[0]);
});

/** A planted download for the Claude roster read: `{ src, bin }` with `active.json` pointing at it. */
function plantClaude(version) {
  const loader = require(join(MAIN, "runtime", "claude", "loader.js"));
  const bundled = loader.bundledClaude();
  if (!bundled) return null;
  const [major, minor, patch] = bundled.version.split(".").map(Number);
  const v = version || `${major}.${minor}.${patch + 1}`;
  h.base = mkdtempSync(join(tmpdir(), "dopl-runtime-updates-"));
  updates.inject({ baseDir: () => join(h.base, "runtimes"), invalidate: () => {}, runningExecutables: async () => [] });
  mkdirSync(join(h.base, "runtimes", "claude", v), { recursive: true });
  writeFileSync(join(h.base, "runtimes", "claude", v, "claude"), MACHO);
  writeFileSync(join(h.base, "runtimes", "claude", "active.json"), JSON.stringify({ version: v, previous: null, rejected: [] }));
  return { loader, bundled, bin: join(h.base, "runtimes", "claude", v, "claude"), version: v };
}

test("claude roster: a probe that times out on a download is retried longer, and a good build is kept", async () => {
  const planted = plantClaude();
  if (!planted) { console.log("      ℹ no bundled Claude platform package here — case skipped"); return; }
  const models = require(join(MAIN, "runtime", "claude", "models.js"));
  const seen = [];
  models.inject({
    loadSdk: async () => ({}),
    env: () => ({}),
    credentialSource: () => "dopl-token",
    probe: async ({ options, timeoutMs }) => {
      seen.push({ bin: options.pathToClaudeCodeExecutable, timeoutMs: timeoutMs || null });
      if (seen.length === 1) throw new Error("Claude Code did not list its models within 10000ms");
      return [{ value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable" }];
    },
  });
  try {
    const r = await models.models();
    assert.notEqual(r.stale, true, r.reason);
    assert.deepEqual(seen.map((x) => x.bin), [planted.bin, planted.bin], "the same download, twice");
    assert.equal(seen[1].timeoutMs, models.DOWNLOAD_RETRY_TIMEOUT_MS);
    assert.equal(updates.activeFor(require(join(MAIN, "runtime", "claude", "update-source.js"))).version, planted.version, "not rejected");
  } finally {
    models.inject();
  }
});

test("claude roster: a download that fails twice is rejected and the roster comes from the bundle, never none", async () => {
  const planted = plantClaude();
  if (!planted) { console.log("      ℹ no bundled Claude platform package here — case skipped"); return; }
  const models = require(join(MAIN, "runtime", "claude", "models.js"));
  const seen = [];
  models.inject({
    loadSdk: async () => ({}),
    env: () => ({}),
    credentialSource: () => "dopl-token",
    probe: async ({ options }) => {
      seen.push(options.pathToClaudeCodeExecutable);
      if (options.pathToClaudeCodeExecutable === planted.bin) throw new Error("exited 1");
      return [{ value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable" }];
    },
  });
  try {
    const r = await models.models();
    assert.notEqual(r.stale, true, "a live roster, read from the bundle");
    assert.deepEqual(seen, [planted.bin, planted.bin, planted.bundled.path]);
    assert.equal(planted.loader.resolveClaudeExecutable(), planted.bundled.path, "new launches run the bundle");
    assert.ok(r.key.startsWith(`${planted.bundled.path}@`), "filed under what launches run now");
    // The bundle failing is NOT a reason to reject anything, and is not retried.
    seen.length = 0;
    models.inject({ loadSdk: async () => ({}), env: () => ({}), credentialSource: () => "dopl-token", probe: async (o) => { seen.push(o.timeoutMs || null); throw new Error("down"); } });
    assert.equal((await models.models()).stale, true);
    assert.deepEqual(seen, [null]);
  } finally {
    models.inject();
  }
});

test("codex probe: a slow first --version on a download is retried, a dead one falls back to the bundle", async (t) => {
  const codexUpdate = require(join(MAIN, "runtime", "codex", "update-source.js"));
  const bundledVersion = codexUpdate.bundledVersion();
  if (!codexUpdate.pkg || !bundledVersion) { t.skip("no bundled Codex platform package here"); return; }
  const client = require(join(MAIN, "runtime", "codex", "client.js"));
  const resolver = require(join(MAIN, "runtime", "codex", "resolve-bin.js"));
  const [major, minor, patch] = bundledVersion.split(".").map(Number);
  const v = `${major}.${minor}.${patch + 1}`;
  const plant = (script) => {
    h.base = mkdtempSync(join(tmpdir(), "dopl-runtime-updates-"));
    updates.inject({ baseDir: () => join(h.base, "runtimes"), invalidate: () => {}, runningExecutables: async () => [] });
    const bin = codexUpdate.binary(join(h.base, "runtimes", "codex", v));
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(bin, script, { mode: 0o755 });
    writeFileSync(join(h.base, "runtimes", "codex", "active.json"), JSON.stringify({ version: v, previous: null, rejected: [] }));
    resolver.forget();
    return realpathSync(bin);
  };
  const saved = process.env.DOPL_CODEX_BIN;
  delete process.env.DOPL_CODEX_BIN;
  try {
    // Slow on its first exec only (the first-exec scan), then fine: kept.
    const slow = plant(`#!/bin/sh
M="$(dirname "$0")/.warm"
if [ ! -f "$M" ]; then touch "$M"; sleep 2; fi
echo "codex-cli ${v}"
`);
    const kept = await client.probe({ timeoutMs: 300, retryTimeoutMs: 10000 });
    assert.equal(kept.ok, true, kept.reason);
    assert.equal(kept.source, "downloaded");
    assert.equal(kept.path, slow);
    assert.equal(updates.activeFor(codexUpdate).version, v, "not rejected");

    // Dead on every run: rejected, and the answer is the bundle's — never "no Codex".
    plant("#!/bin/sh\nexit 1\n");
    const fell = await client.probe({ timeoutMs: 1000, retryTimeoutMs: 1000 });
    assert.equal(fell.ok, true, fell.reason);
    assert.equal(fell.source, "bundled");
    assert.equal(updates.activeFor(codexUpdate), null);
    assert.deepEqual(JSON.parse(readFileSync(join(h.base, "runtimes", "codex", "active.json"), "utf8")).rejected, [v]);
  } finally {
    if (saved !== undefined) process.env.DOPL_CODEX_BIN = saved;
    resolver.forget();
  }
});

// ── RISK 2: AN UPDATED BINARY NEVER MEETS A KEYCHAIN ACL ───────────────────────────────────────

test("credentials never ride the binary's identity: env token for sessions, and the CLI reaches the Keychain only via /usr/bin/security", async (t) => {
  // Dopl's session credential is an env var on every spawn, whichever binary runs: no Keychain read at all.
  const credential = require(join(MAIN, "runtime", "claude", "credential.js"));
  assert.equal(credential.TOKEN_ENV, "CLAUDE_CODE_OAUTH_TOKEN");
  // Codex's sign-in is a FILE in Dopl's private CODEX_HOME, forced by argv on every spawn.
  const { AUTH_STORE_ARGS } = require(join(MAIN, "runtime", "codex", "config-home.js"));
  assert.deepEqual([...AUTH_STORE_ARGS], ["-c", 'cli_auth_credentials_store="file"']);
  // The full login lives in a Keychain item the CLI reads and writes through `/usr/bin/security` subprocesses,
  // so the item's ACL trusts Apple's `security` tool, not the CLI's path or signature: a new build reads it
  // with no prompt. Pinned on the bundled binary so an SDK bump that moves to a native Keychain API fails here.
  const loader = require(join(MAIN, "runtime", "claude", "loader.js"));
  const bundled = loader.bundledClaude();
  if (!bundled) { t.skip("no bundled Claude platform package here"); return; }
  const bytes = readFileSync(bundled.path);
  assert.ok(bytes.indexOf(Buffer.from('"security",["find-generic-password"')) !== -1, "reads via the security tool");
  assert.ok(bytes.indexOf(Buffer.from('"security",["add-generic-password"')) !== -1, "writes via the security tool");
  assert.equal(bytes.indexOf(Buffer.from("Bun.secrets")), -1, "no native Keychain API from the CLI's own code");
});

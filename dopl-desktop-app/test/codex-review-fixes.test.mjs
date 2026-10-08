// Fixes from model-picker-audit's "SDK Cross-Review — Codex + shared" (2026-10-08), one case per finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadCatalog, memoryLiveStore } from "./_model-catalog-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);

// ── LOW: an unrecognised server request — denied on restricted, never a standing grant on full ──
test("gate: an unrecognised request is DENIED on a restricted profile and never opened by a task grant", () => {
  const { grantDecision } = require(join(MAIN, "session-profiles.js"));
  const { UNRECOGNISED_REQUEST_PREFIX } = require(join(MAIN, "runtime", "sdk-shape.js"));
  const toolName = `${UNRECOGNISED_REQUEST_PREFIX}item/new/requestApproval`;
  const grant = [toolName, `${toolName}:{}`];
  assert.equal(grantDecision({ runtime: "codex", profile: "dopl_only", toolName, toolMode: "never", allowForTask: grant }), "deny");
  assert.equal(grantDecision({ runtime: "codex", profile: "full", toolName, toolMode: "on-request", allowForTask: grant }), "gate",
    "a standing grant never pre-approves a request type Dopl cannot describe");
  assert.equal(grantDecision({ runtime: "codex", profile: "full", toolName, toolMode: "never" }), "gate",
    "even at Full access an unnamed request is ASKED (Codex's Axis A names no such row)");
  const serverRequests = require(join(MAIN, "runtime", "codex", "server-requests.js"));
  assert.equal(serverRequests.UNKNOWN_PREFIX, UNRECOGNISED_REQUEST_PREFIX, "Codex names it with the shared prefix");
});

// ── M1: an in-place upgrade never reuses the old file's version ──
test("identity: a version learned for a file is dropped when the file is rewritten in place", () => {
  const identity = require(join(MAIN, "runtime", "codex", "identity.js"));
  const file = join(mkdtempSync(join(tmpdir(), "dopl-id-")), "codex");
  writeFileSync(file, "v1");
  utimesSync(file, 1000, 1000);
  identity.noteVersion(file, "codex-cli 0.155.1");
  const resolveBin = require(join(MAIN, "runtime", "codex", "resolve-bin.js"));
  const real = resolveBin.resolveCodexBin;
  resolveBin.resolveCodexBin = () => ({ ok: true, path: file, source: "path" });
  try {
    assert.equal(identity.buildIdentity().version, "0.155.1");
    writeFileSync(file, "v2");
    utimesSync(file, 2000, 2000); // brew upgrade: same path, new file
    assert.equal(identity.buildIdentity().version, null, "unknown until the new file is probed — no stale key");
  } finally {
    resolveBin.resolveCodexBin = real;
    identity.forget();
  }
});

// ── M2: a persisted roster without an account in the key only LABELS ──
test("catalog: a persisted roster is READY only when the build key names the account; else stale", async () => {
  const disk = memoryLiveStore();
  const ad = (account) => ({
    descriptor: { id: "rx", label: "X", models: { source: "live", dimensions: [] } },
    runtime: { buildIdentity: () => ({ path: "/bin/x", version: "1", account }), models: async () => ({ models: [{ id: "m" }] }) },
  });
  await loadCatalog(disk).settle(ad("acct-a"));
  assert.equal(loadCatalog(disk).snapshot(ad("acct-a")).status, "ready");
  assert.equal(loadCatalog(disk).snapshot(ad("acct-b")).status, "loading", "another account's list is not this one's");
  await loadCatalog(disk).settle(ad(null));
  const noAccount = loadCatalog(disk).snapshot(ad(null));
  assert.equal(noAccount.status, "stale", "no account fingerprint: labels only, cannot refuse or offer");
  assert.equal(noAccount.persisted, true);
});

test("identity: the account is a FINGERPRINT of Dopl's own auth.json account id — never the token", () => {
  const identity = require(join(MAIN, "runtime", "codex", "identity.js"));
  const configHome = require(join(MAIN, "runtime", "codex", "config-home.js"));
  const root = mkdtempSync(join(tmpdir(), "dopl-acct-"));
  mkdirSync(configHome.privateHome(root), { recursive: true });
  writeFileSync(configHome.authFile(root), JSON.stringify({ tokens: { account_id: "acct-123", access_token: "SECRET" } }));
  const realAuth = configHome.authFile;
  const resolveBin = require(join(MAIN, "runtime", "codex", "resolve-bin.js"));
  const realBin = resolveBin.resolveCodexBin;
  configHome.authFile = () => realAuth(root);
  resolveBin.resolveCodexBin = () => ({ ok: true, path: process.execPath, source: "path" });
  try {
    const { account } = identity.buildIdentity();
    assert.match(account, /^[0-9a-f]{16}$/);
    assert.equal(JSON.stringify(identity.buildIdentity()).includes("SECRET"), false);
    writeFileSync(configHome.authFile(root), JSON.stringify({ tokens: { access_token: "x" } }));
    utimesSync(configHome.authFile(root), 5000, 5000);
    assert.equal(identity.buildIdentity().account, null, "no readable account id = no account (stand-in labels only)");
  } finally {
    configHome.authFile = realAuth;
    resolveBin.resolveCodexBin = realBin;
    identity.forget();
  }
});

// ── M3: ties break on the server's default, then the plainer member ──
test("family: a version tie never falls to roster order", () => {
  const prefs = require(join(MAIN, "runtime", "model-preferences.js"));
  assert.equal(prefs.pickFamily([{ id: "gpt-6-sol-mini" }, { id: "gpt-6-sol" }], "sol").id, "gpt-6-sol", "fewest tokens after the family");
  assert.equal(prefs.pickFamily([{ id: "gpt-6-sol" }, { id: "gpt-6-sol-mini", isDefault: true }], "sol").id, "gpt-6-sol-mini", "the server's default first");
  assert.equal(prefs.pickFamily([{ id: "gpt-6-sol-mini" }, { id: "gpt-7-sol-mini" }, { id: "gpt-6-sol" }], "sol").id, "gpt-7-sol-mini", "newest still wins");
});

// ── Hollow (review): the generic reply builder agrees with the MEASURED schema for every hand-written reply ──
test("replies: replyFromSchema on the measured 0.155.1 schema = the replies server-requests.js hand-writes", () => {
  const fixture = require("./fixtures/codex-shape.json");
  const sr = require(join(MAIN, "runtime", "codex", "server-requests.js"));
  assert.equal(fixture.measured, true);
  for (const m of ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]) {
    assert.deepEqual(fixture.replies[m], { accept: sr.decisionReply("allow"), decline: sr.decisionReply("deny") }, m);
  }
  assert.deepEqual(fixture.replies["mcpServer/elicitation/request"], { accept: { action: "accept" }, decline: { action: "decline" } });
  // Where a reply would have to be guessed, the builder answers null — never an invented shape.
  assert.deepEqual(fixture.replies["item/tool/requestUserInput"], { accept: null, decline: null });
});

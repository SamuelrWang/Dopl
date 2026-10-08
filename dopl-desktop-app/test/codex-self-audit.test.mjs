// Codex Self Audit 2026-10-08 (KB "Codex Self Audit 2026-10-08", master ba6fc204) — one repro per item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { loadCatalog, memoryLiveStore } from "./_model-catalog-harness.mjs";
import { threadEcho } from "./helpers/codex-echo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const policy = require(join(MAIN, "runtime", "codex", "policy.js"));
const normalizer = require(join(MAIN, "runtime", "codex", "normalize.js"));
const sdkShape = require(join(MAIN, "runtime", "sdk-shape.js"));

// ── M1: a roster read answers only for its own build/account, and is filed under neither when it moved ──
test("M1: a roster read in flight across a build switch is never filed, persisted or handed to the new build", async () => {
  const disk = memoryLiveStore();
  const cat = loadCatalog(disk);
  let version = "1.0.0";
  let release;
  const gate = new Promise((r) => { release = r; });
  let reads = 0;
  const ad = {
    descriptor: { id: "codex", label: "Codex", models: { source: "live", dimensions: [] } },
    runtime: {
      buildIdentity: () => ({ path: "/bin/codex", version, account: "acct" }),
      models: async () => {
        reads += 1;
        const mine = version;
        if (reads === 1) await gate;
        return { models: [{ id: `model-of-${mine}`, isDefault: true }] };
      },
    },
  };
  cat.snapshot(ad); // read #1 starts for 1.0.0
  version = "2.0.0"; // the updater switches builds mid-read
  const settled = cat.settle(ad); // a launch on 2.0.0 must not join 1.0.0's read
  release();
  const out = await settled;
  assert.equal(out.status, "ready");
  assert.deepEqual(out.models.map((m) => m.id), ["model-of-2.0.0"], "the launch sees ITS build's list");
  assert.equal(out.key, "/bin/codex@2.0.0#acct");
  assert.equal(disk.read("roster", "codex", "/bin/codex@1.0.0#acct"), null, "nothing filed under the old key");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(cat.snapshot(ad).models.map((m) => m.id), ["model-of-2.0.0"], "the late 1.0.0 answer never overwrote it");
});

// ── M2: the sandbox echo is read by TYPE — anything not readable as "off" refuses ──
test("M2: network/roots/unknown fields in any shape Dopl cannot read as 'off' refuse", () => {
  const same = (a, b) => realpathSync(a) === realpathSync(b);
  const sent = { cwd: HERE, sandbox: "workspace-write", approvalPolicy: "on-request" };
  const took = (sandbox) => () => policy.assertThreadTook(sent, { ...threadEcho(sent), sandbox }, same);
  for (const [box, why] of [
    [{ type: "workspaceWrite", networkAccess: "enabled" }, /network setting Dopl cannot read/],
    [{ type: "workspaceWrite", networkAccess: { mode: "on" } }, /network setting Dopl cannot read/],
    [{ type: "workspaceWrite", networkAccess: true }, /network access on/],
    [{ type: "workspaceWrite", writableRoots: { a: "/" } }, /writable folders Dopl cannot read/],
    [{ type: "workspaceWrite", writableRoots: "/" }, /writable folders Dopl cannot read/],
    [{ type: "workspaceWrite", excludeSlashTmp: "no" }, /cannot read \(excludeSlashTmp\)/],
    [{ type: "workspaceWrite", extraRoots: ["/etc"] }, /does not recognise \(extraRoots\)/],
  ]) assert.throws(took(box), why, JSON.stringify(box));
  // What 0.155.1 / 0.160.1 actually echo still passes; narrowing flags and empty unknowns are fine.
  took({ type: "workspaceWrite", networkAccess: false, writableRoots: [], excludeSlashTmp: true, excludeTmpdirEnvVar: false })();
  took({ type: "workspaceWrite" })();
  took({ type: "workspaceWrite", futureList: [], futureFlag: null })();
});

// ── M3: the model the thread runs is the one requested ──
test("M3: a thread on another model refuses; no reported model refuses; no request accepts the CLI's pick", () => {
  const same = (a, b) => realpathSync(a) === realpathSync(b);
  const sent = { cwd: HERE, sandbox: "workspace-write", approvalPolicy: "on-request", model: "gpt-6-sol" };
  assert.throws(() => policy.assertThreadTook(sent, { ...threadEcho(sent), model: "gpt-6-luna" }, same),
    /on model `gpt-6-luna` after Dopl asked for `gpt-6-sol`/);
  assert.throws(() => policy.assertThreadTook(sent, { ...threadEcho(sent), model: undefined }, same), /no model Dopl could read/);
  policy.assertThreadTook(sent, { ...threadEcho(sent) }, same);
  const noPick = { cwd: HERE, sandbox: "workspace-write", approvalPolicy: "on-request" };
  policy.assertThreadTook(noPick, { ...threadEcho(noPick), model: "gpt-6-astra" }, same);
  // The reported model may sit on the thread object only.
  policy.assertThreadTook(sent, { ...threadEcho(sent), model: undefined, thread: { id: "t", model: "gpt-6-sol" } }, same);
});

// ── LOW: Dopl's MCP server down → the shared guard, never a tool-free turn ──
test("LOW: a failed Dopl MCP startup reaches the SHARED guard (one retry, then a visible end)", () => {
  const evs = normalizer.normalize({ type: normalizer.ERROR_MESSAGE_TYPE, text: "", mcpStartup: "failed" }, {});
  assert.deepEqual(evs.map((e) => e.type), ["assistant", "mcp_status_report"]);
  const io = require(join(MAIN, "session-io.js"));
  const signal = io.applyCoreEvents({ runtimeId: "codex" }, evs, () => {}, {});
  assert.deepEqual(signal, { type: "mcp_status", status: "failed" });
  const mcpConnect = require(join(MAIN, "mcp-connect.js"));
  assert.equal(mcpConnect.mcpConnectVerdict({ status: "failed", attempt: 0 }), "retry");
  assert.equal(mcpConnect.mcpConnectVerdict({ status: "failed", attempt: 1 }), "fail");
});

// ── LOW: an undeclared notification is drift; a declared-but-unhandled one is routine ──
test("LOW: unknown notifications are drift only when THIS build's own schema does not declare them", async () => {
  sdkShape.forgetShape("codex");
  assert.deepEqual(normalizer.normalize({ method: "brand/newThing", params: {} }, {}), [], "no description yet: no verdict");
  const ad = {
    descriptor: { id: "codex", label: "Codex", requiredShape: { core: { methods: ["turn/start"] } } },
    runtime: { buildIdentity: () => ({ path: "/b", version: "1", account: "a" }), shape: async () => ({ methods: ["turn/start"], notifications: { "item/agentMessage/delta": [] } }) },
  };
  await sdkShape.settleShape(ad);
  assert.deepEqual(normalizer.normalize({ method: "item/agentMessage/delta", params: {} }, {}), [], "declared: routine");
  const drift = normalizer.normalize({ method: "brand/newThing", params: {} }, {});
  assert.equal(drift.length, 1);
  assert.equal(drift[0].type, "shape_drift");
  assert.equal(drift[0].where, "notification:brand/newThing");
  sdkShape.forgetShape("codex");
});

// ── LOW: no capability claimed that the adapter does not drive ──
test("LOW: Codex no longer claims `fork` (no thread/fork path)", () => {
  assert.equal(require(join(MAIN, "runtime", "codex", "index.js")).descriptor.session.fork, false);
});

// ── Reviewer re-check (7854b400) ──
test("M2 residual: an UNKNOWN sandbox field set to false refuses (Dopl cannot tell 'off' from 'restriction off')", () => {
  const same = (a, b) => realpathSync(a) === realpathSync(b);
  const sent = { cwd: HERE, sandbox: "workspace-write", approvalPolicy: "on-request" };
  assert.throws(() => policy.assertThreadTook(sent, { ...threadEcho(sent), sandbox: { type: "workspaceWrite", restrictReads: false } }, same),
    /does not recognise \(restrictReads\)/);
  policy.assertThreadTook(sent, { ...threadEcho(sent), sandbox: { type: "workspaceWrite", futureList: [], futureMap: {}, futureNull: null } }, same);
});

test("M3: a roster row whose id ≠ model launches — the row's MODEL is sent and is what the echo must name", async () => {
  const catalogs = require(join(MAIN, "runtime", "model-catalog.js"));
  const codexModels = require(join(MAIN, "runtime", "codex", "models.js"));
  const launchSpec = require(join(MAIN, "runtime", "codex", "launch-spec.js"));
  catalogs.forget();
  const row = { id: "sol-latest", model: "gpt-6.1-sol-2026-10", displayName: "Sol", isDefault: true };
  assert.equal(codexModels.entryFrom(row).launch, "gpt-6.1-sol-2026-10", "the catalog keeps the row's own model");
  await catalogs.settle({
    descriptor: { id: "codex", label: "Codex", models: { source: "live", dimensions: [] } },
    runtime: { buildIdentity: () => null, models: async () => ({ models: [codexModels.entryFrom(row)] }) },
  });
  try {
    const ts = launchSpec.buildLaunchSpec({
      session: { profile: "full", channelId: "11111111-1111-4111-8111-111111111111", state: { toolMode: "on-request" },
        workspaceId: "ws", model: "sol-latest", containerToken: { token: "t" } },
      dispatch: () => {},
    }).threadStart;
    assert.equal(ts.model, "gpt-6.1-sol-2026-10", "the pick (row id) launches as the row's model");
    const same = (a, b) => realpathSync(a) === realpathSync(b);
    const sent = { ...ts, cwd: HERE };
    policy.assertThreadTook(sent, { ...threadEcho(sent), model: "gpt-6.1-sol-2026-10" }, same);
    assert.throws(() => policy.assertThreadTook(sent, { ...threadEcho(sent), model: "sol-latest" }, same), /on model `sol-latest`/,
      "the echo is compared to what was SENT");
  } finally {
    catalogs.forget();
  }
});

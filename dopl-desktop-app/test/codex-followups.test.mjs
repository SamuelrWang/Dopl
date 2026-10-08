// Reviewer follow-ups on 9b98ddee (2026-10-08): A — a resume after a restart launches the row's own model;
// C — the sandbox echo's known fields are a CLOSED set checked at UPDATE time (a candidate declaring another
// field is refused; the installed build keeps working with a drift note), the launch-time strict echo stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { threadEcho, configEcho } from "./helpers/codex-echo.mjs";

const require = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const CODEX = join(MAIN, "runtime", "codex");
const client = require(join(CODEX, "client.js"));
const catalog = require(join(CODEX, "catalog.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
const codexModels = require(join(CODEX, "models.js"));
const catalogs = require(join(MAIN, "runtime", "model-catalog.js"));
const sdkShape = require(join(MAIN, "runtime", "sdk-shape.js"));
const REQUIRED = require(join(CODEX, "required-shape.js"));
const fixture = require("./fixtures/codex-shape.json");

// ── A ──
test("A: a resume after a restart (no roster held) settles the roster and sends the row's own model", async () => {
  catalogs.forget();
  const row = { id: "sol-latest", model: "gpt-6.1-sol", displayName: "Sol", isDefault: true };
  const realSettle = catalogs.settle;
  let settled = 0;
  catalogs.settle = async () => {
    settled += 1;
    return realSettle({
      descriptor: { id: "codex", label: "Codex", models: { source: "live", dimensions: [] } },
      runtime: { buildIdentity: () => null, models: async () => ({ models: [codexModels.entryFrom(row)] }) },
    });
  };
  const calls = [];
  let hooks = null;
  const fake = {
    async request(method, params) {
      if (method === "config/read") return configEcho(hooks && hooks.args);
      calls.push({ method, params });
      if (method === "thread/resume") return { ...threadEcho(params), thread: { id: "th-old" } };
      return {};
    },
    notify() {},
    close() {},
  };
  const realConnect = client.connect;
  const realCatalog = catalog.writeDelegationFreeCatalog;
  client.connect = (opts) => { hooks = opts; return fake; };
  catalog.writeDelegationFreeCatalog = async (home) => join(home, catalog.CATALOG_FILE);
  // The spec as built at resume time, BEFORE any roster read: the sync resolve could only send the raw pick.
  const spec = launchSpec.buildLaunchSpec({
    session: { key: "c:t:a", profile: "full", channelId: "11111111-1111-4111-8111-111111111111",
      state: { toolMode: "on-request" }, workspaceId: "ws", model: "sol-latest", containerToken: { token: "t" }, resumeSdkId: "th-old" },
    dispatch: () => {},
  });
  assert.equal(spec.threadStart.model, "sol-latest", "sync resolve with nothing held: the raw pick");
  const handle = launchSpec.start(Object.assign({}, spec, {
    cwd: import.meta.dirname, env: {}, args: [], resumeThreadId: "th-old",
    prompt: (async function* idle() { await new Promise(() => {}); })(),
  }));
  try {
    const first = await handle.next();
    assert.equal(first.value.method, "dopl/threadStarted", "the echo checked out");
    const resume = calls.find((c) => c.method === "thread/resume");
    assert.equal(resume.params.model, "gpt-6.1-sol", "the settled roster's row model was sent");
    assert.equal(settled, 1);
  } finally {
    handle.close();
    client.connect = realConnect;
    catalog.writeDelegationFreeCatalog = realCatalog;
    catalogs.settle = realSettle;
    catalogs.forget();
  }
});

// ── C ──
const observedWith = (extra) => ({ paths: fixture.shape.paths.concat(extra || []) });

test("C: the measured build declares only the known sandbox fields — nothing unexpected, nothing refused", () => {
  const v = sdkShape.checkShape(REQUIRED, fixture.shape);
  assert.deepEqual(v.unexpected.safety, []);
  assert.equal(v.refuseUpdate, false);
});

test("C: a schema that ADDS a sandbox field → the UPDATE is refused, the installed build launches (drift names it)", async () => {
  const added = ["result thread/start sandbox.restrictReads", "result thread/resume sandbox.restrictReads"];
  const v = sdkShape.checkShape(REQUIRED, observedWith(added));
  assert.equal(v.refuse, false, "nothing Dopl reads is missing");
  assert.equal(v.refuseUpdate, true, "a candidate with an unknown sandbox field is not adopted");
  assert.deepEqual(v.unexpected.safety, ["result thread/start sandbox.restrictReads", "result thread/resume sandbox.restrictReads"]);

  // The updater: refused, recorded against this requirement, the installed build untouched.
  const updates = require(join(MAIN, "runtime", "updates", "index.js"));
  const { registry, runner, source, setup, record } = await import("./_runtime-updates-harness.mjs");
  const dir = mkdtempSync(join(tmpdir(), "dopl-reg-"));
  setup(registry(dir, "0.4.0"), runner(), { requiredShape: () => REQUIRED });
  const src = source({ probeShape: async () => observedWith(added) });
  assert.equal(await updates.check(src), "incompatible-shape");
  assert.equal(updates.activeFor(src), null, "launches keep the installed build");
  assert.match(record().rejected[0], /^0\.4\.0#shape:/);
  updates.inject();

  // The INSTALLED build with the same field: launches, and the drift ledger names the field.
  sdkShape.forgetShape();
  sdkShape.forgetDrift();
  sdkShape.injectDiag(() => {});
  const ad = { descriptor: { id: "codex", label: "Codex", requiredShape: REQUIRED },
    runtime: { buildIdentity: () => ({ path: "/b", version: "1", account: "a" }), shape: async () => observedWith(added) } };
  assert.equal(await sdkShape.launchShapeRefusal(ad), null);
  assert.match(sdkShape.driftReport("codex").map((d) => d.detail).join(" "), /restrictReads/);
  sdkShape.forgetShape();
});

test("C: the per-launch backstop reads the SAME closed list (one place to add a field)", () => {
  const src = readFileSync(join(CODEX, "policy.js"), "utf8");
  assert.match(src, /require\('\.\/required-shape'\)\.safety\.closed\['result thread\/start sandbox'\]/);
  assert.deepEqual(REQUIRED.safety.closed["result thread/start sandbox"],
    ["type", "networkAccess", "writableRoots", "excludeSlashTmp", "excludeTmpdirEnvVar"]);
});

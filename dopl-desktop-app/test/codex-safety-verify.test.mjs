// CODEX SAFETY VERIFY (2026-10-08, Samuel: "must work right"): every safety setting Dopl sends is READ
// BACK from the build before a session runs, and anything Dopl cannot confirm REFUSES the run.
//   1. `thread/start|resume` echo — approval policy, sandbox (+ network, extra roots), reviewer, cwd.
//   2. the feature fence — every feature Dopl turns off is known, present and effectively off on THIS build.
//   3. the delegation fence — nulls every delegation key by name family, so a rename cannot leave it on.
//   4. an unknown server request — shown in the lane (drift) and asked, never silently denied.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { threadEcho } from "./helpers/codex-echo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const require = createRequire(import.meta.url);
const policy = require(join(CODEX, "policy.js"));
const fenceVerify = require(join(CODEX, "fence-verify.js"));
const catalog = require(join(CODEX, "catalog.js"));
const normalizer = require(join(CODEX, "normalize.js"));
const tools = require(join(CODEX, "tools.js"));

const same = (a, b) => realpathSync(a) === realpathSync(b);
const sent = (over = {}) => ({ cwd: HERE, sandbox: "workspace-write", approvalPolicy: "on-request", ...over });
const took = (params, over = {}) => () => policy.assertThreadTook(params, { ...threadEcho(params), ...over }, same);

// ── 1. the echo ─────────────────────────────────────────────────────────────────────────────

test("echo: the agreeing answer passes, for every sandbox Dopl sends", () => {
  for (const sandbox of Object.keys(policy.SANDBOX_ECHO)) took(sent({ sandbox }))();
  took(sent({ approvalsReviewer: "guardian_subagent" }))();
});

test("echo: a WIDER or different sandbox refuses", () => {
  assert.throws(took(sent({ sandbox: "read-only" }), { sandbox: { type: "workspaceWrite" } }), /sandbox `workspaceWrite` after Dopl asked for `read-only`/);
  assert.throws(took(sent(), { sandbox: { type: "dangerFullAccess" } }), /refusing/);
  assert.throws(took(sent(), { sandbox: { type: "workspaceWrite", networkAccess: true } }), /network access on/);
  assert.throws(took(sent(), { sandbox: { type: "workspaceWrite", writableRoots: ["/"] } }), /extra writable folders/);
});

test("echo: a sandbox Dopl cannot READ refuses — absent, untyped, or an unknown mode asked", () => {
  assert.throws(took(sent(), { sandbox: undefined }), /cannot read/);
  assert.throws(took(sent(), { sandbox: "workspace-write" }), /cannot read/, "a string where the schema says object");
  assert.throws(took(sent({ sandbox: "bogus" })), /cannot read/);
});

test("echo: approvals routed to a reviewer nobody asked for refuses; absent reviewer refuses", () => {
  assert.throws(took(sent(), { approvalsReviewer: "auto_review" }), /routed to `auto_review` after Dopl asked for `user`/);
  assert.throws(took(sent({ approvalsReviewer: "guardian_subagent" }), { approvalsReviewer: "user" }), /refusing/);
  assert.throws(took(sent(), { approvalsReviewer: undefined }), /no reviewer/);
  // The legacy word and its echo are one reviewer.
  took(sent({ approvalsReviewer: "guardian_subagent" }), { approvalsReviewer: "guardian_subagent" })();
});

test("echo: a different working folder refuses; the same folder through a symlink passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-cwd-"));
  const link = join(mkdtempSync(join(tmpdir(), "dopl-cwd-link-")), "here");
  symlinkSync(dir, link);
  took(sent({ cwd: dir }), { cwd: link })();
  assert.throws(took(sent({ cwd: dir }), { cwd: tmpdir() }), /different working folder/);
  assert.throws(took(sent({ cwd: dir }), { cwd: undefined }), /no working folder/);
});

test("echo: no answer at all refuses; the policy check is the same fail-closed one", () => {
  assert.throws(() => policy.assertThreadTook(sent(), null, same), /no answer Dopl could read/);
  assert.throws(took(sent(), { approvalPolicy: undefined }), /without saying which approval policy/);
  assert.throws(took(sent(), { approvalPolicy: "never" }), /approval policy `never` after Dopl asked for `on-request`/);
});

// ── 2. the feature fence ────────────────────────────────────────────────────────────────────

const LISTING = [
  "apps                                     stable             false",
  "goals                                    stable             false",
  "multi_agent                              stable             false",
  "memories                                 under development  false",
  "collaboration_modes                      removed            true",
  "noise that is not a row",
].join("\n");

beforeEach(() => fenceVerify.forget());

test("fence: parse reads one- and two-word stages", () => {
  const rows = fenceVerify.parseFeatures(LISTING);
  assert.deepEqual(rows.memories, { stage: "under development", enabled: false });
  assert.deepEqual(rows.collaboration_modes, { stage: "removed", enabled: true });
  assert.equal(Object.keys(rows).length, 5);
});

test("fence: renamed, removed, kept-on and an empty listing are each a problem; only OFF keys are checked", () => {
  const rows = fenceVerify.parseFeatures(LISTING);
  assert.deepEqual(fenceVerify.fenceProblems({ apps: false, multi_agent: false, plugins: true }, rows), []);
  assert.match(fenceVerify.fenceProblems({ multi_agent_v3: false }, rows)[0], /no longer knows the feature "multi_agent_v3"/);
  assert.match(fenceVerify.fenceProblems({ collaboration_modes: false }, rows)[0], /removed/);
  const keptOn = fenceVerify.parseFeatures("apps stable true");
  assert.match(fenceVerify.fenceProblems({ apps: false }, keptOn)[0], /kept the feature "apps" on/);
  assert.match(fenceVerify.fenceProblems({ apps: false }, {})[0], /listed no features/);
});

test("fence: verify passes the fence as -c overrides, refuses with the cause, and caches per binary + fence", async () => {
  const seen = [];
  const run = async (bin, env, features) => { seen.push(features); return LISTING; };
  const fence = { apps: false, multi_agent: false };
  await fenceVerify.verifyFeatureFence(process.execPath, {}, fence, { run });
  await fenceVerify.verifyFeatureFence(process.execPath, {}, fence, { run });
  assert.equal(seen.length, 1, "one run per (binary, fence)");
  await assert.rejects(fenceVerify.verifyFeatureFence(process.execPath, {}, { hooks: false }, { run }), /no longer knows the feature "hooks"/);
  await assert.rejects(
    fenceVerify.verifyFeatureFence(process.execPath, {}, { apps: false, goals: false, x: false }, { run: async () => { throw new Error("timed out"); } }),
    /could not check Codex's feature switches \(timed out\)/,
  );
  await assert.rejects(fenceVerify.verifyFeatureFence("", {}, fence, { run }), /could not find the Codex build/);
  await fenceVerify.verifyFeatureFence("", {}, { apps: true }, { run }); // nothing turned off: nothing to check
});

test("fence: Dopl's SHIPPED feature fence is what gets verified (every profile turns these off)", () => {
  const cfg = tools.buildSessionToolConfig("full");
  const off = Object.keys(cfg.features).filter((k) => cfg.features[k] === false);
  assert.ok(off.includes("multi_agent") && off.includes("apps") && off.includes("plugins"), off.join(","));
});

// ── 3. the delegation fence ─────────────────────────────────────────────────────────────────

test("delegation: every key in the delegation NAME FAMILY is nulled, so a rename cannot leave it on", () => {
  const [row] = catalog.delegationFree([{
    slug: "m", multi_agent_version: "v2", multi_agent_reasoning_effort: "high",
    subagent_version: "v3", delegation_mode: "auto", context_window: 1000, tool_mode: "x",
  }]);
  assert.equal(row.multi_agent_version, null);
  assert.equal(row.multi_agent_reasoning_effort, null);
  assert.equal(row.subagent_version, null, "a renamed key is still fenced");
  assert.equal(row.delegation_mode, null);
  assert.equal(row.context_window, 1000, "unrelated keys untouched");
  assert.equal(row.tool_mode, "x");
  // A row that never had the key still gets the measured one nulled (the schema default).
  assert.equal(catalog.delegationFree([{ slug: "n" }])[0].multi_agent_version, null);
});

// ── 4. an unknown server request is told to the session ─────────────────────────────────────

test("unknown request: the normalizer turns Dopl's frame into ONE shape-drift event for the shared ledger", () => {
  const out = normalizer.normalize({ method: normalizer.UNKNOWN_REQUEST, params: { method: "item/new/requestApproval" } }, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "shape_drift");
  assert.equal(out[0].where, "server-request");
  assert.match(out[0].detail, /item\/new\/requestApproval/);
});

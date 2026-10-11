// THE CODEX ADAPTER'S LAUNCH SHAPE and the refusals it declares. Split from codex-gate.test.mjs at the
// 500-line cap; the gate half (Axis A/B, containment, the approval answer) stays there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startedStateFor } from "./_session-preset-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const CODEX = join(MAIN, "runtime", "codex");

const profiles = require(join(MAIN, "session-profiles.js"));
const registry = require(join(MAIN, "runtime", "index.js"));
const capability = require(join(MAIN, "runtime", "capability.js"));
const tools = require(join(CODEX, "tools.js"));
const mcp = require(join(CODEX, "mcp.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
// ⚠ READ-ONLY HERE: the packaging pin is compared against `SUPPORTED_CLI`, which client.js owns.
const client = require(join(CODEX, "client.js"));

const D = registry.descriptorFor("codex");
// A Codex session's state as `session-engine.js › startSession` builds it for the button lane.
const codexState = (startModes) => ({ state: startedStateFor({ windowless: true, startModes: { messages: "ask", ...startModes } }, { id: "codex" }) });
const RT = registry.runtimeFor("codex");

// ── THE LAUNCH SHAPE ─────────────────────────────────────────────────────────────────────────

test("a RESTRICTED profile pins the native pair; `full` rides the operator's own picks", () => {
  // The pick arrives on `state.native`, stamped at spawn (F-390: `state.sandboxMode` never had a
  // producer). Containment is not the operator's to widen from the mode picker, and an unreadable
  // pick lands on Codex's own default rather than the widest.
  const restricted = launchSpec.nativePair(
    { state: { toolMode: "never", native: { sandbox_mode: "danger-full-access" } } },
    RT.toolConfigFor("read_only")
  );
  assert.deepEqual(restricted, { approval_policy: "untrusted", sandbox_mode: "read-only" },
    "containment is not the operator's to widen from the mode picker");
  // The state production builds (a hand-built `toolMode: 'on-request'` hid X-01 / P4-02).
  const full = launchSpec.nativePair(
    codexState({ tools: "on-request", native: { sandbox_mode: "danger-full-access" } }),
    RT.toolConfigFor("full")
  );
  assert.deepEqual(full, { approval_policy: "on-request", sandbox_mode: "danger-full-access" },
    "…and at `full` the operator's own pick finally REACHES the launch");
  // An UNRECOGNISED sandbox pick fail-closes to the narrowest, the same answer main's record
  // normalizer gives (X-05); only an ABSENT one takes Codex's own default.
  const bare = launchSpec.nativePair(
    { state: { toolMode: "junk", native: { sandbox_mode: "junk" } } }, RT.toolConfigFor("full")
  );
  assert.deepEqual(bare, { approval_policy: "untrusted", sandbox_mode: "read-only" });
  // ⚠ AND A SESSION STAMPED WITH NO BAG AT ALL IS THE SAME ANSWER — every spawn shape that hands
  // in no posture (a peer wake, a crash resume, a woken shell) keeps exactly today's behaviour.
  assert.deepEqual(launchSpec.nativePair(codexState({ tools: "on-request" }), RT.toolConfigFor("full")),
    { approval_policy: "on-request", sandbox_mode: "workspace-write" });
  // ⚠ THE OLD FIELD NAME IS DEAD AND MUST STAY DEAD: reading it again would restore a control
  // whose value nothing writes.
  assert.deepEqual(
    launchSpec.nativePair({ state: { toolMode: "on-request", sandboxMode: "danger-full-access" } },
      RT.toolConfigFor("full")),
    { approval_policy: "on-request", sandbox_mode: "workspace-write" }
  );
});

test("Auto's reviewer (the app's \"Approve for me\") rides on-request only, and never a restricted profile", () => {
  const auto = { sandbox_mode: "workspace-write", approvals_reviewer: "guardian_subagent" };
  assert.deepEqual(launchSpec.nativePair(codexState({ tools: "on-request", native: auto }), RT.toolConfigFor("full")),
    { approval_policy: "on-request", sandbox_mode: "workspace-write", approvals_reviewer: "guardian_subagent" });
  // A narrower live pick asks a person again; `never` raises nothing to review.
  for (const tools of ["untrusted", "granular", "never"]) {
    assert.equal(launchSpec.nativePair(codexState({ tools, native: auto }), RT.toolConfigFor("full")).approvals_reviewer, undefined, tools);
  }
  assert.equal(launchSpec.nativePair({ state: { toolMode: "on-request", native: auto } }, RT.toolConfigFor("read_only")).approvals_reviewer, undefined);
  // …and the pair's reviewer is what the real launch assembly puts on `thread/start`, or nothing.
  const specFor = (tools) => launchSpec.buildLaunchSpec({
    session: { profile: "full", channelId: null, workspaceId: "ws-1", model: "", ...codexState({ tools, native: auto }) },
    dispatch: () => {},
  });
  assert.equal(specFor("on-request").threadStart.approvalsReviewer, "guardian_subagent");
  assert.ok(!("approvalsReviewer" in specFor("untrusted").threadStart), "no reviewer field when the pair has none");
});

test("`granular` uses the measured structured app-server shape and asks every shown category", () => {
  assert.deepEqual(launchSpec.approvalPolicy("granular"), {
    granular: {
      mcp_elicitations: true,
      rules: true,
      sandbox_approval: true,
      request_permissions: true,
      skill_approval: true,
    },
  });
});

test("the removed `--ignore-user-config` flag is never sent; CODEX_HOME owns isolation", () => {
  const spec = launchSpec.buildLaunchSpec({
    session: { profile: "full", channelId: null, state: {}, workspaceId: "", model: "" },
    dispatch: () => {},
  });
  assert.ok(!spec.args.includes("--ignore-user-config"));
  assert.deepEqual(spec.args, []);
  assert.equal(spec.threadStart.approvalPolicy, "untrusted");
  assert.equal(spec.threadStart.sandbox, "workspace-write");
});

test("the env scrub drops permission knobs and every inherited credential; PATH, HOME and Dopl's own pass", () => {
  const planted = { CODEX_BYPASS_APPROVALS: "1", OPENAI_API_KEY: "sk-inherited", CODEX_API_KEY: "k", ANTHROPIC_API_KEY: "a" };
  const before = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const env = launchSpec.buildScrubbedEnv({ EXTRA: "x" });
    assert.equal(env.CODEX_BYPASS_APPROVALS, undefined, "a permission-shaped knob is dropped");
    for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY"]) assert.equal(env[key], undefined, key);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.HOME, process.env.HOME);
    assert.equal(env.EXTRA, "x", "what the adapter adds itself survives");
  } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("the Dopl MCP entry makes every Dopl call but a whole-tool read ask, and keeps the bearer OFF ARGV", () => {
  const entry = mcp.buildDoplServerEntry(["dopl_channel"]);
  // ⚠ EVERY CALL REACHES THE GATE, INDEPENDENT OF AXIS A — the channel tool because no tool posture
  // can send a message, the write tools because the gate judges them per op. A tool Dopl does not
  // know yet asks too (the default).
  assert.equal(entry.default_tools_approval_mode, "prompt");
  assert.equal(entry.tools.dopl_channel, undefined, "the channel inherits the asking default");
  // Only the whole-tool reads never ask (`approve`; `auto` was MEASURED to ask, CXP-3A).
  const neverAsk = Object.keys(entry.tools).filter((t) => entry.tools[t].approval_mode === "approve");
  const granularReads = require(join(MAIN, "session-dopl-tools.js")).GRANULAR_READ_TOOLS;
  assert.deepEqual(neverAsk.map((t) => `mcp__dopl__${t}`).sort(), profiles.DOPL_READ_TOOLS.concat(granularReads).sort());
  assert.deepEqual(entry.enabled_tools, ["dopl_channel"]);
  // ⚠ A VARIABLE NAME, NEVER A TOKEN. An override carrying the bearer would put the device token
  // on a command line every `ps` on the machine can read.
  assert.equal(entry.bearer_token_env_var, mcp.BEARER_ENV);
  assert.ok(!JSON.stringify(entry).includes("Bearer "), "no literal credential anywhere in the entry");
  // CUSTODY and VENDOR are two facts on two headers — the whole reason step 1 was a second
  // dimension rather than three more enum members.
  assert.equal(entry.http_headers["X-Dopl-Runtime"], "desktop-session");
  assert.equal(entry.http_headers["X-Dopl-Vendor"], "codex");
  const shared = readFileSync(join(HERE, "..", "..", "src", "shared", "auth", "runtime-header.ts"), "utf8");
  const serverCodex = /export const CODEX_VENDOR = "([^"]+)";/.exec(shared);
  assert.ok(serverCodex, "the server's vendor constant moved — this join needs re-pinning");
  assert.equal(entry.http_headers["X-Dopl-Vendor"], serverCodex[1],
    "main claims a vendor value readVendorHeader does not recognize (no shared module across this join)");
});

test("a session with NO token gets NO Dopl entry, and still launches", () => {
  // ⚠ A HALF-BUILT ENTRY THAT 401s ON EVERY CALL IS WORSE THAN NONE: the agent would be told it
  // HAS a delivery path and watch that path fail.
  const wired = mcp.buildMcpEnv("", "", "");
  if (!wired.usable) {
    assert.deepEqual(wired.env, {});
  } else {
    assert.ok(wired.env[mcp.BEARER_ENV], "a usable wiring must carry the bearer in the ENV");
  }
});

// ── REFUSALS THAT ARE DECLARATIONS ───────────────────────────────────────────────────────────

test("resume is ALLOWED on the measured baseline, and the adapter's own door opens with it", () => {
  // 🔒 ⚠ **THE REASON WAS A MEASUREMENT, AND CORE NOW ACTS ON IT** (2026-09-22, `codex-cli
  // 0.155.1`): `thread/tokenUsage/updated.total` CONTINUES across `thread/resume` in a fresh
  // app-server, so the declaration is `false`. Until CXP-4 that was read as disqualifying, because
  // `session-park.js › resumeParked` ZEROED the delta baseline unconditionally and would have
  // re-billed the whole thread. The baseline is runtime-aware now — a `false` runtime has it
  // CARRIED FORWARD — so `false` is a resumable answer and only `'unverified'` still refuses.
  // `codex-live-session.test.mjs` holds the measurement; `session-park-resume-baseline.test.mjs`
  // holds the billing arithmetic and the argument for the change.
  assert.equal(D.session.usageResetsOnResume, false, "the MEASUREMENT has not moved and must not");
  assert.equal(capability.canResume(D), true);
  assert.equal(capability.resumeRefusal(D), null);
  assert.equal(capability.resumeZeroesBaseline(D, null), false,
    "…and what changed is the arithmetic: this runtime's baseline is carried, never zeroed");
  // ⚠ `launch-spec.js › resume` ASKS THAT PREDICATE RATHER THAN RESTATING IT, so its door opened
  // with no edit. Asserted through the predicate rather than by CALLING it — `resume` falls
  // through to `start`, which spawns a real app-server child.
  assert.equal(typeof launchSpec.resume, "function");
});

test("the in-app sign-in is DECLARED (2026-09-23); the tool-search verb is MEASURED", () => {
  // The bundled app-server's own login (`login.js`); called here it would spawn one, so only its shape.
  assert.equal(D.credential.interactiveSignIn, true);
  assert.equal("reprobeOnWake" in D.credential, false, "only Dopl's own sign-in releases a held agent");
  assert.equal(typeof RT.signIn, "function");
  // 🔒 CXP-3A (2026-09-22, 0.155.1): MEASURED, no longer null — Codex defers every MCP tool.
  assert.equal(D.prose.toolSearchVerb, "tool_search", "the measured verb, never Claude's");
  // …and code-mode models reach the same tool through `exec`'s `ALL_TOOLS` (measured, same day).
  assert.deepEqual(capability.mcpDiscovery(D), { verb: "tool_search", catalog: "ALL_TOOLS" }, "no eager-load flag");
});

test("packaging is `bundled`, so the release makes a version claim it can keep", () => {
  // 🔒 ⚠ **THIS CASE ASSERTED `path` UNTIL 2026-09-22**, when Samuel ruled the binary gets bundled
  // — *"i think we should go with the binary. Let's just do it."* The three fields move together
  // or the descriptor is lying: a `bundled` delivery that unpacks nothing ships a binary inside a
  // read-only asar that cannot exec, and one with a null pin ships a protocol build it refuses to
  // name.
  assert.equal(D.packaging.delivery, "bundled");
  assert.ok(Array.isArray(D.packaging.unpackGlobs) && D.packaging.unpackGlobs.length,
    "a bundled runtime must name what the build unpacks");
  assert.equal(D.packaging.signing, "inherits-app-identity",
    "the vendor binaries are re-signed under the app's own identity — notarisation requires it");
  assert.equal(D.packaging.versionPin, "@openai/codex@0.155.1",
    "the pin is the version SUPPORTED_CLI was measured from, and package.json pins it EXACTLY");
});

test("the version pin, the SUPPORTED_CLI floor and the installed dependency are ONE version", () => {
  // ⚠ THREE COPIES OF ONE NUMBER, AND NOTHING ELSE COMPARES THEM. `packaging.versionPin` is what
  // the release CLAIMS, `client.js › SUPPORTED_CLI.measuredFrom` is what the adapter was BUILT
  // against, and `package.json › dependencies['@openai/codex']` is what `npm install` actually
  // PLACES. A bundled delivery is only worth anything if the three agree.
  const pinned = String(D.packaging.versionPin).split("@").pop();
  assert.equal(pinned, client.SUPPORTED_CLI.measuredFrom);
  const dep = JSON.parse(
    readFileSync(join(HERE, "..", "package.json"), "utf8")
  ).dependencies["@openai/codex"];
  assert.equal(dep, pinned, "an EXACT pin, not a caret — a range makes the claim a guess");
});

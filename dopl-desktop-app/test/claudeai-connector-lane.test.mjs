// THE CLAUDE.AI ACCOUNT-CONNECTOR LANE, AND THE ONE SWITCH WE CAN STILL REACH (F-268, 2026-08-22).
//
// ── THE MECHANISM ────────────────────────────────────────────────────────────────────────────
// The CLI has a THIRD MCP lane, beside the two `buildSdkOptions` controls. When the session's
// OAuth credential carries the `user:mcp_servers` scope, the binary fetches
// `GET /v1/mcp_servers` with that Bearer and connects EVERY claude.ai ACCOUNT CONNECTOR as
// `mcp__claude_ai_<Name>__*`. Neither `mcpServers` nor `settingSources` covers it.
//
// ⚠ AND `settingSources: []` IS WHAT REMOVED THE OFF SWITCH. The CLI's own kill switch is the
// `disableClaudeAiConnectors` SETTING, and our isolation is exactly what stops it being read.
// Tightening the sandbox took the switch away. The ENV VAR is the lever that survives.
// ⚠ `--strict-mcp-config` IS NOT AN ALTERNATIVE: it hard-errors on machines carrying an
// enterprise `managed-mcp.json`, so it trades a leak for a launch failure on exactly the fleet
// least able to debug it. This suite pins that it has not crept in.
//
// ── THE MEASUREMENT (2026-08-22), WHICH IS THE REAL ASSERTION ─────────────────────────────────
// ⚠ NOTHING IN THIS FILE CAN PROVE THE LANE IS OFF, AND THE HEADER SAYS SO RATHER THAN LETTING A
// GREEN RUN IMPLY IT. The only authority is the CLI's own `system`/`init` message and its
// `mcp_servers` array; a unit test can assert what we HAND the child, never what the child then
// does with it. So the empirical run is recorded here, dated, with the command that reproduces it:
//
//   BIN=node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude   # claude 2.1.220
//   [ENABLE_CLAUDEAI_MCP_SERVERS=<v>] "$BIN" --print --output-format stream-json --verbose \
//     --max-turns 1 "Reply with the single word OK and nothing else."
//   # then read the init message's `mcp_servers`
//
//   VALUE          TOTAL SERVERS   claude.ai CONNECTORS   dopl SERVER
//   (unset)             12                  9              present
//   ''                  12                  9              present     <- ⚠ NOT a suppression
//   '0'                  3                  0              present
//   'false'              3                  0              present
//
// The nine were Slack, Figma, Dopl, Attio, Notion, Granola, Google Drive, Google Calendar and
// Gmail — an inventory of the operator's connected accounts, in a prompt that can be auto-sent.
//
// ⚠ POLARITY IS INVERTED AND EMPTY IS A SILENT NO-OP. The binary's eligibility chain is
// `if (su(process.env.ENABLE_CLAUDEAI_MCP_SERVERS) || <setting>) return {}` where `su` is
// "explicitly set FALSY": `['0','false','no','off']`. So the var named ENABLE_ *disables*, and
// `''`, `'1'` and unset all leave the lane ON. **A future edit that "clears" the var instead of
// setting it re-admits nine servers and nothing would fail.** That is the case below.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
// ⚠ NOT CONTAINMENT, and the entry says so twice for a reason. Execution was never reachable:
// every connector tool is unclassified, `AUTO_TOOLS`/`BYPASS_TOOLS` are positive allow-lists, so
// `grantDecision` gates it and a windowless session answers a gate with a deny
// (`test/session-tool-name-prefix.test.mjs` pins all 12 profile x mode cells). What this removes
// is the OFFERED SURFACE: the inventory leak and the per-turn token cost of carrying it.
//
// Run: `node --test dopl-desktop-app/test/claudeai-connector-lane.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const LOADER = read("runtime/claude/loader.js");
// ⚠ 2026-08-31 (runtime-adapter port): the OPTION ASSEMBLY is the runtime adapter's — one
// platform's option vocabulary is that platform's to own. What this pins is unchanged.
const QUERY = read("runtime/claude/launch-spec.js");
const AUTH = read("session-auth.js");
const FRAMING_TEXT = read("prompt-framing-text.js");

// The measured falsy set the bundled binary's `su()` accepts. Anything outside it is a NO-OP.
const SU_FALSY = ["0", "false", "no", "off"];

// sdk-loader.js is electron-bound (`app.getPath`), so the builder is source-extracted and driven
// with a fake `process` — the idiom this directory already uses (sdk-grant / sdk-mcp-token).
const SCRUB = (() => {
  const from = LOADER.indexOf("const PERMISSION_ENV_RE");
  assert.notEqual(from, -1, "PERMISSION_ENV_RE anchor missing from sdk-loader.js");
  const body = LOADER.slice(from, LOADER.indexOf("module.exports = {"));
  assert.ok(body.includes("function buildScrubbedEnv()"), "buildScrubbedEnv slice incomplete");
  return new Function("process", `${body}\n return buildScrubbedEnv;`);
})();
const scrubWith = (env) => SCRUB({ env })();

// ── 1. THE SUPPRESSION REACHES THE CHILD ENV ─────────────────────────────────────────────────

test("the assembled child env carries the connector-lane suppression", () => {
  const out = scrubWith({ PATH: "/usr/bin", HOME: "/Users/x" });
  assert.equal(out.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
});

test("it is set even when the parent env has never heard of the var", () => {
  // The ordinary case: a desktop launched from Finder inherits nothing about this lane, so the
  // var has to be MINTED here rather than merely preserved.
  const out = scrubWith({});
  assert.ok(Object.keys(out).includes("ENABLE_CLAUDEAI_MCP_SERVERS"), "the key exists at all");
  assert.equal(out.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
});

test("it OVERRIDES an inherited value — a parent env cannot re-admit the lane", () => {
  // ⚠ The name does not match PERMISSION_ENV_RE, so an inherited value copies straight through
  // the scrub loop. The assignment has to be the LAST word or the parent wins.
  for (const inherited of ["1", "true", "on", "yes", "", "0", "anything"]) {
    const out = scrubWith({ ENABLE_CLAUDEAI_MCP_SERVERS: inherited });
    assert.equal(out.ENABLE_CLAUDEAI_MCP_SERVERS, "0", `inherited=${JSON.stringify(inherited)}`);
  }
});

test("the VALUE is one the binary reads as falsy — and '' would not be", () => {
  // The trap this case exists for: `su('')` is FALSE, so clearing the var is not disabling it.
  // Measured 2026-08-22 — `''` left all nine connectors connected.
  const value = scrubWith({}).ENABLE_CLAUDEAI_MCP_SERVERS;
  assert.ok(SU_FALSY.includes(value),
    `${JSON.stringify(value)} is not in the binary's falsy set ${JSON.stringify(SU_FALSY)}`);
  assert.ok(!SU_FALSY.includes(""), "empty string is NOT a suppression — do not 'clear' this var");
  assert.equal(typeof value, "string", "env values are strings; a boolean would stringify to 'true'");
});

test("the exported constants are the ones the builder actually uses", () => {
  // A second literal is how the value and the name drift apart. One definition, exported so a
  // doc or a sibling test cannot restate it.
  const loader = { CLAUDEAI_MCP_ENV: null, CLAUDEAI_MCP_OFF: null };
  loader.CLAUDEAI_MCP_ENV = /CLAUDEAI_MCP_ENV = '([^']+)'/.exec(LOADER)?.[1];
  loader.CLAUDEAI_MCP_OFF = /CLAUDEAI_MCP_OFF = '([^']+)'/.exec(LOADER)?.[1];
  assert.equal(loader.CLAUDEAI_MCP_ENV, "ENABLE_CLAUDEAI_MCP_SERVERS");
  assert.equal(loader.CLAUDEAI_MCP_OFF, "0");
  assert.match(LOADER, /out\[CLAUDEAI_MCP_ENV\] = CLAUDEAI_MCP_OFF;/,
    "the builder must use the constants, not a repeated literal");
  assert.match(LOADER, /CLAUDEAI_MCP_ENV,[\s\S]{0,120}CLAUDEAI_MCP_OFF,/,
    "both are exported");
});

test("the scrub's existing jobs are untouched", () => {
  // A new assignment at the end of the builder must not have disturbed the two properties this
  // function already had: permission knobs dropped, auth vars preserved.
  const out = scrubWith({
    CLAUDE_CODE_DANGEROUSLY_SKIP_PERMISSIONS: "1",
    ANTHROPIC_BYPASS_PERMISSIONS: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "tok",
    ANTHROPIC_API_KEY: "key",
    ANTHROPIC_BASE_URL: "https://x",
    PATH: "/usr/bin",
    HOME: "/Users/x",
  });
  assert.equal(out.CLAUDE_CODE_DANGEROUSLY_SKIP_PERMISSIONS, undefined, "permission knob dropped");
  assert.equal(out.ANTHROPIC_BYPASS_PERMISSIONS, undefined, "permission knob dropped");
  assert.equal(out.CLAUDE_CODE_OAUTH_TOKEN, "tok", "auth preserved");
  assert.equal(out.ANTHROPIC_API_KEY, "key", "auth preserved");
  assert.equal(out.ANTHROPIC_BASE_URL, "https://x", "auth preserved");
  assert.equal(out.PATH, "/usr/bin");
});

// ── 2. THE SHAPE THAT CROSSES INTO query() CANNOT RE-ADMIT THE LANE ───────────────────────────
// ⚠ Asserting the env alone is NECESSARY AND NOT SUFFICIENT (§11's own rule). The env is only
// suppressive if it is still the object that reaches `query()`, and only meaningful if nothing
// else in the option set re-opens the lane. These are the joins.

test("the env that reaches query() is the SCRUBBED one, through the one assembly point", () => {
  assert.match(QUERY, /env: sessionAuth\.withStoredCredential\(loader\.buildScrubbedEnv\(\)\)/,
    "the launch spec must build options.env from buildScrubbedEnv — nothing else");
  const opts = QUERY.slice(QUERY.indexOf("function buildOptions("));
  const body = opts.slice(0, opts.indexOf("\nfunction ", 1));
  assert.equal((body.match(/^\s*env:/gm) || []).length, 1, "exactly one env assignment");
  assert.equal(/options\.env\s*=/.test(body), false, "and nothing rewrites it afterwards");
});

test("withStoredCredential ADDS a key and never replaces the env object", () => {
  // If it ever returned a fresh object built from `process.env`, the suppression would be
  // dropped on the one machine (stored-token) that takes its non-identity branch.
  const fn = fnOf(AUTH, "withStoredCredential");
  const make = (state, token) =>
    new Function("credentialState", "getStoredOAuthToken", `${fn}\n return withStoredCredential;`)(
      () => state, () => token
    );
  const base = { ENABLE_CLAUDEAI_MCP_SERVERS: "0", PATH: "/usr/bin" };
  // The pass-through machines: the SAME object back, byte for byte.
  for (const source of ["env", "cli-store", null]) {
    const out = make({ usable: true, source }, "tok")({ ...base });
    assert.equal(out.ENABLE_CLAUDEAI_MCP_SERVERS, "0", `source=${source}`);
  }
  // The injecting machine: one key added, the suppression intact.
  const injected = make({ usable: true, source: "stored-token" }, "tok")({ ...base });
  assert.equal(injected.CLAUDE_CODE_OAUTH_TOKEN, "tok", "the setup-token still lands");
  assert.equal(injected.ENABLE_CLAUDEAI_MCP_SERVERS, "0", "…and does not cost the suppression");
});

test("the option set names exactly one MCP server, and no connector lane among them", () => {
  assert.match(LOADER, /return \{ dopl: server \};/, "buildMcpServers ships one entry");
  assert.equal(/claude_ai/i.test(LOADER.replace(/^\/\/.*$/gm, "")), false,
    "no connector server is constructed in code (comments may name the lane)");
});

test("`settingSources: []` is still pinned, and it is WHY the env var is needed", () => {
  // Not a regression pin on its own — the join. The empty setting sources are what make
  // `disableClaudeAiConnectors` unreadable, so this line and the env var have to move together:
  // anyone who re-admits setting sources should reconsider the var, and vice versa.
  assert.match(QUERY, /settingSources: \[\],/, "settingSources is still the empty array");
  assert.match(LOADER, /disableClaudeAiConnectors/,
    "sdk-loader must keep stating why the setting cannot be our lever");
});

test("`--strict-mcp-config` has NOT crept in as a second answer", () => {
  // Considered and rejected: it hard-errors on enterprise machines carrying managed-mcp.json.
  // If it ever lands, this case is where the trade gets re-argued.
  for (const [name, src] of [["runtime/claude/launch-spec.js", QUERY], ["runtime/claude/loader.js", LOADER]]) {
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/strictMcpConfig/.test(code), false, `${name}: strictMcpConfig option`);
  }
});

// ── 3. THE FRAMING BELT ──────────────────────────────────────────────────────────────────────

test("the framing tells the agent which lane is real, and obeys the house scanners", () => {
  const { LANE_EXCLUSIVITY } = require(join(MAIN, "prompt-framing-text.js"));
  const text = LANE_EXCLUSIVITY.join("\n");
  assert.match(text, /ONLY path off this machine/, "states exclusivity");
  assert.match(text, /mcp__dopl__/, "names the real prefix");
  assert.match(text, /Slack/, "names a concrete decoy the operator actually has connected");
  assert.match(text, /never use one to reach a person/, "states the prohibition as an imperative");
  // §H-13 house voice, and prompt-framing.test.mjs scans every line naming dopl_channel.
  for (const line of LANE_EXCLUSIVITY) {
    assert.ok(!line.includes("—"), `em dash in ${JSON.stringify(line)}`);
    assert.ok(!/\btask\s*=/.test(line), `teaches task= in ${JSON.stringify(line)}`);
  }
  // FIXED TEXT: it lives in the text module and interpolates nothing, so it can never carry a
  // forged fence token — the property that makes that file's whole contents safe.
  assert.equal(/\$\{/.test(FRAMING_TEXT.slice(FRAMING_TEXT.indexOf("const LANE_EXCLUSIVITY"))), false,
    "LANE_EXCLUSIVITY must interpolate nothing");
});

test("the belt actually reaches a built turn, on BOTH sides", () => {
  const framing = require(join(MAIN, "prompt-framing.js"));
  const context = {
    channelId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    channelName: "acme",
  };
  for (const side of ["requester", "responder"]) {
    const out = framing.buildFencedTurn({ side, message: "x", nonce: "f268", context });
    assert.match(out, /ONLY path off this machine/, `${side}: the belt is in the turn`);
    // It belongs to FIRST ACTIONS, above the delivery section, like the grant sentence it extends.
    const first = out.indexOf("FIRST ACTIONS THIS TURN");
    const belt = out.indexOf("ONLY path off this machine");
    assert.ok(first >= 0 && belt > first, `${side}: the belt sits inside FIRST ACTIONS`);
  }
});

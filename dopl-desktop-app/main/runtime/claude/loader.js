// Claude Agent SDK loader — the CLAUDE ADAPTER's platform half.
//
// Core never requires this module; it asks `main/runtime/index.js` instead.
//
// ⚠ The SINGLE module that touches the ESM-only SDK, so CJS->ESM interop and packaged-binary
// path math live in exactly one place (contract §D).
//   getSdk() / peekSdk()       cached dynamic import() of the ESM SDK / its sync read (null pre-await)
//   resolveClaudeExecutable()  the binary a new launch runs (a verified download, else the asar-unpacked
//                              bundle) for options.pathToClaudeCodeExecutable
//   buildSecretPathDenyRules() credential-path deny rules every session runs with
//   buildScrubbedEnv()         the child env: permission knobs and credentials dropped, lane pins set
//
// ⚠ Dynamic import, not require: the SDK ships `sdk.mjs` (ESM only) and Electron main is CJS,
// so a static require throws ERR_REQUIRE_ESM.
// ⚠ asar rewrite: the 256 MB `claude` Mach-O cannot exec from inside the read-only app.asar and
// codesign cannot sign a file inside it, so it is `asarUnpack`ed. require.resolve still reports
// the in-asar path. A dev/unpackaged tree has no `app.asar` segment and is unchanged.
// The session's MCP entry (bearer, headers, stamps) is `mcp.js`'s.

const path = require('path');
const { app } = require('electron');
const cliSpawn = require('../cli-spawn');
const { diag } = require('../../diag');
// F-692: the CLI's ONE connect-timeout knob, and its measured default. Pure module, no electron.
const mcpConnect = require('../../mcp-connect');
const updates = require('../updates');
const updateSource = require('./update-source');

const SDK_PKG = '@anthropic-ai/claude-agent-sdk';

let _sdk = null; // cached ESM namespace

// CJS->ESM bridge, cached once. Throws (caught by the caller) only when the package is
// genuinely absent — the engine then reports {skipped:'no-sdk'}.
async function getSdk() {
  if (!_sdk) _sdk = await import(SDK_PKG);
  return _sdk;
}

// The SYNC read of that cache, for SYNCHRONOUS option assembly (agent-self-ops.js builds an
// in-process server inside `launch-spec.js › buildOptions`, which every query path reaches only AFTER awaiting
// getSdk). ⚠ NULL BEFORE THE FIRST AWAIT IS THE CONTRACT, not an error: a caller answers "no
// SDK extras this session" and the launch proceeds — never throw a launch over a display verb.
function peekSdk() {
  return _sdk;
}

// The bundled `claude` executable, `{ path, version }`, or null. The platform binary ships as
// `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` (an optionalDependency, host-arch only) with a
// `claude` file at its package root; `version` is that package's (the SDK's `exports` map hides its own).
function bundledClaude() {
  const platformPkg = `${SDK_PKG}-${process.platform}-${process.arch}`;
  try {
    const pkgJson = require.resolve(`${platformPkg}/package.json`);
    const bin = path.join(path.dirname(pkgJson), 'claude');
    return { path: cliSpawn.rewriteAsarUnpacked(bin), version: String(require(pkgJson).version || '?') };
  } catch (err) {
    diag('sdk-loader: platform binary unresolved', platformPkg, err && err.message);
    return null;
  }
}

// The binary a NEW launch runs, `{ path, version }`, or null (engine falls back to headless): a verified
// download newer than the bundle (`../updates/index.js`), else the bundle. A running session keeps the
// binary it was spawned from.
function claudeRuntime() {
  return updates.activeFor(updateSource) || bundledClaude();
}

// Absolute path for options.pathToClaudeCodeExecutable, or null.
function resolveClaudeExecutable() {
  const runtime = claudeRuntime();
  return runtime ? runtime.path : null;
}

// ⚠ Tool-BOUND half of the same fix. A pre-approved tool never reaches grantDecision, so this
// deny must ride options.disallowedTools (the SDK's rule layer). Fences the two credential
// directories: userData (the safeStorage-encrypted electron-store; mcp-spawn.json USED to live
// here and no longer exists) and ~/.claude* (CLI config + keychain-adjacent state). Rules are
// gitignore-style: an absolute path takes the `//` filesystem-root prefix, `~/` is home. Applied
// to EVERY profile, because every profile pre-approves the local reads. `Read` is load-bearing;
// Grep/Glob are belt.
// ⚠ THE LIST IS PATH-TOOLS ONLY, AND `Bash` CANNOT JOIN IT — not an oversight. Claude Code's
// `Bash` rules match COMMAND STRINGS (`Bash(npm run build)`, `Bash(git *)`), so a generated
// `Bash(//Users/…/**)` would match no command and deny nothing while reading as coverage. The
// answer for a secret Bash can reach is to not put the secret on disk; see
// `mcp-config.js › removeSpawnConfig`.
const SECRET_TOOLS = ['Read', 'Grep', 'Glob'];
const SECRET_HOME_PATHS = ['~/.claude*', '~/.claude/**'];
function buildSecretPathDenyRules() {
  const paths = SECRET_HOME_PATHS.slice();
  try {
    const userData = app.getPath('userData');
    if (userData) paths.unshift('//' + String(userData).replace(/^\/+/, '') + '/**');
  } catch (_) { /* no app yet (harness) — the home rules still apply */ }
  const rules = [];
  for (const tool of SECRET_TOOLS) {
    for (const p of paths) rules.push(`${tool}(${p})`);
  }
  return rules;
}

// FIX M2 — a scrubbed copy of process.env for options.env.
// ⚠ The SDK's options.env REPLACES the child env entirely, so every var is copied and only the
// permission-affecting knobs that would short-circuit canUseTool are dropped — and only when
// the key is ALSO CLAUDE_CODE_* / ANTHROPIC_*, so unrelated app env is untouched.
// ⚠ Every inherited credential is dropped too (`cli-spawn.js › scrubbedEnv`); the session's one credential is
// added by `credential.js › withCredential`. With none, the binary falls back to the operator's own keychain
// login, which is why every spawn is preflighted (`session-auth.js › holdIfNoRuntimeCredential`).
const PERMISSION_ENV_RE = /PERMISSION|BYPASS|ACCEPT_EDITS|DONT_ASK|SKIP_PERMISSIONS|AUTO_APPROVE|DANGEROUS/i;

// ⚠ THE THIRD MCP LANE, AND THE ONLY LEVER WE HAVE LEFT ON IT (2026-08-22, F-268).
// `mcpServers` and `settingSources` do NOT cover it. When the session's OAuth credential carries
// the `user:mcp_servers` scope, the CLI fetches `GET /v1/mcp_servers` with that Bearer and
// connects EVERY claude.ai ACCOUNT CONNECTOR as `mcp__claude_ai_<Name>__*`. Measured 2026-08-22
// against the bundled binary (claude 2.1.220 / claude-agent-sdk 0.3.220): the init message's
// `mcp_servers` listed 12 servers, NINE of them connectors (Slack, Gmail, Google Calendar, Google
// Drive, Figma, Granola, Notion, Attio, Dopl) that no launch option asked for.
// ⚠ THE SETTINGS KILL SWITCH IS UNREADABLE TO US, WHICH IS THE IRONY: the CLI's own off switch is
// the `disableClaudeAiConnectors` SETTING, and `settingSources: []` — our isolation — is exactly
// what stops it being read. Tightening the sandbox removed the switch. The env var is the lever
// that survives, and `--strict-mcp-config` is NOT an alternative (it hard-errors on machines with
// an enterprise managed-mcp.json).
// ⚠ POLARITY IS INVERTED AND EMPTY IS A NO-OP. The binary's eligibility chain is
// `if (su(process.env.ENABLE_CLAUDEAI_MCP_SERVERS) || <setting>) return {}`, where `su` is
// "explicitly set FALSY" — `['0','false','no','off']`. So the var DISABLES the lane, and `''`,
// `'1'` or unset all leave it ON. Measured, same run: unset -> 9 connectors, `''` -> 9,
// `'0'` -> 0, `'false'` -> 0, with the `dopl` server itself untouched in every case.
// ⚠ SET LAST AND UNCONDITIONALLY, so an inherited `ENABLE_CLAUDEAI_MCP_SERVERS=1` in the parent
// env cannot re-admit the lane. It does not match PERMISSION_ENV_RE and would otherwise copy
// straight through the loop above.
// ⚠ CONTAINMENT ALREADY HELD — this is the OFFERED SURFACE, not execution. Every connector tool
// is unclassified, so `grantDecision` gates it and a windowless session denies it
// (`test/session-tool-name-prefix.test.mjs`). What this removes is an inventory of the operator's
// connected accounts sitting in a prompt that can be auto-sent, and its per-turn token cost.
const CLAUDEAI_MCP_ENV = 'ENABLE_CLAUDEAI_MCP_SERVERS';
const CLAUDEAI_MCP_OFF = '0';
function buildScrubbedEnv() {
  const out = cliSpawn.scrubbedEnv(process.env, /^(CLAUDE_CODE_|ANTHROPIC_)/, PERMISSION_ENV_RE);
  out[CLAUDEAI_MCP_ENV] = CLAUDEAI_MCP_OFF; // last word, always — see the block above
  // ── ⚠ THE MCP CONNECT BUDGET (F-692, 2026-09-13) ─────────────────────────────────────────────
  //
  // MEASURED IN THE BUNDLED BINARY (claude 2.1.220 / claude-agent-sdk 0.3.220): the connect timeout
  // is `function(){ let e = Z.MCP_CONNECT_TIMEOUT_MS; return e && e > 0 ? e : 5000 }`, an INT env
  // var with a 5000 default, and it is in the binary's own passthrough env table. ⚠ THERE IS NO
  // CLI FLAG — the binary ships exactly one mcp flag, `--mcp-config`; `--mcp-timeout` does not
  // exist. The two neighbours are different clocks: `MCP_TIMEOUT` (default 30000) is the per-server
  // STARTUP budget and `MCP_TOOL_TIMEOUT` the per-CALL one, which the entry's own `timeout` field
  // already sets (`buildMcpServers`).
  //
  // 5000 is what the F-692 incident blew: a cold `/api/mcp` answered in 10–16s, so the child
  // abandoned the `dopl` server, `alwaysLoad` released the launch anyway, and every
  // `mcp__dopl__*` call came back "No such tool available" for the life of the session.
  // ⚠ THE PRE-FLIGHT IS THE FIX AND THIS IS THE BELT (`session-query.js › startQuery` warms the
  // route first). Raising the budget alone would only make the FIRST launch slow instead of mute.
  // ⚠ SET LAST AND UNCONDITIONALLY, on `ENABLE_CLAUDEAI_MCP_SERVERS`'s rule directly above: an
  // inherited value in the parent env must not decide a session's containment-adjacent timing, and
  // neither name matches PERMISSION_ENV_RE so both would otherwise copy straight through.
  out[mcpConnect.CLI_CONNECT_TIMEOUT_ENV] = String(mcpConnect.CLI_CONNECT_TIMEOUT_MS);
  return out;
}

module.exports = {
  getSdk,
  peekSdk, // sync read of the cached namespace — null pre-await, by contract (agent-self-ops)
  bundledClaude,
  claudeRuntime,
  resolveClaudeExecutable,
  buildSecretPathDenyRules, // credential-path deny every session runs with
  buildScrubbedEnv,
  CLAUDEAI_MCP_ENV, // F-268: the connector lane's only reachable off switch
  CLAUDEAI_MCP_OFF,
};

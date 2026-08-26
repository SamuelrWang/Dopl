// Claude Agent SDK loader.
//
// ⚠ The SINGLE module that touches the ESM-only SDK, so CJS->ESM interop and packaged-binary
// path math live in exactly one place (contract §D).
//   getSdk()                   cached dynamic import() of the ESM SDK
//   resolveClaudeExecutable()  asar-unpacked path for options.pathToClaudeCodeExecutable
//   buildMcpServers(cfg, wsId) in-memory mcpServers object (dopl bearer from safeStorage +
//                              the session's X-Workspace-Id pin)
//   buildSecretPathDenyRules() credential-path deny rules every session runs with
//
// ⚠ Dynamic import, not require: the SDK ships `sdk.mjs` (ESM only) and Electron main is CJS,
// so a static require throws ERR_REQUIRE_ESM.
// ⚠ asar rewrite: the 256 MB `claude` Mach-O cannot exec from inside the read-only app.asar and
// codesign cannot sign a file inside it, so it is `asarUnpack`ed. require.resolve still reports
// the in-asar path. A dev/unpackaged tree has no `app.asar` segment and is unchanged.
// ⚠ The dopl bearer NEVER hits logs/argv: it stays inside the returned in-memory mcpServers
// object, held by safeStorage, never read back off disk (§H-7).

const path = require('path');
const { app } = require('electron');
const { MCP_URL } = require('./config');
const { diag } = require('./diag');

const SDK_PKG = '@anthropic-ai/claude-agent-sdk';

let _sdk = null; // cached ESM namespace

// CJS->ESM bridge, cached once. Throws (caught by the caller) only when the package is
// genuinely absent — the engine then reports {skipped:'no-sdk'}.
async function getSdk() {
  if (!_sdk) _sdk = await import(SDK_PKG);
  return _sdk;
}

// In-asar path -> its asar.unpacked twin. Pure string transform (testable without electron).
// No `app.asar` segment => unchanged; an already-`.unpacked` path is left alone by the
// negative lookahead.
function rewriteAsarUnpacked(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

// Absolute path to the bundled `claude` executable, or null (engine falls back to headless).
// The platform binary ships as `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` (an
// optionalDependency, host-arch only) with a `claude` file at its package root.
function resolveClaudeExecutable() {
  const platformPkg = `${SDK_PKG}-${process.platform}-${process.arch}`;
  try {
    const pkgJson = require.resolve(`${platformPkg}/package.json`);
    const bin = path.join(path.dirname(pkgJson), 'claude');
    return rewriteAsarUnpacked(bin);
  } catch (err) {
    diag('sdk-loader: platform binary unresolved', platformPkg, err && err.message);
    return null;
  }
}

// ⚠ THE DEVICE TOKEN STAYS OFF DISK ON THE SDK PATH. `Read` is PRE-APPROVED on all three
// session profiles, so the SDK SHADOWS it and the call never reaches canUseTool — a plaintext
// bearer in userData/mcp-spawn.json is liftable with ZERO operator clicks. The bearer comes
// from mcp-config's safeStorage-held cache straight into the in-memory object. The file
// survives ONLY for the CLI path (session-spawner's --mcp-config, manual `claude` runs), and
// buildSecretPathDenyRules below keeps the pre-approved read tools out of it.
function doplBearer() {
  // ⚠ Lazy require: mcp-config pulls in auth/session-spawner, and an unwired harness (or a
  // pre-sign-in launch) must read as "no token", never throw into a launch.
  try {
    return require('./mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

// ⚠ ONE DEFINITION of the per-server call timeout: mcp-config owns the number (it writes the
// same key into the spawn-config file) and derives it from the server's await budget. Never
// restate the literal here. Lazy like doplBearer, and only reached after it proved mcp-config
// loads.
function clientTimeoutMs() {
  return require('./mcp-config').MCP_CLIENT_TIMEOUT_MS;
}

// ⚠ Tool-BOUND half of the same fix. A pre-approved tool never reaches grantDecision, so this
// deny must ride options.disallowedTools (the SDK's rule layer). Fences the two credential
// directories: userData (mcp-spawn.json + the safeStorage-encrypted electron-store) and
// ~/.claude* (CLI config + keychain-adjacent state). Rules are gitignore-style: an absolute
// path takes the `//` filesystem-root prefix, `~/` is home. Applied to EVERY profile, because
// every profile pre-approves the local reads. `Read` is load-bearing; Grep/Glob are belt.
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

// The in-memory mcpServers object (replaces the --mcp-config file).
// ⚠ `doplToolsPolicy` is ACCEPTED AND DELIBERATELY NOT FORWARDED — see the block at the end of
// this function. No token (pre-sign-in) => {}, so the session still runs.
//
// ⚠ The url is ALWAYS the compiled-in MCP_URL. A `dopl.url || MCP_URL` read trusts a value off
// disk, so any local process rewriting that file repoints the session's whole MCP surface —
// bearer included — at its own endpoint.
//
// WORKSPACE PIN: the session's workspace UUID rides as `X-Workspace-Id`. The device credential
// can span workspaces and a multi-workspace connection has NO default, so a call omitting
// `workspace=` is refused. The MCP endpoint resolves the header against the caller's own
// memberships (src/app/api/mcp/route.ts -> packages/mcp-server factory). ⚠ GRANTS nothing: the
// pin must match an existing membership, and a per-call `workspace=` still wins. ⚠ UUID only,
// never a slug — two prod workspaces can share a slug. Omitted when there is no session
// workspace.
// 🔒 CONTAINER LOCK (plan §4.4 B1): `bearerOverride`, when present, REPLACES the device token
// for this session — a child credential locked to one workspace, minted by
// `session-credential.js` at spawn and revoked at settle. Everything else about the entry is
// identical, and that is the point: the lock is not a header or a flag the agent could rewrite,
// it is which credential the session was handed. `X-Workspace-Id` below stays a HINT that grants
// nothing; the locked token is what REFUSES another workspace, server-side, in
// `with-workspace-auth.ts`. An empty/absent override falls back to the device token, so every
// unlocked session is byte-for-byte unchanged.
function buildMcpServers(doplToolsPolicy, workspaceId, bearerOverride) {
  const override = typeof bearerOverride === 'string' ? bearerOverride.trim() : '';
  const token = override || doplBearer();
  if (!token) return {};
  const server = {
    type: 'http',
    url: MCP_URL,
    // Per-server `timeout`, honoured by claude 2.1.220 / claude-agent-sdk 0.3.220: aborts a
    // tool call whose RESPONSE HEADERS have not arrived by
    // min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647) ms.
    // ⚠ It can only RAISE the abort above the 60s floor, never lower it, and it ALSO lowers the
    // hard tool-call ceiling from ~1e8 ms to this value. Belt-and-braces against a
    // not-yet-deployed server or a buffering proxy (/api/mcp now streams, F-092).
    // ⚠ The VALUE is derived in mcp-config.js — never restate it here.
    timeout: clientTimeoutMs(),
    // ⚠ `alwaysLoad` keeps the dopl tools OUT of `ToolSearch` deferral. Verified on the bundled
    // runtime: tool search defaults ON (no ENABLE_TOOL_SEARCH => `tst`, and buildScrubbedEnv
    // strips only permission knobs), and `isDeferredTool` returns TRUE for EVERY MCP tool
    // (`if (isMcp) return true`) unless server or tool carries `alwaysLoad`. The per-server
    // `tools` policy exempts nothing — it is a PERMISSION policy, not a load policy. Deferral
    // is skipped wholesale only when ToolSearch is absent from the offered set.
    // Without this, `full` (which has ToolSearch) gets `dopl_channel` — the session's DELIVERY
    // PATH — as a bare name needing a ToolSearch call the prompt forbids by name and that gates
    // in every Axis-A mode, `bypass` included: "I do not have the mcp__dopl__dopl_channel tool".
    // Also blocks launch until the server connects (MCP startup is non-blocking by default, so
    // the turn-1 prompt could be built before it did), capped by the CLI's 5s connect timeout.
    // NO-OP for read_only / dopl_only, which still deny ToolSearch.
    alwaysLoad: true,
    headers: {
      Authorization: `Bearer ${token}`,
      // RUNTIME DISAMBIGUATION: every MCP call a DESKTOP-SPAWNED session makes carries this;
      // the operator's EXTERNAL Claude Code session (same device credential, own `claude`
      // process) does not. `runtime` is a RESERVED server-side metadata key — a body copy is
      // stripped and the stamp is written only for this exact header value.
      // ⚠ ROUTING HINT, NOT AUTHORIZATION (src/shared/auth/runtime-header.ts): anything holding
      // this device token can set it, so it PROVES nothing about the caller. Nothing may be
      // GRANTED on it. Unconditional — it identifies the RUNTIME, not the workspace.
      'X-Dopl-Runtime': 'desktop-session',
    },
  };
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) server.headers['X-Workspace-Id'] = pin;
  // ⚠ NEVER SET `server.tools`. The per-server `tools` field is a PERMISSION policy —
  // `{ name, permission_policy?, org_max_permission? }[]` (sdk.d.ts McpHttpServerConfig /
  // McpServerToolPolicy) — not a visibility allowlist, and it exempts nothing from ToolSearch
  // deferral. Worse, the CLI zod-validates `--mcp-config` PER ENTRY and a failed safeParse
  // DROPS THE WHOLE SERVER: `Skipped — invalid MCP server config for "dopl": tools.0: …`.
  // Observed against the bundled binary (--print --output-format stream-json --verbose, init
  // message's `mcp_servers`):
  //     tools: ['dopl_channel']           ->  "mcp_servers": []   <- entry GONE
  //     tools: [{ name: 'dopl_channel' }] ->  "mcp_servers": [{"name":"dopl",…}]
  //     tools omitted                     ->  "mcp_servers": [{"name":"dopl",…}]
  // Passing the short names left every read_only / dopl_only session with NO dopl server and
  // no delivery path. The same bound is already carried by SDK `disallowedTools`, whose
  // complement over the server's real surface IS the intended allowlist, and everything
  // surviving it still stops at canUseTool. `doplToolsPolicy` stays in the SIGNATURE so
  // session-query's call shape and the profile table are untouched — deliberately unread.
  // Pinned by test/mcp-server-tools-policy.test.mjs.
  return { dopl: server };
}

// WHICH SESSION IS CALLING, stamped onto an entry buildMcpServers just made. One device
// credential is held by many concurrent sessions BY DESIGN, and nothing else on the wire says
// which of them wrote a message. The server strips any caller-supplied `metadata.session_id`
// and stamps the reserved key ONLY from this header — same discipline as X-Dopl-Runtime.
//
// ⚠ SEPARATE FUNCTION on purpose: buildMcpServers answers "what MCP server does this app
// offer" — the same answer for every spawn, which mcp-config.js writes ONCE into the shared
// spawn config the headless `--mcp-config` path reads, where a per-session value cannot live.
// This answers "which run is calling", knowable only on the in-memory SDK path.
//
// ⚠ A LABEL, NOT A LOCK: nothing granted, nothing enforced, no session count limited. An absent
// or malformed slot stamps NOTHING. SHAPE mirrors the server's own
// (src/shared/auth/session-header.ts: id characters only, no whitespace, <=128).
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
function withSessionStamp(servers, sessionId) {
  const slot = typeof sessionId === 'string' ? sessionId.trim() : '';
  const entry = servers && typeof servers === 'object' ? servers.dopl : null;
  // ⚠ A LABEL MUST NEVER BREAK A LAUNCH. Runs inside buildSdkOptions, the ONE assembly point
  // every spawn shape goes through, so a throw takes the whole session down for an attribution
  // hint. The guards are unreachable today (buildMcpServers always ships `headers`) and exist
  // so a future entry without one stamps nothing instead of crashing the spawn.
  // MUTATES IN PLACE: the call site ignores the return value.
  if (entry && typeof entry === 'object' && slot && SESSION_ID_RE.test(slot)) {
    entry.headers = entry.headers || {};
    entry.headers['X-Dopl-Session-Id'] = slot;
  }
  return servers;
}

// FIX M2 — a scrubbed copy of process.env for options.env.
// ⚠ The SDK's options.env REPLACES the child env entirely, so every var is copied and only the
// permission-affecting knobs that would short-circuit canUseTool are dropped — and only when
// the key is ALSO CLAUDE_CODE_* / ANTHROPIC_*, so unrelated app env is untouched.
// ⚠ AUTH IS PRESERVED: the bundled binary authenticates from the macOS keychain even under a
// fully-stripped env (apiKeySource=none), and CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY /
// ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL do not match the permission pattern. PATH / HOME /
// keychain access are never removed.
const PERMISSION_ENV_RE = /PERMISSION|BYPASS|ACCEPT_EDITS|DONT_ASK|SKIP_PERMISSIONS|AUTO_APPROVE|DANGEROUS/i;

// ⚠ THE THIRD MCP LANE, AND THE ONLY LEVER WE HAVE LEFT ON IT (2026-08-22, F-268).
// `mcpServers` and `settingSources` do NOT cover it. When the session's OAuth credential carries
// the `user:mcp_servers` scope, the CLI fetches `GET /v1/mcp_servers` with that Bearer and
// connects EVERY claude.ai ACCOUNT CONNECTOR as `mcp__claude_ai_<Name>__*`. Measured 2026-08-22
// against the bundled binary (claude 2.1.220 / claude-agent-sdk 0.3.220): the init message's
// `mcp_servers` listed 12 servers, NINE of them connectors (Slack, Gmail, Google Calendar, Google
// Drive, Figma, Granola, Notion, Attio, Dopl) that no option in `buildSdkOptions` asked for.
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
  const src = process.env || {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (/^(CLAUDE_CODE_|ANTHROPIC_)/.test(k) && PERMISSION_ENV_RE.test(k)) continue; // drop permission knobs
    out[k] = src[k];
  }
  out[CLAUDEAI_MCP_ENV] = CLAUDEAI_MCP_OFF; // last word, always — see the block above
  return out;
}

module.exports = {
  getSdk,
  resolveClaudeExecutable,
  buildMcpServers,
  withSessionStamp, // F2: this run's slot key, onto the entry above
  buildSecretPathDenyRules, // credential-path deny every session runs with
  buildScrubbedEnv,
  CLAUDEAI_MCP_ENV, // F-268: the connector lane's only reachable off switch
  CLAUDEAI_MCP_OFF,
};

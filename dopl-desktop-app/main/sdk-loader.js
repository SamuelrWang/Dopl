// Claude Agent SDK loader (v1.9 Session Window, Track T1).
//
// The SINGLE module that touches the ESM-only SDK, so the CJS->ESM interop and the
// packaged-binary path math live in exactly one place (contract §D).
//   getSdk()                  cached dynamic import() of the ESM SDK
//   resolveClaudeExecutable() the asar-unpacked path for options.pathToClaudeCodeExecutable
//   buildMcpServers(cfg, wsId) the in-memory mcpServers object (dopl bearer from
//                              mcp-spawn.json + the session's X-Workspace-Id pin)
//
// WHY dynamic import (research §0 / §D): the SDK ships `sdk.mjs` (ESM only) but the
// Electron main process is CJS. A static `require` throws ERR_REQUIRE_ESM; a dynamic
// `import()` is the standard CJS->ESM bridge and Electron 43 (Node 20/22) supports
// it. We import only what the engine needs (`query`, `AbortError`).
//
// WHY the asar rewrite (research R1): the 256 MB `claude` Mach-O cannot exec from
// inside the read-only app.asar and codesign cannot sign a file inside it, so the
// binary is `asarUnpack`ed. require.resolve still reports the in-asar path, so we
// rewrite `app.asar` -> `app.asar.unpacked` where the real, signed binary lives. In
// dev / an unpackaged tree there is no `app.asar` segment and the path is unchanged.
//
// The dopl bearer NEVER hits logs/argv: it stays inside the returned in-memory
// mcpServers object, read straight from mcp-spawn.json (§H-7).

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { MCP_URL } = require('./config');
const { diag } = require('./diag');

const SDK_PKG = '@anthropic-ai/claude-agent-sdk';

let _sdk = null; // cached ESM namespace

// Standard CJS->ESM bridge, cached once. Throws (caught by the caller) only if the
// package is genuinely absent — the engine then reports {skipped:'no-sdk'}.
async function getSdk() {
  if (!_sdk) _sdk = await import(SDK_PKG);
  return _sdk;
}

// Rewrite an in-asar path to its asar.unpacked twin. Pure string transform, so it
// is trivially correct and testable without electron. A path with no `app.asar`
// segment (dev / unpackaged) is returned unchanged; an already-`.unpacked` path is
// left alone by the negative lookahead.
function rewriteAsarUnpacked(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

// The absolute path to the bundled `claude` executable, or null when it cannot be
// located (the engine then falls back — headless remains the fallback executor).
// The platform binary ships as `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`
// (an optionalDependency, host-arch only) with a `claude` file at its package root.
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

// The in-memory mcpServers object (research §4 — replaces the --mcp-config file).
// Reads the dopl bearer + URL straight out of mcp-spawn.json (written mode-600 by
// mcp-config.js). `doplToolsPolicy` (a non-null array) becomes the per-server
// `tools` allowlist so a restricted profile only sees its scoped dopl tools. When
// the file is absent (rare — pre-sign-in) returns {} so the session still runs.
//
// v2.x WORKSPACE PIN. `workspaceId` (the SESSION's workspace UUID) rides as the
// `X-Workspace-Id` request header. The device credential can span several
// workspaces, and a multi-workspace connection has NO default: every dopl call
// that omitted `workspace=` came back refused ("This connection has no default
// workspace ... pass workspace=<slug_or_id>"), which is half of why a spawned
// agent could not deliver. The MCP endpoint reads that header as a per-request
// pin and resolves it against the caller's own memberships
// (src/app/api/mcp/route.ts -> packages/mcp-server factory), so pinning it here
// auto-targets every call the session makes even when the model forgets the arg.
// It GRANTS nothing new: the pin must match a membership the credential already
// has, and a per-call `workspace=` still wins (the server resolves the arg first
// and runs that handler in its own scope). UUID only, never a slug — two prod
// workspaces can share a slug. Omitted entirely when there is no session
// workspace, which leaves today's behavior untouched.
function buildMcpServers(doplToolsPolicy, workspaceId) {
  const file = path.join(app.getPath('userData'), 'mcp-spawn.json');
  let dopl;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    dopl = parsed && parsed.mcpServers && parsed.mcpServers.dopl;
  } catch (_) {
    return {};
  }
  if (!dopl || !dopl.headers || !dopl.headers.Authorization) return {};
  const server = {
    type: 'http',
    url: dopl.url || MCP_URL,
    headers: { Authorization: dopl.headers.Authorization },
  };
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) server.headers['X-Workspace-Id'] = pin;
  if (Array.isArray(doplToolsPolicy)) server.tools = doplToolsPolicy;
  return { dopl: server };
}

// FIX M2 — a scrubbed copy of process.env for options.env. The SDK's options.env
// REPLACES the child env entirely (research §1: you must spread process.env
// yourself), so we copy every var and DELETE only the permission-affecting knobs an
// operator might have exported that would short-circuit canUseTool — a dangerous
// default permission MODE, or BYPASS / ACCEPT_EDITS / DONT_ASK / SKIP_PERMISSIONS /
// AUTO_APPROVE / DANGEROUS toggles — but ONLY when the key is also CLAUDE_CODE_* /
// ANTHROPIC_* (so unrelated app env is untouched). AUTH IS PRESERVED: the research
// proved the bundled binary authenticates from the macOS keychain even under a
// fully-stripped env (apiKeySource=none), and the auth-critical vars do NOT match
// the permission pattern — CLAUDE_CODE_OAUTH_TOKEN (the setup-token fallback),
// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (deliberate key auth), ANTHROPIC_BASE_URL
// (gateway) all pass through. PATH / HOME / keychain access are never removed.
const PERMISSION_ENV_RE = /PERMISSION|BYPASS|ACCEPT_EDITS|DONT_ASK|SKIP_PERMISSIONS|AUTO_APPROVE|DANGEROUS/i;
function buildScrubbedEnv() {
  const src = process.env || {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (/^(CLAUDE_CODE_|ANTHROPIC_)/.test(k) && PERMISSION_ENV_RE.test(k)) continue; // drop permission knobs
    out[k] = src[k];
  }
  return out;
}

module.exports = {
  getSdk,
  resolveClaudeExecutable,
  rewriteAsarUnpacked,
  buildMcpServers,
  buildScrubbedEnv,
};

// Claude Agent SDK loader (v1.9 Session Window, Track T1).
//
// The SINGLE module that touches the ESM-only SDK, so the CJS->ESM interop and the
// packaged-binary path math live in exactly one place (contract §D).
//   getSdk()                  cached dynamic import() of the ESM SDK
//   resolveClaudeExecutable() the asar-unpacked path for options.pathToClaudeCodeExecutable
//   buildMcpServers(cfg, wsId) the in-memory mcpServers object (dopl bearer from
//                              safeStorage + the session's X-Workspace-Id pin)
//   buildSecretPathDenyRules() the credential-path deny rules every session runs with
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
// mcpServers object, held by safeStorage and never read back off disk (§H-7, C1).

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

// C1 (HIGH-2) — THE DEVICE TOKEN IS OFF DISK FOR THE SDK PATH. buildMcpServers used to
// read userData/mcp-spawn.json, a mode-600 file carrying a 90-day dopl.read+dopl.write
// bearer. `Read` is PRE-APPROVED on all three session profiles, which means the SDK
// SHADOWS it and the call never reaches canUseTool at all: an injected agent could lift
// that token with ZERO operator clicks and then act as this device against the Dopl API,
// bypassing every control the session window offers. The bearer now comes from
// mcp-config's safeStorage-held cache and is injected straight into this in-memory
// object, so a session spawn needs no plaintext credential on disk. The file survives
// ONLY for the CLI path (session-spawner's --mcp-config, manual `claude` runs), and
// buildSecretPathDenyRules below keeps the pre-approved read tools out of it.
function doplBearer() {
  // Lazily required: mcp-config pulls in auth/session-spawner, and an unwired harness
  // (or a pre-sign-in launch) must read as "no token", never throw into a launch.
  try {
    return require('./mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

// Q9 — ONE DEFINITION of the per-server call timeout. mcp-config owns the number
// (it writes the same key into the spawn-config file) and derives it from the
// server's own await budget; this module used to restate the literal, which is
// exactly how the two drifted. Lazy for the same reason doplBearer is lazy, and
// only ever reached AFTER doplBearer has already proven mcp-config loads.
function clientTimeoutMs() {
  return require('./mcp-config').MCP_CLIENT_TIMEOUT_MS;
}

// C1 — the tool-BOUND half of the same fix. A pre-approved tool never reaches our gate,
// so this deny has to ride options.disallowedTools (the SDK's rule layer), not
// grantDecision. It fences the two directories that hold credentials on this machine:
// userData (mcp-spawn.json + the safeStorage-encrypted electron-store) and ~/.claude*
// (the CLI's own config + its keychain-adjacent state). Rules are gitignore-style, so an
// absolute path takes the `//` (filesystem-root) prefix and `~/` is the home dir. Applied
// to EVERY profile, because every profile pre-approves the local reads. `Read` is the
// load-bearing entry; the Grep/Glob twins are belt (an unrecognized rule is a harmless
// no-op on this CLI, which is why naming them costs nothing).
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

// The in-memory mcpServers object (research §4 — replaces the --mcp-config file).
// `doplToolsPolicy` (a non-null array) becomes the per-server `tools` allowlist so a
// restricted profile only sees its scoped dopl tools. With no token (pre-sign-in)
// returns {} so the session still runs, exactly as the missing-file case used to.
//
// C2 (HIGH-3): the url is ALWAYS the compiled-in MCP_URL. The old `dopl.url || MCP_URL`
// trusted a value read back off disk, so any local process that rewrote that file could
// point the session's whole MCP surface — bearer included — at its own endpoint.
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
  const token = doplBearer();
  if (!token) return {};
  const server = {
    type: 'http',
    url: MCP_URL,
    // FIX Q9. Claude Code 2.1.220 (bundled by @anthropic-ai/claude-agent-sdk 0.3.220,
    // the version this app ships) HONOURS a per-server `timeout`: it aborts a tool call
    // whose RESPONSE HEADERS have not arrived by
    // min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647) ms, reporting
    // the bare string "The operation timed out." Two nuances that make this a deliberate
    // choice rather than a free knob: the key can only RAISE that abort above the 60s
    // floor, never lower it; and it ALSO lowers the hard tool-call ceiling from ~1e8 ms
    // to this value. Both are fine here — this entry is in-memory and ours alone.
    // /api/mcp used to buffer (enableJsonResponse), so the 60s bound covered the WHOLE
    // call and every op="await" died at exactly 60s — before the ~2min mark where the
    // client backgrounds a pending call, the one thing that wakes an idle session. The
    // route now STREAMS (headers flush at t≈0, F-092), which is the real fix for every
    // client. This field stays as belt-and-braces: it protects spawns against a
    // not-yet-deployed server or a buffering proxy, and costs nothing once headers
    // stream. The VALUE is derived in mcp-config.js — never restate it here.
    timeout: clientTimeoutMs(),
    headers: {
      Authorization: `Bearer ${token}`,
      // WAKE-V1 RUNTIME DISAMBIGUATION. Every MCP call a DESKTOP-SPAWNED session makes
      // carries this header; the operator's EXTERNAL Claude Code session (same device
      // credential, its own `claude` process) does not send it. `runtime` is a RESERVED
      // metadata key server-side — a caller-supplied value in the message body is
      // stripped, and the stamp is written only for this exact header value — so
      // metadata.runtime === 'desktop-session' says a desktop-shaped runtime posted it.
      //
      // A ROUTING HINT, NOT AN AUTHORIZATION SIGNAL (see src/shared/auth/runtime-header.ts).
      // Anything holding this device token can set the header, so the stamp PROVES
      // nothing about who is calling; it only labels the expected origin. What makes
      // targeting.requesterTaskOpen safe is that it fails CLOSED (no stamp -> no window
      // at all) on top of the conjunct that does carry identity: the message's
      // authorUserId is the operator themselves, and the thread is one they created.
      // Nothing may be GRANTED on this header. Unconditional: it identifies the RUNTIME,
      // not the workspace, so it rides even without a pin.
      'X-Dopl-Runtime': 'desktop-session',
    },
  };
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) server.headers['X-Workspace-Id'] = pin;
  if (Array.isArray(doplToolsPolicy)) server.tools = doplToolsPolicy;
  return { dopl: server };
}

// F2 — WHICH SESSION IS CALLING, stamped onto an entry buildMcpServers just made.
//
// One `channel_agents` row can be claimed by any number of concurrent processes
// holding this device's credential — `as_agent` is per-call and ownership-checked
// only — and on THIS machine that is BY DESIGN: session-store's `slotKey` gives a
// ROOM session (channel, agent) and a PAIR session (channel, thread) disjoint
// keys, so one handle legitimately runs several at once. Nothing on the wire said
// which of them wrote a message, so two sessions posted as one handle and gave a
// peer contradictory instructions 79 seconds apart with nothing able to attribute
// either. The header closes that: the server strips any caller-supplied
// `metadata.session_id` and stamps the reserved key ONLY from this header — the
// identical discipline X-Dopl-Runtime is on, one lane over.
//
// A SEPARATE FUNCTION, and the seam is real rather than cosmetic. buildMcpServers
// answers "what MCP server does this app offer", which is the same answer for
// every spawn — mcp-config.js writes that same shape ONCE, to the shared spawn
// config the headless `--mcp-config` path reads, where a per-session value could
// not live at all. This answers "which run is calling", which only the in-memory
// SDK path can know (session-query.js has the session record and therefore its
// slot). Keeping them apart is what stops the second question being asked of a
// shared config file that cannot answer it.
//
// A LABEL, NOT A LOCK: nothing is granted by it, nothing is enforced on it, and no
// session count is limited anywhere. An absent or malformed slot stamps NOTHING,
// which is byte-for-byte today's request — the SHAPE is the server's own
// (`src/shared/auth/session-header.ts`: id characters only, no whitespace, <=128),
// mirrored here so an unsendable value is never put on the wire, exactly as
// app-version.js does with VERSION_RE.
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
function withSessionStamp(servers, sessionId) {
  const slot = typeof sessionId === 'string' ? sessionId.trim() : '';
  const entry = servers && typeof servers === 'object' ? servers.dopl : null;
  // A LABEL MUST NEVER BREAK A LAUNCH. This runs inside buildSdkOptions, the ONE
  // assembly point every spawn shape goes through, so a throw here would take the
  // whole session down for an attribution hint. buildMcpServers always ships a
  // `headers` object, which is why the two guards below are unreachable TODAY —
  // they are here so a future entry that arrives without one (or a non-object in
  // `dopl`) stamps nothing instead of crashing the spawn. MUTATES IN PLACE: the
  // call site ignores the return value.
  if (entry && typeof entry === 'object' && slot && SESSION_ID_RE.test(slot)) {
    entry.headers = entry.headers || {};
    entry.headers['X-Dopl-Session-Id'] = slot;
  }
  return servers;
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
  withSessionStamp, // F2: this run's slot key, onto the entry above
  buildSecretPathDenyRules, // C1: the credential-path deny every session runs with
  buildScrubbedEnv,
};

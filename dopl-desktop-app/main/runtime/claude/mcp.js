// MCP REGISTRATION — ⚠ TWO MECHANISMS, NOT ONE, AND CONFLATING THEM WAS A REAL DESIGN ERROR.
//
//   SESSION TRANSPORT   what the SPAWNED session gets. Built in memory, per launch, never a file
//                       and never a CLI verb: `› buildMcpServers` + `› withSessionStamp` below.
//                       This is the lane Axis B's whole enforcement story depends on, because the
//                       Dopl MCP server is remote HTTP — the desktop main process is NOT in the
//                       call path of a channel call, so the held permission callback is the only
//                       thing between the model and that endpoint.
//   HOST REGISTRATION   the OPERATOR's own user-scope entry, so their manual runs of this CLI can
//                       reach Dopl too. A CLI verb here (`main/mcp-cli-add.js`, which NEVER edits
//                       the runtime's config file directly), with policy in `main/mcp-config.js`.
//
// ⚠ THE OPERATOR'S ENTRY IS DELIBERATELY UNSTAMPED. `addMcpEntry` sends `Authorization` and
// nothing else — a manual run in the operator's own terminal is NOT a session this app spawned,
// and claiming the desktop custody stamp for it would be the exact confusion that stamp removes.
//
// ⚠ THE POLICY LAYER STAYS IN CORE AND THIS FILE ONLY NAMES THE LANE. `mcp-config.js` owns
// add / leave-alone / repair-on-origin-drift, and it owns `MCP_CLIENT_TIMEOUT_MS` — the ONE
// definition of the per-server call timeout, derived from the server's own await budget.
// `› clientTimeoutMs` reads that constant rather than restating it, because it drifted once already by
// restating it, and moving the builder must not sever that.
// ⚠ The dopl bearer NEVER hits logs/argv: it stays inside the returned in-memory mcpServers
// object, held by safeStorage, never read back off disk (§H-7).

const { MCP_URL } = require('../../config');
// ⚠ The one fail-closed read of a profile name, shared with the deny list this session was
// spawned under — see `withToolProfileStamp`. `tool-profiles.js` is electron/fs/path-free.
const { normalizeProfile } = require('../../tool-profiles');
// DMP-013: the tool-set header. Pure module, no electron.
const mcpConnect = require('../../mcp-connect');

const cliAdd = () => require('../../mcp-cli-add');

// ── SESSION TRANSPORT: the in-memory entry every spawn carries ───────────────────────────────

// ⚠ THE DEVICE TOKEN STAYS OFF DISK, FULL STOP. `Read` is PRE-APPROVED on all three session
// profiles, so the SDK SHADOWS it and the call never reaches canUseTool — a plaintext bearer in
// userData/mcp-spawn.json was liftable with ZERO operator clicks. The bearer comes from
// mcp-config's safeStorage-held cache straight into the in-memory object.
// ⚠ THAT FILE IS GONE (2026-08-26): `mcp-config.js › removeSpawnConfig` deletes it on every
// signed-in launch and nothing writes it, so it no longer "survives for the CLI path" — the
// headless spawner that read it was deleted 2026-08-20, and manual `claude` runs use the CLI's
// own user-scope entry. `tools.js › buildSecretPathDenyRules` still fences userData for the encrypted
// electron-store, but it is no longer the thing standing between an agent and this credential —
// see removeSpawnConfig for why a `Bash` rule could never have been that thing.
function doplBearer() {
  // ⚠ Lazy require: mcp-config pulls in auth/session-spawner, and an unwired harness (or a
  // pre-sign-in launch) must read as "no token", never throw into a launch.
  try {
    return require('../../mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

// ⚠ ONE DEFINITION of the per-server call timeout: mcp-config owns the number and derives it
// from the server's await budget. Never restate the literal here — the entry below is the only
// Dopl MCP entry this process builds, and it drifted once already by restating it. Lazy like
// doplBearer, and only reached after it proved mcp-config loads.
function clientTimeoutMs() {
  return require('../../mcp-config').MCP_CLIENT_TIMEOUT_MS;
}

// The in-memory mcpServers object (replaces the --mcp-config file).
// ⚠ `doplToolsPolicy` is ACCEPTED AND DELIBERATELY NOT FORWARDED AS `server.tools` — see the
// block at the end of this function. What the server IS told is the profile's NAME, one header,
// stamped by `withToolProfileStamp` below. No token (pre-sign-in) => {}, so the session runs.
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
    // Without this, a profile offering ToolSearch would get `dopl_channel` — the session's DELIVERY
    // PATH — as a bare name needing a ToolSearch call the prompt forbids by name and that gates
    // in every Axis-A mode, `bypass` included: "I do not have the mcp__dopl__dopl_channel tool".
    // ⚠ ITS LIVE JOB TODAY IS THE OTHER ONE: it BLOCKS LAUNCH UNTIL THE SERVER CONNECTS (MCP
    // startup is non-blocking by default, so the turn-1 prompt could be built before it did —
    // F-692), capped by the connect budget below. No profile offers ToolSearch any more
    // (`read_only` / `dopl_only` deny it, `full` / `channel_agent` bound it out), and the CLI
    // skips deferral wholesale without it ("ToolSearchTool is not available"), so every Dopl tool
    // loads either way.
    // ⚠ WHY NOT PER-TOOL `_meta["anthropic/alwaysLoad"]` ON THE GRANULAR CORE 8 (DMP-013,
    // measured in the bundled CLI 0.3.220): it would defer nothing here (no ToolSearch), and only
    // THIS flag routes the server through the blocking connect. `MCP_CONNECTION_NONBLOCKING=0`
    // would block too, but trading a pinned field for an env knob buys no context. Kept.
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
      // ⚠ THE SECOND DIMENSION, AND IT IS NOT A RUNTIME VALUE (2026-08-31, adapter port step 1).
      // The stamp above is CUSTODY — "the desktop app spawned this" — and stays true for a
      // Dopl-driven Codex or Cursor session. Three live sites compare the custody word by strict
      // equality or array membership (`packages/mcp-server/src/tools/identity.ts › runtimeWord`,
      // `packages/mcp-server/src/tools/channel-wake-guidance.ts`, `main/targeting.js ›
      // DESKTOP_RUNTIMES`), so putting a vendor word THERE would silently flip all three for
      // every non-Claude session. VENDOR is what the MCP server's PROSE branches on — which tool
      // verb exists, which name prefix, whether an await wakes anything.
      // ⚠ Absent is a legal answer server-side and must stay one: an older build sends only the
      // custody stamp, and `desktop-session` never implies Claude.
      'X-Dopl-Vendor': 'claude',
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
  // ⚠ THE SERVER-SIDE HALF OF THE SAME IDEA IS A HEADER, NOT THIS FIELD (2026-09-02). The
  // profile's NAME rides as `X-Dopl-Tool-Profile` (`withToolProfileStamp`), and the MCP server
  // decides what a name means. That inverts what failed here: the CLI validated a per-entry
  // tool LIST and dropped the whole server on a bad one, whereas a name it does not recognize
  // is served the whole surface. Nothing is granted on it either way.
  return { dopl: server };
}

// WHICH SESSION IS CALLING, stamped onto an entry buildMcpServers just made. One device
// credential is held by many concurrent sessions BY DESIGN, and nothing else on the wire says
// which of them wrote a message. The server strips any caller-supplied `metadata.session_id`
// and stamps the reserved key ONLY from this header — same discipline as X-Dopl-Runtime.
//
// ⚠ SEPARATE FUNCTION on purpose: buildMcpServers answers "what MCP server does this app
// offer" — the same answer for every spawn, and for years that answer was ALSO serialized into a
// shared on-disk spawn config where a per-session value could not have been correct for the
// sessions that later read it. (That file is gone — `mcp-config.js › removeSpawnConfig` — but
// the seam it forced is the right one and stays.) This answers "which run is calling", knowable
// only on the in-memory SDK path.
//
// ⚠ A LABEL, NOT A LOCK: nothing granted, nothing enforced, no session count limited. An absent
// or malformed slot stamps NOTHING. SHAPE mirrors the server's own
// (src/shared/auth/session-header.ts: id characters only, no whitespace, <=128).
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
function withSessionStamp(servers, sessionId) {
  const slot = typeof sessionId === 'string' ? sessionId.trim() : '';
  const entry = servers && typeof servers === 'object' ? servers.dopl : null;
  // ⚠ A LABEL MUST NEVER BREAK A LAUNCH. Runs inside `launch-spec.js › buildOptions`, the ONE assembly point
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

// HOW CONTAINED THIS SESSION IS, stamped onto an entry buildMcpServers just made. The desktop
// already computes a containment profile per session and enforces it LOCALLY (`tool-profiles.js`,
// `disallowedTools`, the permission gate); the server never heard the word, so a session that
// will never be allowed to call a single Dopl tool still paid for all 13 tools' descriptions
// and input schemas on connection. This is that one word.
//
// ⚠ IT MAY ONLY NARROW, AND IT GRANTS NOTHING. The MCP server's table
// (`packages/mcp-server/src/gating.ts › PROFILE_TOOLS`) maps each value to the tools that
// profile is offered, and a value it cannot place resolves to the NARROWEST profile — never to
// the whole surface. ⚠ SO A NEW PROFILE NAME IS A TWO-SIDED CHANGE: this side stamping a name
// the server has not learned yet narrows that session to nothing, which is why
// `test/tool-profile-stamp.test.mjs` holds `KNOWN_PROFILES` inside the server's own vocabulary,
// read out of its source. Only an ABSENT header serves everything. Nothing may be GRANTED on
// this value; a LABEL, exactly like the runtime, vendor and session-id stamps beside it.
//
// ⚠ SEPARATE FUNCTION for `withSessionStamp`'s reason: `buildMcpServers` answers "what MCP
// server does this app offer" — the same answer for every spawn — and this answers something
// about THIS run. ⚠ It normalizes through `tool-profiles.js › normalizeProfile`, the same
// fail-closed read the deny list was built from, so the header can never name a wider profile
// than the one the session is actually contained at.
//
// MUTATES IN PLACE: the call site ignores the return value.
const TOOL_PROFILE_HEADER = 'X-Dopl-Tool-Profile';
function withToolProfileStamp(servers, profile) {
  const entry = servers && typeof servers === 'object' ? servers.dopl : null;
  // ⚠ A LABEL MUST NEVER BREAK A LAUNCH — same rule as the session stamp: this runs inside
  // `launch-spec.js › buildOptions`, the one assembly point every spawn shape goes through.
  if (entry && typeof entry === 'object') {
    entry.headers = entry.headers || {};
    entry.headers[TOOL_PROFILE_HEADER] = normalizeProfile(profile);
  }
  return servers;
}

// WHICH TOOL SET this session asked for (DMP-013), stamped onto the same entry. Only `granular`
// adds a header (`mcp-connect.js › toolSetHeaders`), and only once the server advertised it; the
// default sends nothing, so a legacy entry is byte-for-byte what it was. MUTATES IN PLACE.
function withToolSetStamp(servers, toolSet) {
  const entry = servers && typeof servers === 'object' ? servers.dopl : null;
  if (entry && typeof entry === 'object') entry.headers = Object.assign(entry.headers || {}, mcpConnect.toolSetHeaders(toolSet));
  return servers;
}

// ── HOST REGISTRATION ────────────────────────────────────────────────────────────────────────


/** Add or repair the operator's own user-scope entry for this runtime. */
function registerMcp(cfg) {
  return cliAdd().addMcpEntry(cfg);
}

/**
 * ⚠ ABSENT AND UNKNOWN ARE DIFFERENT ANSWERS, and this lane can tell them apart: the CLI's own
 * `get` verb exits non-zero with a "no such server" line, which is CONFIRMED ABSENT, while a
 * missing binary or an unreadable config is UNKNOWN. A probe that collapses the two makes
 * "repair the entry" indistinguishable from "do not touch the operator's config".
 */
function probeMcp() {
  return cliAdd().probeMcpEntry();
}

// Descriptor half.
const descriptor = {
  sessionTransport: 'http',
  hostRegistration: 'cli-verb',
  probe: true,
  toolNamePrefix: 'mcp__<server>__<tool>',
  // ⚠ null: this runtime has no per-MCP-tool approval policy. The per-server `tools` field it
  // DOES have is a PERMISSION policy, not a visibility allowlist, and setting it made the CLI
  // drop the whole server entry — `› buildMcpServers` carries that measurement.
  perToolApproval: null,
  // ⚠ THE EAGER-LOAD FLAG IS LOAD-BEARING, NOT AN OPTIMISATION. Without it the channel tool —
  // the session's DELIVERY PATH — arrives deferred behind this runtime's tool-search verb, and
  // the session declares it does not have the tool.
  eagerLoadFlag: 'alwaysLoad',
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp,
  probeMcp,
  descriptor,
  buildMcpServers,
  withSessionStamp, // F2: this run's slot key, onto the entry above
  withToolProfileStamp, // this run's containment profile, onto the same entry — narrowing-only
  withToolSetStamp, // DMP-013: the negotiated tool set, onto the same entry — granular only
  TOOL_PROFILE_HEADER,
};

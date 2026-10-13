// MCP ON THIS RUNTIME — ⚠ THE SESSION TRANSPORT IS `in-process`: DOPL MAKES THE CALL.
//
//   SESSION TRANSPORT   Dopl's tools are `local.customTools` (`axis-b.js`), so the desktop is in the
//                       call path — the reason Axis B has an enforcement point here at all.
//   HOST REGISTRATION   nothing to write (`registerMcp`): servers go inline on `Agent.create()`.
//
// So this file carries an MCP CLIENT: an allowed `execute()` still has to reach
// `packages/mcp-server`, over Streamable HTTP JSON-RPC to the SAME endpoint and headers the other
// runtimes' hosts use — one server surface, one auth story.
// ⚠ THE URL IS ALWAYS THE COMPILED-IN `MCP_URL`: reading it off disk would let a local process
// repoint the session's MCP surface, bearer included.
// ⚠ THE BEARER NEVER TOUCHES ARGV OR A LOG: held in the per-session wiring, sent as a header only.
// ⚠ THE POLICY LAYER STAYS IN CORE: `mcp-config.js` owns the call timeout and the device token; both
// are READ, never restated (the timeout drifted once by being restated).

const { MCP_URL } = require('../../config');
// The two-shape body reader (JSON or SSE) and the tool-set header are core's (`mcp-connect.js`).
const { parseSse, readBody, toolSetHeaders } = require('../../mcp-connect');
const doplMcp = require('../kit/dopl-mcp');

// ⚠ CUSTODY, NOT VENDOR — two headers, two facts. `desktop-session` ("the desktop spawned this") is
// compared by strict equality / membership (`identity.ts › runtimeWord`, `channel-wake-guidance.ts`,
// `main/targeting.js › DESKTOP_RUNTIMES`), so a vendor word there would drop every Cursor session
// out of the desktop branch. The vendor must match `src/shared/auth/runtime-header.ts ›
// CURSOR_VENDOR` by literal: no shared module crosses that join.
const RUNTIME_HEADERS = {
  'X-Dopl-Runtime': 'desktop-session',
  'X-Dopl-Vendor': 'cursor',
};

// The revision this client is built against: `@modelcontextprotocol/sdk`'s `LATEST_PROTOCOL_VERSION`
// at the repo's pin (`^1.29.0`, measured 2026-08-31). The version the server answers in `initialize`
// is echoed on every later request, so a negotiated-down server is followed.
const PROTOCOL_VERSION = '2025-11-25';

// Lazy (`kit/dopl-mcp.js`): `mcp-config` pulls auth, and an unwired harness must read as "no token",
// never throw. This adapter falls back to 60s when mcp-config cannot load (kept as it was, 2026-10-13).
const clientTimeoutMs = () => doplMcp.clientTimeoutMs({ fallbackMs: 60000 });

const doplBearer = () => doplMcp.doplBearer();

/**
 * The per-session wiring an in-process call carries.
 *
 * ⚠ NO TOKEN => NO SURFACE, and the session still launches: a wiring that 401s on every call tells
 * the agent it HAS a delivery path and lets it watch that path fail.
 * 🔒 `bearerOverride` is the CONTAINER LOCK (a child credential locked to one workspace, minted at
 * spawn for a shared link container). It REPLACES the device token and is what refuses another
 * workspace server-side; `X-Workspace-Id` is a HINT that grants nothing.
 * ⚠ The SLOT KEY is a LABEL, not a lock: it tells two concurrent sessions of one agent apart on the wire.
 */
function buildWiring(workspaceId, bearerOverride, slotKey, toolSet) {
  const override = typeof bearerOverride === 'string' ? bearerOverride.trim() : '';
  const token = override || doplBearer();
  if (!token) return { usable: false, headers: null };
  const headers = Object.assign({
    'Content-Type': 'application/json',
    // ⚠ BOTH: Streamable HTTP may answer JSON or SSE; advertising one gets refused when the server
    // picks the other. `readBody` parses both.
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  }, RUNTIME_HEADERS, toolSetHeaders(toolSet));
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) headers['X-Workspace-Id'] = pin;
  const slot = typeof slotKey === 'string' ? slotKey.trim() : '';
  // Same shape the server's own header parser accepts (id characters only, no whitespace, <=128).
  if (slot && /^[A-Za-z0-9:._-]{1,128}$/.test(slot)) headers['X-Dopl-Session-Id'] = slot;
  return { usable: true, headers };
}

// ── THE WIRE ─────────────────────────────────────────────────────────────────────────────────
//
// ⚠ ONE FRAME PER REQUEST, EITHER SHAPE (JSON or SSE). `readBody` (core's, shared with the launch
// pre-flight) reads both and treats an unparseable body as a failure, not an empty result.

/**
 * One JSON-RPC request against the Dopl endpoint.
 *
 * ⚠ BOUNDED BY THE SERVER'S OWN AWAIT BUDGET: a held channel read waits up to ~215s by design, so a
 * short timeout would turn every await into a transport error.
 * ⚠ AN ERROR IS RETURNED, NEVER THROWN: `execute()` must answer the model something it can act on.
 */
async function rpc(state, method, params) {
  const headers = Object.assign({}, state.headers);
  if (state.sessionId) headers['Mcp-Session-Id'] = state.sessionId;
  if (state.protocolVersion) headers['MCP-Protocol-Version'] = state.protocolVersion;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clientTimeoutMs());
  try {
    state.id += 1;
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: state.id, method, params: params || {} }),
      signal: controller.signal,
    });
    // The handshake's answer carries the session handle every later request must echo.
    const sid = res.headers.get('mcp-session-id');
    if (sid && !state.sessionId) state.sessionId = sid;
    if (!res.ok) return { ok: false, error: `Dopl MCP answered HTTP ${res.status}` };
    const body = await readBody(res);
    if (!body) return { ok: false, error: 'Dopl MCP returned an unreadable frame' };
    if (body.error) return { ok: false, error: body.error.message || 'Dopl MCP error' };
    return { ok: true, result: body.result };
  } catch (err) {
    return { ok: false, error: (err && err.name === 'AbortError') ? 'Dopl MCP did not answer in time' : ((err && err.message) || 'Dopl MCP unreachable') };
  } finally {
    clearTimeout(timer);
  }
}

/** The handshake, once per session. ⚠ MANDATORY — a `tools/call` before it is refused. */
async function handshake(state) {
  if (state.ready) return { ok: true };
  const init = await rpc(state, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    // ⚠ The client identity the server logs this session under: the forensic join between a
    // session and its calls.
    clientInfo: { name: 'dopl-desktop', version: state.appVersion || '0.0.0' },
  });
  if (!init.ok) return init;
  const negotiated = init.result && init.result.protocolVersion;
  state.protocolVersion = typeof negotiated === 'string' && negotiated ? negotiated : PROTOCOL_VERSION;
  // Fire-and-forget by protocol; not fatal, the next request carries version and session header.
  await rpc(state, 'notifications/initialized', {}).catch(() => {});
  state.ready = true;
  return { ok: true };
}

/**
 * A live connection to the Dopl endpoint for ONE session: a header set plus a session id (no child
 * process, no socket), held so the handshake is paid once.
 */
function connect(wiring, appVersion) {
  const state = {
    headers: wiring.headers, sessionId: null, protocolVersion: null, ready: false, id: 0,
    appVersion: appVersion || '0.0.0',
  };
  return {
    /** `[{ name, description, inputSchema }]` — the SERVER's own description of its surface. */
    async list() {
      const ready = await handshake(state);
      if (!ready.ok) throw new Error(ready.error);
      const out = await rpc(state, 'tools/list', {});
      if (!out.ok) throw new Error(out.error);
      const rows = (out.result && out.result.tools) || [];
      return rows.filter((t) => t && typeof t.name === 'string').map((t) => ({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : '',
        inputSchema: t.inputSchema || t.input_schema || { type: 'object' },
      }));
    },
    /** `{ ok, text }` — the tool's own answer, flattened to text for the model. */
    async call(name, args) {
      const ready = await handshake(state);
      if (!ready.ok) return { ok: false, text: ready.error };
      const out = await rpc(state, 'tools/call', { name, arguments: args || {} });
      if (!out.ok) return { ok: false, text: out.error };
      const result = out.result || {};
      const text = Array.isArray(result.content)
        ? result.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n').trim()
        : '';
      // ⚠ The SERVER's `isError` is honoured: a refusal dressed as success reads as a delivery.
      return { ok: result.isError !== true, text };
    },
  };
}

// ── HOST REGISTRATION ────────────────────────────────────────────────────────────────────────

/**
 * The OPERATOR's own entry.
 *
 * ⚠ NOTHING TO WRITE — a capability difference, not a refusal. Sessions Dopl spawns reach Dopl
 * without touching `.cursor/mcp.json`, `~/.cursor/mcp.json` or a team dashboard (design §7). Writing
 * an entry anyway would leave a file the operator also owns and must find and undo by hand.
 */
function registerMcp(_cfg) {
  return Promise.resolve({
    ok: false,
    reason: 'This runtime takes MCP servers inline per session, so Dopl writes no entry into your '
      + 'Cursor config. Sessions Dopl spawns reach Dopl regardless — this only affects your own '
      + 'manual `cursor-agent` runs, which you would configure yourself.',
  });
}

/**
 * ⚠ `present: false`, not `null`: no persisted entry exists by construction, so absence is CONFIRMED.
 */
function probeMcp() {
  return Promise.resolve({ present: false, reason: 'this runtime registers inline per session; there is no stored entry' });
}

// Descriptor half.
const descriptor = {
  // ⚠ The only `in-process` of the three: Axis B's whole mechanism (`axis-b.js`).
  sessionTransport: 'in-process',
  // ⚠ Not `cli-verb`: registration is an argument to the SDK call that creates the agent.
  hostRegistration: 'inline',
  // ⚠ TRUE: absent is a CONFIRMED answer (no stored entry by construction).
  probe: true,
  // ⚠ null: the prefix the MODEL sees on a custom tool is undocumented (§5 item X17). It cannot
  // reproduce F-139: the gate is asked the name this process registered (`axis-b.js › buildTool`).
  toolNamePrefix: null,
  // ⚠ null: we own the tools; the channel op cannot execute without passing through `execute()`.
  perToolApproval: null,
  // ⚠ null: no documented deferral behind a search verb (hence `prose.toolSearchVerb` null too).
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor,
  buildWiring, connect, parseSse, PROTOCOL_VERSION,
};

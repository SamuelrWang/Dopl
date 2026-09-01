// MCP ON THIS RUNTIME — ⚠ THE SESSION TRANSPORT IS `in-process`, WHICH MEANS DOPL MAKES THE CALL.
//
//   SESSION TRANSPORT   what the SPAWNED session gets. On the other two runtimes that is a remote
//                       HTTP entry the host connects to, and the desktop is NOT in the call path.
//                       Here it is `local.customTools` (`axis-b.js`) — Dopl IMPLEMENTS the tools,
//                       so Dopl is in the call path, which is the entire reason Axis B has an
//                       enforcement point on a runtime with no permission callback.
//   HOST REGISTRATION   the OPERATOR's own entry. ⚠ There is NOTHING TO WRITE here — see
//                       `registerMcp`. This runtime takes servers INLINE on `Agent.create()`, so
//                       Dopl registers per session and leaves no file behind.
//
// ⚠ SO THIS FILE CARRIES A CLIENT THE OTHER ADAPTERS DO NOT NEED: an allowed `execute()` still has
// to reach `packages/mcp-server`. It speaks Streamable HTTP JSON-RPC to the SAME endpoint the
// other runtimes' hosts connect to, with the same headers, so there is one server surface and one
// auth story rather than two.
//
// ⚠ THE URL IS ALWAYS THE COMPILED-IN `MCP_URL`. Reading it off disk would let any local process
// repoint the session's whole MCP surface — bearer included — at its own endpoint.
// ⚠ THE BEARER NEVER TOUCHES ARGV OR A LOG. It is held in the per-session wiring object, sent as
// a header, and never serialised anywhere else.
// ⚠ THE POLICY LAYER STAYS IN CORE. `main/mcp-config.js` owns the per-server call timeout
// (`MCP_CLIENT_TIMEOUT_MS`, derived from the server's own await budget) and the device token. Both
// are READ from there and never restated — the timeout drifted once already by being restated.

const { MCP_URL } = require('../../config');

// ⚠ CUSTODY, NOT VENDOR — two headers, two facts, and port step 1 exists because they were nearly
// fused. `desktop-session` means "the desktop app spawned this" and stays TRUE for a Dopl-driven
// Cursor session; three live consumers compare it by strict equality or array membership
// (`packages/mcp-server/src/tools/identity.ts › runtimeWord`, `› channel-wake-guidance.ts`,
// `main/targeting.js › DESKTOP_RUNTIMES`), so a vendor word THERE would silently drop every Cursor
// session out of the desktop branch. The vendor is the second header, and
// `src/shared/auth/runtime-header.ts › CURSOR_VENDOR` is the literal it must match — there is no
// shared module across that join, so the two sides agree by literal or not at all.
const RUNTIME_HEADERS = {
  'X-Dopl-Runtime': 'desktop-session',
  'X-Dopl-Vendor': 'cursor',
};

// ⚠ THE REVISION THIS CLIENT IS BUILT AGAINST, named rather than inherited. It is
// `@modelcontextprotocol/sdk`'s own `LATEST_PROTOCOL_VERSION` at the pin this repo carries
// (`^1.29.0`, measured 2026-08-31) — the same package `src/app/api/mcp/route.ts` serves with. The
// server ANSWERS a version in `initialize` and this client echoes THAT back on every later
// request, so a server that negotiates down is followed rather than argued with.
const PROTOCOL_VERSION = '2025-11-25';

const CHANNEL_TOOL = 'dopl_channel';

function clientTimeoutMs() {
  // ⚠ ONE DEFINITION, READ NOT RESTATED. Lazy because `mcp-config` pulls auth, and an unwired
  // harness must read as "no token", never throw into a launch.
  try {
    return require('../../mcp-config').MCP_CLIENT_TIMEOUT_MS;
  } catch (_) {
    return 60000;
  }
}

function doplBearer() {
  try {
    return require('../../mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

/**
 * The per-session wiring an in-process call carries.
 *
 * ⚠ NO TOKEN => NO SURFACE, and the session still launches. A half-built wiring that 401s on every
 * call would tell the agent it HAS a delivery path and let it watch that path fail.
 * 🔒 `bearerOverride` is the CONTAINER LOCK: a child credential locked to one workspace, minted at
 * spawn for a shared link container. It REPLACES the device token, and it is what actually refuses
 * another workspace server-side. `X-Workspace-Id` stays a HINT that grants nothing.
 * ⚠ The SLOT KEY is a LABEL, not a lock: it names the registry slot this run occupies so two
 * concurrent sessions of one agent handle are distinguishable on the wire, which nothing else
 * about them is.
 */
function buildWiring(workspaceId, bearerOverride, slotKey) {
  const override = typeof bearerOverride === 'string' ? bearerOverride.trim() : '';
  const token = override || doplBearer();
  if (!token) return { usable: false, headers: null };
  const headers = Object.assign({
    'Content-Type': 'application/json',
    // ⚠ BOTH, because a Streamable HTTP server may answer either a JSON body or an SSE stream for
    // the same request, and a client that advertises one gets refused when the server picks the
    // other. `readBody` below parses both.
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  }, RUNTIME_HEADERS);
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) headers['X-Workspace-Id'] = pin;
  const slot = typeof slotKey === 'string' ? slotKey.trim() : '';
  // Same shape the server's own header parser accepts (id characters only, no whitespace, <=128).
  if (slot && /^[A-Za-z0-9:._-]{1,128}$/.test(slot)) headers['X-Dopl-Session-Id'] = slot;
  return { usable: true, headers };
}

// ── THE WIRE ─────────────────────────────────────────────────────────────────────────────────
//
// ⚠ ONE FRAME PER REQUEST, AND THE RESPONSE MAY BE EITHER SHAPE. Streamable HTTP lets a server
// answer a POST with `application/json` or with an SSE stream carrying the same JSON-RPC response.
// A reader that assumed one would work in development and fail in production, or the reverse, so
// this reads both and treats an unparseable body as a failure rather than as an empty result.
function parseSse(text) {
  let last = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try { last = JSON.parse(payload); } catch (_) { /* a keep-alive or a partial frame */ }
  }
  return last;
}

async function readBody(res) {
  const text = await res.text();
  const type = String(res.headers.get('content-type') || '');
  if (type.indexOf('text/event-stream') !== -1) return parseSse(text);
  try { return JSON.parse(text); } catch (_) { return null; }
}

/**
 * One JSON-RPC request against the Dopl endpoint.
 *
 * ⚠ BOUNDED BY THE SERVER'S OWN AWAIT BUDGET. `dopl_channel(op="await")` HOLDS for up to ~215s by
 * design, so a short timeout here would turn every await into a transport error and lose the
 * re-arm teaching the result carries. The number is `mcp-config.js`'s and is read, never restated.
 * ⚠ AN ERROR IS RETURNED, NEVER THROWN PAST THE TOOL. `execute()` has to answer the model
 * something; a thrown fetch would surface as an opaque platform failure the agent cannot act on.
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
    // ⚠ The client identity the server logs this session under. It is the only forensic join
    // between a Dopl session and the calls it made, and it is set deliberately.
    clientInfo: { name: 'dopl-desktop', version: state.appVersion || '0.0.0' },
  });
  if (!init.ok) return init;
  const negotiated = init.result && init.result.protocolVersion;
  state.protocolVersion = typeof negotiated === 'string' && negotiated ? negotiated : PROTOCOL_VERSION;
  // The notification is fire-and-forget by protocol; a failure to send it is not fatal here
  // because the next request carries the negotiated version and the session header anyway.
  await rpc(state, 'notifications/initialized', {}).catch(() => {});
  state.ready = true;
  return { ok: true };
}

/**
 * A live connection to the Dopl endpoint for ONE session.
 *
 * ⚠ IT IS NOT A CHILD PROCESS AND NOT A SOCKET — it is a header set plus a session id. Held per
 * session so the handshake is paid once, and disposable.
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
      // ⚠ The SERVER's own `isError` is honoured rather than reinterpreted: a refusal it issued is
      // a refusal, and dressing it as a success would let an agent read a denial as a delivery.
      return { ok: result.isError !== true, text };
    },
  };
}

// ── HOST REGISTRATION ────────────────────────────────────────────────────────────────────────

/**
 * The OPERATOR's own entry.
 *
 * ⚠ THERE IS NOTHING TO WRITE, AND THAT IS A CAPABILITY DIFFERENCE RATHER THAN A REFUSAL. This
 * runtime accepts `mcpServers` INLINE on `Agent.create()`, so every session Dopl spawns reaches
 * Dopl without touching `.cursor/mcp.json`, `~/.cursor/mcp.json` or a team dashboard — which is
 * how the design's §7 claim that the MCP shared-file reconciliation problem is AVOIDED is actually
 * true here rather than aspirational. Writing an entry anyway would create the exact side effect
 * the other adapter refuses to leave behind: a file the operator also owns and would have to find
 * and undo by hand.
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
 * ⚠ THERE IS NO PERSISTED ENTRY TO PROBE, so `present` is `false` rather than `null`: this is a
 * CONFIRMED ABSENCE and not an unknown. The other native runtime answers `null` because it cannot
 * tell "no such server" from "unreadable config"; here the answer is structural.
 */
function probeMcp() {
  return Promise.resolve({ present: false, reason: 'this runtime registers inline per session; there is no stored entry' });
}

// Descriptor half.
const descriptor = {
  // ⚠ THE ONLY `in-process` OF THE THREE, and it is Axis B's whole mechanism rather than a spare
  // seam. See `axis-b.js`.
  sessionTransport: 'in-process',
  // ⚠ NOT `cli-verb`. There is no verb and no file — registration is an argument to the SDK call
  // that creates the agent.
  hostRegistration: 'inline',
  // ⚠ TRUE: absent is a CONFIRMED answer here, because there is no stored entry by construction.
  probe: true,
  // ⚠ null: what prefix the MODEL sees on a custom tool is not documented — the research says only
  // that `customTools` are "registered as a built-in `custom-user-tools` MCP server". It is
  // recorded as §5 item X17 and, unlike the same question on the other native runtime, it CANNOT
  // reproduce F-139: the gate is asked the name THIS PROCESS registered, canonicalised at build
  // time (`axis-b.js › buildTool`), so no host spelling can miss a list. What it affects is prose.
  toolNamePrefix: null,
  // ⚠ null: we own the tools, so there is no per-tool approval policy to set on a host. The pin
  // the other native runtime needs (`tools.dopl_channel.approval_mode`) is unnecessary here
  // because the channel op cannot execute without passing through `execute()`.
  perToolApproval: null,
  // ⚠ null: nothing in the research says this runtime defers MCP tools behind a search verb, which
  // is also why `prose.toolSearchVerb` is null.
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor,
  buildWiring, connect, parseSse, readBody, clientTimeoutMs,
  RUNTIME_HEADERS, PROTOCOL_VERSION, CHANNEL_TOOL,
};

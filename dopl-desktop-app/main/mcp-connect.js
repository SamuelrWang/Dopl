// THE DOPL MCP SERVER'S REACHABILITY AT LAUNCH — the whole of F-692, as one pure vocabulary.
//
// ⚠ THE INCIDENT, IN ONE SENTENCE (2026-09-13). A session launched into a shared home channel
// resolved `channel_agent` correctly (ruling B7) and then ran for its whole life with NO dopl MCP
// server: `MCP_URL` points at the local Next dev server, whose COLD `/api/mcp` route answered
// `POST 200 in 12.4s / 10.0s / 16.2s / 14.7s`, and the CLI abandons a server that has not
// connected inside `MCP_CONNECT_TIMEOUT_MS` (default 5000 — measured out of the bundled binary,
// `rVu()`: `Z.MCP_CONNECT_TIMEOUT_MS > 0 ? it : 5000`). The IN-PROCESS `dopl_agents` SDK server
// connected, so `rename_agent` worked and every `mcp__dopl__*` call came back "No such tool
// available" — and `prompt-framing.js` told the agent never to report the tool missing, so the
// failure was hidden BY INSTRUCTION.
//
// ⚠ SO THE ONE THING THIS MODULE EXISTS TO SAY IS THAT NOBODY WAS READING THE ANSWER. The runtime
// already TELLS us, in the first message of every stream: `SDKSystemMessage` (sdk.d.ts, SDK
// 0.3.220) is
//
//     { type: 'system', subtype: 'init', session_id, model, tools: string[],
//       mcp_servers: { name: string; status: string }[], … }
//
// and `status` is the client's own connection word — measured in the bundled binary's strings as
// one of `connected` / `connecting` / `pending` / `needs-auth` / `failed` / `disabled`. Core read
// `session_id` and `model` off that message and dropped the rest on the floor.
//
// ⚠ PURE. No electron, no fs, no clock, no `fetch` of its own — the warm call takes its fetch as
// an argument, exactly like `session-health.js` takes its injected free vars, so the whole module
// is drivable in plain Node from a FAKE INIT MESSAGE (test/mcp-connect-guard.test.mjs).
//
// ⚠ IT DECIDES, IT DOES NOT ACT. `mcpConnectVerdict` answers ok / retry / fail; killing the child,
// re-running the launch and ending the session visibly are `main/mcp-connect-guard.js`'s, which is
// the module allowed to hold the engine's handles.

// The key `runtime/claude/loader.js › buildMcpServers` mounts the Dopl server under, and the
// `name` the CLI therefore reports. ⚠ ONE SPELLING: the tool prefix agents see
// (`mcp__dopl__dopl_channel`) is this word, and a rename is a two-file change, not a one-file one.
const DOPL_SERVER_KEY = 'dopl';

// The ONLY status that means the session can call a dopl tool. Everything else — including the
// two OPTIMISTIC-sounding ones, `connecting` and `pending` — means the turn-1 prompt is about to
// order a call into a server that is not there.
// ⚠ `alwaysLoad: true` on the entry is what makes reading this honest at init time: it blocks the
// launch until the server connects (MCP startup is non-blocking by default), so a `connecting`
// here is a server that ran out the connect timeout rather than one still in flight.
const CONNECTED = 'connected';

// What `doplStatus` answers when the init message lists servers and `dopl` is not among them —
// the EXACT shape of the incident, and of the 2026-08-08 `tools:` regression before it
// (`test/mcp-server-tools-policy.test.mjs`: a bad per-entry field DROPS THE WHOLE SERVER, so
// `mcp_servers` came back `[]`). ⚠ A WORD AND NOT `null`, so the operator line can tell "the CLI
// dropped our entry" apart from "this runtime reports no server list at all".
const STATUS_MISSING = 'missing';

// The runtime reported nothing to read. ⚠ ANSWERED FOR A MESSAGE WITH NO `mcp_servers` KEY AT
// ALL, and it is deliberately NOT a failure: a runtime that does not publish a server list has
// not told us the server is down, and refusing every launch on a second adapter's silence would
// make this guard a launch-blocking claim about a runtime it cannot see.
const STATUS_UNREPORTED = 'unreported';

// ⚠ THE CLI'S ONLY CONNECT-TIMEOUT KNOB, MEASURED — there is NO `--mcp-timeout` flag (the binary
// ships exactly one mcp flag, `--mcp-config`). `MCP_CONNECT_TIMEOUT_MS` is an int env var read
// through the binary's own env table, default 5000; `MCP_TIMEOUT` (default 30000) is the
// per-server STARTUP budget and `MCP_TOOL_TIMEOUT` the per-call one, so neither is this.
// ⚠ 30s IS THE WARM CALL'S BUDGET PLUS HEADROOM, not a number picked for itself: the pre-flight
// below already waited for the route, so this only has to cover a compile that finished just as
// the child started asking. It is a CEILING on how long a launch can hang, so it is not larger.
const CLI_CONNECT_TIMEOUT_ENV = 'MCP_CONNECT_TIMEOUT_MS';
const CLI_CONNECT_TIMEOUT_MS = 30_000;

// ── THE PRE-FLIGHT ───────────────────────────────────────────────────────────────────────────
//
// ⚠ IT EXISTS BECAUSE THE FIRST REQUEST IS THE EXPENSIVE ONE AND THE CHILD MAKES IT. A Next dev
// server compiles `/api/mcp` on first hit; production is warm but cold-starts. Either way the
// only process that can afford to wait is THIS one, so the desktop pays the compile on a call it
// controls the timeout of, and the child then connects against a warm route.
// ⚠ IT CANNOT FAIL A LAUNCH. Every outcome — 200, 401, 500, a timeout, a thrown fetch, no token
// at all — resolves to a word for the log. The ASSERTION is the init message; this is only the
// thing that makes the assertion usually pass.
const WARM_TIMEOUT_MS = 25_000;

// The cheapest request the route accepts: an MCP `initialize`, which is what the CLI itself sends
// first. ⚠ NOT a bare `GET` and not an empty POST — the route is a JSON-RPC handler, and a shape
// it rejects can be answered by an early guard WITHOUT compiling the handler we are trying to warm.
const WARM_RPC = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'dopl-desktop-preflight', version: '1' },
  },
};

// ── THE TOOL-SET NEGOTIATION ─────────────────────────────────────────────────────────────────
//
// The server serves two tool surfaces and lists the one a connection asks for (`X-Dopl-Tool-Set`);
// a desktop session that asks for none gets legacy (the server keys that on the `X-Dopl-Runtime`
// custody stamp, `tool-manifest.ts › resolveToolSet`). The desktop asks for `granular` ONLY where the server has said it
// serves it: `initialize` names both sets under this capability (`packages/mcp-server/src/
// tool-manifest.ts › TOOL_SETS_CAPABILITY`), and the pre-flight above already sends that request,
// so reading its answer costs no extra round trip. An older server says nothing and every session
// stays legacy, exactly as today; an older desktop never sends the header.
const TOOL_SET_HEADER = 'X-Dopl-Tool-Set';
const TOOL_SETS_CAPABILITY = 'dopl/toolSets';
const GRANULAR_TOOL_SET = 'granular';
const LEGACY_TOOL_SET = 'legacy';

/** The set an `initialize` answer lets a session ask for: granular only when the server names it. */
function advertisedToolSet(frame) {
  const experimental = frame && frame.result && frame.result.capabilities && frame.result.capabilities.experimental;
  const cap = experimental && typeof experimental === 'object' ? experimental[TOOL_SETS_CAPABILITY] : null;
  const sets = cap && Array.isArray(cap.sets) ? cap.sets : [];
  return sets.indexOf(GRANULAR_TOOL_SET) !== -1 ? GRANULAR_TOOL_SET : LEGACY_TOOL_SET;
}

/** The header a session's MCP entry carries: none for legacy, so a legacy entry is byte-for-byte what it was. */
function toolSetHeaders(set) {
  return set === GRANULAR_TOOL_SET ? { [TOOL_SET_HEADER]: GRANULAR_TOOL_SET } : {};
}

// A Streamable HTTP server answers a POST with `application/json` OR an SSE stream carrying the same
// JSON-RPC frame, so both are read; an unparseable body is null, never an empty result.
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
  const type = String((res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '');
  if (type.indexOf('text/event-stream') !== -1) return parseSse(text);
  try { return JSON.parse(text); } catch (_) { return null; }
}

/**
 * THE `dopl` SERVER'S STATUS, off the init message's own list.
 *
 * @param servers the raw `mcp_servers` array (`{name, status}[]`), or null/undefined.
 * @returns the reported status word, `STATUS_MISSING`, or `STATUS_UNREPORTED`.
 *
 * ⚠ A NON-ARRAY IS `unreported`, NOT `missing`. "This runtime told me nothing" and "this runtime
 * told me our server is gone" are different facts and only the second one is evidence.
 * ⚠ NAME MATCH IS EXACT. The CLI echoes the key from `--mcp-config` / `options.mcpServers`
 * verbatim, so a prefix or case-insensitive match here would accept a DIFFERENT server's health
 * as ours the first time anything else is mounted beside it (`agent-self-ops.js` already mounts
 * one).
 */
function doplStatus(servers) {
  if (!Array.isArray(servers)) return STATUS_UNREPORTED;
  for (const entry of servers) {
    if (entry && entry.name === DOPL_SERVER_KEY) {
      const status = typeof entry.status === 'string' ? entry.status.trim() : '';
      return status || STATUS_MISSING; // an entry with no word says nothing about being up
    }
  }
  return STATUS_MISSING;
}

/** The same read from the RAW init message — the shape the tests drive and the adapters forward. */
function doplStatusFromInit(msg) {
  return doplStatus(msg && msg.mcp_servers);
}

/** Is this the one word that means a dopl tool call can land? */
function isConnected(status) {
  return status === CONNECTED;
}

/**
 * WHAT TO DO ABOUT THE STATUS THIS LAUNCH REPORTED — `ok`, `retry` or `fail`.
 *
 * `attempt` is how many launches of THIS session have already reported a status: 0 on the cold
 * launch, 1 on the one retry. So exactly ONE retry is ever offered, which is the ruling: a cold
 * route is warm on the second connect, and a route that is still not there after the pre-flight
 * AND a retry is a broken deployment rather than a slow one.
 *
 * ⚠ `unreported` IS `ok`. See STATUS_UNREPORTED — this guard may not refuse a runtime for not
 * publishing a list. It is the reason adding a Codex/Cursor adapter does not silently break here.
 * ⚠ NEVER RUN A MUTE AGENT is the whole rule, and `fail` is how it is kept: the alternative the
 * incident actually took was a full-length session whose every delivery call was "No such tool".
 */
function mcpConnectVerdict(a) {
  const status = (a && a.status) || STATUS_UNREPORTED;
  if (status === STATUS_UNREPORTED || isConnected(status)) return 'ok';
  const attempt = Number(a && a.attempt) || 0;
  return attempt >= 1 ? 'fail' : 'retry';
}

/**
 * THE OPERATOR'S SENTENCE. ⚠ It names the SERVER and the STATUS and promises nothing about the
 * cause: on this machine the cause is a cold dev route, in production it would be a deploy, and a
 * line that guessed would send the reader to the wrong place.
 */
const MCP_UNAVAILABLE_LABEL = 'MCP unavailable';
function mcpDownText(status, attempt) {
  const where = Number(attempt) >= 1 ? 'after a retry' : 'on launch';
  return `${MCP_UNAVAILABLE_LABEL}: the desktop could not connect the Dopl MCP server ${where} ` +
    `(status "${status || STATUS_UNREPORTED}"). This agent has no delivery path, so it was not started.`;
}

/**
 * WARM THE ROUTE, THEN LET THE CHILD CONNECT. Resolves a WORD for the log, never throws, never
 * rejects — see WARM_TIMEOUT_MS above for why this may not fail a launch.
 *
 * ⚠ `fetchImpl` AND THE TIMEOUT ARE INJECTED so this module stays pure and the suite can drive a
 * slow route without one. `AbortSignal.timeout` is not used: the caller may hand in a fetch that
 * does not honour a signal, and a hand-rolled timer is what makes "resolves within the budget" a
 * property of this function rather than of its argument.
 */
async function warmMcpRoute(a) {
  const opts = a || {};
  const url = typeof opts.url === 'string' ? opts.url : '';
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : null;
  if (!url || !fetchImpl) return 'skipped';
  const budget = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : WARM_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const token = typeof opts.token === 'string' ? opts.token.trim() : '';
  if (token) headers.Authorization = `Bearer ${token}`;
  const workspaceId = typeof opts.workspaceId === 'string' ? opts.workspaceId.trim() : '';
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  let timer = null;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), budget); });
  const call = (async () => {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(WARM_RPC) });
      // The answer's tool-set advertisement, when there is an answer to read (never fails the warm).
      if (typeof opts.onToolSet === 'function' && res && res.status === 200 && typeof res.text === 'function') {
        try { opts.onToolSet(advertisedToolSet(await readBody(res))); } catch (_) { /* unread stays unknown */ }
      }
      // ⚠ ANY STATUS IS A WARM ROUTE. A 401 compiled and ran the handler, which is the whole
      // point; asserting 200 here would make an expired device token look like an outage.
      return `http ${(res && res.status) || 0}`;
    } catch (err) {
      return `error ${(err && err.message) || 'unknown'}`;
    }
  })();
  try {
    return await Promise.race([call, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  DOPL_SERVER_KEY,
  CONNECTED,
  STATUS_MISSING,
  STATUS_UNREPORTED,
  CLI_CONNECT_TIMEOUT_ENV, // the CLI's ONE knob; there is no flag (measured, see above)
  CLI_CONNECT_TIMEOUT_MS,
  WARM_TIMEOUT_MS,
  WARM_RPC,
  MCP_UNAVAILABLE_LABEL,
  doplStatus,
  doplStatusFromInit,
  isConnected,
  mcpConnectVerdict,
  mcpDownText,
  warmMcpRoute,
  TOOL_SET_HEADER,
  TOOL_SETS_CAPABILITY,
  GRANULAR_TOOL_SET,
  LEGACY_TOOL_SET,
  advertisedToolSet,
  toolSetHeaders,
  parseSse,
  readBody,
};

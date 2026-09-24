// The query lifecycle, and nothing about which platform runs it: supersede-before-relaunch, the loop tag
// that makes a superseded consumer inert, the launch watchdog and the auth-hold short circuit. The launch
// spec is the runtime adapter's and core never looks inside it; `buildLaunchSpec` is the one assembly point.

const io = require('./session-io');
const store = require('./session-store');
const { diag } = require('./diag');
const sessionAuth = require('./session-auth');
// F-692: kill / retry once / end visibly when the runtime reports the Dopl MCP server did not connect.
const mcpGuard = require('./mcp-connect-guard');
const sessionCredential = require('./session-credential');
const runtimeRegistry = require('./runtime');
// The Dopl MCP route pre-flight is core's: `/api/mcp` is the one server every runtime is pointed at.
const mcpConnect = require('./mcp-connect');
const config = require('./config');
const { teardownHandles } = require('./session-handles');

let deps = null;

function bind(d) {
  deps = d || null;
}

/** The opaque launch payload for this session's runtime; the engine's handles ride the request so the
 *  adapter never requires the engine back. */
function buildLaunchSpec(s) {
  return runtimeRegistry.runtimeFor(s.runtimeId).buildLaunchSpec({
    session: s,
    dispatch: deps.dispatch,
  });
}

// H1: supersede the live handles without touching lifecycle state. Nulling `s.query` makes the old loop
// inert (`s.query !== q`); the handle is closed first or a Codex child outlives the relaunch (P4-14).
function abortInFlight(s) {
  teardownHandles(s, { supersede: true });
}

async function startQuery(s, rt) {
  // Supersede first, so a relaunch can never leave a second child holding this session's channel access.
  abortInFlight(s);
  // Held, never spawned, without the runtime's Dopl credential (a child would fall back to the operator's own).
  if (await sessionAuth.holdIfNoRuntimeCredential(s, rt)) return;
  // The container lock, minted before the (synchronous) spec is built. One of exactly two query-start
  // sites with `session-park.js › startResumedConsumer` (a woken spawn-idle shell never comes here).
  await sessionCredential.ensureContainerCredential(s, diag);
  if (await preflightMcp(s)) return;
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  // Synchronous by contract: the handle is assigned the moment the child exists. `launchVia` tells the MCP
  // guard which lane to retry on (F-696).
  s.launchVia = 'start';
  const q = rt.start(buildLaunchSpec(s));
  s.query = q;
  s.pushIterator.push(io.userMessage(s.firstTurn));
  // Arm the launch watchdog here, the one deferred launch: a child that never emits init must still end.
  if (deps && deps.scheduleIdle) deps.scheduleIdle(s);
  consume(s, q, rt);
}

// The normalizer's read-only context, rebuilt per message: `willGatePost` asks the LIVE gate.
function normalizeCtx(s) {
  return {
    channelId: s.channelId,
    peerName: s.counterpartyName,
    peerId: s.counterpartyId,
    willGatePost: (input, toolName) => io.postWillGate(s, input, toolName),
  };
}

async function consume(s, q, rt) {
  try {
    // `q` tags this loop: a relaunch swaps `s.query`, so a superseded loop drops its tail and late rejection.
    // The auth hold's RETURN VALUE is the stop condition — a settled session must keep draining.
    for await (const msg of q) {
      if (s.query !== q) return;
      const signal = io.applyCoreEvents(s, rt.normalize(msg, normalizeCtx(s)), deps.dispatch, store);
      if (signal && signal.type === 'mcp_status') {
        if (mcpGuard.handleMcpStatus(s, signal.status)) return;
        continue;
      }
      if (signal && signal.type === 'auth_hold' && sessionAuth.holdIfAuthFailure(s, signal.text)) return;
    }
  } catch (err) {
    if (s.query !== q) return;
    if (!isAbortError(err)) {
      const text = (err && err.message) || err;
      // The runtime decides whether a rejection is auth-shaped, through the same normalizer as a message.
      const held = rt.normalize({ type: 'error', text: String(text == null ? '' : text) }, normalizeCtx(s));
      const hold = held.find((ev) => ev && ev.type === 'auth_hold');
      if (hold && sessionAuth.holdIfAuthFailure(s, hold.text)) return;
      diag('session-engine: query error', text);
      // A vendor-neutral end code (re-said per runtime at read time); a stream that died before launch is a
      // START failure, mid-run a crash. It sets a field and decides nothing.
      if (!s.endCode) s.endCode = s.sdkSessionId ? 'runtime-crashed' : 'runtime-start-failed';
      if (!s.settled) deps.dispatch(s, { type: 'crash' });
    }
  }
}

/**
 * THE BEARER THE PRE-FLIGHT WARMS WITH: this session's container-locked credential, else the device
 * token — the adapter's precedence, so the warm call takes the child's auth path. '' still compiles it.
 */
function mcpTokenFor(s) {
  const locked = sessionCredential.sessionBearer(s);
  if (typeof locked === 'string' && locked.trim()) return locked.trim();
  // Lazy: `mcp-config` pulls auth; an unwired harness or a pre-sign-in launch reads as no token.
  try { return require('./mcp-config').deviceTokenForSpawn() || ''; } catch (_) { return ''; }
}

// The tool set the server last advertised on a pre-flight (DMP-013 B4); null until one was read.
let advertisedToolSet = null;

/** One warm call; resolves the log word and the tool set its answer advertised (null when unread). */
async function warm(s) {
  let heard = null;
  const word = await mcpConnect.warmMcpRoute({
    url: config.MCP_URL,
    token: mcpTokenFor(s),
    workspaceId: s.workspaceId,
    fetchImpl: typeof fetch === 'function' ? fetch : null,
    onToolSet: (set) => { heard = set; },
  });
  if (heard) advertisedToolSet = heard;
  return { word, heard };
}

/**
 * THE TOOL SET A NEW SESSION SPEAKS, stamped once, before its first turn is written: the turn spells
 * every Dopl call in it and the adapter's MCP entry asks for it (`mcp-connect.js › toolSetHeaders`).
 * The first launch of an app run pays one warm call to learn it (the route is warm for the pre-flight
 * after it); unknown is the legacy default.
 */
async function stampToolSet(s) {
  if (advertisedToolSet === null) await warm(s);
  s.doplToolSet = advertisedToolSet || mcpConnect.LEGACY_TOOL_SET;
}

/**
 * Warm the Dopl MCP route (a cold route can outlast the CLI's connect budget), then answer TRUE when
 * the launch must be abandoned. It never fails a launch; it re-checks `settled` after its up-to-25s
 * wait because the old query is already torn down and `settle` would have nothing to abort (F-692).
 * A server that answers without advertising `granular` (a rollback) takes a granular session back to
 * the default before its entry is built; a session never moves the other way mid-life.
 */
async function preflightMcp(s) {
  const { word, heard } = await warm(s);
  diag('session-query: mcp pre-flight', config.MCP_URL, '->', word, heard ? `tools=${heard}` : '');
  if (heard === mcpConnect.LEGACY_TOOL_SET && s.doplToolSet === mcpConnect.GRANULAR_TOOL_SET) s.doplToolSet = heard;
  if (s.settled) {
    diag('session-query: launch abandoned — the session settled during the pre-flight');
    return true;
  }
  return false;
}

function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
}

module.exports = {
  bind,
  buildLaunchSpec,
  abortInFlight,
  preflightMcp,
  stampToolSet,
  startQuery,
  consume,
  isAbortError,
};

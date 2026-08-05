// Shared authenticated HTTP helper for the newer main-process modules
// (mcp-config, consent, presence, session-history, session-peer-post,
// session-close-task). The Channels listener still keeps its own SEND (E2E-
// verified — its long-poll wires a caller abort signal into the controller and
// its timeouts are load-bearing), but the two no longer keep separate 401
// REPAIRS: that half is api-repair.js and both call it. Keeping a second copy of
// the repair is what produced the 1.8.x Channels outage — see api-repair.js.
//
// Auth is via the Electron session's Supabase cookies (see auth.js for why not
// a bearer). withUserAuth endpoints ({ sessionOnly: true } included) honor them.

const auth = require('./auth');
const appVersion = require('./app-version');
const { fetchWithAuthRepair } = require('./api-repair');
const { API_BASE } = require('./config');

async function sendOnce(pathname, opts) {
  const { method = 'GET', workspaceId, body, headers: extra, timeoutMs, noStore } = opts;
  const cookie = await auth.getAuthCookie();
  // Q10: this build's version rides on the TRANSPORT, not on each post site, so a
  // new caller cannot forget it. The server stamps it as the reserved
  // metadata.appVersion (header-only, never from the body) — see app-version.js.
  const headers = { Accept: 'application/json', ...appVersion.versionHeaders() };
  if (cookie) headers.Cookie = cookie;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (noStore) headers['Cache-Control'] = 'no-store';
  if (extra) Object.assign(headers, extra);

  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(`${API_BASE}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 401 REPAIR (Phase 2 — desktop-main.md B3/R1). `api.js` had NO repair at all:
// only the listener retried on 401 (channel-listener.js:102-115), so presence
// skipped a cycle and consent, mcp-config, session-history, session-peer-post and
// session-close-task simply failed. Today the remote page hides that by keeping
// the cookie jar fresh; the bundled SPA removes the page and with it the
// refresher, and `getAuthCookie()` only repairs an EMPTY jar, never a STALE one.
//
// The repair itself now lives in api-repair.js and is SHARED with listener-io.js,
// which shipped without it and took the whole Channels subsystem down on 1.8.x.
// `sendOnce` stays here because the SEND is what differs between the two
// transports; the 401 rule is what must never differ again.
function apiFetch(pathname, opts = {}) {
  return fetchWithAuthRepair('api', pathname, () => sendOnce(pathname, opts));
}

// The main process uses the global `fetch` — which in Electron main is Node's
// undici, a SEPARATE network stack from Chromium's (the renderer's). After a
// network transition (sleep/wake, wifi change) undici's keepalive pool can hold
// dead sockets, so every request hangs until its AbortController timeout (the
// recurring "presence: beat error This operation was aborted" storm for minutes
// after unlock). `session.closeAllConnections()` clears ONLY Chromium's pool, not
// undici's, so the main process needs its own reset.
//
// Node's built-in fetch reads its dispatcher from a well-known global symbol on
// every call, so swapping that symbol for a fresh dispatcher gives all subsequent
// fetches a clean pool — this is exactly what `undici.setGlobalDispatcher(new
// Agent())` does. We do NOT require the `undici` package: it is only a dev-time
// transitive dependency (electron -> @electron/get) and is NOT bundled into the
// packaged app, where `require('undici')` throws. Instead we rebuild a fresh
// dispatcher from the runtime's OWN dispatcher class (version-matched, no
// dependency), falling back to the package in dev and to a safe no-op if neither
// path is available (the per-request AbortController above still bounds any dead
// socket, so the worst case is today's behavior).
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

function resetPool() {
  try {
    const current = globalThis[UNDICI_GLOBAL_DISPATCHER];
    let fresh = null;
    if (current && typeof current.constructor === 'function') {
      try { fresh = new current.constructor(); } catch (_) { fresh = null; }
    }
    if (!fresh) {
      try { fresh = new (require('undici').Agent)(); } catch (_) { /* not bundled */ }
    }
    if (!fresh) return false;
    globalThis[UNDICI_GLOBAL_DISPATCHER] = fresh;
    // Tear down the old pool's (now dead) sockets; harmless if already draining.
    if (current && current !== fresh && typeof current.destroy === 'function') {
      Promise.resolve(current.destroy()).catch(() => {});
    }
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { apiFetch, resetPool };

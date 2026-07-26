// Shared authenticated HTTP helper for the newer main-process modules
// (mcp-config). The Channels listener keeps its own copy (E2E-verified — not
// refactored here); this is the same shape: cookie-forwarded, X-Workspace-Id
// optional, AbortController timeout.
//
// Auth is via the Electron session's Supabase cookies (see auth.js for why not
// a bearer). withUserAuth endpoints ({ sessionOnly: true } included) honor them.

const auth = require('./auth');
const { API_BASE } = require('./config');

async function apiFetch(pathname, opts = {}) {
  const { method = 'GET', workspaceId, body, headers: extra, timeoutMs, noStore } = opts;
  const cookie = await auth.getAuthCookie();
  const headers = { Accept: 'application/json' };
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

module.exports = { apiFetch };

// IPC handlers for the BUNDLED UI window — the main-process half of
// `renderer/app-preload.js` (see that file for the two invariants, and
// main/spa-window.js for the window itself).
//
// WHAT THIS IS. In the target architecture the renderer owns no credentials and
// opens no sockets: it hands main a path, main decides the origin, attaches the
// Authorization header, performs the request on main's own fetch pool, and
// hands back a plain `{ status, statusText, hasBody, body }` record. The error
// ENVELOPE is decoded in the renderer (apps/desktop-ui/src/lib/api.ts) so the
// IPC transport and the dev-in-browser fetch transport share one decoder.
//
// SENDER BINDING (the §B.3 contract). Every handler below re-derives its
// subject from `event.sender` and refuses anything that is not the SPA window's
// own top frame — the same rule main/channel-dir-ipc.js's `mainOnly` enforces
// for the remote main window (an iframe SHARES its host's webContents, so
// identity alone is not enough). That file keeps its own copy of the predicate
// because its pure block is sliced by test/channel-ipc-sender.test.mjs; do not
// "de-duplicate" by editing it out from under that test.
//
// NOT WIRED YET. See dopl-desktop-app/WIRING.md.

const { ipcMain, shell } = require('electron');
const appVersion = require('./app-version');
const { API_BASE } = require('./config');
const { diag } = require('./diag');

const AUTH_STATE_EVENT = 'dopl:auth-state-changed';
const REQUEST_TIMEOUT_MS = 30_000;

// ─── BEGIN UI-BRIDGE-PURE (guards; unit-testable via source extraction) ──────
// No electron/require refs below.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TRUE only for the given window's own TOP frame. `win` is resolved at CALL
// time, so a destroyed or not-yet-built window fails closed rather than
// throwing. `senderFrame` is a getter that THROWS once the frame is detached,
// so it is read defensively: a frame we cannot read is refused.
function isWindowSender(event, win) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  const sender = event && event.sender;
  if (!sender || sender !== win.webContents) return false;
  let frame;
  try {
    frame = event.senderFrame;
  } catch (_err) {
    return false;
  }
  if (frame && sender.mainFrame && frame !== sender.mainFrame) return false;
  return true;
}

// The renderer may reach the API and NOTHING else. A path that is not an
// app-relative `/api/...` is refused before a URL is built, so the bridge can
// never be steered at another origin (`//evil.example/x` is a protocol-relative
// URL), at the auth pages, or out of the prefix via `..` normalization.
function isApiPath(path) {
  const p = String(path == null ? '' : path);
  if (!p.startsWith('/api/')) return false;
  if (p.startsWith('//')) return false;
  if (p.includes('\\') || p.includes('..')) return false;
  return true;
}

// Only http(s) may be opened externally: a `file:`/`smb:` URL handed to the OS
// opener is a local-file / credential-leak primitive, not a link.
function isExternalUrl(url) {
  try {
    const scheme = new URL(String(url)).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch (_err) {
    return false;
  }
}

// x-workspace-id is UUID-only server-side (src/shared/auth/with-workspace-auth.ts
// — blank/non-UUID is a 400), so a malformed id is a caller bug: refuse it here
// rather than silently dropping the header and running against another scope.
function isWorkspaceId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}
// ─── END UI-BRIDGE-PURE ──────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// THE AUTH SEAM — deliberately unimplemented in this file.
//
// Phase 2's decision (docs/DESKTOP-MIGRATION-PLAN.md, corrections §1) is
// Supabase-JWT-as-Bearer: main attaches `Authorization: Bearer <supabase access
// token>` and `withUserAuth` grows a bearer-KIND branch. Today main's HTTP is
// COOKIE-based (main/api.js:6-7) and the jar is refreshed by the remote web
// page — the refresher that the bundled SPA removes
// (docs/migration-research/desktop-main.md §3.3 B1–B8).
//
// So the token half is being built separately. These two functions are the
// entire seam; when the auth work lands, they become the only edits here.
// Until then every request goes out UNAUTHENTICATED and the API answers 401 —
// which is the honest failure, not a silent one.
// ─────────────────────────────────────────────────────────────────────────────

// TODO(auth): return the current Supabase access token from the main-process
// token store, refreshing it proactively when it is near expiry. Never return
// it to the renderer — it exists only to build this header.
function getBearerToken() {
  return null;
}

// TODO(auth): derive from the token store's JWT (main/auth.js `getUserId()`
// reads the id with no network call). MUST stay token-free: `{ signedIn,
// userId }` is the entire contract the renderer is allowed to see.
function getAuthState() {
  return { signedIn: false, userId: null };
}

async function performApiRequest(path, opts) {
  const method = opts.method || 'GET';
  const headers = { Accept: 'application/json', ...appVersion.versionHeaders() };

  const token = getBearerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.workspaceId) headers['X-Workspace-Id'] = opts.workspaceId;
  if (opts.expectedUpdatedAt) headers['x-updated-at'] = opts.expectedUpdatedAt;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    // Node's global fetch — the same undici pool main/api.js documents (and
    // resets after a network transition), NOT Chromium's stack.
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const out = { status: res.status, statusText: res.statusText, hasBody: false };
  if (res.status === 204) return out;
  try {
    out.body = await res.json();
    out.hasBody = true;
  } catch (_err) {
    // Non-JSON (an HTML error page, an empty 500) — the renderer's decoder
    // turns a bodiless failure into ApiError(status, INTERNAL_ERROR).
  }
  return out;
}

/**
 * Register the bridge. `opts.getMainWindow()` returns the live SPA
 * BrowserWindow (or null) — the ONE sender every handler is bound to. Absent,
 * every handler fails CLOSED: an unbound privileged surface is not a usable one.
 */
function register(opts = {}) {
  const getWindow =
    typeof opts.getMainWindow === 'function' ? opts.getMainWindow : () => null;

  // Refusals REJECT rather than returning a synthetic HTTP status: a refused
  // call is a caller bug (or an attack), never a server answer, and must not be
  // decodable as one.
  const bound = (name, fn) => async (event, ...args) => {
    if (!isWindowSender(event, getWindow())) {
      diag('ui-bridge: refused', name, '— sender is not the SPA window top frame');
      throw new Error('dopl: refused');
    }
    return fn(event, ...args);
  };

  ipcMain.handle(
    'dopl:api-request',
    bound('api-request', async (_event, path, rawOpts) => {
      if (!isApiPath(path)) throw new Error('dopl: invalid api path');
      const o = rawOpts && typeof rawOpts === 'object' ? rawOpts : {};
      if (o.workspaceId !== undefined && !isWorkspaceId(o.workspaceId)) {
        throw new Error('dopl: invalid workspace id');
      }
      return performApiRequest(path, o);
    })
  );

  ipcMain.handle(
    'dopl:auth-state',
    bound('auth-state', () => getAuthState())
  );

  ipcMain.handle(
    'dopl:open-external',
    bound('open-external', async (_event, url) => {
      if (!isExternalUrl(url)) return { ok: false };
      try {
        await shell.openExternal(String(url));
        return { ok: true };
      } catch (err) {
        diag('ui-bridge openExternal error', err && err.message);
        return { ok: false };
      }
    })
  );
}

/**
 * Push a fresh auth state to the SPA window (`window.dopl.onAuthState`). The
 * auth wiring calls this on sign-in, sign-out and refresh; nothing polls.
 * Token-free by contract — pass `{ signedIn, userId }` only.
 */
function broadcastAuthState(win, state) {
  if (!win || win.isDestroyed()) return;
  const s = state || getAuthState();
  win.webContents.send(AUTH_STATE_EVENT, {
    signedIn: Boolean(s.signedIn),
    userId: s.userId == null ? null : String(s.userId),
  });
}

module.exports = {
  register,
  broadcastAuthState,
  isApiPath,
  isExternalUrl,
  isWorkspaceId,
  isWindowSender,
  AUTH_STATE_EVENT,
};

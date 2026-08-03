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
const authTokens = require('./auth-tokens');
const { API_BASE } = require('./config');
const uiSync = require('./ui-sync');
const authActions = require('./auth-actions');
const auth = require('./auth');
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
  // FAIL CLOSED: a frame we cannot read — or a webContents whose mainFrame
  // is gone — is refused, never waved through.
  if (!frame || !sender.mainFrame || frame !== sender.mainFrame) return false;
  return true;
}

// The renderer may reach the API and NOTHING else. PARSE FIRST, GATE THE
// RESULT: a character blacklist runs before WHATWG normalization, which
// decodes dot-segments AFTER the check (`/api/%2e%2e/auth/x` resolves to
// `/auth/x`), so the gate must judge the URL the fetch will actually use.
// Returns the resolved absolute href, or null when refused — the caller
// fetches the RETURNED href, never the raw input. Origin equality kills
// protocol-relative (`//evil.example/api/x`) and credentialed forms; the
// normalized-pathname prefix check kills every traversal encoding.
function resolveApiUrl(path, apiBase) {
  let u;
  try {
    u = new URL(String(path == null ? '' : path), apiBase);
  } catch (_err) {
    return null;
  }
  if (u.origin !== new URL(apiBase).origin) return null;
  if (!(u.pathname === '/api' || u.pathname.startsWith('/api/'))) return null;
  return u.href;
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
// THE AUTH SEAM — now implemented against main/auth-tokens.js.
//
// Phase 2's decision (docs/DESKTOP-MIGRATION-PLAN.md, corrections §1) is
// Supabase-JWT-as-Bearer: main attaches `Authorization: Bearer <supabase access
// token>` and `withUserAuth` has grown a bearer-KIND branch, so this bearer is a
// SESSION caller (not an agent) and `sessionOnly` routes answer it.
//
// These two functions are still the entire seam — the names are load-bearing for
// WIRING.md and for anything that greps for them. `getBearerToken` is now async
// because the authority refreshes in line when the token is near expiry; nothing
// else about the shape changed.
//
// INVARIANT (auth-flows.md §5 I8): the token value may become an outbound
// Authorization header and NOTHING else. `getAuthState()` is what crosses IPC,
// and it is token-free by construction.
// ─────────────────────────────────────────────────────────────────────────────

// The current Supabase access token from the main-process token authority,
// proactively refreshed when it is near expiry. NEVER returned to the renderer —
// it exists only to build the header below.
function getBearerToken() {
  return authTokens.getAccessToken();
}

// `{ signedIn, userId }` — derived from the stored session's JWT with no network
// call. Token-free by contract: this is the entire shape the renderer may see.
function getAuthState() {
  return authTokens.getAuthState();
}

async function sendApiRequest(href, opts, token) {
  const method = opts.method || 'GET';
  const headers = { Accept: 'application/json', ...appVersion.versionHeaders() };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.workspaceId) headers['X-Workspace-Id'] = opts.workspaceId;
  if (opts.expectedUpdatedAt) headers['x-updated-at'] = opts.expectedUpdatedAt;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Node's global fetch — the same undici pool main/api.js documents (and
    // resets after a network transition), NOT Chromium's stack.
    return await fetch(href, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function performApiRequest(href, opts) {
  let res = await sendApiRequest(href, opts, await getBearerToken());

  // 401 REPAIR — ONE forced rotation and ONE retry, never a loop. The token can
  // be revoked or rotated out from under a request that was already in flight; a
  // 401 that survives a fresh token is a real authorization answer.
  if (authTokens.shouldRepairAuth(res.status, false)) {
    const fresh = await authTokens.forceRefresh();
    if (fresh && fresh.access_token) {
      res = await sendApiRequest(href, opts, fresh.access_token);
    }
    if (res.status === 401) authTokens.emitAuthState('signed-out');
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
      const href = resolveApiUrl(path, API_BASE);
      if (!href) throw new Error('dopl: invalid api path');
      const o = rawOpts && typeof rawOpts === 'object' ? rawOpts : {};
      if (o.workspaceId !== undefined && !isWorkspaceId(o.workspaceId)) {
        // SERVER-SHAPED 400, not a bridge rejection: the renderer's decoder
        // must see `status: 400` so TanStack's retry policy treats it as
        // permanent (a status-less Error is retried as if transient) and
        // the page surfaces the same envelope the server would answer.
        return {
          status: 400,
          statusText: 'Bad Request',
          hasBody: true,
          body: {
            error: {
              code: 'WORKSPACE_INVALID',
              message: 'x-workspace-id must be a UUID',
            },
          },
        };
      }
      return performApiRequest(href, o);
    })
  );

  ipcMain.handle(
    'dopl:auth-state',
    bound('auth-state', () => getAuthState())
  );

  ipcMain.handle(
    'dopl:begin-sign-in',
    bound('begin-sign-in', () => {
      // Sign-in MUST start in main: beginSignIn() arms the login-CSRF
      // pending-auth nonce and appends it as ?state= before opening the
      // browser — a renderer-side openExternal skips the nonce and
      // captureFromFragment (correctly) refuses the returning deep link.
      void authActions.beginSignIn({});
      return { ok: true };
    })
  );

  ipcMain.handle(
    'dopl:sign-out',
    bound('sign-out', async () => {
      // SPA sign-out: drop the credential (blob + jar) and emit the
      // signed-out push — the renderer flips to the signed-out screen on
      // it. Deliberately NOT authActions.signOut(): that loads the remote
      // home page into the window, which is the OLD shell's step.
      await auth.signOut();
      try { authTokens.onSignOut(); } catch (_err) { /* not started */ }
      return { ok: true };
    })
  );

  ipcMain.handle(
    'dopl:sync-watch',
    bound('sync-watch', (_event, workspaceId) => {
      // null = unwatch; anything else must be a workspace UUID — the same
      // gate the api-request header enforces.
      if (workspaceId === null) {
        uiSync.watch(null);
        return { ok: true };
      }
      if (!isWorkspaceId(workspaceId)) return { ok: false };
      uiSync.watch(workspaceId);
      return { ok: true };
    })
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
  resolveApiUrl,
  isExternalUrl,
  isWorkspaceId,
  isWindowSender,
  AUTH_STATE_EVENT,
};

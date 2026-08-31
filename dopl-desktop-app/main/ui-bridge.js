// IPC handlers for the BUNDLED UI window — the main-process half of renderer/app-preload.js
// (see that file for the two invariants; main/spa-window.js for the window itself).
//
// ⚠ The renderer owns NO credentials and opens NO sockets: it hands main a path, main decides
// the origin, attaches Authorization, fetches on main's own pool, and returns a plain
// `{ status, statusText, hasBody, body }`. The error ENVELOPE is decoded in the renderer
// (apps/desktop-ui/src/lib/api.ts) so the IPC and dev-in-browser transports share one decoder.
//
// ⚠ SENDER BINDING (§B.3): every handler re-derives its subject from `event.sender` and refuses
// anything that is not an APP-OWNED window's own TOP FRAME — an iframe SHARES its host's
// webContents, so identity alone is not enough.
// ⚠ THE PREDICATE IS SHARED, AND THIS PARAGRAPH USED TO FORBID THAT (corrected 2026-08-20). It
// read: "main/channel-dir-ipc.js keeps its OWN copy of this predicate because its pure block is
// sliced by test/channel-ipc-sender.test.mjs; do NOT de-duplicate it out from under that test."
// The instinct was right and the conclusion was wrong: the two copies had ALREADY drifted once
// (F-221), with the more privileged surface on the LENIENT side of an absent `senderFrame`. The
// extraction idiom is satisfiable with ONE source — `main/ipc-guards.js` carries its own
// BEGIN/END sentinels and BOTH suites slice it. De-duplicating out from under a test is the
// hazard; de-duplicating INTO the thing the tests slice is the fix.
//
// ⚠ WIDENED 2026-08-18 (wiring plan Phase 10, Samuel's ruling — option (a)): the subject was
// "the MAIN window" and is now "any window in main/app-windows.js's registry" — the shell plus
// any pop-out thread window. Read that module's header for why the registry cannot be enlarged
// from a renderer. THE IFRAME CHECK DID NOT MOVE, the fail-closed direction did not move, and
// the refusal shape did not move; only the identity half is wider.
//
// NOT WIRED YET. See dopl-desktop-app/WIRING.md.

const { ipcMain, shell } = require('electron');
const appVersion = require('./app-version');
const authTokens = require('./auth-tokens');
// ⚠ THE BODY-RELEASE HELPER ONLY — NOT `fetchWithAuthRepair`, which repairs the COOKIE
// JAR (a jar write from the bearer seam would be wrong; api-repair.js states the split).
// `discardBody` is the transport-agnostic half, so it is shared, not re-implemented.
const { discardBody } = require('./api-repair');
const { API_BASE, APP_ORIGIN } = require('./config');
const uiSync = require('./ui-sync');
const sessionSummary = require('./session-summary'); // the session-pill projection
const authActions = require('./auth-actions');
const authPassword = require('./auth-password');
const auth = require('./auth');
const avatarPolicy = require('./avatar-policy');
// ⚠ THE SENDER GUARD IS NO LONGER A COPY (2026-08-20). `isAppWindowSender` stood verbatim in
// the pure block below AND in `main/channel-dir-ipc.js`; the two had already disagreed once
// (F-221) with the more privileged surface on the lenient side. It now lives in
// `main/ipc-guards.js`, which carries its own BEGIN/END sentinels so both suites slice ONE
// source. It is re-exported below because callers already import it through this module.
const { isAppWindowSender } = require('./ipc-guards');
const { diag } = require('./diag');

const AUTH_STATE_EVENT = 'dopl:auth-state-changed';
const REQUEST_TIMEOUT_MS = 30_000;

// THE APP'S OWN UI, STAMPED. Without it a request the operator TYPES is indistinguishable
// server-side from an external agent's post, and the listener can only open something inert on
// a caller-asserted `authorKind`. targeting.requesterTaskOpen reads the resulting
// `metadata.runtime` and launches a full requester session, as it does for `desktop-session`.
// ⚠ STAMPED HERE AND NOWHERE ELSE: this is the ONE transport the SPA renderer has
// (app-preload.js exposes no header surface, every handler is bound to the window's top frame),
// so the stamp cannot ride anything the renderer did not originate and a new call site cannot
// forget it. main/api.js and listener-io.js are deliberately untouched — their callers are the
// LISTENER and SESSION lanes, whose posts are not the operator typing.
// ⚠ ROUTING HINT, NOT AUTHORIZATION (src/shared/auth/runtime-header.ts). The header proves
// nothing; the server refuses this value to any AGENT credential, and routing rests on the
// unforgeable identity pair. Unconditional — it identifies the RUNTIME, not the workspace.
const RUNTIME_HEADER = 'X-Dopl-Runtime';
const DESKTOP_UI_RUNTIME = 'desktop-ui';

// ─── BEGIN UI-BRIDGE-PURE (guards; unit-testable via source extraction) ──────
// No electron/require refs below.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ⚠ `isAppWindowSender` STOOD HERE AND IS NOW SHARED (2026-08-20). It moved WHOLE and
// unchanged to `main/ipc-guards.js`, which carries its own BEGIN/END sentinels so this suite
// and `test/channel-ipc-sender.test.mjs` slice one source instead of two copies. It is
// required at the top of this file and re-exported, so every caller reads the same name. The
// rest of this block stays pure: nothing below refers to it.

// The renderer may reach the API and NOTHING else.
// ⚠ PARSE FIRST, GATE THE RESULT. A character blacklist runs before WHATWG normalization,
// which decodes dot-segments AFTER the check (`/api/%2e%2e/auth/x` resolves to `/auth/x`), so
// the gate must judge the URL the fetch will actually use. ⚠ The caller fetches the RETURNED
// href, never the raw input. Origin equality kills protocol-relative (`//evil.example/api/x`)
// and credentialed forms; the normalized-pathname prefix kills every traversal encoding.
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

// ⚠ WHERE the OS opener may be pointed. The scheme check above is NOT a policy: no CSP applies
// to `shell.openExternal`, so a scheme-only gate makes this handler the renderer's arbitrary
// outbound GET — the one hole in the SPA's `connect-src 'none'` containment, and the exfil leg
// for anything the renderer can read back over the API bridge. Hence an ALLOWLIST:
//   • the app's own origin — settings, billing, account, sign-in help (DOPL_APP_URL in dev)
//   • *.stripe.com  — hosted checkout + billing portal, URLs the API mints
//   • *.github.com  — the notarized DMG on the releases page
// Adding a destination is a deliberate edit HERE, never a side effect of a ported component.
const EXTERNAL_HOST_ALLOWLIST = Object.freeze(['stripe.com', 'github.com']);

function isAllowedExternalUrl(url, appOrigin) {
  if (!isExternalUrl(url)) return false;
  const u = new URL(String(url));
  if (appOrigin && u.origin === appOrigin) return true;
  // Third parties are https-only; the app origin above may be http in dev.
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return EXTERNAL_HOST_ALLOWLIST.some((h) => host === h || host.endsWith(`.${h}`));
}

// ⚠ x-workspace-id is UUID-only server-side (src/shared/auth/with-workspace-auth.ts — blank or
// non-UUID is a 400). Refuse a malformed id here rather than silently dropping the header and
// running against another scope.
function isWorkspaceId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}
// ─── END UI-BRIDGE-PURE ──────────────────────────────────────────────────────

// ── THE AUTH SEAM (main/auth-tokens.js) ──────────────────────────────────────
// Supabase-JWT-as-Bearer: main attaches `Authorization: Bearer <supabase access token>`, and
// `withUserAuth`'s bearer-KIND branch makes it a SESSION caller (not an agent), so `sessionOnly`
// routes answer it. ⚠ These two function NAMES are load-bearing for WIRING.md and for greps.
// ⚠ INVARIANT (auth-flows.md §5 I8): the token value may become an outbound Authorization
// header and NOTHING else. `getAuthState()` is what crosses IPC and is token-free by
// construction.

// Current Supabase access token, refreshed in line when near expiry. ⚠ NEVER returned to the
// renderer — it exists only to build the header below.
function getBearerToken() {
  return authTokens.getAccessToken();
}

// `{ signedIn, userId }` from the stored session's JWT, no network call. ⚠ Token-free by
// contract: this is the entire shape the renderer may see.
function getAuthState() {
  return authTokens.getAuthState();
}

// WARM THE CREDENTIAL AT LAUNCH, NOT ON THE FIRST REQUEST. performApiRequest awaits
// getBearerToken(), which ROTATES IN LINE while the stored token is inside auth-tokens'
// near-expiry window — where a cold start lands whenever the app was closed past ~80% of a
// token's life (~48 min). Paid there it is a serial hop in front of the SPA's first API call;
// paid here it overlaps window creation. ⚠ FIRE AND FORGET — it warms a cache and gates
// nothing: signed out costs no network call, and a failed rotation is auth-tokens' business.
function primeAuth() {
  getBearerToken().catch((err) =>
    diag('ui-bridge: auth prime failed —', (err && err.message) || String(err))
  );
}

async function sendApiRequest(href, opts, token) {
  const method = opts.method || 'GET';
  const headers = {
    Accept: 'application/json',
    ...appVersion.versionHeaders(),
    [RUNTIME_HEADER]: DESKTOP_UI_RUNTIME,
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.workspaceId) headers['X-Workspace-Id'] = opts.workspaceId;
  if (opts.expectedUpdatedAt) headers['x-updated-at'] = opts.expectedUpdatedAt;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    // ⚠ Node's global fetch — the same undici pool main/api.js documents (and resets after a
    // network transition), NOT Chromium's stack.
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

// ⚠ COPIED FROM THE SERVER, NOT INVENTED: byte-for-byte the body
// `src/shared/auth/with-auth.ts` answers a credential-less request — the flat
// `{ error, message }` shape `api-envelope.decodeResponse` turns into
// `ApiError(401, "Authentication required", "Sign in to continue.")`. A prettier envelope
// here would make ONE condition read two ways depending on whether the request left the
// machine, which is the drift the shared decoder exists to prevent.
function unauthenticatedEnvelope() {
  return {
    status: 401,
    statusText: 'Unauthorized',
    hasBody: true,
    body: { error: 'Authentication required', message: 'Sign in to continue.' },
  };
}

async function performApiRequest(href, opts) {
  // ⚠ NO SESSION ⇒ NO REQUEST (2026-08-30, the abort-churn incident). This seam attaches
  // a BEARER and nothing else, so with no stored session the request is unauthenticated
  // by construction and `withUserAuth` can only answer 401. Sending it anyway cost
  // everything on the failing path: against a saturated API each doomed call held a
  // socket for REQUEST_TIMEOUT_MS and then REJECTED the IPC with a status-less
  // AbortError — which `page-states.isUnauthorized` cannot read as "signed out", so the
  // SPA stranded on a retryable error card instead of the sign-in screen, and a
  // status-less error is the one class the shared TanStack predicate DOES retry.
  //
  // ⚠ THE DISCRIMINATOR IS THE AUTHORITY'S STATE, NOT A NULL TOKEN READ: `getBearerToken()`
  // also answers null for a SIGNED-IN operator mid-backoff after a network blip, and a 401
  // there is the renderer flap the note below refuses to cause. `getAuthState().signedIn`
  // is false only when nothing is stored — where a refused OS keychain leaves the app.
  if (!getAuthState().signedIn) return unauthenticatedEnvelope();

  let res = await sendApiRequest(href, opts, await getBearerToken());

  // ⚠ 401 REPAIR — ONE forced rotation and ONE retry, NEVER a loop. A token can be revoked or
  // rotated out from under an in-flight request; a 401 surviving a fresh token is a real answer.
  if (authTokens.shouldRepairAuth(res.status, false)) {
    const fresh = await authTokens.forceRefresh();
    // ⚠ ONLY A 401 THAT SURVIVED A FRESH TOKEN IS A SIGN-OUT. A null refresh does NOT mean the
    // session is dead — auth-tokens classifies 5xx/429/timeouts as TRANSIENT, keeps the stored
    // session and has just emitted 'signed-in'. Emitting 'signed-out' off the ORIGINAL 401
    // flips the renderer to the login screen and tears down the sync feed (watched workspace
    // included) on a network blip, then flaps back. main/api.js gates it the same way.
    if (fresh && fresh.access_token) {
      // ⚠ RELEASE THE FIRST 401 BEFORE OPENING A SECOND CONNECTION (2026-08-30). `res` is
      // about to be reassigned and its body is then unreachable — and an unread undici body
      // counts as IN FLIGHT, pinning socket + TLS state (native, invisible to a heap
      // snapshot). `api-repair.js` covers this for the two COOKIE transports; ui-bridge is
      // the BEARER one, kept its rule inline, and kept the leak with it.
      discardBody(res);
      res = await sendApiRequest(href, opts, fresh.access_token);
      // ⚠ RECORDED, NOT JUST ANNOUNCED (2026-08-30): a bare `emitAuthState('signed-out')`
      // changed nothing, so the next request re-announced signed-IN and the renderer read
      // an auth transition per 401. `auth-tokens.js › noteSessionRejected` has the loop.
      if (res.status === 401) authTokens.noteSessionRejected('ui-bridge: 401 survived a forced refresh');
    }
  }

  const out = { status: res.status, statusText: res.statusText, hasBody: false };
  if (res.status === 204) return out;
  try {
    out.body = await res.json();
    out.hasBody = true;
  } catch (_err) {
    // Non-JSON (HTML error page, empty 500) — the renderer's decoder turns a bodiless failure
    // into ApiError(status, INTERNAL_ERROR).
  }
  return out;
}

// ⚠ THE POST-AUTH KICK. Without it the channel listener keeps long-polling on a revoked
// credential after a sign-out (up to the 5-minute reconcile, with a misleading "your session
// expired" notification in between), and after a password sign-in the tray still reads "signed
// out" and the CLI's MCP config is never written. ⚠ Lazy requires: both modules pull in the
// auth stack this file is part of.
function kickListener(reason) {
  try {
    require('./channel-listener').restart();
  } catch (err) {
    diag('ui-bridge: listener restart failed —', reason, (err && err.message) || String(err));
  }
}

function ensureMcpConfig(reason) {
  try {
    require('./mcp-config')
      .ensureMcpConfig()
      .catch((err) => diag('ui-bridge: mcp-config —', reason, err && err.message));
  } catch (err) {
    diag('ui-bridge: mcp-config —', reason, (err && err.message) || String(err));
  }
}

/**
 * Register the bridge. `opts.getSenderIds()` returns the LIVE set of app-owned `webContents`
 * ids (main/app-windows.js › senderIds) — the senders every handler here is bound to.
 * ⚠ Absent, every handler fails CLOSED: an unbound privileged surface is not a usable one.
 */
function register(opts = {}) {
  const getSenderIds =
    typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  // In whenReady, BEFORE createShellWindow — the earliest point a token rotation can start.
  primeAuth();

  // ⚠ Refusals REJECT rather than returning a synthetic HTTP status: a refused call is a caller
  // bug (or an attack), never a server answer, and must not be decodable as one.
  const bound = (name, fn) => async (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('ui-bridge: refused', name, '— sender is not an app window top frame');
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
        // ⚠ SERVER-SHAPED 400, not a bridge rejection: the renderer's decoder must see
        // `status: 400` so TanStack treats it as permanent (a status-less Error is retried as
        // transient) and the page surfaces the envelope the server would answer.
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
    bound('begin-sign-in', (_event, provider) => {
      // ⚠ Sign-in MUST start in main: beginSignIn() arms the login-CSRF pending-auth nonce and
      // appends it as ?state= before opening the browser. A renderer-side openExternal skips
      // the nonce and captureFromFragment then (correctly) refuses the returning deep link.
      // Provider is a closed enum; anything else falls back to google.
      const p = provider === 'github' ? 'github' : 'google';
      void authActions.beginSignIn({ provider: p });
      return { ok: true };
    })
  );

  ipcMain.handle(
    'dopl:password-sign-in',
    bound('password-sign-in', async (_event, payload) => {
      const out = await authPassword.passwordAuth(payload);
      if (out.ok && !out.pendingConfirmation) {
        try { authTokens.onSignIn(); } catch (_err) { /* not started */ }
        kickListener('password-sign-in');
        ensureMcpConfig('password-sign-in');
      }
      return out;
    })
  );

  ipcMain.handle(
    'dopl:magic-link',
    bound('magic-link', (_event, payload) => authPassword.sendMagicLink(payload))
  );

  ipcMain.handle(
    'dopl:sign-out',
    bound('sign-out', async () => {
      // SPA sign-out: drop the credential (blob + jar) and emit the signed-out push.
      // ⚠ Deliberately NOT authActions.signOut() — that loads the remote home page into the
      // window, which is the OLD shell's step.
      await auth.signOut();
      try { authTokens.onSignOut(); } catch (_err) { /* not started */ }
      kickListener('sign-out');
      return { ok: true };
    })
  );

  ipcMain.handle(
    'dopl:sync-watch',
    bound('sync-watch', (_event, workspaceId) => {
      // null = unwatch; anything else must be a workspace UUID — the same gate the api-request
      // header enforces.
      if (workspaceId === null) {
        uiSync.watch(null);
        return { ok: true };
      }
      if (!isWorkspaceId(workspaceId)) {
        // ⚠ REJECT, never a soft `{ ok: false }`: the renderer's registry commits the watch on
        // any RESOLVED answer (shared-channel-registry issueWatch), so a refusal it can read as
        // a resolution leaves it believing it watches a workspace main never joined — a
        // permanently dead feed its own dedupe then refuses to re-issue.
        diag('ui-bridge: refused sync-watch — workspaceId is not a UUID');
        throw new Error('dopl: invalid workspace id');
      }
      uiSync.watch(workspaceId);
      return { ok: true };
    })
  );

  // SESSION PILLS — the CURRENT summaries for a just-mounted view. The feed itself is a PUSH
  // (`dopl:sessions`, armed by session-summary.start), and a push-only surface leaves a freshly
  // opened channel blank until the next state change, which on a quiet machine is never. Read
  // once on mount, then listen.
  // ⚠ HERE, not beside `sessions:reopen` in `session-ipc-ops.js`, and the ORIGINAL reason is
  // retired: it was "that file is the surface exposed to the window hosting a REMOTE page,
  // which renderer/preload.js does not expose". The remote shell and its preload are deleted
  // (corrected 2026-08-20). What survives is the REAL distinction: this transport's `bound`
  // wrapper REJECTS a foreign sender outright, while the ops surface answers a refusal SHAPE
  // indistinguishable from a bad payload — a difference that matters for a read like this one,
  // where a refusal and an empty answer must not be confusable.
  // DERIVED, NEVER STORED: a projection over the in-memory registry. Starts no query, opens no
  // window, writes no row, touches no network.
  ipcMain.handle(
    'sessions:summaries',
    bound('sessions-summaries', () => ({ sessions: sessionSummary.list() }))
  );

  ipcMain.handle(
    'dopl:avatar',
    bound('avatar', async (_event, url) => {
      // ⚠ NULL, never a throw: every caller already renders initials for a missing image, and
      // a rejection surfaces as an unhandled promise in a component with nothing to do with
      // it. Allowlist + bounded fetch live in main/avatar-policy.js; the renderer never learns
      // which of them said no.
      return avatarPolicy.resolveAvatarDataUri(String(url == null ? '' : url));
    })
  );

  ipcMain.handle(
    'dopl:open-external',
    bound('open-external', async (_event, url) => {
      if (!isAllowedExternalUrl(url, APP_ORIGIN)) {
        // ⚠ Log the HOST, never the URL: a refused URL may carry whatever the caller was
        // trying to smuggle out in its query string.
        let host = '?';
        try { host = new URL(String(url)).host || '?'; } catch (_err) { /* unparseable */ }
        diag('ui-bridge: refused open-external — host not on the allowlist:', host);
        return { ok: false };
      }
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
 * Push a fresh auth state to EVERY app window (`window.dopl.onAuthState`). Called on sign-in,
 * sign-out and refresh; nothing polls. ⚠ Token-free by contract — `{ signedIn, userId }` only.
 *
 * ⚠ FANS OUT SINCE 2026-08-18 (Phase 10). `targets` is the app-window registry's live list; a
 * bare window is still accepted, because every caller used to pass one. A pop-out that never
 * learns about a SIGN-OUT keeps rendering the previous session's data with no way to say so —
 * the same silent-staleness failure the pop-out's realtime fan-out answers, but with a
 * credential behind it, so this one is not optional. One dead window must not stop the rest.
 */
function broadcastAuthState(targets, state) {
  const wins = Array.isArray(targets) ? targets : targets ? [targets] : [];
  const s = state || getAuthState();
  const payload = {
    signedIn: Boolean(s.signedIn),
    userId: s.userId == null ? null : String(s.userId),
  };
  let sent = 0;
  for (const win of wins) {
    if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) continue;
    try {
      win.webContents.send(AUTH_STATE_EVENT, payload);
      sent += 1;
    } catch (err) {
      diag('ui-bridge: auth push failed —', (err && err.message) || String(err));
    }
  }
  return sent;
}

module.exports = {
  register,
  broadcastAuthState,
  resolveApiUrl,
  isExternalUrl,
  isAllowedExternalUrl,
  isWorkspaceId,
  isAppWindowSender,
  AUTH_STATE_EVENT,
};

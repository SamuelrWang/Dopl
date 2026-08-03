// Preload for the BUNDLED UI window (main/spa-window.js).
//
// `window.dopl` here is the ENTIRE privileged API the SPA gets: four members,
// no dynamic channels, no Node, no fs. It follows session-preload.js's model (a
// local page may hold a real bridge) with session-preload.js's discipline
// (every argument coerced to a primitive before it crosses, fail-closed).
//
// TWO INVARIANTS THAT MUST SURVIVE EVERY EDIT:
//
//  1. NO TOKENS. `getAuthState` answers `{ signedIn, userId }` and nothing
//     else. The access token, the refresh token and the cookie jar stay in
//     main (main/auth-store.js keeps the blob in safeStorage). A renderer that
//     never holds a credential cannot leak one.
//  2. NO CALLER-SUPPLIED HEADERS. `apiRequest` takes a path and a small typed
//     options object; main builds every header, including Authorization. If the
//     page could set headers it could forge identity or reach a third party.
//
// The main side additionally binds every handler to THIS window's top frame
// (main/ui-bridge.js), so a payload can never target another window.

const { contextBridge, ipcRenderer } = require('electron');

const AUTH_STATE_EVENT = 'dopl:auth-state-changed';

const METHODS = { GET: 1, POST: 1, PATCH: 1, PUT: 1, DELETE: 1 };

const asStr = (v) => String(v == null ? '' : v);
// Fail-closed: an unknown verb becomes the read-only one, never a write.
const asMethod = (v) => {
  const s = asStr(v).toUpperCase();
  return METHODS[s] ? s : 'GET';
};

// Only the two request-shaping headers the app's HTTP contract defines
// (x-workspace-id, x-updated-at) may be influenced from here, and only as
// values — main decides the header names. Body is passed through the structured
// clone as-is; main serializes it.
function asRequestOpts(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const out = { method: asMethod(o.method) };
  if (o.workspaceId != null) out.workspaceId = asStr(o.workspaceId);
  if (o.expectedUpdatedAt != null) out.expectedUpdatedAt = asStr(o.expectedUpdatedAt);
  if (o.body !== undefined) out.body = o.body;
  return out;
}

// main → renderer auth pushes. One shared listener, fanned out to the page's
// callbacks; the raw ipcRenderer event object is never handed over.
const authListeners = new Set();
ipcRenderer.on(AUTH_STATE_EVENT, (_event, state) => {
  for (const cb of authListeners) {
    try {
      cb(state);
    } catch (_err) {
      /* never let a renderer callback throw back across the bridge */
    }
  }
});

contextBridge.exposeInMainWorld('dopl', {
  // → { status, statusText, hasBody, body? }. Never throws for an HTTP status;
  //   the renderer decodes the error envelope (apps/desktop-ui/src/lib/api.ts).
  //   Rejects only when the request never completed or the call was malformed.
  apiRequest: (path, opts) =>
    ipcRenderer.invoke('dopl:api-request', asStr(path), asRequestOpts(opts)),

  // → { signedIn, userId }. NEVER a token.
  getAuthState: () => ipcRenderer.invoke('dopl:auth-state'),

  // Subscribe to sign-in/sign-out. Returns an unsubscribe function.
  onAuthState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    authListeners.add(callback);
    return () => authListeners.delete(callback);
  },

  // Open an http(s) URL in the SYSTEM browser (main re-validates the scheme).
  openExternal: (url) => ipcRenderer.invoke('dopl:open-external', asStr(url)),
});

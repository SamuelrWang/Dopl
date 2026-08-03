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

// The app's public origin, injected by main (spa-window.js
// additionalArguments). A constant, not a capability — safe to expose.
const APP_ORIGIN_ARG = process.argv
  .find((a) => a.startsWith('--dopl-app-origin='));
const APP_ORIGIN = APP_ORIGIN_ARG ? APP_ORIGIN_ARG.split('=')[1] : '';

// Channel-scoped input coercion, mirrored from renderer/preload.js — the
// bridge never forwards raw renderer values.
const asId = (channelId) => String(channelId == null ? '' : channelId);
const asMode = (mode) => String(mode == null ? '' : mode);

contextBridge.exposeInMainWorld('dopl', {
  // The public https origin for building user-facing URLs (join links,
  // MCP endpoints) — the document's own origin is file:// here.
  appOrigin: APP_ORIGIN,

  // → { status, statusText, hasBody, body? }. Never throws for an HTTP status;
  //   the renderer decodes the error envelope (apps/desktop-ui/src/lib/api.ts).
  //   Rejects only when the request never completed or the call was malformed.
  apiRequest: (path, opts) =>
    ipcRenderer.invoke('dopl:api-request', asStr(path), asRequestOpts(opts)),

  // Main-initiated navigation (notification click → the channel's page).
  // Path-only payload; the renderer's router decides what to do with it.
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      const p = payload && typeof payload === 'object' ? payload : {};
      const path = String(p.path || '');
      if (path.startsWith('/')) callback({ path });
    };
    ipcRenderer.on('dopl:navigate', listener);
    return () => ipcRenderer.removeListener('dopl:navigate', listener);
  },

  // Sign out: main drops the credential and pushes the signed-out state.
  signOut: () => ipcRenderer.invoke('dopl:sign-out'),

  // Start the external OAuth sign-in. Main arms the login-CSRF nonce and
  // opens the browser — the renderer never builds the URL.
  beginSignIn: (provider) =>
    ipcRenderer.invoke('dopl:begin-sign-in', provider === 'github' ? 'github' : 'google'),

  // Native email/password + magic link — main runs the GoTrue calls (the
  // renderer has no network). The password crosses this bridge once, into
  // one https request body; it is never stored or logged.
  passwordSignIn: (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return ipcRenderer.invoke('dopl:password-sign-in', {
      mode: p.mode === 'sign-up' ? 'sign-up' : 'sign-in',
      email: String(p.email == null ? '' : p.email),
      password: String(p.password == null ? '' : p.password),
    });
  },
  sendMagicLink: (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return ipcRenderer.invoke('dopl:magic-link', {
      email: String(p.email == null ? '' : p.email),
    });
  },

  // → { signedIn, userId }. NEVER a token.
  getAuthState: () => ipcRenderer.invoke('dopl:auth-state'),

  // Subscribe to sign-in/sign-out. Returns an unsubscribe function.
  onAuthState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    authListeners.add(callback);
    return () => authListeners.delete(callback);
  },

  // Open an http(s) URL in the SYSTEM browser (main re-validates the scheme).
  // Per-channel controls for the consent card + channel header — the SAME
  // five label-only ops the remote-page preload exposes (renderer/preload.js),
  // invoking the SAME sender-bound handlers (main/channel-dir-ipc.js, which
  // resolves the live main window — the SPA window in DOPL_UI=spa mode).
  // Absolute paths never cross this bridge; folder ops return labels only.
  channels: {
    getFolderLabel: (channelId) =>
      ipcRenderer.invoke('channels:getFolderLabel', asId(channelId)),
    chooseFolder: (channelId) =>
      ipcRenderer.invoke('channels:chooseFolder', asId(channelId)),
    clearFolder: (channelId) =>
      ipcRenderer.invoke('channels:clearFolder', asId(channelId)),
    getPermissionPreset: (channelId) =>
      ipcRenderer.invoke('channels:getPermissionPreset', asId(channelId)),
    setPermissionPreset: (channelId, preset) =>
      ipcRenderer.invoke('channels:setPermissionPreset', {
        channelId: asId(channelId),
        preset: {
          tools: asMode(preset && preset.tools),
          messages: asMode(preset && preset.messages),
        },
      }),
  },

  // Phase 3 live updates: main watches postgres_changes for the viewed
  // workspace's content tables and forwards coalesced change events; the
  // renderer's shared-channel-registry turns them into refetch signals.
  // syncWatch tells main WHICH workspace the UI is looking at (null =
  // none). Subscription returns an unsubscribe fn.
  syncWatch: (workspaceId) =>
    ipcRenderer.invoke('dopl:sync-watch', workspaceId == null ? null : String(workspaceId)),
  onSyncEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      const p = payload && typeof payload === 'object' ? payload : {};
      callback({ workspaceId: String(p.workspaceId || ''), table: String(p.table || '') });
    };
    ipcRenderer.on('dopl:sync-event', listener);
    return () => ipcRenderer.removeListener('dopl:sync-event', listener);
  },

  openExternal: (url) => ipcRenderer.invoke('dopl:open-external', asStr(url)),
});

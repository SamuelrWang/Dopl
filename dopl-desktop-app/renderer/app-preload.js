// Preload for the BUNDLED UI window (main/spa-window.js).
//
// `window.dopl` is the ENTIRE privileged API the SPA gets: a fixed, small set of members, no
// dynamic channels, no Node, no fs. Every argument is coerced to a primitive before it crosses,
// fail-closed (session-preload.js's discipline).
//
// ⚠ TWO INVARIANTS THAT MUST SURVIVE EVERY EDIT:
//  1. NO TOKENS. `getAuthState` answers `{ signedIn, userId }` and nothing else. Access token,
//     refresh token and cookie jar stay in main. A renderer that never holds a credential
//     cannot leak one.
//  2. NO CALLER-SUPPLIED HEADERS. `apiRequest` takes a path and a small typed options object;
//     main builds every header, Authorization included. A page that can set headers can forge
//     identity or reach a third party.
//
// Main additionally binds every handler to an APP-OWNED window's top frame
// (main/ui-bridge.js, main/channel-dir-ipc.js), so a payload can never target another window.
// ⚠ "APP-OWNED" WIDENED ON 2026-08-18 (wiring plan Phase 10) from "the main window" to
// "anything main/app-windows.js registered at creation" — the shell plus a pop-out thread
// window. This preload is what a pop-out gets too, deliberately: a pop-out is an app window,
// and REGISTRATION is what authorizes it, not a second, narrower bridge.

const { contextBridge, ipcRenderer } = require('electron');

const AUTH_STATE_EVENT = 'dopl:auth-state-changed';
// ⚠ A constant, like every other channel name: test/preload-parity pins that no ipc channel
// name is computed.
const SESSIONS_EVENT = 'dopl:sessions';

const METHODS = { GET: 1, POST: 1, PATCH: 1, PUT: 1, DELETE: 1 };

const asStr = (v) => String(v == null ? '' : v);
// Fail-closed: an unknown verb becomes the read-only one, never a write.
const asMethod = (v) => {
  const s = asStr(v).toUpperCase();
  return METHODS[s] ? s : 'GET';
};

// ⚠ Only the two request-shaping headers the HTTP contract defines (x-workspace-id,
// x-updated-at) may be influenced from here, and only as VALUES — main decides the names.
// Body rides the structured clone as-is; main serializes it.
function asRequestOpts(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const out = { method: asMethod(o.method) };
  if (o.workspaceId != null) out.workspaceId = asStr(o.workspaceId);
  if (o.expectedUpdatedAt != null) out.expectedUpdatedAt = asStr(o.expectedUpdatedAt);
  if (o.body !== undefined) out.body = o.body;
  return out;
}

// main -> renderer auth pushes. One shared listener fanned out to the page's callbacks;
// ⚠ the raw ipcRenderer event object is never handed over.
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

// The app's public origin, injected by main (spa-window.js additionalArguments). A constant,
// not a capability.
const APP_ORIGIN_ARG = process.argv
  .find((a) => a.startsWith('--dopl-app-origin='));
const APP_ORIGIN = APP_ORIGIN_ARG ? APP_ORIGIN_ARG.split('=')[1] : '';

// ⚠ Channel-scoped input coercion, mirrored from renderer/preload.js — the bridge never
// forwards raw renderer values.
const asId = (channelId) => String(channelId == null ? '' : channelId);
const asMode = (mode) => String(mode == null ? '' : mode);

contextBridge.exposeInMainWorld('dopl', {
  // Public https origin for user-facing URLs — the document's own origin is file:// here.
  appOrigin: APP_ORIGIN,

  // -> { status, statusText, hasBody, body? }. ⚠ Never throws for an HTTP status — the
  //    renderer decodes the error envelope (apps/desktop-ui/src/lib/api.ts). Rejects only when
  //    the request never completed or the call was malformed.
  apiRequest: (path, opts) =>
    ipcRenderer.invoke('dopl:api-request', asStr(path), asRequestOpts(opts)),

  // Main-initiated navigation (notification click -> the channel's page). Path-only payload.
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

  // ⚠ Main arms the login-CSRF nonce and opens the browser — the renderer never builds the
  // URL.
  beginSignIn: (provider) =>
    ipcRenderer.invoke('dopl:begin-sign-in', provider === 'github' ? 'github' : 'google'),

  // Native email/password + magic link — main runs the GoTrue calls (the renderer has no
  // network). ⚠ The password crosses once, into one https request body; never stored or
  // logged.
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

  // Per-channel controls for the consent card + channel header — the SAME five label-only ops
  // renderer/preload.js exposes, on the SAME sender-bound handlers (main/channel-dir-ipc.js).
  // ⚠ Absolute paths never cross this bridge; folder ops return LABELS only.
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
    // AUTO-SEND (2026-08-20): the DURABLE per-channel posture for the operator's own
    // agent's replies — unlike the single-use arm above. A boolean over the wire, nothing else.
    getAutoSend: (channelId) =>
      ipcRenderer.invoke('channels:getAutoSend', asId(channelId)),
    setAutoSend: (channelId, on) =>
      ipcRenderer.invoke('channels:setAutoSend', { channelId: asId(channelId), on: on === true }),
  },

  // `reopen` — the session card's "Open thread" button, the SAME op renderer/preload.js
  // exposes on the SAME sender-bound handler (main/channel-dir-ipc.js `sessions:reopen`, which
  // requires the live main window's TOP frame). Ids coerced here, re-validated in main
  // (channelId must be a UUID). Wire name `task` == domain name `thread`.
  // ⚠ OPENS THE WINDOW ONLY: starts no query, wakes no agent, runs no gated tool, so it widens
  // neither invariant above. A parked shell stays parked until a steer or accepted inbound.
  // ⚠ The web tree FEATURE-DETECTS this namespace (`@/shared/lib/desktop` getDesktopSessions ->
  // `sessions.reopen`) and renders NOTHING when absent, so dropping it silently removes the
  // button rather than failing. Pinned by test/preload-parity.test.mjs.
  //
  // `summaries` / `onSummaries` — the AGENTS TAB's feed: sessions running on THIS machine, each
  // with a name, a coarse state (working|idle|ended), its channel + thread, and (Phase 5,
  // 2026-08-18) the runtime numbers the agent view draws — context occupancy against that
  // model's window, lifetime token spend, started and last-activity stamps. All projected by
  // main/session-summary.js. Read once on mount, then listen — a push-only surface leaves a
  // freshly opened channel blank until the next state change, which on a quiet machine is
  // never.
  // ⚠ SPA-ONLY, deliberately: absent from renderer/preload.js, which belongs to the window
  // hosting the RETIRED website and does not grow new capabilities. The parity invariant runs
  // remote ⊆ SPA, so this widens nothing; test/preload-parity records the divergence.
  // ⚠ NOTHING PRIVILEGED CROSSES: derived from in-memory state — no path, no token, no window
  // handle, no absolute anything. The metrics are counts, and they stop at this renderer:
  // session-state-push.js picks the server row's columns by name and takes none of them.
  //
  // `pause` / `end` — the Agents tab's two controls on MY OWN agent (Phase 5). They reach the
  // SAME reducer events the session window's own buttons have always dispatched: pause is the
  // send button's pause morph (interrupt), end is "End session". Nothing here can START a
  // query, wake a parked shell or post anything, so the failure direction of a forged call is
  // an agent that stops.
  // ⚠ OWN AGENTS ONLY, structurally: main resolves (channelId, taskId) against its own session
  // registry, which contains nothing but this operator's sessions on this machine.
  // ⚠ NEVER keyed on `sessionId` — that id is ephemeral across a park+recreate.
  sessions: {
    reopen: (channelId, taskId) =>
      ipcRenderer.invoke('sessions:reopen', {
        channelId: asId(channelId),
        taskId: asId(taskId),
      }),
    summaries: () => ipcRenderer.invoke('sessions:summaries'),
    onSummaries: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => {
        const p = payload && typeof payload === 'object' ? payload : {};
        callback({ sessions: Array.isArray(p.sessions) ? p.sessions : [] });
      };
      ipcRenderer.on(SESSIONS_EVENT, listener);
      return () => ipcRenderer.removeListener(SESSIONS_EVENT, listener);
    },
    // LAUNCH (2026-08-20): attach MY OWN agent to a thread, windowless. The
    // payload is display strings + ids; main validates and owns the posture.
    launch: (payload) => ipcRenderer.invoke('sessions:launch', payload || {}),
    pause: (channelId, taskId) =>
      ipcRenderer.invoke('sessions:pause', {
        channelId: asId(channelId),
        taskId: asId(taskId),
      }),
    end: (channelId, taskId) =>
      ipcRenderer.invoke('sessions:end', {
        channelId: asId(channelId),
        taskId: asId(taskId),
      }),
  },

  // THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18). `openWindow` asks MAIN to
  // open a second window on this same bundle, landing on `/{segment}/channels/{channelId}`
  // with `{threadId}` selected. The thread view's header renders the button only when this
  // op exists, so a plain browser and an older main both simply have no affordance.
  // ⚠ ASKS FOR A WINDOW; IT IS NOT ONE. No handle, no window id and no reference of any kind
  // comes back — main creates the window, main registers it in `main/app-windows.js`, and the
  // answer is `{ ok }`. That is the whole reason widening the sender binding is safe: the
  // renderer cannot enlarge the set of bound senders, it can only ask main to.
  // ⚠ Every value is coerced here and RE-VALIDATED in main — the channel id as a UUID, the
  // segment and thread id through `deep-link-target.js › isSafeSegment`, the one character
  // rule for a string entering a router path.
  threads: {
    openWindow: (segment, channelId, threadId) =>
      ipcRenderer.invoke('threads:openWindow', {
        segment: asId(segment),
        channelId: asId(channelId),
        threadId: asId(threadId),
      }),
  },

  // Live updates: main watches postgres_changes for the viewed workspace's content tables and
  // forwards coalesced change events; the renderer's shared-channel-registry turns them into
  // refetch signals. syncWatch tells main WHICH workspace the UI is on (null = none).
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

  // -> a `data:image/...;base64,...` URI, or null. The packaged page's `img-src` cannot list
  // the OAuth CDNs (an open-ended set), so main fetches the avatar and returns the bytes
  // inline. ⚠ Main owns the destination allowlist (main/avatar-policy.js) AND re-checks mime +
  // size; a refused URL answers null and the component keeps its initials. Never a URL, never
  // a header, never a token.
  avatarDataUri: (url) => ipcRenderer.invoke('dopl:avatar', asStr(url)),
});

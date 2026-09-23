// Preload for the bundled UI window (main/spa-window.js) and every app-owned window main registers
// (main/app-windows.js): REGISTRATION authorizes a window, not a second bridge.
// `window.dopl` is the ENTIRE privileged API: fixed members, no dynamic channels, no Node, no fs;
// every argument coerced to a primitive, fail-closed. Two invariants survive every edit:
//  1. NO TOKENS. `getAuthState` answers `{ signedIn, userId }` only.
//  2. NO CALLER-SUPPLIED HEADERS. `apiRequest` takes a path + small typed options; main builds
//     every header.
// Main binds every handler to an app-owned window's top frame (main/ui-bridge.js,
// main/channel-dir-ipc.js).

const { contextBridge, ipcRenderer } = require('electron');

const AUTH_STATE_EVENT = 'dopl:auth-state-changed';
// Channel names are constants: test/preload-parity pins that none is computed.
const SESSIONS_EVENT = 'dopl:sessions';
const NARRATION_EVENT = 'dopl:session-narration';

const METHODS = { GET: 1, POST: 1, PATCH: 1, PUT: 1, DELETE: 1 };

const asStr = (v) => String(v == null ? '' : v);
// Fail-closed: an unknown verb becomes the read-only one, never a write.
const asMethod = (v) => {
  const s = asStr(v).toUpperCase();
  return METHODS[s] ? s : 'GET';
};

// Only the two request-shaping header VALUES (x-workspace-id, x-updated-at) come from here; main
// names every header. The body rides the structured clone; main serializes it.
function asRequestOpts(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const out = { method: asMethod(o.method) };
  if (o.workspaceId != null) out.workspaceId = asStr(o.workspaceId);
  if (o.expectedUpdatedAt != null) out.expectedUpdatedAt = asStr(o.expectedUpdatedAt);
  if (o.body !== undefined) out.body = o.body;
  return out;
}

// main -> renderer auth pushes, fanned out; the raw ipcRenderer event is never handed over.
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

// The app's public origin, injected by main (spa-window.js additionalArguments). A constant.
const APP_ORIGIN_ARG = process.argv.find((a) => a.startsWith('--dopl-app-origin='));
const APP_ORIGIN = APP_ORIGIN_ARG ? APP_ORIGIN_ARG.split('=')[1] : '';

// Channel-scoped input coercion: the bridge never forwards raw renderer values.
const asId = (channelId) => String(channelId == null ? '' : channelId);
const asMode = (mode) => String(mode == null ? '' : mode);
// The runtime-native settings bag as a flat string map (no nesting, arrays or numbers); main
// re-validates every key against the selected adapter's declared dimensions.
const asNative = (native) => {
  const out = {};
  if (native && typeof native === 'object' && !Array.isArray(native)) {
    for (const key of Object.keys(native)) out[String(key)] = asMode(native[key]);
  }
  return out;
};
// The runtime-keyed half of a launch selection, `{ <runtimeId>: { tools?, native? } }`. Each field
// is forwarded only on an OWN KEY: absence and `''` are different facts in that record.
const asRuntimeRecords = (byRuntime) => {
  const out = {};
  if (!byRuntime || typeof byRuntime !== 'object' || Array.isArray(byRuntime)) return out;
  for (const id of Object.keys(byRuntime)) {
    const record = byRuntime[id] || {};
    out[String(id)] = {
      ...(record.tools !== undefined ? { tools: asMode(record.tools) } : {}),
      ...(record.native !== undefined ? { native: asNative(record.native) } : {}),
    };
  }
  return out;
};

contextBridge.exposeInMainWorld('dopl', {
  // Public https origin for user-facing URLs (the document's own origin is file://).
  appOrigin: APP_ORIGIN,

  // -> { status, statusText, hasBody, body? }. Never throws for an HTTP status (the renderer
  //    decodes the envelope); rejects only when the request never completed or was malformed.
  apiRequest: (path, opts) => ipcRenderer.invoke('dopl:api-request', asStr(path), asRequestOpts(opts)),

  // Main-initiated navigation (notification click). Path-only payload.
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

  // Main arms the login-CSRF nonce and opens the browser; the renderer never builds the URL.
  beginSignIn: (provider) => ipcRenderer.invoke('dopl:begin-sign-in', provider === 'github' ? 'github' : 'google'),

  // Native email/password — main runs the GoTrue call (the renderer has no network).
  // ⚠ The password crosses once, into one https request body; never stored or logged.
  passwordSignIn: (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return ipcRenderer.invoke('dopl:password-sign-in', {
      mode: p.mode === 'sign-up' ? 'sign-up' : 'sign-in',
      email: String(p.email == null ? '' : p.email),
      password: String(p.password == null ? '' : p.password),
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

  // Per-channel settings (sender-bound handlers in `main/channel-dir-ipc.js`). The folder ops are
  // label-only: absolute paths never cross this bridge.
  channels: {
    getFolderLabel: (channelId) => ipcRenderer.invoke('channels:getFolderLabel', asId(channelId)),
    chooseFolder: (channelId) => ipcRenderer.invoke('channels:chooseFolder', asId(channelId)),
    clearFolder: (channelId) => ipcRenderer.invoke('channels:clearFolder', asId(channelId)),

    // The durable launch posture: one consumer (`session-ipc-ops.js › sessions:launch`), which is
    // what keeps H2 closed (`main/channel-prefs.js`).
    getLaunchPosture: (channelId) => ipcRenderer.invoke('channels:getLaunchPosture', asId(channelId)),
    setLaunchPosture: (channelId, preset) =>
      ipcRenderer.invoke('channels:setLaunchPosture', {
        channelId: asId(channelId),
        preset: {
          // Own-key on every field: `setLaunchSelection` rejects the WHOLE write on an unoffered
          // value, and `''` is a real value (`runtime: ''` resets to the default runtime), so an
          // absent field must stay absent. No `model`: the channel stores none.
          ...(preset && preset.tools !== undefined ? { tools: asMode(preset.tools) } : {}),
          ...(preset && preset.messages !== undefined ? { messages: asMode(preset.messages) } : {}),
          ...(preset && preset.native !== undefined ? { native: asNative(preset.native) } : {}),
          ...(preset && preset.runtime !== undefined ? { runtime: asMode(preset.runtime) } : {}),
        },
      }),
    // No `getAutoSend`/`setAutoSend`: that axis is the posture's `messages`, and their main handlers
    // are deleted (an unregistered invoke rejects).
    // Agent chaining: may an agent launched here launch more? Default and fail-closed are FALSE; it
    // lifts a depth bound and grants nothing (`main/channel-prefs.js › getAgentChain`).
    getAgentChain: (channelId) => ipcRenderer.invoke('channels:getAgentChain', asId(channelId)),
    setAgentChain: (channelId, on) => ipcRenderer.invoke('channels:setAgentChain', { channelId: asId(channelId), on: on === true }),
    // Default agent settings: what a NEW channel starts on. No channel id (one operator, one Mac).
    // A seed, never a launch-time read (`main/agent-defaults.js`: that would re-open H2);
    // `applyAgentDefaults` refuses a channel that already has a posture.
    getAgentDefaults: () => ipcRenderer.invoke('channels:getAgentDefaults'),
    setAgentDefaults: (defaults) =>
      ipcRenderer.invoke('channels:setAgentDefaults', {
        defaults: {
          tools: asMode(defaults && defaults.tools),
          messages: asMode(defaults && defaults.messages),
          agentChain: !!(defaults && defaults.agentChain),
          // Coerced unconditionally, unlike `setLaunchPosture`: this record has ONE writer (the
          // profile popup's Agents tab), which always sends the whole record.
          runtime: asMode(defaults && defaults.runtime),
          // `v` must ride along: `normalizeDefaults` reads a record without it as the legacy shape
          // and overwrites the other runtimes' settings. Own-key.
          ...(defaults && defaults.v !== undefined ? { v: Number(defaults.v) } : {}),
          ...(defaults && defaults.byRuntime !== undefined ? { byRuntime: asRuntimeRecords(defaults.byRuntime) } : {}),
        },
      }),
    applyAgentDefaults: (channelId) => ipcRenderer.invoke('channels:applyAgentDefaults', { channelId: asId(channelId) }),
  },

  // The two orchestrator consents: `orchestratorLaunch` (may another agent make this machine SPAWN a
  // session?) and `orchestratorDirect` (may one DIRECT a running session?). Two grants, both default
  // FALSE, per machine, feature-probed (absent = OFF). This bridge is the only way either moves — a
  // server-stored flag could be flipped by an agent holding the operator's credential
  // (`main/orchestrator-consent.js`). `set` answers main's own value; revert on `{ok:false}`.
  orchestratorLaunch: {
    get: () => ipcRenderer.invoke('orchestrator:getLaunchEnabled'),
    set: (e) => ipcRenderer.invoke('orchestrator:setLaunchEnabled', { enabled: e === true }),
  },
  orchestratorDirect: {
    get: () => ipcRenderer.invoke('orchestrator:getDirectEnabled'),
    set: (e) => ipcRenderer.invoke('orchestrator:setDirectEnabled', { enabled: e === true }),
  },

  // Sign this Mac in to one runtime (`''` = the default): the one entry into the auth-hold recovery flow
  // (`main/session-auth.js`). No credential crosses in either direction — main runs the OAuth in the
  // system browser. Feature-probed: absent, not inert.
  runtimeAuth: {
    signIn: (runtimeId) => ipcRenderer.invoke('runtime:signIn', { runtimeId: asId(runtimeId) }),
  },

  // The operator's OWN agents on this machine. Main resolves (channelId, taskId[, agentId]) against
  // its own registry, so nothing here reaches another member's runtime; never keyed on `sessionId`
  // (ephemeral across a park+recreate). Ids are coerced here and re-validated in main. The web tree
  // feature-detects each op. `test/preload-parity.test.mjs` is a pinned inventory: adding an op
  // fails it on purpose.
  sessions: {
    // A trailing optional `agentId` picks which of several agents on a thread; omitted = the oldest
    // live one. `segment` lets a windowless session reopen as the agent window (router path).
    reopen: (channelId, taskId, segment, agentId) => ipcRenderer.invoke('sessions:reopen',
      { channelId: asId(channelId), taskId: asId(taskId), segment: asId(segment), agentId: asId(agentId) }),
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
    // Attach MY OWN agent, windowless. The one op that forwards its payload raw: main re-validates
    // every field. An absent / null / '' `identityId` is a blank agent.
    launch: (payload) => ipcRenderer.invoke('sessions:launch', payload || {}),

    // Machine-local first-use approval of another member's identity; starts and grants nothing.
    // Never server-reachable, or a credential-holding agent could pre-approve itself.
    approveIdentity: (identityId) => ipcRenderer.invoke('sessions:approveIdentity', { identityId: asId(identityId) }),

    // After a thread DELETE: main cannot see the server cascade. Local history only.
    forgetThread: (channelId, taskId) => ipcRenderer.invoke('agents:forgetThread',
      { channelId: asId(channelId), taskId: asId(taskId) }),
    pause: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:pause',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),
    end: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:end',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),
    // Answer ONE held tool call: allow-once, no standing grant, no turn
    // (`main/session-answer-permission.js`). `allow` fails closed here and in main.
    answerPermission: (channelId, taskId, requestId, allow, agentId) => ipcRenderer.invoke('sessions:answerPermission',
      { channelId: asId(channelId), taskId: asId(taskId), requestId: asId(requestId), allow: allow === true, agentId: asId(agentId) }),

    // `end` plus an erase of every LOCAL trace (posts are the server's). `agentId` is REQUIRED here:
    // an omitted id resolves to the oldest agent, wrong for a destructive verb.
    delete: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:delete',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),

    // Asks main for an agent window (F-212); no handle comes back — main creates and registers it.
    openAgentWindow: (segment, channelId, taskId, agentId) => ipcRenderer.invoke('sessions:openAgentWindow',
      { segment: asId(segment), channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),

    // A LIVE session's posture (supervision, not containment; the profile is checked first). Main
    // re-validates both strings and the reducer coerces again.
    setMode: (channelId, taskId, axis, mode, agentId) => ipcRenderer.invoke('sessions:setMode',
      { channelId: asId(channelId), taskId: asId(taskId), axis: asMode(axis), mode: asMode(mode), agentId: asId(agentId) }),

    // Display only; '' clears. Main answers its own stored value, so a refused name reverts.
    rename: (agentId, name) => ipcRenderer.invoke('sessions:rename',
      { agentId: asId(agentId), name: typeof name === 'string' ? name : '' }),

    // `rename`'s twin: what the agent is for.
    describe: (agentId, description) => ipcRenderer.invoke('sessions:describe',
      { agentId: asId(agentId), description: typeof description === 'string' ? description : '' }),
    // Its presence is the SPA's gate for a pre-assigned launch id; reserves nothing.
    mintAgentId: () => ipcRenderer.invoke('sessions:mintAgentId'),
    // Switch ONE live session's model and record the pick on it; main coerces the id. No per-channel
    // model for the next spawn.
    setModel: (channelId, taskId, model, agentId) => ipcRenderer.invoke('sessions:setModel',
      { channelId: asId(channelId), taskId: asId(taskId), model: asMode(model), agentId: asId(agentId) }),

    // The ONE op that starts a turn: the operator's words to their own agent, delimited with that
    // session's nonce (`session-seed.js › frameOperatorTurn`). It cannot grant a tool, widen a
    // posture or post without the outbound gate. Capped here and in main (main's is the fence).
    message: (channelId, taskId, text, agentId) => ipcRenderer.invoke('sessions:message',
      { channelId: asId(channelId), taskId: asId(taskId), text: String(text == null ? '' : text).slice(0, 4000), agentId: asId(agentId) }),

    // The work lane: read once, then listen. Frames are keyed by `sessionKey`; main tracks no
    // subscriptions.
    narration: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:narration',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),
    onNarration: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => {
        const p = payload && typeof payload === 'object' ? payload : {};
        callback({
          sessionKey: String(p.sessionKey || ''),
          entries: Array.isArray(p.entries) ? p.entries : [],
        });
      };
      ipcRenderer.on(NARRATION_EVENT, listener);
      return () => ipcRenderer.removeListener(NARRATION_EVENT, listener);
    },
  },

  // Asks main for a pop-out thread window; no handle comes back. Values re-validated in main
  // (`deep-link-target.js › isSafeSegment`).
  threads: {
    openWindow: (segment, channelId, threadId) => ipcRenderer.invoke('threads:openWindow',
      { segment: asId(segment), channelId: asId(channelId), threadId: asId(threadId) }),
  },

  // Live updates: tell main which workspace the UI is on (null = none); it forwards coalesced
  // change events for the shared-channel-registry.
  syncWatch: (workspaceId) => ipcRenderer.invoke('dopl:sync-watch', workspaceId == null ? null : String(workspaceId)),
  onSyncEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      const p = payload && typeof payload === 'object' ? payload : {};
      callback({ workspaceId: String(p.workspaceId || ''), table: String(p.table || '') });
    };
    ipcRenderer.on('dopl:sync-event', listener);
    return () => ipcRenderer.removeListener('dopl:sync-event', listener);
  },

  // This window's own chrome (the frameless agent pop-out). No arguments: each op acts on the
  // sender's window. Feature-detected by the header.
  appWindow: {
    close: () => ipcRenderer.invoke('window:close'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    // The key names a TAB; main refuses unless the sender IS the agent window (`window-chrome.js`).
    closeTab: (key) => ipcRenderer.invoke('window:closeTab', asStr(key)),
    // The whole set every time (`agent-window.js › pushTabs`), coerced at this boundary.
    onTabs: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => {
        const p = payload && typeof payload === 'object' ? payload : {};
        const rows = Array.isArray(p.tabs) ? p.tabs : [];
        callback({
          tabs: rows.map((row) => {
            const r = row && typeof row === 'object' ? row : {};
            return {
              key: asStr(r.key),
              segment: asStr(r.segment),
              channelId: asStr(r.channelId),
              taskId: asStr(r.taskId),
              agentId: asStr(r.agentId),
            };
          }),
          focusKey: asStr(p.focusKey),
        });
      };
      ipcRenderer.on('agent-window:tabs', listener);
      return () => ipcRenderer.removeListener('agent-window:tabs', listener);
    },
  },

  openExternal: (url) => ipcRenderer.invoke('dopl:open-external', asStr(url)),

  // -> a `data:` URI or null. Main owns the destination allowlist (main/avatar-policy.js) and
  // re-checks mime + size; never a URL, header or token.
  avatarDataUri: (url) => ipcRenderer.invoke('dopl:avatar', asStr(url)),
});

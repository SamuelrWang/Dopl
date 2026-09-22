// Preload for the BUNDLED UI window (main/spa-window.js).
//
// `window.dopl` is the ENTIRE privileged API the SPA gets: a fixed, small set of members, no
// dynamic channels, no Node, no fs. Every argument is coerced to a primitive before it crosses,
// fail-closed (session-preload.js's discipline).
//
// TWO INVARIANTS THAT MUST SURVIVE EVERY EDIT:
//  1. NO TOKENS. `getAuthState` answers `{ signedIn, userId }` and nothing else. Access token,
//     refresh token and cookie jar stay in main; a renderer that never holds a credential cannot
//     leak one.
//  2. NO CALLER-SUPPLIED HEADERS. `apiRequest` takes a path and a small typed options object; main
//     builds every header, Authorization included. A page that can set headers can forge identity
//     or reach a third party.
//
// Main additionally binds every handler to an APP-OWNED window's top frame (main/ui-bridge.js,
// main/channel-dir-ipc.js), so a payload can never target another window. "App-owned" widened on
// 2026-08-18 (wiring plan Phase 10) from "the main window" to "anything main/app-windows.js
// registered at creation". This preload is what a pop-out gets too, deliberately: REGISTRATION is
// what authorizes it, not a second, narrower bridge.

const { contextBridge, ipcRenderer } = require('electron');

const AUTH_STATE_EVENT = 'dopl:auth-state-changed';
// ⚠ A constant, like every other channel name: test/preload-parity pins that no ipc channel
// name is computed.
const SESSIONS_EVENT = 'dopl:sessions';
const NARRATION_EVENT = 'dopl:session-narration';

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
const APP_ORIGIN_ARG = process.argv.find((a) => a.startsWith('--dopl-app-origin='));
const APP_ORIGIN = APP_ORIGIN_ARG ? APP_ORIGIN_ARG.split('=')[1] : '';

// Channel-scoped input coercion — the bridge never forwards raw renderer values. Nothing is
// mirrored from anywhere: this is the only preload with a `channels` namespace, and
// `test/preload-parity.test.mjs` asserts the old `renderer/preload.js` stays deleted.
const asId = (channelId) => String(channelId == null ? '' : channelId);
const asMode = (mode) => String(mode == null ? '' : mode);
// ⚠ 2026-09-21 (U8) — THE RUNTIME-NATIVE SETTINGS BAG, AS A FLAT STRING MAP. Codex's `sandbox_mode` and its reasoning effort became WRITABLE in U5 (`main/launch-selection.js › normalizeRuntimeRecord`'s `native` branch, stamped at spawn by `session-engine.js`); this bridge dropped the field, so the Settings row would have been F-390 again — a control the renderer draws and the wire discards. It is a MAP OF STRINGS and nothing else: no nesting, no arrays, no numbers, so nothing structural can cross here, and main re-validates every key against the SELECTED adapter's declared dimensions (an undeclared key is dropped and reviewed).
const asNative = (native) => {
  const out = {};
  if (native && typeof native === 'object' && !Array.isArray(native)) {
    for (const key of Object.keys(native)) out[String(key)] = asMode(native[key]);
  }
  return out;
};
// ⚠ THE RUNTIME-KEYED HALF OF A LAUNCH SELECTION — `{ <runtimeId>: { tools?, model?, native? } }`. Its ONE producer is the profile popup's Agents tab, whose record `main/agent-defaults.js › seedChannel` copies into a NEW channel whole; before U5 the seed copied one global model and lost the operator's Codex pick entirely. Each field is forwarded only on an OWN KEY, because absence and `''` are different facts in that record.
const asRuntimeRecords = (byRuntime) => {
  const out = {};
  if (!byRuntime || typeof byRuntime !== 'object' || Array.isArray(byRuntime)) return out;
  for (const id of Object.keys(byRuntime)) {
    const record = byRuntime[id] || {};
    out[String(id)] = {
      ...(record.tools !== undefined ? { tools: asMode(record.tools) } : {}),
      ...(record.model !== undefined ? { model: asMode(record.model) } : {}),
      ...(record.native !== undefined ? { native: asNative(record.native) } : {}),
    };
  }
  return out;
};

contextBridge.exposeInMainWorld('dopl', {
  // Public https origin for user-facing URLs — the document's own origin is file:// here.
  appOrigin: APP_ORIGIN,

  // -> { status, statusText, hasBody, body? }. ⚠ Never throws for an HTTP status — the
  //    renderer decodes the error envelope (apps/desktop-ui/src/lib/api.ts). Rejects only when
  //    the request never completed or the call was malformed.
  apiRequest: (path, opts) => ipcRenderer.invoke('dopl:api-request', asStr(path), asRequestOpts(opts)),

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
  beginSignIn: (provider) => ipcRenderer.invoke('dopl:begin-sign-in', provider === 'github' ? 'github' : 'google'),

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

  // Per-channel settings for the Settings tab: the working folder, the durable launch posture and
  // auto-send — SEVEN ops on the sender-bound handlers in `main/channel-dir-ipc.js`. Only the three
  // FOLDER ops are label-only. Absolute paths never cross this bridge.
  channels: {
    getFolderLabel: (channelId) => ipcRenderer.invoke('channels:getFolderLabel', asId(channelId)),
    chooseFolder: (channelId) => ipcRenderer.invoke('channels:chooseFolder', asId(channelId)),
    clearFolder: (channelId) => ipcRenderer.invoke('channels:clearFolder', asId(channelId)),
    // `getPermissionPreset` / `setPermissionPreset` stood here and are deleted (2026-08-20): they
    // were the single-use consent ARM, whose web controls had already stopped rendering (F-233).

    // THE DURABLE LAUNCH POSTURE. One consumer — `session-ipc-ops.js › sessions:launch`, the
    // operator's own Launch button — and that consumer COUNT is what keeps H2 closed
    // (`main/channel-prefs.js` states it). Same `asMode` coercion, same fail-closed write.
    getLaunchPosture: (channelId) => ipcRenderer.invoke('channels:getLaunchPosture', asId(channelId)),
    setLaunchPosture: (channelId, preset) =>
      ipcRenderer.invoke('channels:setLaunchPosture', {
        channelId: asId(channelId),
        preset: {
          ...(preset && preset.tools !== undefined ? { tools: asMode(preset.tools) } : {}), // ⚠ OWN-KEY SINCE 2026-09-21 (U8), AND THE UNCONDITIONAL VERSION HAD BECOME A REFUSAL. `channels:setLaunchPosture` hands the payload to `main/channel-prefs.js › setLaunchSelection`, which is own-key throughout and REJECTS THE WHOLE WRITE when `tools` carries a value the SELECTED runtime does not offer. Coercing an absent field to `''` therefore turned every runtime-only write into `{tools:'', messages:''}` — a rejected write, nothing stored, and the row reverting with no sentence. The model and runtime keys one line below have been own-key since 2026-09-05 for the neighbouring reason; this is the same rule finally applied to the two axes.
          ...(preset && preset.messages !== undefined ? { messages: asMode(preset.messages) } : {}),
          // THE MODEL JOINED THE POSTURE ON 2026-08-22 (Samuel's ruling) AND IS NOT A THIRD AXIS.
          // It rides the same record because it is the same decision — what MY agent starts as when
          // I press Launch — but it grants nothing and reaches no gate. Main validates it against
          // `session-model.js › MODEL_IDS` and an unknown value is simply ABSENT (the SDK default),
          // where an unknown value on either AXIS rejects the whole write.
          ...(preset && preset.model !== undefined ? { model: asMode(preset.model) } : {}), // ⚠ THE KEY IS FORWARDED ONLY WHEN THE CALLER SUPPLIED ONE — a SPREAD, not `asMode(...)` unconditionally (2026-09-05) — for the RUNTIME's exact reason one line below, on the axis the runtime copied it from. `''` is a REAL VALUE here too: it is the "Default" row, which CLEARS the channel's pick. Coercing an ABSENT field into it made every posture write from a surface that does not carry a model — an older SPA, a Permissions-only or Sends-only control, anything that predates this field — silently clear the pick, so the operator's chosen model stopped reaching the launch with nothing anywhere saying so. A launch sends NO model unless one was explicitly picked, and an absent key must never be how a pick disappears. Main's own-key test is the other half of the same rule (`main/channel-prefs.js › postureInto` carries the stored model through a write that does not mention it); the two must agree or the rule has a hole at whichever end forgets.
          ...(preset && preset.native !== undefined ? { native: asNative(preset.native) } : {}), // ⚠ 2026-09-21 (U8) — THE SELECTED RUNTIME'S NATIVE LAUNCH SETTINGS, on the model key's exact own-key discipline and for its exact reason: `{}` is a real "clear them all" and an absent key must leave them alone. It lands on the record of whichever runtime the same patch selects (`main/launch-selection.js › patchSelection`), so one write may switch runtime AND set that runtime's sandbox.
          ...(preset && preset.runtime !== undefined ? { runtime: asMode(preset.runtime) } : {}), // ⚠ 2026-08-31 (port wave D) — WHICH AGENT RUNTIME this channel's agents launch on. It rides this record for the MODEL's exact reason and with the model's exact discipline: same decision (what MY agent starts as when I press Launch), grants nothing, reaches no gate, and an id main does not have REGISTERED clears the key rather than being stored (`main/channel-runtime.js › normalizeRuntimeId`) — where an unknown value on either AXIS rejects the whole write. The read answers `runtime` + the frozen `runtimes` descriptor table, so the SPA feature-probes an OWN KEY exactly as it does for `model` and renders NO row on a desktop that has no runtime concept. ⚠ THE KEY IS FORWARDED ONLY WHEN THE CALLER SUPPLIED ONE — a SPREAD, not `asMode(...)` unconditionally — because `''` is a REAL VALUE here (reset to the default runtime) and coercing an absent field into it would make every posture write from a surface that does not know about runtimes silently clear the channel's pick. Main's own-key test is the other half of the same rule; the two must agree or the rule has a hole at whichever end forgets.
        },
      }),
    // ⚠ `getAutoSend` / `setAutoSend` REMOVED 2026-09-06 (item 8): the axis they set is the launch posture's `messages` now, reachable through `getLaunchPosture` / `setLaunchPosture` above. The main-process handlers are deleted too, so a bridge method left here would invoke an unregistered channel and reject.
    // AGENT CHAINING (2026-08-31, Samuel's ruling): may an agent launched in this channel launch MORE agents? Default and fail-closed answer are both FALSE — the one-generation bound that shipped. Same boolean-only wire as auto-send; it lifts a DEPTH bound and grants nothing (`main/channel-prefs.js › getAgentChain`).
    getAgentChain: (channelId) => ipcRenderer.invoke('channels:getAgentChain', asId(channelId)),
    setAgentChain: (channelId, on) => ipcRenderer.invoke('channels:setAgentChain', { channelId: asId(channelId), on: on === true }),
    // DEFAULT AGENT SETTINGS (2026-09-18, Samuel's ruling): what a channel created FROM NOW ON starts on. It takes no channel id — one operator, one Mac, one answer — and it is a SEED, never a launch-time read: `main/agent-defaults.js` states why wiring it to a spawn would re-open H2 and would additionally re-point every EXISTING channel. `applyAgentDefaults` is the inheritance point, called by the renderer that just created the channel, and it refuses a channel that already has a posture.
    getAgentDefaults: () => ipcRenderer.invoke('channels:getAgentDefaults'),
    setAgentDefaults: (defaults) =>
      ipcRenderer.invoke('channels:setAgentDefaults', {
        defaults: {
          tools: asMode(defaults && defaults.tools),
          messages: asMode(defaults && defaults.messages),
          agentChain: !!(defaults && defaults.agentChain),
          // ⚠ COERCED UNCONDITIONALLY HERE, UNLIKE `setLaunchPosture` ABOVE, AND THE ASYMMETRY IS THE RULE. That op forwards `model` / `runtime` only on an own-key because MANY surfaces write one channel's posture and a surface with no model concept must not clear the operator's pick. This record has exactly ONE writer — the profile popup's Agents tab — which always sends the whole record, so an absent field really is "no pick" and `''` really is "clear it". Main re-validates both SOFT either way.
          model: asMode(defaults && defaults.model),
          runtime: asMode(defaults && defaults.runtime),
          // ⚠ 2026-09-21 (U8) — THE VERSIONED, RUNTIME-KEYED HALF. `main/agent-defaults.js › normalizeDefaults` branches on `v == null`: WITHOUT it the record is read as a pre-U5 legacy one and its single global `tools`/`model` are migrated into the DEFAULT runtime's slot, so every write from this tab ERASED the operator's Codex model and sandbox. With it the record is read as a selection and both runtimes' settings survive — Decisions #1 and #2, which is the whole of U5's contract. Own-key so a caller that predates the field still writes the legacy shape it means.
          ...(defaults && defaults.v !== undefined ? { v: Number(defaults.v) } : {}),
          ...(defaults && defaults.byRuntime !== undefined ? { byRuntime: asRuntimeRecords(defaults.byRuntime) } : {}),
        },
      }),
    applyAgentDefaults: (channelId) => ipcRenderer.invoke('channels:applyAgentDefaults', { channelId: asId(channelId) }),
  },

  // ── THE TWO ORCHESTRATOR CONSENTS ────────────────────────────────────────────────────────
  //   `orchestratorLaunch` (2026-08-22) — may another agent make this machine SPAWN a session?
  //   `orchestratorDirect` (2026-08-31) — may one DIRECT a session already running here?
  // TWO GRANTS, NOT TWO SPELLINGS OF ONE: launching buys COMPUTE, directing reaches a RUNNING
  // agent's PRIVATE lane, and an operator may want one and not the other. Both default FALSE, per
  // machine; with one off, a row addressed to this operator is ignored SILENTLY and expires
  // server-side where the orchestrator can see it happen.
  //
  // Their own namespaces, not members of `channels`, because neither takes a channel: one operator,
  // one Mac, one answer. Every member is FEATURE-PROBED, and an older main simply has no toggle —
  // which reads as OFF, the correct terminal answer.
  //
  // THIS BRIDGE IS THE ONLY WAY EITHER VALUE MOVES, and that is the security content rather than a
  // storage detail: a spawned session runs with `Bash` and this operator's device token is on disk
  // (§6), so a SERVER-STORED version of either flag could be flipped by an agent holding the
  // operator's own credential, arming every machine they own. Read
  // `main/orchestrator-consent.js` before adding any second writer. `set` answers MAIN'S OWN value,
  // never an echo, so an optimistic switch reverts on `{ok:false}`.
  orchestratorLaunch: {
    get: () => ipcRenderer.invoke('orchestrator:getLaunchEnabled'),
    set: (e) => ipcRenderer.invoke('orchestrator:setLaunchEnabled', { enabled: e === true }),
  },
  orchestratorDirect: {
    get: () => ipcRenderer.invoke('orchestrator:getDirectEnabled'),
    set: (e) => ipcRenderer.invoke('orchestrator:setDirectEnabled', { enabled: e === true }),
  },

  // `turnCap.get` / `turnCap.set` stood here and are DELETED (2026-09-07, Samuel's ruling: remove
  // the turn/cost limit). They were a live defect for the length of one pass, which is why this
  // teardown is its own item: the main-process handlers were unregistered while these bindings
  // stayed, so the SPA could still call them and an `invoke` with no registered handler REJECTS —
  // which the row's catch turned into "reads as unset", a control showing a posture nothing
  // enforced. No declared-optional stub in their place: the SPA feature-probed this bridge member
  // and rendered NO ROW when absent, so absence was already the designed answer.

  // ── SIGN IN TO CLAUDE CODE, FROM INSIDE THE APP (2026-08-25) ─────────────────────────────
  //
  // THE ONE ENTRY INTO THE RECOVERY FLOW. A session runs on THIS MAC's Claude Code credential —
  // separate from the Dopl login and from the Claude app — and when it is missing or expired the
  // engine HOLDS the session (`main/session-auth.js`) instead of burning it.
  //
  // Its own namespace, not a member of `sessions`, because it takes no session and no channel: one
  // operator, one Mac, one credential. FEATURE-PROBED by the SPA, so the button is absent on an
  // older main and in a plain browser, never inert.
  //
  // NO CREDENTIAL CROSSES THIS BRIDGE IN EITHER DIRECTION, and nothing is typed into a Dopl
  // surface: main opens the OAuth page in the SYSTEM BROWSER and collects the pasted code in its
  // own local window. The answer is `{ ok }` — whether this Mac can run a session now.
  claude: {
    signIn: () => ipcRenderer.invoke('claude:signIn'),
  },

  // `reopen` — the session card's "Open thread" button, on the sender-bound handler in
  // `main/session-ipc-ops.js` (`sessions:reopen`, which requires an app-owned window's TOP frame).
  // Ids coerced here, re-validated in main (channelId must be a UUID). Wire name `task` == domain
  // name `thread`. It OPENS THE WINDOW ONLY: starts no query, wakes no agent, runs no gated tool,
  // so it widens neither invariant above. The web tree FEATURE-DETECTS this namespace and renders
  // NOTHING when absent, so dropping it silently removes the button rather than failing.
  //
  // `summaries` / `onSummaries` — the AGENTS TAB's feed: sessions running on THIS machine, each with
  // a name, a coarse state (working|idle|ended), its channel + thread, and (Phase 5, 2026-08-18)
  // the runtime numbers the agent view draws — context occupancy against that model's window,
  // lifetime token spend, started and last-activity stamps. All projected by
  // main/session-summary.js. Read once on mount, then listen — a push-only surface leaves a freshly
  // opened channel blank until the next state change, which on a quiet machine is never.
  // Two more fields since 2026-08-20: `detail` and `toolLabel`, from main/session-detail.js. They
  // refine the coarse state for the operator's OWN cards and are LOCAL-ONLY — the pill vocabulary
  // stays three-valued because it is the SERVER's, and session-state-push.js picks the row's
  // columns by name so neither field can reach `channel_sessions`.
  // `test/preload-parity.test.mjs` is a PINNED INVENTORY, not a comparison: adding an op fails it
  // deliberately, so a new capability is looked at rather than absorbed.
  // NOTHING PRIVILEGED CROSSES: derived from in-memory state — no path, no token, no window handle.
  //
  // `pause` / `end` — the Agents tab's two controls on MY OWN agent (Phase 5). They reach the SAME
  // reducer events the session window's own buttons dispatched: pause is the send button's pause
  // morph (interrupt), end is "End session". Nothing here can START a query, wake a parked shell or
  // post anything, so the failure direction of a forged call is an agent that stops. OWN AGENTS
  // ONLY, structurally: main resolves (channelId, taskId) against its own session registry, which
  // contains nothing but this operator's sessions on this machine. NEVER keyed on `sessionId` —
  // that id is ephemeral across a park+recreate.
  sessions: {
    // EVERY OP BELOW GAINED A TRAILING OPTIONAL `agentId` ON 2026-08-21 (Samuel's multiplayer
    // ruling). `(channelId, taskId)` stopped identifying a session when an operator could put
    // several agents on one thread. It is TRAILING and OPTIONAL so every existing call site keeps
    // compiling and its old behaviour — main resolves an omitted id to the oldest live agent on the
    // thread. `asId` is the same character clamp every other id gets; agent ids are
    // `[a-z][a-z0-9]{7}`, a strict subset, and main re-checks the real charset.
    // `segment` is OPTIONAL and joined 2026-08-20: a live WINDOWLESS session reopens as the AGENT
    // WINDOW, whose landing is a router path, and main holds the workspace UUID while a route needs
    // the slug. Main re-checks it through `isSafeSegment` and degrades when it is unusable.
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
    // LAUNCH (2026-08-20): attach MY OWN agent to a thread, windowless. The payload is display
    // strings + ids; main validates and owns the posture. THE ONE OP HERE THAT FORWARDS ITS PAYLOAD
    // RAW, and `templateId` (2026-08-22) rides that property rather than adding a coercion: main
    // re-validates every field anyway, and a preload that half-coerced a UUID would be a second
    // opinion about what a template id is. An absent / null / '' id is a BLANK agent.
    launch: (payload) => ipcRenderer.invoke('sessions:launch', payload || {}),

    // FIRST-USE APPROVAL FOR ANOTHER MEMBER'S AGENT TEMPLATE (2026-08-22, OQ-3). Records a
    // MACHINE-LOCAL decision and starts nothing; call it when the operator has read that template's
    // instructions and chosen to run as it, then relaunch. It widens no containment — a launch from
    // an approved template is contained exactly like any other. NEVER SERVER-REACHABLE, and that is
    // the security content: a server-writable approval would let a credential-holding agent
    // pre-approve itself on every machine the operator owns.
    approveTemplate: (templateId) => ipcRenderer.invoke('sessions:approveTemplate', { templateId: asId(templateId) }),

    // CALL THIS AFTER A THREAD DELETE SUCCEEDS (2026-08-22). Main cannot see the server's cascade,
    // so without it an ended agent's frozen history outlives its thread by up to seven days and
    // renders a card with a stale title. LOCAL history only — `channel_messages` are the server's.
    forgetThread: (channelId, taskId) => ipcRenderer.invoke('agents:forgetThread',
      { channelId: asId(channelId), taskId: asId(taskId) }),
    pause: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:pause',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),
    end: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:end',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),
    // ⚠ ANSWER ONE HELD TOOL CALL (2026-09-17) — the agent panel's inline Approve / Deny, the surface the retired session window took with it.
    // ALLOW-ONCE, grants nothing standing, starts no turn (`main/session-answer-permission.js`); `allow` fails closed here AND in main.
    answerPermission: (channelId, taskId, requestId, allow, agentId) => ipcRenderer.invoke('sessions:answerPermission',
      { channelId: asId(channelId), taskId: asId(taskId), requestId: asId(requestId), allow: allow === true, agentId: asId(agentId) }),

    // DELETE THE AGENT (2026-08-25) — `end` plus an ERASE. A live session stops through the SAME
    // reducer event `end` dispatches (one stop path, never two), then every LOCAL trace goes. It
    // deletes a LOCAL VIEW, never a conversation: what the agent POSTED is `channel_messages` on the
    // SERVER. `agentId` is REQUIRED here and optional above — an omitted id resolves to the OLDEST
    // live agent on the thread, which for a DESTRUCTIVE verb is not the card that was clicked.
    delete: (channelId, taskId, agentId) => ipcRenderer.invoke('sessions:delete',
      { channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),

    // ── THE AGENT WINDOW (2026-08-20, F-212's closure) ─────────────────────────────
    // `openAgentWindow` ASKS MAIN for a second window on this same bundle, showing ONE of the
    // operator's own agents. Like `threads.openWindow` it gets NO handle back — main creates and
    // registers the window, and the answer is `{ ok }`. That is why the widened sender binding is
    // safe: a renderer cannot enlarge the set of bound senders, only ask main to.
    openAgentWindow: (segment, channelId, taskId, agentId) => ipcRenderer.invoke('sessions:openAgentWindow',
      { segment: asId(segment), channelId: asId(channelId), taskId: asId(taskId), agentId: asId(agentId) }),

    // THE LIVE PERMISSION POSTURE (2026-08-20) — both axes, on a session already running, applying
    // from the very next gate decision rather than the next launch. NOT `channels.setLaunchPosture`,
    // which writes the per-channel record governing the NEXT spawn. It widens SUPERVISION, never
    // CONTAINMENT: the axes decide whether the operator is ASKED, the profile decides what is
    // reachable at all and is checked first. Main re-validates both strings against the frozen
    // enums, and the reducer coerces again fail-closed.
    setMode: (channelId, taskId, axis, mode, agentId) => ipcRenderer.invoke('sessions:setMode',
      { channelId: asId(channelId), taskId: asId(taskId), axis: asMode(axis), mode: asMode(mode), agentId: asId(agentId) }),

    // ⚠ WHAT THE OPERATOR CALLS THIS AGENT (2026-08-25). Display only: nothing resolves an
    // agent by it, and an EMPTY string clears the name rather than storing one. Main answers
    // with its OWN stored value, so a refused name reverts instead of painting.
    rename: (agentId, name) => ipcRenderer.invoke('sessions:rename',
      { agentId: asId(agentId), name: typeof name === 'string' ? name : '' }),

    // ⚠ `rename`'s TWIN (2026-08-27): what the agent is FOR. Same contract; empty clears.
    describe: (agentId, description) => ipcRenderer.invoke('sessions:describe',
      { agentId: asId(agentId), description: typeof description === 'string' ? description : '' }),
    // ⚠ PRESENCE = the SPA's capability gate for the pre-assigned launch id; reserves nothing.
    mintAgentId: () => ipcRenderer.invoke('sessions:mintAgentId'),
    // ⚠ THE LIVE MODEL SWITCH (2026-08-22, Samuel's model-selection ruling). It takes the ID
    // vocabulary a UI offers (`main/session-model.js › MODEL_IDS`); main coerces against that
    // frozen list and converts to the argv-safe ALIAS, so an unknown string CLEARS the override
    // rather than reaching a child process. It moves ONE live session and records the pick; the
    // per-channel record governing the NEXT spawn is `channels.setLaunchPosture`'s `model` field.
    setModel: (channelId, taskId, model, agentId) => ipcRenderer.invoke('sessions:setModel',
      { channelId: asId(channelId), taskId: asId(taskId), model: asMode(model), agentId: asId(agentId) }),

    // `message` IS THE ONE OP ON THIS BRIDGE THAT STARTS A TURN, and the only reason this
    // namespace's failure direction is not simply "an agent that stops". The operator types to their
    // OWN agent out of band; main resolves (channel, thread) against its own registry, delimits the
    // text with that session's nonce (`session-seed.js › frameOperatorTurn`, which carries operator
    // authority rather than fencing the words as data), and dispatches the SAME `steer` the session
    // window's composer always dispatched. It cannot grant a tool, widen a posture, reach another
    // machine, or post anything without the outbound gate. Capped here AND in main — this bound is
    // a convenience, main's is the fence.
    message: (channelId, taskId, text, agentId) => ipcRenderer.invoke('sessions:message',
      { channelId: asId(channelId), taskId: asId(taskId), text: String(text == null ? '' : text).slice(0, 4000), agentId: asId(agentId) }),

    // The work lane: what this agent has been doing (its own text, its tool calls WITH
    // NAMES, their results, what it posted). `narration` is the read for a window's first
    // paint, `onNarration` the live push — read once, then listen, exactly as the
    // summaries feed does, because a push-only surface leaves a freshly opened window
    // blank until the next event.
    // ⚠ Frames are keyed by `sessionKey`; a window filters to the agent it shows. Main
    // tracks no subscriptions, which is what stops the two sides going out of step.
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

  // THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18). `openWindow` asks MAIN to open a
  // second window on this same bundle, landing on `/{segment}/channels/{channelId}` with
  // `{threadId}` selected. The thread view's header renders the button only when this op exists, so
  // a plain browser and an older main both simply have no affordance. IT ASKS FOR A WINDOW AND IS
  // NOT ONE: no handle, no window id and no reference comes back — main creates the window and
  // registers it, and the answer is `{ ok }`. That is the whole reason widening the sender binding
  // is safe. Every value is coerced here and RE-VALIDATED in main — the channel id as a UUID, the
  // segment and thread id through `deep-link-target.js › isSafeSegment`.
  threads: {
    openWindow: (segment, channelId, threadId) => ipcRenderer.invoke('threads:openWindow',
      { segment: asId(segment), channelId: asId(channelId), threadId: asId(threadId) }),
  },

  // Live updates: main watches postgres_changes for the viewed workspace's content tables and
  // forwards coalesced change events; the renderer's shared-channel-registry turns them into
  // refetch signals. syncWatch tells main WHICH workspace the UI is on (null = none).
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

  // THIS WINDOW'S OWN CHROME (2026-09-13) — the agent pop-out is FRAMELESS, so macOS draws no close
  // and no zoom button and its header draws its own. NO ARGUMENTS, AND THAT IS THE POINT: each op
  // acts on the window the call came FROM, so there is nothing to coerce and no id to forge in main.
  // The header FEATURE-DETECTS both, so an older main renders no buttons rather than dead ones.
  appWindow: {
    close: () => ipcRenderer.invoke('window:close'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    // THE TABBED AGENT WINDOW (2026-09-13). ⚠ THE KEY IS THE ONE ARGUMENT ON THIS WIRE AND IT
    // NAMES A TAB, NOT A WINDOW: main resolves the window as the sender's own and refuses
    // unless that window IS the agent window (`main/window-chrome.js`), so this cannot reach
    // another surface however the key is spelled.
    closeTab: (key) => ipcRenderer.invoke('window:closeTab', asStr(key)),
    // ⚠ THE WHOLE SET, EVERY TIME — main pushes the list and which tab to show, never a diff
    // (`main/agent-window.js › pushTabs`), so a missed message cannot leave the strip drifted.
    // Coerced HERE, at the boundary, exactly as `onSyncEvent` above does it.
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

  // -> a `data:image/...;base64,...` URI, or null. The packaged page's `img-src` cannot list
  // the OAuth CDNs (an open-ended set), so main fetches the avatar and returns the bytes
  // inline. ⚠ Main owns the destination allowlist (main/avatar-policy.js) AND re-checks mime +
  // size; a refused URL answers null and the component keeps its initials. Never a URL, never
  // a header, never a token.
  avatarDataUri: (url) => ipcRenderer.invoke('dopl:avatar', asStr(url)),
});

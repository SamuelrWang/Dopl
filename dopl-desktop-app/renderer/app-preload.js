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
const APP_ORIGIN_ARG = process.argv
  .find((a) => a.startsWith('--dopl-app-origin='));
const APP_ORIGIN = APP_ORIGIN_ARG ? APP_ORIGIN_ARG.split('=')[1] : '';

// ⚠ Channel-scoped input coercion — the bridge never forwards raw renderer values. (This said
// "mirrored from renderer/preload.js" until 2026-08-20; that preload is deleted, and
// `test/preload-parity.test.mjs` asserts it stays deleted. Nothing is mirrored from anywhere:
// this is the only preload with a `channels` namespace.)
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

  // Per-channel settings for the Settings tab: the working folder, the durable launch posture
  // and auto-send — SEVEN ops on the sender-bound handlers in `main/channel-dir-ipc.js`.
  // ⚠ RE-COUNTED AND RE-POINTED 2026-08-20. This said "the SAME five label-only ops
  // renderer/preload.js exposes": that preload is deleted, "five" predates the auto-send pair,
  // and only the three FOLDER ops are label-only.
  // ⚠ Absolute paths never cross this bridge; folder ops return LABELS only.
  channels: {
    getFolderLabel: (channelId) =>
      ipcRenderer.invoke('channels:getFolderLabel', asId(channelId)),
    chooseFolder: (channelId) =>
      ipcRenderer.invoke('channels:chooseFolder', asId(channelId)),
    clearFolder: (channelId) =>
      ipcRenderer.invoke('channels:clearFolder', asId(channelId)),
    // ⚠ `getPermissionPreset` / `setPermissionPreset` STOOD HERE AND ARE DELETED
    // (2026-08-20). They were the single-use consent ARM; its web controls had already
    // stopped rendering (F-233), so the ops armed a record nothing could set.

    // THE DURABLE LAUNCH POSTURE. One consumer — `session-ipc-ops.js › sessions:launch`, the
    // operator's own Launch button — and that consumer COUNT is what keeps H2 closed
    // (`main/channel-prefs.js` states it). ⚠ This said "SEPARATE record with a separate
    // consumer … the arm stays single-use and consent-only": there is no arm to be separate
    // from, and the handler moved out of `channel-dir-ipc.js` at the F-226 split. Corrected
    // 2026-08-20. Same `asMode` coercion, same fail-closed write.
    getLaunchPosture: (channelId) =>
      ipcRenderer.invoke('channels:getLaunchPosture', asId(channelId)),
    setLaunchPosture: (channelId, preset) =>
      ipcRenderer.invoke('channels:setLaunchPosture', {
        channelId: asId(channelId),
        preset: {
          tools: asMode(preset && preset.tools),
          messages: asMode(preset && preset.messages),
          // ⚠ THE MODEL JOINED THE POSTURE ON 2026-08-22 (Samuel's ruling) AND IS NOT A THIRD
          // AXIS. It rides the same record because it is the same decision — what MY agent starts
          // as when I press Launch — but it grants nothing and reaches no gate. Main validates it
          // against `session-model.js › MODEL_IDS` and an unknown value is simply ABSENT (the SDK
          // default), where an unknown value on either AXIS rejects the whole write.
          model: asMode(preset && preset.model),
        },
      }),
    // AUTO-SEND (2026-08-20): the DURABLE per-channel posture for the operator's own
    // agent's replies — unlike the single-use arm above. A boolean over the wire, nothing else.
    getAutoSend: (channelId) =>
      ipcRenderer.invoke('channels:getAutoSend', asId(channelId)),
    setAutoSend: (channelId, on) =>
      ipcRenderer.invoke('channels:setAutoSend', { channelId: asId(channelId), on: on === true }),
  },

  // ── ⚠ THE ORCHESTRATOR LAUNCH TOGGLE (2026-08-22, Samuel's launch-over-MCP ruling) ────────
  //
  // MAY ANOTHER AGENT CAUSE THIS MACHINE TO SPAWN A SESSION? Default FALSE, per machine, and it
  // is the STANDING CONSENT for the whole `channel_launch_directives` lane
  // (`main/launch-directives.js`) — with it off, a directive addressed to this operator is
  // ignored silently and expires server-side where the orchestrator can see it happen.
  //
  // ⚠ IT IS ITS OWN NAMESPACE, NOT A MEMBER OF `channels`, because it takes no channel: one
  // operator, one Mac, one answer. Both members are FEATURE-PROBED by the SPA and an older main
  // simply has no toggle, which reads as OFF — the correct terminal answer, not a compatibility
  // mode (UNKNOWN is not EMPTY).
  //
  // ⚠ THIS BRIDGE IS THE ONLY WAY THE VALUE MOVES, AND THAT IS THE SECURITY CONTENT rather
  // than a storage detail. A spawned session runs with `Bash` and this operator's device token
  // is on disk (§6), so a SERVER-STORED version of this flag could be flipped by an agent
  // holding the operator's own credential — arming every machine they own. There is no route,
  // no MCP op and no column for it, deliberately; read `main/channel-prefs.js`'s block before
  // adding any second writer.
  //
  // ⚠ `set` ANSWERS MAIN'S OWN VALUE, never an echo, so the SPA's optimistic switch reverts on
  // `{ok:false}` instead of showing a state nothing is enforcing.
  orchestratorLaunch: {
    get: () => ipcRenderer.invoke('orchestrator:getLaunchEnabled'),
    set: (enabled) =>
      ipcRenderer.invoke('orchestrator:setLaunchEnabled', { enabled: enabled === true }),
  },

  // ── ⚠ SIGN IN TO CLAUDE CODE, FROM INSIDE THE APP (2026-08-25) ───────────────────────────
  //
  // THE ONE ENTRY INTO THE RECOVERY FLOW. A session runs on THIS MAC's Claude Code credential —
  // separate from the Dopl login and from the Claude app — and when it is missing or expired the
  // engine HOLDS the session (`main/session-auth.js`) instead of burning it. Everything needed
  // to un-hold one existed and had no caller; this is the call.
  //
  // ⚠ ITS OWN NAMESPACE, NOT A MEMBER OF `sessions`, because it takes no session and no channel:
  // one operator, one Mac, one credential. It is FEATURE-PROBED by the SPA (the button is absent
  // on an older main and in a plain browser, never inert).
  //
  // ⚠ NO CREDENTIAL CROSSES THIS BRIDGE IN EITHER DIRECTION, and nothing is typed into a Dopl
  // surface: main opens the OAuth page in the SYSTEM BROWSER and collects the pasted code in its
  // own local window (`main/claude-auth.js`). The answer is `{ ok }` — whether this Mac can run a
  // session now — and carries no token, no path and no reason string.
  claude: {
    signIn: () => ipcRenderer.invoke('claude:signIn'),
  },

  // `reopen` — the session card's "Open thread" button, on the sender-bound handler in
  // `main/session-ipc-ops.js` (`sessions:reopen`, which requires an app-owned window's TOP
  // frame). ⚠ It said "the SAME op renderer/preload.js exposes" until 2026-08-20: that preload
  // is deleted, and the handler moved at the F-226 split. Ids coerced here, re-validated in main
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
  // ⚠ TWO MORE FIELDS SINCE 2026-08-20: `detail` (thinking | tool | posting | permission |
  // awaiting_peer | awaiting_inbound, or null) and `toolLabel`, from main/session-detail.js.
  // They refine the coarse state for the operator's OWN cards and are LOCAL-ONLY — the pill
  // vocabulary stays three-valued because it is the SERVER's, and session-state-push.js picks
  // the row's columns by name so neither field can reach `channel_sessions`.
  // ⚠ THIS WAS "SPA-ONLY, absent from renderer/preload.js, … the parity invariant runs
  // remote ⊆ SPA" — and there is no second preload to be absent from since the remote shell
  // was deleted (corrected 2026-08-20). `test/preload-parity.test.mjs` is a PINNED INVENTORY
  // now, not a comparison: adding an op fails it deliberately, so a new capability is looked
  // at rather than absorbed.
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
    // ⚠ EVERY OP BELOW GAINED A TRAILING OPTIONAL `agentId` ON 2026-08-21 (Samuel's
    // multiplayer ruling). `(channelId, taskId)` stopped identifying a session when an operator
    // could put several agents on one thread; the id is which of them this call is for. It is
    // TRAILING and OPTIONAL so every existing call site keeps compiling and keeps its old
    // behaviour — main resolves an omitted id to the oldest live agent on the thread, which is
    // exactly what a thread that could hold only one always gave back. `asId` is the same
    // character clamp every other id on this surface gets; agent ids are `[a-z][a-z0-9]{7}`, a
    // strict subset of it, and main re-checks the real charset.
    // ⚠ `segment` is OPTIONAL and joined 2026-08-20: a live WINDOWLESS session reopens as
    // the AGENT WINDOW, whose landing is a router path, and main holds the workspace UUID
    // while a route needs the slug. Main re-checks it through `isSafeSegment` and degrades
    // to the other reopen branches when it is absent or unusable.
    reopen: (channelId, taskId, segment, agentId) =>
      ipcRenderer.invoke('sessions:reopen', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        segment: asId(segment),
        agentId: asId(agentId),
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
    // ⚠ THE ONE OP HERE THAT FORWARDS ITS PAYLOAD RAW, and `templateId` (2026-08-22) rides that
    // property rather than adding a coercion: main re-validates every field of this object
    // anyway (`session-launch-op.js`), and a preload that half-coerced a UUID would be a second
    // opinion about what a template id is. An absent / null / '' id is a BLANK agent, exactly as
    // before templates existed.
    launch: (payload) => ipcRenderer.invoke('sessions:launch', payload || {}),

    // ⚠ FIRST-USE APPROVAL FOR ANOTHER MEMBER'S AGENT TEMPLATE (2026-08-22, OQ-3). Records a
    // MACHINE-LOCAL decision and starts nothing. Call it when the operator has read that
    // template's instructions in the launch sheet and chosen to run as it, then relaunch.
    // ⚠ IT WIDENS NO CONTAINMENT. A launch from an approved template is contained exactly like a
    // launch from any other: same tool profile, same permission axes, same working folder.
    // ⚠ NEVER SERVER-REACHABLE, and that is the security content rather than the storage: a
    // server-writable approval would let a credential-holding agent pre-approve itself on every
    // machine the operator owns (`main/channel-prefs.js` states the same rule for the
    // orchestrator toggle it lives beside).
    approveTemplate: (templateId) =>
      ipcRenderer.invoke('sessions:approveTemplate', { templateId: asId(templateId) }),

    // ⚠ CALL THIS AFTER A THREAD DELETE SUCCEEDS (2026-08-22). Main cannot see the server's
    // cascade, so without it an ended agent's frozen history outlives its thread by up to
    // seven days and renders a card with a stale title. It deletes LOCAL history only —
    // `channel_messages` are the server's and are never touched.
    forgetThread: (channelId, taskId) =>
      ipcRenderer.invoke('agents:forgetThread', {
        channelId: asId(channelId),
        taskId: asId(taskId),
      }),
    pause: (channelId, taskId, agentId) =>
      ipcRenderer.invoke('sessions:pause', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        agentId: asId(agentId),
      }),
    end: (channelId, taskId, agentId) =>
      ipcRenderer.invoke('sessions:end', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        agentId: asId(agentId),
      }),

    // ⚠ DELETE THE AGENT (2026-08-25) — `end` plus an ERASE. A live session stops through the
    // SAME reducer event `end` dispatches (one stop path, never two), then every LOCAL trace goes.
    // ⚠ IT DELETES A LOCAL VIEW, NEVER A CONVERSATION: what the agent POSTED is `channel_messages`
    // on the SERVER, and the transcript keeps attributing it to `Agent #<id>` from the message.
    // ⚠ `agentId` IS REQUIRED here and optional above — an omitted id resolves to the OLDEST live
    // agent on the thread, which for a DESTRUCTIVE verb is not the card that was clicked.
    // Full argument: `main/session-delete-op.js` and `test/preload-parity.test.mjs`.
    delete: (channelId, taskId, agentId) =>
      ipcRenderer.invoke('sessions:delete', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        agentId: asId(agentId),
      }),

    // ── THE AGENT WINDOW (2026-08-20, F-212's closure) ─────────────────────────────
    // `openAgentWindow` ASKS MAIN for a second window on this same bundle, showing ONE of
    // the operator's own agents. Like `threads.openWindow` it gets NO handle back — main
    // creates the window and main registers it in `main/app-windows.js`; the answer is
    // `{ ok }`. That is the whole reason the widened sender binding is safe: a renderer
    // cannot enlarge the set of bound senders, only ask main to.
    openAgentWindow: (segment, channelId, taskId, agentId) =>
      ipcRenderer.invoke('sessions:openAgentWindow', {
        segment: asId(segment),
        channelId: asId(channelId),
        taskId: asId(taskId),
        agentId: asId(agentId),
      }),

    // THE LIVE PERMISSION POSTURE (2026-08-20) — both axes, on a session already running,
    // applying from the very next gate decision rather than the next launch.
    // ⚠ NOT `channels.setLaunchPosture`, which writes the per-channel record governing the
    // NEXT spawn. This moves ONE live session's reducer state and stores nothing.
    // ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT: the axes decide whether the operator is
    // ASKED, the profile decides what is reachable at all and is checked first. Main
    // re-validates both strings against the frozen enums, and the reducer coerces again
    // fail-closed, so an unknown value lands on the most restrictive member of its axis.
    setMode: (channelId, taskId, axis, mode, agentId) =>
      ipcRenderer.invoke('sessions:setMode', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        axis: asMode(axis),
        mode: asMode(mode),
        agentId: asId(agentId),
      }),

    // ⚠ WHAT THE OPERATOR CALLS THIS AGENT (2026-08-25). Display only: nothing resolves an
    // agent by it, and an EMPTY string clears the name rather than storing one. Main answers
    // with its OWN stored value, so a refused name reverts instead of painting.
    rename: (agentId, name) =>
      ipcRenderer.invoke('sessions:rename', {
        agentId: asId(agentId),
        name: typeof name === 'string' ? name : '',
      }),

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
    setModel: (channelId, taskId, model, agentId) =>
      ipcRenderer.invoke('sessions:setModel', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        model: asMode(model),
        agentId: asId(agentId),
      }),

    // ⚠ `message` IS THE ONE OP ON THIS BRIDGE THAT STARTS A TURN, and it is the only
    // reason this namespace's failure direction is not simply "an agent that stops".
    // The operator types to their OWN agent out of band; main resolves (channel, thread)
    // against its own registry, delimits the text with that session's nonce
    // (`session-seed.js › frameOperatorTurn`, which carries operator authority rather than
    // fencing the words as data), and dispatches the SAME `steer` the session window's
    // composer always dispatched. It cannot grant a tool, widen a posture, reach another
    // machine, or post anything without the outbound gate. Capped here AND in main —
    // this bound is a convenience, main's is the fence.
    message: (channelId, taskId, text, agentId) =>
      ipcRenderer.invoke('sessions:message', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        text: String(text == null ? '' : text).slice(0, 4000),
        agentId: asId(agentId),
      }),

    // The work lane: what this agent has been doing (its own text, its tool calls WITH
    // NAMES, their results, what it posted). `narration` is the read for a window's first
    // paint, `onNarration` the live push — read once, then listen, exactly as the
    // summaries feed does, because a push-only surface leaves a freshly opened window
    // blank until the next event.
    // ⚠ Frames are keyed by `sessionKey`; a window filters to the agent it shows. Main
    // tracks no subscriptions, which is what stops the two sides going out of step.
    narration: (channelId, taskId, agentId) =>
      ipcRenderer.invoke('sessions:narration', {
        channelId: asId(channelId),
        taskId: asId(taskId),
        agentId: asId(agentId),
      }),
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

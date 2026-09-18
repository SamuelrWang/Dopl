// THE SESSION + WINDOW IPC OPS — `sessions:*` and `threads:*`.
//
// Split out of `main/channel-dir-ipc.js` on 2026-08-20 (F-226), which sat at EXACTLY 500 lines and
// so could not absorb even a corrected comment. The seam is REASON TO CHANGE, not line count:
// `channel-dir-ipc.js` keeps the `channels:*` ops (per-channel PREFERENCES), this file takes the
// AGENT + WINDOW verbs. They shared a file because they shared a guard, and the guard is now its
// own module (`main/ipc-guards.js`).
//
// ONE REGISTRATION ENTRY POINT, deliberately: `index.js` still calls `channelDirIpc.register({...})`
// and that function calls this one with the same `getSenderIds` accessor. A second call site would
// be a second place to forget the registry accessor, and an unbound privileged surface is the bug
// this binding exists to prevent.
//
// THE OPS HERE, and why each is bound:
//
//   sessions:launch          ⚠ STARTS a windowless session on my own thread
//   sessions:approveTemplate records this machine's first-use approval of ANOTHER
//                            member's agent template; starts nothing, grants no tool
//   sessions:reopen          opens the AGENT WINDOW on a live session (starts no query)
//   sessions:openAgentWindow (F-212) opens the AGENT window on one of my own agents
//   sessions:setMode         moves a LIVE session's two permission axes — supervision, not
//                            containment; see its own block
//   sessions:setModel        switches a LIVE session's MODEL (Query.setModel) and records it
//   sessions:message         ⚠ THE OTHER OP THAT STARTS A TURN — see its own block
//   sessions:narration       reads my own agent's work ring, for that window's first paint
//   sessions:pause           interrupts the turn my agent is running on a thread
//   sessions:end             ends my agent on a thread — terminal, and never the thread; and
//                            sessions:answerPermission answers ONE tool call HELD at the gate
//   sessions:delete          ⚠ ends it if live, then DESTROYS every LOCAL trace of it — never
//                            a channel message, which is the server's
//   sessions:rename          what the operator calls one agent — display only, never an address
//   sessions:describe        what it is FOR — rename's twin; sessions:mintAgentId ONE fresh id
//   agents:forgetThread      drops every LOCAL trace of a deleted thread's ended agents
//   claude:signIn            ⚠ signs THIS MAC in to Claude Code, then releases every held
//                            session — the ONE entry into the recovery flow
//   threads:openWindow       (Phase 10) opens a pop-out window on ONE thread
//
// SENDER BINDING IS THE SAME RULE, WRITTEN THE SAME WAY. Two checks, because one is not enough:
// the sender must be an APP-OWNED window's webContents AND that window's TOP frame (a cross-origin
// iframe SHARES its host's webContents). The predicate is `main/ipc-guards.js ›
// isAppWindowSender` — ONE source, shared with `ui-bridge.js`. The `appWindowOnly(...)` WRAPPER is
// written literally at every `ipcMain.handle` below, because `test/channel-ipc-sender.test.mjs`'s
// structural belt reads exactly that shape: hiding it inside a factory would pass review and
// silently disarm the guard that stops the NEXT op being added unbound.
//
// EVERY REFUSAL IS BYTE-IDENTICAL to that op's own bad-payload rejection, so a hostile page cannot
// learn which window it is running in from the difference.

const { ipcMain } = require('electron');
const { isAppWindowSender, isUuid } = require('./ipc-guards');
const { isAgentId, newAgentId } = require('./agent-id'); // ⚠ BOTH from the ONE require: `agent-id.js` is pure + electron-free, so it needs none of the lazy-require cycle dodging below.
const { diag } = require('./diag');

// THE THIRD COORDINATE OF EVERY AGENT OP (2026-08-21, Samuel's multiplayer ruling). `(channelId,
// taskId)` stopped identifying a session the moment an operator could run several agents on one
// thread, so each op takes an OPTIONAL `agentId`. An omitted id resolves to the OLDEST live agent
// on the thread (`main/session-reopen.js › resolveSession`), which is what a caller got when there
// was only ever one. Anything outside the closed `agent-id.js` charset is dropped to '' rather than
// refused, so a malformed value degrades instead of teaching a probe which values exist.
function asAgentId(value) {
  return isAgentId(value) ? String(value) : '';
}

// The 1:1 composer's body bound, enforced at the BOUNDARY (the preload caps too, but a renderer
// bound is a convenience and this one is the fence). PINNED against the preload's own cap by
// `test/preload-parity.test.mjs` — two deliberately separate bounds that must not drift.
const MESSAGE_CAP = 4000;

/**
 * Register the session + window ops. `getSenderIds` returns the LIVE set of app-owned
 * `webContents` ids (main/app-windows.js › senderIds). Absent (a mid-wave caller, a
 * harness), every handler fails CLOSED: an unbound privileged surface is not a usable one.
 */
function register(opts = {}) {
  const getSenderIds = typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  const appWindowOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('session ipc: refused', name, '— sender is not an app window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // NEW AGENT ON A THREAD — the operator's own Launch button, windowless and SPAWN-IDLE.
  //
  // The body lives in `main/session-launch-op.js` since 2026-08-22 (a §1 split; that file's header
  // carries the argument). What stays HERE is the IPC SURFACE: the op name, the sender binding
  // written literally at the site, and the refusal shape.
  //
  // It returns an ADDRESS, `{ ok: true, agentId }`, and STARTS NOTHING — the session is registered
  // idle and its query launches on the first message for that agent. Refusals on this lane, as
  // words the SPA renders: `cap`, `busy`, `no-sdk`, `auth-hold`, `disabled`, and since 2026-08-22
  // `no-template` and `template-approval`. `template-approval` is an IPC word ONLY and must not
  // join the `channel_launch_directives` refusal vocabulary: the directive lane has no human at the
  // keyboard and `orchestratorLaunchEnabled` stands in for the click there (OQ-3).
  ipcMain.handle('sessions:launch', appWindowOnly('sessions:launch', { ok: false }, (_event, payload) => (
    require('./session-launch-op').launchFromButton(payload)
  )));

  // FIRST-USE APPROVAL FOR ANOTHER MEMBER'S AGENT TEMPLATE (2026-08-22, OQ-3). It records a
  // MACHINE-LOCAL decision and starts nothing; it grants no tool, widens no axis and touches no
  // containment input — it decides only whether a foreign template's TEXT may become an agent's
  // role on this Mac. The store is unreachable from any Dopl endpoint, deliberately: a
  // server-writable approval lets a credential-holding agent pre-approve itself everywhere.
  ipcMain.handle('sessions:approveTemplate', appWindowOnly('sessions:approveTemplate', { ok: false }, (_event, payload) => (
    require('./session-launch-op').approveTemplate(payload)
  )));

  // FORGET EVERY LOCAL TRACE OF THIS THREAD'S ENDED AGENTS (2026-08-22, Samuel's ended-agent
  // ruling) — the thread-delete cascade's desktop half.
  //
  // MAIN CANNOT SEE A THREAD DELETION ON ITS OWN, which is why this is an op rather than a
  // listener: the delete is a SERVER cascade driven from the SPA, so an ended agent's frozen
  // history would sit out its full seven days keyed to a thread that no longer resolves.
  //
  // IT DELETES A LOCAL VIEW, NEVER A CONVERSATION — everything the agents POSTED is
  // `channel_messages` on the server and is not reachable from here. It cannot touch a LIVE session
  // either: the sweep's cleaners are keyed stores only (the SPA ends those first, over
  // `sessions:end`). Same guards as every op here, and best-effort by design — a failed cleanup
  // must not fail a delete the server already did.
  ipcMain.handle('agents:forgetThread', appWindowOnly('agents:forgetThread', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    try {
      const keys = require('./agent-retention').forgetThread(p.channelId, String(p.taskId || ''));
      return { ok: true, forgotten: keys.length };
    } catch (err) {
      diag('session ipc: agents:forgetThread failed —', (err && err.message) || String(err));
      return { ok: false };
    }
  }));

  // Reveal a LIVE session for a (channel, task) from a bound window. `channelId` is UUID-validated
  // (the anti-probe guard every op here uses); `taskId` is an opaque string, coerced and handed to
  // the engine, which resolves by `store.sessionKey(channelId, taskId)`. Wire name `task` == domain
  // name `thread`.
  //
  // Rewritten 2026-08-20 (F-228): `reopenByTask` has two answers now — a LIVE session opens the
  // AGENT WINDOW (`main/agent-window.js`), anything else refuses. It still starts NO query and runs
  // NO gated tool (test/open-session-no-query.test.mjs pins that half). `segment` is OPTIONAL: the
  // agent window's landing is a router path and main holds the workspace UUID while a route needs
  // the SLUG, so it comes from the renderer, character-checked here; an absent or unsafe one
  // degrades rather than refusing.
  ipcMain.handle('sessions:reopen', appWindowOnly('sessions:reopen', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const { isSafeSegment } = require('./deep-link-target');
    const engine = require('./session-engine');
    if (typeof engine.reopenByTask !== 'function') return { ok: false };
    return engine.reopenByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      segment: isSafeSegment(p.segment) ? String(p.segment) : '',
      agentId: asAgentId(p.agentId), // 2026-08-21: WHICH of my agents on that thread
    });
  }));

  // THE AGENT WINDOW (2026-08-20, F-212's closure) — a second window on this same bundle showing
  // ONE of the operator's OWN agents: its live narration, what it sent, and a 1:1 composer.
  // `threads:openWindow`'s twin, taking its guards verbatim.
  //
  // A SEPARATE OP FROM `sessions:reopen`, not a rename: `reopen` answers "show me this thread's
  // session" and resolves against the registry first, this one always means "open the agent view".
  // Three strings enter a router path and none is trusted — `channelId` UUID-gated, `segment` and
  // `taskId` through `deep-link-target.js › isSafeSegment`, the ONE character rule (INVARIANTS §11).
  // The VERSION FLOOR applies: `createShellWindow` is the min-version gate's single enforcement
  // point, and a factory that bypassed it would be a door the block does not cover.
  ipcMain.handle('sessions:openAgentWindow', appWindowOnly('sessions:openAgentWindow', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    // ⚠ THE BODY LIVES IN `main/session-ipc-window-op.js` SINCE 2026-09-14 (a §2 split at the
    // 500-line cap, on `session-launch-op.js`’s precedent). What stays HERE is the IPC SURFACE:
    // the op name, the sender binding, the refusal shape and the `channelId` UUID gate.
    return require('./session-ipc-window-op').openAgentWindow(p);
  }));

  // THE LIVE PERMISSION POSTURE (Samuel, 2026-08-20) — both axes, on a session ALREADY RUNNING,
  // applying from the very next gate decision rather than the next launch. NOT
  // `channels:setLaunchPosture`: that writes a per-channel RECORD governing the NEXT spawn, this
  // moves ONE live session's reducer state and stores nothing. It widens SUPERVISION (is the
  // operator asked?), never CONTAINMENT (what is reachable at all) — the profile is checked first
  // and no posture can widen it; the argument lives with `main/session-reopen.js › setModeByTask`.
  //
  // BOUNDS HERE, because this is the boundary: sender-bound; `channelId` UUID-gated; the AXIS
  // restricted to two literals (it cannot coerce — there is no "most restrictive axis"); the MODE
  // re-validated against `session-profiles.js`'s frozen enums, after which the reducer coerces
  // AGAIN fail-closed. The WINDOWLESS FLOOR is applied in `setModeByTask`, not here: this boundary
  // cannot see whether the resolved session is windowless.
  ipcMain.handle('sessions:setMode', appWindowOnly('sessions:setMode', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const axis = p.axis === 'tools' || p.axis === 'messages' ? p.axis : null;
    if (!axis) return { ok: false, reason: 'bad-axis' };
    const { normalizeToolMode, normalizeMessageMode } = require('./session-profiles');
    const mode = axis === 'tools' ? normalizeToolMode(p.mode) : normalizeMessageMode(p.mode);
    const engine = require('./session-engine');
    if (typeof engine.setModeByTask !== 'function') return { ok: false };
    return engine.setModeByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
      axis: axis,
      mode: mode,
    });
  }));

  // THE LIVE MODEL SWITCH (2026-08-22, Samuel's ruling). It moves ONE running session onto another
  // model and RECORDS the pick, so a later park/resume keeps it; the bundled SDK supports it in
  // streaming input mode (`Query.setModel`), the only mode this tree uses. Full argument at
  // `main/session-reopen.js › setModelByTask`. The value is the ID vocabulary (`session-model.js ›
  // MODEL_IDS`), coerced HERE and again inside; an unknown value lands on 'default', which CLEARS
  // the override rather than refusing, because the CLI's own pick is a legitimate thing to ask for.
  ipcMain.handle('sessions:setModel', appWindowOnly('sessions:setModel', { ok: false }, async (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.setModelByTask !== 'function') return { ok: false };
    return engine.setModelByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
      model: require('./session-model').normalizeModelId(p.model),
    });
  }));

  // THE OP ON THIS SURFACE THAT STARTS A TURN ON AN EXISTING SESSION (2026-08-20, F-212's direct
  // 1:1 lane). Everything else here is a read, a stop verb or a window; this one makes the
  // operator's own agent DO something, so it got its own review. The full argument lives with the
  // code that executes it (`main/session-reopen.js › messageByTask`), including why an out-of-band
  // steer correctly bypasses the inbound gate and why it is own-agents-only structurally.
  //
  // THE BOUNDS THAT LIVE HERE: sender-bound like every op in this file; `channelId` UUID-gated and
  // `taskId` coerced, resolved against MAIN's OWN registry, which holds nothing but this operator's
  // sessions on this machine; the text CAPPED here as well as in the preload; an EMPTY body after
  // trimming refused rather than dispatched (a blank turn wakes a parked agent to read nothing);
  // and the version floor, because a blocked build must not be able to start work.
  ipcMain.handle('sessions:message', appWindowOnly('sessions:message', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const text = String(p.text == null ? '' : p.text).slice(0, MESSAGE_CAP).trim();
    if (!text) return { ok: false, reason: 'empty' };
    try {
      if (require('./version-gate').isBlocked()) return { ok: false, reason: 'blocked' };
    } catch (_err) { /* mid-wave / harness: no gate is not a block */ }
    const engine = require('./session-engine');
    if (typeof engine.messageByTask !== 'function') return { ok: false };
    return engine.messageByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      // THE 1:1 LANE MUST REACH EXACTLY ONE AGENT (2026-08-21, ruling 5): named, it steers that
      // agent and no other; unnamed, the oldest live one on the thread.
      agentId: asAgentId(p.agentId),
      text: text,
    });
  }));

  // The agent window's FIRST PAINT. The ring is a push (`session-narration.js`), and a push-only
  // surface leaves a freshly opened window blank until the next event — which on an agent between
  // turns never comes. Read once on mount, then listen. READ-ONLY and derived from in-memory state:
  // no path, no token, no window handle, and no `inputFull`.
  ipcMain.handle('sessions:narration', appWindowOnly('sessions:narration', { entries: [] }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { entries: [] };
    const engine = require('./session-engine');
    if (typeof engine.narrationFor !== 'function') return { entries: [] };
    // IT HANDS OVER AN ADDRESS, NOT A KEY (2026-08-21). This used to build `${channelId}:${taskId}`
    // by hand — a second statement of the session-key format, which the third segment invalidated.
    return { entries: engine.narrationFor({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
    }) };
  }));

  // PAUSE / END MY OWN AGENT, from the Agents tab (wiring plan Phase 5, 2026-08-18). Same guards
  // and the SAME resolution (`store.sessionKey`) as `sessions:reopen`, so the two ops cannot
  // disagree about which session a card names.
  //
  // THESE ARE STOP VERBS AND THEY WIDEN NOTHING: nothing here can START a query, wake a parked
  // shell, grant a tool or post on the operator's behalf, so the failure direction of a forged call
  // is an agent that stops. There is no cross-machine control and there must not be — the registry
  // holds only this operator's own sessions (Samuel's ruling, INVARIANTS §11). The body is shared,
  // the wrapping is not; see this file's header.
  const control = (action) => (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.controlByTask !== 'function') return { ok: false };
    return engine.controlByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId), // pause/end MY agent, not whichever sibling is oldest
      action: action,
    });
  };
  ipcMain.handle('sessions:pause', appWindowOnly('sessions:pause', { ok: false }, control('pause')));
  ipcMain.handle('sessions:end', appWindowOnly('sessions:end', { ok: false }, control('end')));

  // ANSWER ONE HELD TOOL CALL — Approve / Deny, inline (2026-09-17, Samuel's ruling). ⚠ THE BODY, THE PAYLOAD GATES AND THE WHOLE ARGUMENT LIVE IN `main/session-answer-permission.js`:
  // why it is ALLOW-ONCE, why it widens nothing (a `deny` VERDICT parks no resolver, so there is nothing here to answer for one), and why "exactly once" is proved by the resolver map, not a flag.
  ipcMain.handle('sessions:answerPermission', appWindowOnly('sessions:answerPermission', { ok: false }, (_event, payload) => (
    require('./session-answer-permission').answerPermission(payload)
  )));

  // DELETE MY OWN AGENT (2026-08-25, Samuel's ruling) — the Agents-tab card's trash icon.
  //
  // The body lives in `main/session-delete-op.js` (a §1 split; that file's header carries the whole
  // argument, including why END-THEN-PURGE is an ORDER rather than a preference and why the
  // `agentId` is required here and optional everywhere else). What stays HERE is the IPC SURFACE.
  //
  // It is a STOP VERB plus a LOCAL ERASE and it widens nothing: it cannot start a query, wake a
  // parked shell, grant a tool or post on the operator's behalf. Own-agents-only for
  // `sessions:end`'s reason. It reaches no `channel_messages` — everything the agent said stays in
  // the channel, attributed exactly as before. This deletes a LOCAL VIEW, never a conversation.
  ipcMain.handle('sessions:delete', appWindowOnly('sessions:delete', { ok: false }, (_event, payload) => (
    require('./session-delete-op').deleteAgent(payload)
  )));

  // WHAT THE OPERATOR CALLS THIS AGENT (2026-08-25, Samuel's ruling). Store is
  // `main/agent-names.js`, keyed by the INSTANCE ADDRESS.
  //
  // It is the ONLY op here that takes no channel, and that is the point: a name belongs to an
  // agent, not to where it is working. It moves no session, starts no turn and grants nothing — the
  // registry is not even consulted. IT NAMES, IT NEVER ADDRESSES: `@<agentId>` and every other op
  // still resolve against the id, or a rename would silently re-point a running instruction. An
  // EMPTY name CLEARS, which is how the operator goes back to `Agent #<id>`.
  //
  // The answer is MAIN's own stored value, never an echo: a refused name (too long, control or bidi
  // characters) comes back `{ ok: false }` so the field can revert rather than paint a name this
  // machine did not take. Same rule `setMode` / `setModel` follow.
  ipcMain.handle('sessions:rename', appWindowOnly('sessions:rename', { ok: false }, (_event, payload) => {
    const p = payload || {};
    const agentId = asAgentId(p.agentId);
    if (!agentId) return { ok: false };
    // The write is `agent-self-ops.js › applyRenameTo` since 2026-09-01 — the ONE statement of
    // "empty CLEARS, else sanitize, and a sanitizer refusal is a refusal rather than a silent
    // strip", shared with the in-process tool and the external rename directive. It commits through
    // `agent-identity-commit.js` since 2026-09-05, which writes the store AND flushes the summary:
    // writing `agent-names` directly here moved the local store without moving the summary digest,
    // so the push never fired and the @-picker offered the old name until an app restart.
    const res = require('./agent-identity-commit').commitRename(agentId, p.name);
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, displayName: res.name };
  }));

  // WHAT AN AGENT IS FOR, beside what it is CALLED (2026-08-27, Samuel's launch-panel ruling).
  // `sessions:rename`'s TWIN — its whole contract above applies verbatim. EMPTY clears; the answer
  // is MAIN's own stored value. Why a second op: `main/agent-names.js › patched`.
  ipcMain.handle('sessions:describe', appWindowOnly('sessions:describe', { ok: false }, (_event, payload) => {
    const p = payload || {};
    const agentId = asAgentId(p.agentId);
    if (!agentId) return { ok: false };
    // Same commit path as its twin, and it had the same missing flush (2026-09-05). A description
    // never reaches a PEER — `channel_sessions` carries no such column, on purpose — but it does
    // ride this machine's own summary onto its own cards.
    const stored = require('./agent-identity-commit').commitDescribe(agentId, p.description);
    if (stored === null) return { ok: false, reason: 'bad-description' };
    return { ok: true, description: stored || null };
  }));

  // ONE FRESH INSTANCE ID, ASSIGNED TO NOBODY (2026-08-27, Samuel's launch-panel ruling). The panel
  // shows the operator the ID while they fill the form, so it is minted BEFORE the spawn and handed
  // to `sessions:launch`. Its presence is the SPA's capability gate and it reserves nothing —
  // `main/agent-id.js` argues both.
  ipcMain.handle('sessions:mintAgentId', appWindowOnly('sessions:mintAgentId', { ok: false }, () => (
    { ok: true, agentId: newAgentId() }
  )));

  // SIGN THIS MAC IN TO CLAUDE CODE (2026-08-25) — the ONE entry into the recovery flow.
  //
  // The body lives in `main/claude-signin-op.js` (a §1 split); that file's header carries the whole
  // argument, including why success is RE-PROBED rather than reported and why the single-flight
  // stays in `claude-auth.js`. The wrapper is written literally at the site like every op here.
  //
  // It takes NO PAYLOAD, the third op in this family whose subject is the MACHINE rather than a
  // channel. There is no id to UUID-gate, so the SENDER BINDING IS THE ONLY GUARD — which is why it
  // is enumerated in that suite rather than waved through. It starts no turn and grants nothing: it
  // drives an OAuth flow the operator completes in their own browser (no credential is ever typed
  // into a Dopl surface) and then RELEASES sessions this machine already holds. The failure
  // direction of a forged call is a native dialog the operator cancels.
  ipcMain.handle('claude:signIn', appWindowOnly('claude:signIn', { ok: false }, () => (
    require('./claude-signin-op').signIn()
  )));

  // THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18) — a SECOND window on the SAME SPA
  // bundle, landing on the channel route with this thread selected. It is the op the whole
  // sender-binding widening exists for.
  //
  // The payload is three strings entering a router path and none is trusted: `channelId` UUID-gated
  // like every op here, `segment` + `threadId` through `deep-link-target.js › isSafeSegment`, the
  // ONE character rule (INVARIANTS §11). Required LAZILY so this file keeps its load-time
  // dependency set small. The VERSION FLOOR applies — `createShellWindow` is the min-version gate's
  // single enforcement point, and a factory that bypassed it would be a window the block does not
  // cover. It refuses in the same `{ ok: false }` shape as a bad channel id, a foreign sender and a
  // full window budget alike.
  ipcMain.handle('threads:openWindow', appWindowOnly('threads:openWindow', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const { isSafeSegment } = require('./deep-link-target');
    if (!isSafeSegment(p.segment) || !isSafeSegment(p.threadId)) return { ok: false };
    try {
      if (require('./version-gate').isBlocked()) {
        diag('session ipc: refused threads:openWindow — the version floor is blocking');
        return { ok: false };
      }
    } catch (_err) { /* mid-wave / harness: no gate is not a block */ }
    return require('./popout-window').openThreadWindow({
      segment: p.segment,
      channelId: p.channelId,
      threadId: p.threadId,
    });
  }));
}

// ⚠ `asAgentId` IS EXPORTED SINCE 2026-09-14 (the §2 split below this file): the agent-window
// op's body reads it from here rather than respelling the coercion — one statement, two files.
module.exports = { register, MESSAGE_CAP, asAgentId };

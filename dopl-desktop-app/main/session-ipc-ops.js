// THE SESSION + WINDOW IPC OPS — `sessions:*` and `threads:*`.
//
// ⚠ SPLIT OUT OF `main/channel-dir-ipc.js` ON 2026-08-20 (F-226). That file sat at EXACTLY
// 500 lines, which under INVARIANTS §1 means it could not absorb so much as a corrected
// COMMENT — and it was carrying four stale ones, including a SECURITY-MODEL paragraph that
// still described the main window as hosting remote usedopl.com content. A file at the cap
// does not just stop growing; it stops being correctable, and that is the state this split
// was taken out of.
//
// THE SEAM IS REASON-TO-CHANGE, not line count. `channel-dir-ipc.js` keeps the `channels:*`
// ops — per-channel PREFERENCES (the working folder, the durable launch posture, auto-send),
// which move when a new per-channel setting is added. This file takes the AGENT + WINDOW
// verbs, which move when the agent surface moves. They shared a file because they shared a
// guard, and the guard is now its own module (`main/ipc-guards.js`).
//
// ⚠ ONE REGISTRATION ENTRY POINT, DELIBERATELY. `index.js` still calls
// `channelDirIpc.register({...})` exactly as before, and that function calls this one with
// the same `getSenderIds` accessor. A second call site in `index.js` would be a second place
// to forget the registry accessor, and an unbound privileged surface is the bug this whole
// binding exists to prevent.
//
// THE OPS HERE, and why each is bound:
//
//   sessions:launch          ⚠ STARTS a windowless session on my own thread
//   sessions:reopen          opens the AGENT WINDOW on a live session (starts no query)
//   sessions:openAgentWindow (F-212) opens the AGENT window on one of my own agents
//   sessions:setMode         moves a LIVE session's two permission axes — supervision, not
//                            containment; see its own block
//   sessions:setModel        switches a LIVE session's MODEL (Query.setModel) and records it
//   sessions:message         ⚠ THE OTHER OP THAT STARTS A TURN — see its own block
//   sessions:narration       reads my own agent's work ring, for that window's first paint
//   sessions:pause           interrupts the turn my agent is running on a thread
//   sessions:end             ends my agent on a thread — terminal, and never the thread
//   agents:forgetThread      drops every LOCAL trace of a deleted thread's ended agents
//   threads:openWindow       (Phase 10) opens a pop-out window on ONE thread
//
// ⚠ SENDER BINDING IS THE SAME RULE, WRITTEN THE SAME WAY. Two checks, because one is not
// enough: the sender must be an APP-OWNED window's webContents AND that window's TOP frame
// (a cross-origin iframe SHARES its host's webContents). The predicate is
// `main/ipc-guards.js › isAppWindowSender` — ONE source, shared with `ui-bridge.js`. The
// `appWindowOnly(...)` WRAPPER is written literally at every `ipcMain.handle` below, because
// `test/channel-ipc-sender.test.mjs`'s structural belt reads exactly that shape: hiding it
// inside a factory would pass review and silently disarm the guard that stops the NEXT op
// being added unbound.
//
// ⚠ EVERY REFUSAL IS BYTE-IDENTICAL TO THAT OP'S OWN BAD-PAYLOAD REJECTION, so a hostile
// page cannot learn which window it is running in from the difference.

const { ipcMain } = require('electron');
const { isAppWindowSender, isUuid } = require('./ipc-guards');
const { isAgentId } = require('./agent-id');
const { diag } = require('./diag');

// ⚠ THE THIRD COORDINATE OF EVERY AGENT OP (2026-08-21, Samuel's multiplayer ruling). Ops here
// address `(channelId, taskId)` and that pair stopped identifying a session the moment an
// operator could run several agents on one thread — so each one takes an OPTIONAL `agentId`.
// Optional, never required: an omitted id resolves to the OLDEST live agent on the thread
// (`main/session-reopen.js › resolveSession`), which is byte-for-byte what a caller got when
// there was only ever one, so an older renderer keeps working. Anything that is not the closed
// `agent-id.js` charset is dropped to '' rather than refused, on the same terms as `segment`:
// a malformed value degrades to the thread-scoped answer instead of teaching a probe which
// values exist.
function asAgentId(value) {
  return isAgentId(value) ? String(value) : '';
}

// The 1:1 composer's body bound, enforced at the BOUNDARY (the preload caps too, but a
// renderer bound is a convenience and this one is the fence). Well above a typed note, well
// below anything that could stuff a context window.
// ⚠ PINNED AGAINST THE PRELOAD'S OWN CAP by `test/preload-parity.test.mjs` — the two are
// deliberately separate bounds and must not drift into disagreeing about the same sentence.
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

  // NEW AGENT ON A THREAD (2026-08-20; SPAWN-IDLE and multi-agent since 2026-08-21). A
  // WINDOWLESS requester-side session: the clicking human IS the consent (it is
  // their own agent on their own thread — no row is raised), the message axis is
  // floored at auto_inbound, and the OUT half is the channel's auto-send posture.
  // UUID-gated channel; taskId must be a UUID too (first-class threads only —
  // a legacy exchange has no thread to attach to). Fail shape: { ok: false }.
  //
  // ⚠ TWO THINGS CHANGED ON 2026-08-21 (Samuel's rulings 2 and 3) AND BOTH ARE CONTRACT:
  //
  //   1. IT MINTS AN AGENT ID AND RETURNS IT — `{ ok: true, agentId }`. The id is the ADDRESS
  //      of the thing just created: it names the pill, it is what a human @-mentions in the
  //      thread to talk to THIS agent rather than its siblings, and it is the third argument
  //      every other op here now takes. `sessionId` still rides along and is still an opaque
  //      React key, never an address.
  //   2. IT STARTS NOTHING. The session is registered IDLE with prepared context (channel,
  //      thread, workspace, operator, posture) and NO first SDK turn: `query()` does not run
  //      until the first inbound message for this agent arrives, at which point it launches
  //      with the full framing plus that message. So the button is cheap, pressing it twice
  //      genuinely gives you two agents, and an agent nobody talks to costs no `claude` child.
  //      Ordinary idle timers apply from the spawn (`session-engine.js`).
  //
  // ⚠ `counterpartyId` IS OPTIONAL NOW and no longer refuses the launch. It used to be
  // REQUIRED because it FENCED THE FEED — only that member's replies could reach the session.
  // The fan-out ruling replaced that fence with the thread (`main/session-dispatch.js`), so
  // demanding it here would refuse a legitimate spawn on a thread whose other party the caller
  // has not resolved. It still rides through when known: it labels the outbound consent card.
  //
  // ⚠ AND `taskId` IS NULLABLE SINCE 2026-08-21 (Samuel's CHANNEL-LEVEL AGENT ruling) — `null`
  // spawns an agent attached to the CHANNEL rather than to a thread. Its key is
  // `<channelId>::<agentId>`: the same three-part key with an empty middle segment, so nothing
  // about the slot, the state push or the resolution rules is special-cased. What differs is
  // only its FEED SCOPE, and that falls out of the fan-out for free — an untagged main-room post
  // resolves `firstClassTaskId(m) === ''`, so it reaches exactly the sessions whose own thread
  // id is '' and no others.
  //
  // ⚠ `null` AND `''` ARE DIFFERENT REQUESTS THAT LAND ON THE SAME SCOPE, and both are accepted
  // rather than one being normalised away at the boundary. `null` is the SPA asking for a
  // channel-level agent; `''` is the legacy wire value for a responder whose exchange never
  // became a first-class thread. They coincide because both see exactly the untagged main-room
  // traffic — there is no third scope for them to disagree about — and refusing `''` here would
  // refuse an older caller for no behavioural gain.
  // ⚠ A SUPPLIED `taskId` MUST STILL BE A UUID: first-class threads only.
  //
  // ⚠ THERE IS NO `no-counterparty` REFUSAL ANY MORE, on this lane or any other. It was the
  // consequence of the counterparty FENCING the feed; the fan-out replaced that fence with the
  // thread, and a channel-level agent has no counterparty to resolve by construction.
  ipcMain.handle('sessions:launch', appWindowOnly('sessions:launch', { ok: false }, async (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const channelLevel = p.taskId == null || p.taskId === '';
    if (!channelLevel && !isUuid(p.taskId)) return { ok: false };
    const engine = require('./session-engine');
    const channelPrefs = require('./channel-prefs');
    const targeting = require('./targeting');
    const listener = require('./channel-listener');
    // ⚠ CONTAINMENT: the profile comes from MAIN's own watched-channel record
    // (the server DTO), never the renderer's claim — a forged call must not
    // widen it. An unwatched channel fails restrictive.
    const watched = (listener.listWatchedChannels() || []).find((c) => c.id === p.channelId);
    const toolProfile = watched ? targeting.resolveToolProfile(watched) : 'read_only';
    const title = typeof p.threadTitle === 'string' ? p.threadTitle.slice(0, 200) : '';
    // ⚠ THE GOAL IS DISPLAY/SEED TEXT ONLY ON THIS LANE and is never sent as a turn — a
    // SPAWN-IDLE session has no first turn at all. It survives because `startSession` still
    // builds the initiating-request payload from it, and because a CHANNEL-LEVEL agent has no
    // thread to be told to read.
    const goal = channelLevel
      ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
      : title
        ? `Join the thread "${title}" as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.`
        : 'Join this thread as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.';
    const res = await engine.launchRequesterSession({
      channelId: p.channelId,
      // '' is the CHANNEL-LEVEL scope, not a missing value — see the block above.
      taskId: channelLevel ? '' : p.taskId,
      workspaceId: typeof p.workspaceId === 'string' ? p.workspaceId : null,
      goal,
      counterpartyId: isUuid(p.counterpartyId) ? p.counterpartyId : null,
      direct: p.direct === true,
      context: {
        channelName: typeof p.channelName === 'string' ? p.channelName.slice(0, 120) : '',
        taskTitle: channelLevel ? null : (title || null),
        channelId: p.channelId,
        workspaceId: typeof p.workspaceId === 'string' ? p.workspaceId : null,
        taskId: channelLevel ? '' : p.taskId,
        // ⚠ THE SCOPE THE FRAMING READS (2026-08-21). `prompt-framing.js` cannot infer
        // "channel-level" from an absent thread id alone — a legacy responder also has none —
        // so the launch that KNOWS states it.
        scope: channelLevel ? 'channel' : 'thread',
        workspaceSegment: typeof p.workspaceSegment === 'string' ? p.workspaceSegment : null,
      },
      toolProfile,
      mode: 'interactive',
      windowless: true,
      // THE DURABLE POSTURE, CONSUMED HERE AND NOWHERE ELSE (2026-08-20).
      // ⚠ `tools` was PINNED to 'manual' and the operator's Settings-tab pick was
      // never read on this lane at all, so "Tools = Bypass" did nothing for the
      // one launch shape the button in front of them starts. It is a real read
      // now — and this is the ONLY call site, which is what keeps H2 intact: the
      // click on Launch is the human decision this posture applies to, exactly
      // like the consent Allow is the arm's. A peer wake, a resume and a
      // recreate still pass nothing and still inherit manual/ask.
      // ⚠ MESSAGES WIDENS, NEVER NARROWS, and it is floored at auto_inbound for
      // the windowless reason (no Accept UI exists). Auto-send is the durable
      // OUT switch; an auto_outbound / auto_both posture is a second way to say
      // the same thing, so either turns the floor into auto_both — and neither
      // can drop below it.
      startModes: channelPrefs.launchStartModes(p.channelId),
      // ⚠ THE CHANNEL'S CHOSEN MODEL (2026-08-22, Samuel's ruling), read through its OWN reader.
      // `getLaunchModel` is deliberately not `getLaunchPosture`: that one has exactly ONE
      // consumer and a census pins the count, because a second reader of the stored PERMISSION
      // pair re-opens H2. A model grants nothing and reaches no gate, so it may travel further —
      // and keeping the two readers apart is what makes that distinction checkable.
      // The full id is converted to the argv-safe ALIAS here, because everything below this line
      // speaks the alias vocabulary (`session-model.js` carries the two-list argument).
      model: require('./session-model').aliasForModelId(channelPrefs.getLaunchModel(p.channelId)),
      // ⚠ SPAWN IDLE (ruling 3): register, prepare the context, send NO first turn. The FIRST
      // inbound message for this agent is what starts its query.
      idle: true,
      // ⚠ `operatorArmed` IS WHAT LETS THE DURABLE POSTURE REACH AN IDLE SPAWN. `startSession`'s
      // FIX-4 guard refuses a handed-in posture on a `parkedShell` unless a human armed it just
      // now — because a shell is normally woken by something that is NOT the approving human.
      // Here the click on New Agent IS that human, in the same breath as the posture read, which
      // is exactly the case the flag exists for. Nothing else on this surface sets it.
      operatorArmed: true,
    });
    // THE ANSWER IS THE ADDRESS. `agentId` is present on every successful launch.
    if (res && res.agentId) return { ok: true, agentId: res.agentId, sessionId: res.sessionId || null };
    return { ok: false, reason: (res && res.skipped) || 'unknown' };
  }));

  // FORGET EVERY LOCAL TRACE OF THIS THREAD'S ENDED AGENTS (2026-08-22, Samuel's ended-agent
  // ruling). The thread-delete cascade's desktop half.
  //
  // ⚠ MAIN CANNOT SEE A THREAD DELETION ON ITS OWN, and that is why this op exists rather than
  // a listener. The delete is a SERVER cascade driven from the SPA
  // (`channels/server/service-tasks-delete.ts`); main learns nothing from it, so an ended
  // agent's frozen history would sit out its full seven days keyed to a thread that no longer
  // resolves — a card with a stale title opening a window onto work whose exchange is gone.
  // The SPA already ends its own agents on that thread before deleting; this is the same
  // gesture finished.
  //
  // ⚠ IT DELETES A LOCAL VIEW, NEVER A CONVERSATION. Everything the agents POSTED is
  // `channel_messages` on the server and is not reachable from here at all.
  // ⚠ IT CANNOT TOUCH A LIVE SESSION. The sweep's cleaners are keyed stores only; an agent
  // still running keeps running (the SPA ends those first, deliberately, over `sessions:end`).
  // ⚠ Same guards as every op here: sender-bound, `channelId` UUID-gated, `taskId` coerced.
  // Best-effort by design — a failed cleanup must not fail a delete the server already did.
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

  // Reveal a LIVE session for a (channel, task) from a bound window.
  // channelId is UUID-validated (the same anti-probe guard as every op here);
  // taskId is an opaque string (a legacy `task-{channel}-{seq}` id or a
  // first-class UUID), coerced and handed to the engine, which resolves the
  // session by `store.sessionKey(channelId, taskId)`.
  // ⚠ REWRITTEN 2026-08-20: this described the v1 SESSION WINDOW that `sessions:reopen`
  // used to show or recreate, deleted whole (F-228). `reopenByTask` has two answers now — a
  // LIVE session opens the AGENT WINDOW (`main/agent-window.js`), anything else refuses. It
  // still starts NO query and runs NO gated tool (test/open-session-no-query.test.mjs pins
  // that half). Wire name `task` == domain name `thread`.
  // ⚠ `segment` JOINED THE PAYLOAD ON 2026-08-20 and is OPTIONAL. The agent window's landing
  // is a router path, and main holds the workspace UUID while a route needs the SLUG — so the
  // segment has to come from the renderer, character-checked here like every other string
  // entering a path. An absent or unsafe one degrades rather than refusing: an older caller
  // that only knows `(channel, task)` keeps working exactly as it did.
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

  // THE AGENT WINDOW (2026-08-20, F-212's closure) — a second window on this same bundle
  // showing ONE of the operator's OWN agents: its live narration, what it sent, and a 1:1
  // composer. It is `threads:openWindow`'s twin and takes its guards verbatim.
  //
  // ⚠ IT IS A SEPARATE OP FROM `sessions:reopen`, not a rename. `reopen` answers "show me
  // this thread's session" and resolves against the registry first; this one always means
  // "open the agent view". Both reach `agent-window.js`, so there is one window factory and
  // one budget — what differs is what the caller is asking.
  // ⚠ THREE STRINGS ENTERING A ROUTER PATH, none trusted: `channelId` UUID-gated,
  // `segment` and `taskId` through `deep-link-target.js › isSafeSegment` — the ONE
  // character rule (INVARIANTS §11). A second regex here would be a second answer to it.
  // ⚠ THE VERSION FLOOR APPLIES, like `threads:openWindow`: `createShellWindow` is the
  // min-version gate's single enforcement point, and a factory that bypassed it would be a
  // door the block does not cover.
  ipcMain.handle('sessions:openAgentWindow', appWindowOnly('sessions:openAgentWindow', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const { isSafeSegment } = require('./deep-link-target');
    // ⚠ A CHANNEL-LEVEL AGENT HAS NO THREAD (2026-08-21), so an EMPTY `taskId` is legitimate
    // here — but only when an agent id names the target instead. A payload naming neither is
    // asking for a window onto nothing and is refused in the same `{ok:false}` shape as
    // everything else. A NON-empty taskId still passes the ONE character rule.
    const agentId = asAgentId(p.agentId);
    const taskId = p.taskId == null ? '' : String(p.taskId);
    if (!isSafeSegment(p.segment)) return { ok: false };
    if (taskId ? !isSafeSegment(taskId) : !agentId) return { ok: false };
    try {
      if (require('./version-gate').isBlocked()) {
        diag('session ipc: refused sessions:openAgentWindow — the version floor is blocking');
        return { ok: false };
      }
    } catch (_err) { /* mid-wave / harness: no gate is not a block */ }
    return require('./agent-window').openAgentWindow({
      segment: p.segment,
      channelId: p.channelId,
      taskId,
      // ⚠ ONE WINDOW PER AGENT since 2026-08-21: without this, opening the second agent on a
      // thread silently FRONTED the first one's window.
      agentId,
    });
  }));

  // THE LIVE PERMISSION POSTURE (Samuel, 2026-08-20) — both axes, on a session ALREADY
  // RUNNING, applying from the very next gate decision rather than the next launch.
  // ⚠ NOT `channels:setLaunchPosture`: that writes a per-channel RECORD governing the NEXT
  // spawn, this moves ONE live session's reducer state and stores nothing. Collapsing the
  // two makes a per-session decision permanent.
  // ⚠ SECURITY, in one line because the argument lives with the code that acts on it
  // (`main/session-reopen.js › setModeByTask`, and the review at
  // `test/preload-parity.test.mjs`): it widens SUPERVISION (is the operator asked?), never
  // CONTAINMENT (what is reachable at all) — the profile is checked first and no posture can
  // widen it.
  //
  // BOUNDS HERE, because this is the boundary: sender-bound; `channelId` UUID-gated; the AXIS
  // restricted to two literals (it cannot coerce — there is no "most restrictive axis"); the
  // MODE re-validated against `session-profiles.js`'s frozen enums, after which the reducer
  // coerces AGAIN fail-closed onto the most restrictive member of its axis.
  // ⚠ AND THE WINDOWLESS FLOOR IS APPLIED IN `setModeByTask`, NOT HERE (2026-08-20). The
  // message axis may not drop below `auto_inbound` on a session with no Accept surface; the
  // clamp lives with the session it is a fact about, because this boundary cannot see whether
  // the resolved session is windowless.
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

  // ⚠ THE LIVE MODEL SWITCH (2026-08-22, Samuel's ruling). It moves ONE running session onto
  // another model and RECORDS the pick, so a later park/resume keeps it; the bundled SDK supports
  // it in streaming input mode (`Query.setModel`), the only mode this tree uses, so it really
  // switches. Full argument at `main/session-reopen.js › setModelByTask`. It is NOT
  // `channels:setLaunchPosture`, which governs the NEXT spawn — a session can be moved off what
  // it launched on. The value is the ID vocabulary (`session-model.js › MODEL_IDS`), coerced HERE
  // and again inside; an unknown value lands on 'default', which CLEARS the override rather than
  // refusing, because the CLI's own pick is a legitimate thing to ask for.
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

  // ⚠ THE OP ON THIS SURFACE THAT STARTS A TURN ON AN EXISTING SESSION (2026-08-20, F-212's
  // direct 1:1 lane). Everything else here is a read, a stop verb or a window; this one makes
  // the operator's own agent DO something, which is a materially different security shape and
  // got its own review. The full argument lives with the code that executes it
  // (`main/session-reopen.js › messageByTask`), including why an out-of-band steer correctly
  // bypasses the inbound gate and why it is own-agents-only structurally.
  //
  // THE BOUNDS THAT LIVE HERE, because this is the boundary:
  //   • sender-bound like every op in this file (`appWindowOnly`, literally at the site);
  //   • `channelId` UUID-gated, `taskId` coerced — resolved against MAIN's OWN registry,
  //     which holds nothing but this operator's sessions on this machine;
  //   • the text is CAPPED here as well as in the preload, because a renderer bound is a
  //     convenience and this one is the boundary;
  //   • an EMPTY body after trimming is refused rather than dispatched — a blank turn
  //     wakes a parked agent to read nothing;
  //   • the version floor applies: a blocked build must not be able to start work.
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
      // ⚠ THE 1:1 LANE MUST REACH EXACTLY ONE AGENT (2026-08-21, ruling 5). Named, it steers
      // that agent and no other; unnamed, it steers the oldest live one on the thread, which is
      // what this op did when a thread could only ever hold one.
      agentId: asAgentId(p.agentId),
      text: text,
    });
  }));

  // The agent window's FIRST PAINT. The ring is a push (`session-narration.js`), and a
  // push-only surface leaves a freshly opened window blank until the next event — which on
  // an agent between turns never comes. Read once on mount, then listen; the same rule
  // `sessions.summaries` follows and for the same reason.
  // ⚠ READ-ONLY AND DERIVED FROM IN-MEMORY STATE: no path, no token, no window handle, and
  // no `inputFull` (session-narration.js's header states what may enter a ring entry).
  ipcMain.handle('sessions:narration', appWindowOnly('sessions:narration', { entries: [] }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { entries: [] };
    const engine = require('./session-engine');
    if (typeof engine.narrationFor !== 'function') return { entries: [] };
    // ⚠ IT HANDS OVER AN ADDRESS, NOT A KEY (2026-08-21). This used to build
    // `${channelId}:${taskId}` by hand — a second statement of the session-key format, sitting
    // in the IPC layer, which the third segment silently invalidated. The engine resolves it.
    return { entries: engine.narrationFor({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
    }) };
  }));

  // PAUSE / END MY OWN AGENT, from the Agents tab (wiring plan Phase 5, 2026-08-18). Same
  // guards as `sessions:reopen` — sender-bound, UUID-gated channel id, opaque task id — and
  // the SAME resolution (`store.sessionKey`), so the two ops cannot disagree about which
  // session a card names.
  //
  // ⚠ THESE ARE STOP VERBS AND THEY WIDEN NOTHING. Nothing here can START a query, wake a
  // parked shell, grant a tool or post on the operator's behalf — the failure direction of a
  // forged call is an agent that stops, which is the safe one.
  // ⚠ There is no cross-machine control here and there must not be: the registry holds only
  // this operator's own sessions, so an unresolvable key answers { ok: false } rather than
  // reaching for anything else. Pause/end is own-agents-only (Samuel's ruling, INVARIANTS §11).
  // ⚠ THE BODY IS SHARED, THE WRAPPING IS NOT — see this file's header for why the wrap is
  // written literally at each registration site.
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

  // THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18). The thread view's
  // "Open as new window" button — a SECOND window on the SAME SPA bundle, landing on the
  // channel route with this thread selected. It is the op the whole sender-binding
  // widening exists for.
  //
  // ⚠ THE PAYLOAD IS THREE STRINGS ENTERING A ROUTER PATH, and none of them is trusted:
  // `channelId` is UUID-gated like every op here, and `segment` + `threadId` pass
  // `deep-link-target.js › isSafeSegment` — the ONE character rule for a string entering a
  // router path (INVARIANTS §11). A second regex here would be a second answer to it.
  // Required LAZILY so this file keeps its load-time dependency set small.
  // ⚠ THE VERSION FLOOR APPLIES. `createShellWindow` is the min-version gate's single
  // enforcement point (main/shell-mode.js), and a factory that bypassed it would be a window
  // the block does not cover — so a blocked build refuses here rather than growing a second
  // door. There is nothing to pop out of anyway: the shell is the update screen.
  // ⚠ REFUSES IN THE SAME `{ ok: false }` SHAPE as a bad channel id, a foreign sender and a
  // full window budget alike — a hostile page must not learn which one it hit.
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

module.exports = { register, MESSAGE_CAP };

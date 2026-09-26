// The session + window IPC ops (`sessions:*`, `threads:*`, `agents:forgetThread`, `runtime:*`), registered
// through `channel-dir-ipc.js › register`. Every handler is sender-bound: an app-owned window's TOP frame
// (`ipc-guards.js › isAppWindowSender`), and `appWindowOnly(...)` is written literally at each `ipcMain.handle`
// because test/channel-ipc-sender.test.mjs reads that shape. Every refusal matches the op's bad-payload shape.

const { ipcMain } = require('electron');
const { isAppWindowSender, isUuid } = require('./ipc-guards');
const { isAgentId, newAgentId } = require('./agent-id');
const { diag } = require('./diag');

// The optional third coordinate of every agent op: an id outside `agent-id.js`'s charset degrades to '' (the
// oldest live agent on the thread) rather than refusing, so a probe learns nothing.
function asAgentId(value) {
  return isAgentId(value) ? String(value) : '';
}

// The 1:1 body bound, enforced at the boundary; pinned against the preload's own cap (preload-parity.test).
const MESSAGE_CAP = 4000;

// A runtime id's shape (`''` = the default); registration is checked inside the op.
const RUNTIME_ID_RE = /^(?:[a-z][a-z0-9-]{0,31})?$/;

/** `payload.runtimeId` when it is shaped like one (absent = `''`), else null. */
function runtimeIdOf(payload) {
  const raw = payload && payload.runtimeId;
  const id = raw == null ? '' : raw;
  return typeof id === 'string' && RUNTIME_ID_RE.test(id) ? id : null;
}

/** Register the ops. With no `getSenderIds` (a harness), every handler fails CLOSED. */
function register(opts = {}) {
  const getSenderIds = typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  const appWindowOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('session ipc: refused', name, '— sender is not an app window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // New Agent: returns an ADDRESS and starts nothing (body: `session-launch-op.js`). `identity-approval` is an
  // IPC word only, never a directive refusal (that lane has no human at the keyboard).
  ipcMain.handle('sessions:launch', appWindowOnly('sessions:launch', { ok: false }, (_event, payload) => (
    require('./session-launch-op').launchFromButton(payload)
  )));

  // A machine-local first-use approval of another member's identity: starts nothing, grants no tool.
  ipcMain.handle('sessions:approveIdentity', appWindowOnly('sessions:approveIdentity', { ok: false }, (_event, payload) => (
    require('./session-launch-op').approveIdentity(payload)
  )));

  // The thread-delete cascade's desktop half: drops LOCAL traces of its ended agents (main cannot see a server
  // delete). Never a channel message, never a live session; best effort.
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

  // Open the agent window on a LIVE session (starts no query); `segment` is character-checked and optional.
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
      agentId: asAgentId(p.agentId),
    });
  }));

  // The agent window on one of my own agents (body: `session-ipc-window-op.js`); the version floor applies there.
  ipcMain.handle('sessions:openAgentWindow', appWindowOnly('sessions:openAgentWindow', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return require('./session-ipc-window-op').openAgentWindow(p);
  }));

  // A LIVE session's posture (supervision, never containment). The axis is one of two literals; the mode is
  // validated against the RESOLVED session's runtime words inside (this boundary cannot see the session).
  ipcMain.handle('sessions:setMode', appWindowOnly('sessions:setMode', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const axis = p.axis === 'tools' || p.axis === 'messages' ? p.axis : null;
    if (!axis) return { ok: false, reason: 'bad-axis' };
    const mode = typeof p.mode === 'string' ? p.mode.slice(0, 64) : '';
    const engine = require('./session-engine');
    if (typeof engine.setModeByTask !== 'function') return { ok: false };
    return engine.setModeByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
      axis: axis,
      mode: mode,
      pinned: true,
    });
  }));

  // Switch a LIVE session's model; bounded here, resolved on its runtime's roster inside (unknown refuses).
  ipcMain.handle('sessions:setModel', appWindowOnly('sessions:setModel', { ok: false }, async (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.setModelByTask !== 'function') return { ok: false };
    return engine.setModelByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
      model: typeof p.model === 'string' ? p.model.trim().slice(0, 120) : '',
    });
  }));

  // The op that STARTS A TURN on an existing session (the 1:1 lane; argument at `session-reopen.js ›
  // messageByTask`): capped here too, an empty body refused, and the version floor applies.
  ipcMain.handle('sessions:message', appWindowOnly('sessions:message', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const text = String(p.text == null ? '' : p.text).slice(0, MESSAGE_CAP).trim();
    if (!text) return { ok: false, reason: 'empty' };
    try {
      if (require('./version-gate').isBlocked()) return { ok: false, reason: 'blocked' };
    } catch (_err) {}
    const engine = require('./session-engine');
    if (typeof engine.messageByTask !== 'function') return { ok: false };
    return engine.messageByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
      text: text,
    });
  }));

  // The agent window's first paint (the ring is push-only): read-only, and it hands over an ADDRESS, not a key.
  ipcMain.handle('sessions:narration', appWindowOnly('sessions:narration', { entries: [] }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { entries: [] };
    const engine = require('./session-engine');
    if (typeof engine.narrationFor !== 'function') return { entries: [] };
    return { entries: engine.narrationFor({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
    }) };
  }));

  // Pause / End MY OWN agent: stop verbs that widen nothing (the registry holds only this operator's sessions).
  const control = (action) => (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.controlByTask !== 'function') return { ok: false };
    return engine.controlByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      agentId: asAgentId(p.agentId),
      action: action,
    });
  };
  ipcMain.handle('sessions:pause', appWindowOnly('sessions:pause', { ok: false }, control('pause')));
  ipcMain.handle('sessions:end', appWindowOnly('sessions:end', { ok: false }, control('end')));

  // Approve / Deny ONE held tool call, inline (body and argument: `session-answer-permission.js`).
  ipcMain.handle('sessions:answerPermission', appWindowOnly('sessions:answerPermission', { ok: false }, (_event, payload) => (
    require('./session-answer-permission').answerPermission(payload)
  )));

  // End-then-purge my own agent's LOCAL traces (body: `session-delete-op.js`); never a channel message.
  ipcMain.handle('sessions:delete', appWindowOnly('sessions:delete', { ok: false }, (_event, payload) => (
    require('./session-delete-op').deleteAgent(payload)
  )));

  // What the operator calls an agent: display only, never an address; empty clears. The answer is main's stored
  // value, and the commit flushes the summary (`agent-identity-commit.js`).
  ipcMain.handle('sessions:rename', appWindowOnly('sessions:rename', { ok: false }, (_event, payload) => {
    const p = payload || {};
    const agentId = asAgentId(p.agentId);
    if (!agentId) return { ok: false };
    const res = require('./agent-identity-commit').commitRename(agentId, p.name);
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, displayName: res.name };
  }));

  // What the agent is FOR — rename's twin, same contract.
  ipcMain.handle('sessions:describe', appWindowOnly('sessions:describe', { ok: false }, (_event, payload) => {
    const p = payload || {};
    const agentId = asAgentId(p.agentId);
    if (!agentId) return { ok: false };
    const stored = require('./agent-identity-commit').commitDescribe(agentId, p.description);
    if (stored === null) return { ok: false, reason: 'bad-description' };
    return { ok: true, description: stored || null };
  }));

  // One fresh instance id, reserved for nobody (the launch panel shows it before the spawn).
  ipcMain.handle('sessions:mintAgentId', appWindowOnly('sessions:mintAgentId', { ok: false }, () => (
    { ok: true, agentId: newAgentId() }
  )));

  // Sign this Mac in to one runtime, then release that runtime's held sessions (body: `runtime-credentials.js`).
  // `runtimeId` is `''` (the default runtime) or a registry-shaped id; anything else refuses before any work.
  ipcMain.handle('runtime:signIn', appWindowOnly('runtime:signIn', { ok: false }, (_event, payload) => {
    const runtimeId = runtimeIdOf(payload);
    return runtimeId === null ? { ok: false } : require('./runtime-credentials').signIn(runtimeId);
  }));

  // "Enable Chrome & connectors": one runtime's optional full login (body: `runtime-credentials.js › signInFull`).
  ipcMain.handle('runtime:signInFull', appWindowOnly('runtime:signInFull', { ok: false }, (_event, payload) => {
    const runtimeId = runtimeIdOf(payload);
    return runtimeId === null ? { ok: false } : require('./runtime-credentials').signInFull(runtimeId);
  }));

  // Every in-app-sign-in runtime's credential status; the same rows `dopl:runtime-credentials` pushes.
  ipcMain.handle('runtime:credentialStatus', appWindowOnly('runtime:credentialStatus', { runtimes: [] }, async () => (
    { runtimes: await require('./runtime-credentials').list() }
  )));

  // The operator closed one runtime's sign-in prompt.
  ipcMain.handle('runtime:dismissSignInPrompt', appWindowOnly('runtime:dismissSignInPrompt', { ok: false }, (_event, payload) => {
    const runtimeId = runtimeIdOf(payload);
    return { ok: !!runtimeId && require('./runtime-credentials').dismissPrompt(runtimeId) };
  }));

  // The pop-out thread window: three router-path strings, none trusted; the version floor applies.
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
    } catch (_err) {}
    return require('./popout-window').openThreadWindow({
      segment: p.segment,
      channelId: p.channelId,
      threadId: p.threadId,
    });
  }));
}

// `asAgentId` is exported so the agent-window op reads it rather than respelling it.
module.exports = { register, MESSAGE_CAP, asAgentId };

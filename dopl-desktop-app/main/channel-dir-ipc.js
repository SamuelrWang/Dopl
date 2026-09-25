// IPC for the per-channel settings the SPA can reach (working folder, launch posture, agent
// chaining, agent defaults) and the machine-wide orchestrator toggles; `renderer/app-preload.js`
// exposes them as `window.dopl.channels.*` / `.orchestrator.*`. Session/window ops are
// `session-ipc-ops.js`, registered from here so index.js has one entry point.
// Every handler is sender-bound (H3): `appWindowOnly` admits only an app-owned window's TOP frame
// (`ipc-guards.js › isAppWindowSender`; a cross-origin iframe shares its host's webContents). It is
// written literally at each registration — `test/channel-ipc-sender.test.mjs` reads that shape — and
// each op's refusal equals its own bad-payload answer, so a page cannot probe which window it is in.
// Channel ids are UUID-gated; folder ops answer abbreviated labels only, never an absolute path.

const { ipcMain } = require('electron');
const { isAppWindowSender, isUuid } = require('./ipc-guards');
const channelDirs = require('./channel-dirs');
const channelPrefs = require('./channel-prefs');
const channelRuntime = require('./channel-runtime');
const channelRuntimeReply = require('./channel-runtime-reply');
const agentDefaults = require('./agent-defaults');
const selectionShape = require('./launch-selection');
const sessionIpcOps = require('./session-ipc-ops');
const { diag } = require('./diag');

// A posture write applies to the agents already running in the room (Samuel, 2026-08-25), through
// the existing live op (`setModeByTask`, where coercion and the windowless floor live). Axis A goes
// only to sessions whose OWN runtime's tool mode moved, in that runtime's words (a containment value
// such as a sandbox is spawn-time and waits for the next launch); Axis B to every
// session when it moved (P3-02). Unpinned, so a per-agent pick keeps narrowing (C2). Addressed per
// agent, never per thread. Best-effort: the durable write has already landed. Returns the count.
function applyPostureToLive(channelId, before, after) {
  if (!before || !after) return 0;
  let applied = 0;
  try {
    const engine = require('./session-engine');
    if (typeof engine.listLiveSessions !== 'function' || typeof engine.setModeByTask !== 'function') return 0;
    const c = require('./runtime').selectionContext();
    const toolsOf = (sel, rt) => selectionShape.settingsFor(c, sel, rt).tools;
    for (const row of engine.listLiveSessions()) {
      if (!row || row.channelId !== channelId) continue;
      const target = { channelId: channelId, taskId: row.taskId || '', agentId: row.agentId || '' };
      const rt = row.runtimeId || c.defaultId;
      const tools = toolsOf(after, rt);
      const results = [];
      if (tools !== toolsOf(before, rt)) results.push(engine.setModeByTask({ axis: 'tools', mode: tools, ...target }));
      if (after.messages !== before.messages) results.push(engine.setModeByTask({ axis: 'messages', mode: after.messages, ...target }));
      if (results.some((r) => r && r.ok)) applied += 1;
    }
  } catch (err) {
    diag('channel-dir ipc: live posture fan-out failed', err && err.message);
    return applied;
  }
  if (applied) diag('channel-dir ipc: posture applied to', applied, 'live session(s)', String(channelId).slice(0, 8));
  return applied;
}

// `opts.onChanged()` refreshes the tray's folder menu; `opts.getSenderIds()` is the live set of
// app-window webContents ids (`app-windows.js › senderIds`). Absent, every handler fails CLOSED.
function register(opts = {}) {
  const onChanged = typeof opts.onChanged === 'function' ? opts.onChanged : () => {};
  const getSenderIds = typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  const appWindowOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('channel-dir ipc: refused', name, '— sender is not an app window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // `label` = where the agent really runs (read through the spawn-cwd function, never null);
  // `custom` = whether a per-channel folder is set.
  const folderAnswer = (channelId) => ({
    label: channelDirs.resolvedDirLabel(channelId),
    custom: channelDirs.liveChannelDirLabel(channelId) !== null,
  });

  ipcMain.handle('channels:getFolderLabel', appWindowOnly('getFolderLabel', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return folderAnswer(channelId);
  }));

  // The user picks in the native dialog; the page can never supply a path.
  ipcMain.handle('channels:chooseFolder', appWindowOnly('chooseFolder', null, async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    try {
      await channelDirs.promptAndSetChannelDir(channelId);
    } catch (err) {
      diag('channel-dir ipc choose error', err && err.message);
    }
    onChanged();
    return folderAnswer(channelId); // labels only
  }));

  ipcMain.handle('channels:clearFolder', appWindowOnly('clearFolder', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    channelDirs.clearChannelDir(channelId);
    onChanged();
    return folderAnswer(channelId);
  }));

  // The launch posture read: the selected runtime's `{ tools, messages }` own keys (older SPA rows
  // feature-probe them), the whole `selection` + its `needsReview` sentences (never a read failure),
  // `runtime` (always present; `''` = default) and the runtime roster/catalogs. Disclosure only:
  // spawning from it is `launchStartModes`'s alone (H2).
  ipcMain.handle('channels:getLaunchPosture', appWindowOnly('getLaunchPosture', null, async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    const detail = channelPrefs.getLaunchSelectionDetail(channelId);
    return Object.assign({}, channelPrefs.getLaunchPosture(channelId), {
      selection: detail.selection,
      needsReview: detail.review,
      runtime: channelRuntime.getChannelRuntime(channelId),
    }, await channelRuntimeReply.runtimeReply());
  }));
  // One own-key write through the validating writer (the runtime is a field of the same record).
  // A runtime change is never fanned out: a running session's runtime is stamped at spawn.
  ipcMain.handle('channels:setLaunchPosture', appWindowOnly('setLaunchPosture', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const patch = p.preset && typeof p.preset === 'object' && !Array.isArray(p.preset) ? p.preset : null;
    if (!patch || !Object.keys(patch).length) return { ok: false }; // an empty patch writes nothing (P3-35)
    const before = channelPrefs.getLaunchSelection(p.channelId);
    const res = channelPrefs.setLaunchSelection(p.channelId, patch);
    if (!res || res.ok !== true) return res || { ok: false };
    const runtime = res.selection.runtime;
    return Object.assign({}, res, {
      applied: applyPostureToLive(p.channelId, before, res.selection),
      runtime,
    });
  }));

  // Agent chaining (`channel-agent-chain.js`). A containment bound, so it is stamped at spawn and
  // NOT fanned out to running sessions.
  ipcMain.handle('channels:getAgentChain', appWindowOnly('getAgentChain', false, (_event, channelId) => {
    if (!isUuid(channelId)) return false;
    return channelPrefs.getAgentChain(channelId);
  }));
  ipcMain.handle('channels:setAgentChain', appWindowOnly('setAgentChain', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return { ok: true, on: channelPrefs.setAgentChain(p.channelId, p.on === true) };
  }));

  // Agent defaults (`agent-defaults.js`): machine-user scoped, so no channel id; a forged `apply`
  // can only seed a channel with no posture yet. No live fan-out — they govern rooms not yet made.
  ipcMain.handle('channels:getAgentDefaults', appWindowOnly('getAgentDefaults', null, async () => {
    return Object.assign({}, agentDefaults.getAgentDefaults(), await channelRuntimeReply.runtimeReply());
  }));
  ipcMain.handle('channels:setAgentDefaults', appWindowOnly('setAgentDefaults', { ok: false }, (_event, payload) => {
    const p = payload || {};
    // The shape gate stands in for the UUID gate (there is no id to reject a probe on).
    if (!p.defaults || typeof p.defaults !== 'object' || Array.isArray(p.defaults)) return { ok: false };
    return agentDefaults.setAgentDefaults(p.defaults);
  }));
  // Called once by the renderer that just created the channel; idempotent (`seeded: false`).
  ipcMain.handle('channels:applyAgentDefaults', appWindowOnly('applyAgentDefaults', { ok: false, seeded: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false, seeded: false };
    return agentDefaults.seedChannel(p.channelId);
  }));

  // The two MACHINE-WIDE orchestrator consents (launch over MCP; direct a running agent). This pair
  // is the ONLY way either value moves — never add a route, MCP op or column for them: a spawned
  // session holds the operator's credential and could arm the fleet (§6). Answers are main's own
  // value (`{ok:false}` when the store did not take it), and a refusal reads like "off".
  // `refresh()` is load-bearing: realtime bindings are fixed at join, so a flip must rejoin.
  ipcMain.handle('orchestrator:getLaunchEnabled', appWindowOnly('getLaunchEnabled', { enabled: false }, () =>
    ({ enabled: channelPrefs.getOrchestratorLaunch() })));
  ipcMain.handle('orchestrator:setLaunchEnabled', appWindowOnly('setLaunchEnabled', { ok: false }, (_event, payload) => {
    const want = (payload || {}).enabled === true;
    const got = channelPrefs.setOrchestratorLaunch(want);
    try { require('./launch-directives').refresh(); }
    catch (err) { diag('orchestrator toggle: could not re-arm the directive lane —', err && err.message); }
    return got === want ? { ok: true, enabled: got } : { ok: false, reason: 'store', enabled: got };
  }));

  ipcMain.handle('orchestrator:getDirectEnabled', appWindowOnly('getDirectEnabled', { enabled: false }, () =>
    ({ enabled: channelPrefs.getOrchestratorDirect() })));
  ipcMain.handle('orchestrator:setDirectEnabled', appWindowOnly('setDirectEnabled', { ok: false }, (_event, payload) => {
    const want = (payload || {}).enabled === true;
    const got = channelPrefs.setOrchestratorDirect(want);
    try { require('./agent-directions').refresh(); }
    catch (err) { diag('orchestrator direct toggle: could not re-arm the direction lane —', err && err.message); }
    return got === want ? { ok: true, enabled: got } : { ok: false, reason: 'store', enabled: got };
  }));

  sessionIpcOps.register({ getSenderIds: getSenderIds });
}

module.exports = { register };
